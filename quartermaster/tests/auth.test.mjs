import assert from "node:assert/strict";
import fs from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";

const source = await fs.readFile(new URL("../src/00-api.js", import.meta.url), "utf8");
function fixture() {
  let secret = " fixture-secret ";
  const requests = [];
  const context = vm.createContext({
    Headers, AbortController, Event, FileReader: class {
      readAsDataURL() { this.result = "data:image/png;base64,fixture"; this.onload(); }
    },
    window: { localStorage: { getItem() { if (secret instanceof Error) throw secret; return secret; } } },
    fetch: async (url, options) => {
      requests.push({ url, ...options });
      const authorized = options.headers.get("X-Admin-Secret") === "fixture-secret";
      return { ok: authorized, status: authorized ? 200 : 403,
        json: async () => authorized ? [] : { error: "Invalid or missing X-Admin-Secret header" },
        blob: async () => new Blob(["image"]),
      };
    },
  });
  vm.runInContext(source + "\nglobalThis.api = QM;", context);
  return { api: context.api, requests, context, secret: value => { secret = value; } };
}

test("inventory CRUD, headers, connection reads and live secret changes", async () => {
  const f = fixture();
  await f.api.listItems("chat", "persona");
  await f.api.addItem("chat", "persona", { name: "Sword" });
  await f.api.updateItem("chat", "persona", "item", { name: "Shield" });
  await f.api.deleteItem("chat", "persona", "item");
  await f.api.listImageConnections();
  for (const request of f.requests) assert.equal(request.headers.get("X-Admin-Secret"), "fixture-secret");
  for (const request of f.requests.slice(1, 4)) assert.equal(request.headers.get("x-marinara-csrf"), "1");
  assert.equal(f.requests[0].headers.has("Content-Type"), false);
  assert.equal(f.requests[3].headers.has("Content-Type"), false);
  assert.equal(f.requests[1].headers.get("Content-Type"), "application/json");
  assert.equal(f.requests[4].headers.get("Accept"), "application/json");
  f.secret("wrong");
  await assert.rejects(f.api.listItems("chat", "persona"), /Invalid or missing/);
  f.secret("fixture-secret");
  await f.api.listItems("chat", "persona");
  f.secret(null);
  await assert.rejects(f.api.listItems("chat", "persona"), /Invalid or missing/);
  assert.equal(f.requests.at(-1).headers.has("X-Admin-Secret"), false);
  f.secret(new Error("Storage disabled"));
  await assert.rejects(f.api.listItems("chat", "persona"), /Invalid or missing/);
});

test("protected images authenticate, native/external images never receive the secret", async () => {
  const f = fixture();
  const image = { dispatchEvent() { throw new Error("Unexpected image failure"); } };
  for (const url of [f.api.slotIconUrl("head"), f.api.itemImageUrl("chat", "persona", "item"), f.api.outfitPortraitUrl("chat", "persona", "outfit")]) {
    await f.api.setImageSource(image, url);
    assert.equal(f.requests.at(-1).headers.get("X-Admin-Secret"), "fixture-secret");
    assert.match(image.src, /^data:image/);
    assert.equal(url.includes("fixture-secret"), false);
  }
  await f.api.setImageSource(image, "https://example.com/avatar.png");
  assert.equal(f.requests.length, 3);
  assert.equal(image.src, "https://example.com/avatar.png");
});

test("late image responses cannot overwrite replacement portraits; failures use fallback", async () => {
  const f = fixture();
  let release;
  f.context.fetch = () => new Promise(resolve => { release = resolve; });
  const image = { src: "", dispatchEvent() {} };
  const pending = f.api.setImageSource(image, f.api.slotIconUrl("head"));
  await f.api.setImageSource(image, "/api/personas/avatar");
  release({ ok: true, blob: async () => new Blob(["image"]) });
  await pending;
  assert.equal(image.src, "/api/personas/avatar");
  const denied = fixture(); denied.secret("bad");
  let errors = 0;
  await denied.api.setImageSource({ dispatchEvent(event) { assert.equal(event.type, "error"); errors++; } }, denied.api.slotIconUrl("head"));
  assert.equal(errors, 1);
});

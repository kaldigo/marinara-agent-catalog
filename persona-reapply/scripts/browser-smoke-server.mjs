import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const clientPath = path.resolve(__dirname, "..", "dist", "package", "client.js");
const port = Number(process.env.PERSONA_REAPPLY_SMOKE_PORT || 41739);

const update = {
  messageId: "message-1",
  previousSnapshot: { nameColor: "#991b1b", dialogueColor: "#1d4ed8", boxColor: "#374151" },
  personaSnapshot: { personaId: "persona-1", nameColor: "#16a34a", dialogueColor: "#c026d3", boxColor: "#fef3c7" },
};

const server = http.createServer(async (request, response) => {
  if (request.url === "/client.js") {
    response.writeHead(200, { "Content-Type": "text/javascript; charset=utf-8" });
    response.end(fs.readFileSync(clientPath));
    return;
  }
  const isPersonaPost =
    request.method === "POST" &&
    (request.url?.endsWith("/all") || request.url?.includes("/messages/message-1"));
  if (isPersonaPost) {
    const body = await readBody(request);
    if (request.headers["content-type"]?.includes("application/json") && body.trim() === "") {
      response.writeHead(400, { "Content-Type": "application/json" });
      response.end(JSON.stringify({ error: "Body cannot be empty when content-type is application/json" }));
      return;
    }
  }
  if (request.method === "POST" && request.url?.endsWith("/all")) {
    sendJson(response, { updated: 1, skipped: 0, updates: [update] });
    return;
  }
  if (request.method === "POST" && request.url?.includes("/messages/message-1")) {
    sendJson(response, { updated: 1, skipped: 0, update });
    return;
  }
  response.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
  response.end(`<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <title>Persona Reapply browser smoke</title>
    <style>
      :root { --foreground: #f9fafb; }
      body { margin: 2rem; font-family: system-ui, sans-serif; background: #111827; color: #f9fafb; }
      [data-chat-mode] { max-width: 42rem; }
      [data-message-id] { padding: 1rem; }
      .mari-message-bubble { padding: 1rem; border-radius: 1rem; background: #374151; }
      .mari-message-actions { display: flex; min-height: 2rem; align-items: center; gap: .25rem; }
      .native-action-reference {
        display: inline-flex; width: 1.7em; height: 1.7em; flex: 0 0 auto; align-items: center;
        justify-content: center; box-sizing: border-box; border: 0; border-radius: .375rem;
        background: transparent; color: color-mix(in srgb, var(--foreground) 40%, transparent);
        padding: 0; font: inherit; font-size: .8125rem; line-height: 1;
      }
      form { display: flex; gap: .5rem; margin-top: 1rem; }
      textarea { flex: 1; min-height: 3rem; }
    </style>
  </head>
  <body>
    <main data-chat-mode="roleplay">
      <article data-message-id="message-1" data-message-role="user">
        <div class="mari-message-name" style="color:#991b1b">Persona One</div>
        <div class="mari-message-bubble mari-rp-bubble">
          <div class="mari-message-content"><span style="color:#1d4ed8">&quot;Hello&quot;</span></div>
        </div>
        <div class="mari-message-actions"><button class="native-action-reference" aria-label="Native action reference">N</button></div>
      </article>
    </main>
    <form><textarea aria-label="Message composer"></textarea><button type="submit">Send</button></form>
    <script type="module" src="/client.js"></script>
  </body>
</html>`);
});

server.listen(port, "127.0.0.1", () => {
  console.log(`Persona Reapply browser smoke server listening on http://127.0.0.1:${port}/chat/chat-1`);
});

function sendJson(response, body) {
  response.writeHead(200, { "Content-Type": "application/json" });
  response.end(JSON.stringify(body));
}

async function readBody(request) {
  const chunks = [];
  for await (const chunk of request) chunks.push(chunk);
  return Buffer.concat(chunks).toString("utf8");
}

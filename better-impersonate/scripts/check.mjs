import assert from "node:assert/strict";
import { buildRequest, extractContinuationSuffix, appendContinuation } from "../src/client/request.js";
import { createInlineThinkingStreamFilter } from "../src/client/thinking-tags.js";
import { createController } from "../src/client/controller.js";
import { consumeDryRun, preflight } from "../src/client/transport.js";
import { readRecall } from "../src/client/recall.js";
const memory = new Map();
globalThis.localStorage = { getItem: k => memory.get(k) ?? null, setItem: (k,v) => memory.set(k,v) };
const settings = { impersonatePromptTemplate: "Unchanged", impersonatePresetId: "p", impersonateConnectionId: "c" };
assert.equal(buildRequest("a", "continue", "Draft", settings).impersonatePromptTemplate, "Unchanged");
assert.match(buildRequest("a", "continue", "Draft").userMessage, /Return only new continuation/);
assert.equal(buildRequest("a", "impersonate", "Guidance").userMessage, "Guidance");
assert.equal(extractContinuationSuffix("Hello", "Hello world"), " world");
assert.equal(extractContinuationSuffix("Hello", "Hel"), "");
assert.equal(extractContinuationSuffix("Hello", "Hello"), "");
assert.equal(extractContinuationSuffix("Hello", "Again Hello"), "Again Hello");
assert.equal(extractContinuationSuffix("Hello ", " Hello world"), " world");
assert.equal(appendContinuation("Hello", ", friend"), "Hello, friend");
for (const text of ["<think>secret</think>Hello", "<thinking>secret</thinking>Hello",
  "[thought]secret[/thought]Hello", "<custom>secret</custom>Hello"]) {
  for (let split = 1; split < text.length; split++) {
    const filter = createInlineThinkingStreamFilter([{open:"<custom>",close:"</custom>"}]);
    const visible = filter.push(text.slice(0,split)).visible + filter.push(text.slice(split)).visible + filter.flush().visible;
    assert.equal(visible, "Hello");
  }
}
const unfinished = createInlineThinkingStreamFilter();
assert.equal(unfinished.push("<think>unfinished private reasoning").visible + unfinished.flush().visible, "");
const encoder = new TextEncoder();
function stream(events) {
  const encoded = events.map(event => "data: " + JSON.stringify(event) + "\r\n\r\n").join("");
  return new Response(new ReadableStream({start(c) {
    for (const byte of encoder.encode(encoded)) c.enqueue(new Uint8Array([byte]));
    c.close();
  }}));
}
let output = "<think>secret</think>Hello";
let missing = false;
let failure = false;
let held;
let requests = [];
globalThis.fetch = async (url, options) => {
  requests.push({url, options});
  if (url.endsWith("/installed")) return Response.json(missing ? [] : [{id:"better-impersonate",status:"active"}]);
  if (url.includes("/chats/")) return Response.json({mode:"roleplay"});
  if (url.endsWith("/abort")) return Response.json({ok:true});
  if (failure) return Response.json({error:"Model unavailable"}, {status:503});
  if (held) return new Promise((resolve,reject) => {
    held.resolve = resolve;
    options.signal.addEventListener("abort", () => reject(new DOMException("Aborted","AbortError")), {once:true});
  });
  return stream([{type:"dryrun_started",data:{runId:"run-1"}},{type:"token",data:output},
    {type:"result",data:{content:output}},{type:"done",data:""}]);
};
let value = "Guidance";
let valid = true;
let releases = 0;
let locks = 0;
const host = { context: () => ({
  chatId:"a", busy:false, isBusy:()=>false, read:()=>value, write:v=>{value=v;},
  valid:()=>valid, lock:()=>{locks++; return ()=>releases++;},
}) };
const controller = createController(host, localStorage);
await controller.start("impersonate");
assert.equal(value,"Hello");
assert.equal(readRecall(localStorage,"a").lastGuidance,"Guidance");
output = "<thinking>secret</thinking>Hello world";
await controller.start("continue");
assert.equal(value,"Hello world");
assert.equal(readRecall(localStorage,"a").lastGuidance,"Guidance");
controller.restore(); assert.equal(value,"Guidance");
output = "<think>reasoning only";
await controller.start("impersonate"); assert.equal(value,"Guidance");
missing = true;
const beforeLocks = locks;
await assert.rejects(controller.start("impersonate"), /no longer installed/);
assert.equal(locks,beforeLocks);
assert.equal(value,"Guidance");
missing = false; failure = true;
await assert.rejects(controller.start("impersonate"), /Model unavailable/);
assert.equal(value,"Guidance"); failure = false;
held = {};
const running = controller.start("impersonate");
while (!held.resolve) await new Promise(resolve=>setImmediate(resolve));
await assert.rejects(controller.start("impersonate"), /already running/);
controller.cancel(); await running;
assert.equal(controller.active,null);
assert.equal(value,"Guidance");
held = {};
const switching = controller.start("impersonate");
while (!held.resolve) await new Promise(resolve=>setImmediate(resolve));
valid = false; value = "Other chat";
held.resolve(stream([{type:"token",data:"Late reply"},{type:"done",data:""}]));
await switching;
assert.equal(value,"Other chat");
assert.equal(locks,releases);
await assert.rejects(consumeDryRun(stream([{type:"token",data:"truncated"}]),()=>{}),/disconnected/);
assert(requests.filter(r=>r.options.method==="POST").every(r=>r.options.headers["x-marinara-csrf"]==="1"));
globalThis.fetch = async url => {
  if (url.endsWith("/installed")) return Response.json([{id:"better-impersonate",status:"active"}]);
  if (url.includes("/chats/")) return Response.json({mode:"roleplay",connectionId:"random",promptPresetId:"chat-preset"});
  if (url.endsWith("/prompts/explicit")) return Response.json({parameters:{customThinkingTags:[{open:"<private>",close:"</private>"}]}});
  return Response.json({error:"Not found"},{status:404});
};
const signal = new AbortController().signal;
assert.equal((await preflight("a",{impersonatePresetId:"explicit"},signal))[0].open,"<private>");
await assert.rejects(preflight("a",{},signal),/Select an impersonation preset/);
await assert.rejects(preflight("a",{impersonateConnectionId:"deleted",impersonatePresetId:"deleted"},signal),/Select an impersonation preset/);
console.log("Passed request, reasoning chunk boundaries, recall, continuation, preflight, failure, cancellation and chat-switch checks.");

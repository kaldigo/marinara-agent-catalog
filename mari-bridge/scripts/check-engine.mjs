// Current Engine integration checks. No server, provider, or shared data is used.
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { __test as handoff } from "../src/server/turn-handoff-registry.js";
import { createSpatialDirectiveCompatibilityStreamFilter } from "../src/server/spatial-directive-compat.js";
const args=Object.fromEntries(process.argv.slice(2).map(v=>{const i=v.indexOf("=");return [v.slice(0,i),v.slice(i+1)];}));
if(!args["--engine"]||!args["--typescript"])throw Error("Required --engine=<built 2.4.6 checkout> --typescript=<typescript.js>");
const engine=path.resolve(args["--engine"]), moduleUrl=(p)=>pathToFileURL(path.join(engine,p)).href;
const manifest=JSON.parse(await fs.readFile(path.join(engine,"package.json"),"utf8"));
assert.equal(manifest.version,"2.4.6");
process.env.MARI_BRIDGE_DISABLE="1";
const {patchServerModule,preflightServerPatches}=await import("../bootstrap/runtime.mjs");
assert.equal(preflightServerPatches(engine),true);
const ts=(await import(pathToFileURL(path.resolve(args["--typescript"])).href)).default;
const dist="packages/server/dist/routes/generate.routes.js";
const patched=patchServerModule(moduleUrl(dist),await fs.readFile(path.join(engine,dist),"utf8"));
const ast=ts.createSourceFile(dist,patched,ts.ScriptTarget.Latest,true,ts.ScriptKind.JS);
let push,flush;
const reads=[];
function visit(n){
 if(ts.isVariableDeclaration(n)&&n.name.getText(ast)==="sendTokenTextChunked")push=n.initializer.getText(ast);
 if(ts.isBlock(n)&&n.statements.some(s=>ts.isVariableStatement(s)&&s.declarationList.declarations.some(d=>d.name.getText(ast)==="pendingChanceText")))flush=n.getText(ast);
 if(ts.isPropertyAssignment(n)&&n.name.getText(ast)==="read"&&n.initializer.getText(ast).includes("gameStateStore.getByChatAndMessage"))reads.push(n.initializer.getText(ast));
 ts.forEachChild(n,visit);
}visit(ast);
assert.ok(push&&flush,"extract the actual compiled generation callbacks");
assert.equal(reads.length,2,"main expansion and application both read the exact target snapshot");
const {createGameStateStorage}=await import(moduleUrl("packages/server/dist/services/storage/game-state.storage.js"));
assert.equal(typeof createGameStateStorage({}).getByChatAndMessage,"function");
for(const source of reads){
 const calls=[];
 const read=new Function("gameStateStore","input","messageId","targetSwipeIndex","trackerBaseGameStateSnapshot","parseGameStateRow",`return (${source});`)(
  {async getByChatAndMessage(...args){calls.push(args);return {id:"exact"};}}, {chatId:"chat"},"message",3,{id:"base"},v=>v);
 assert.deepEqual(await read(),{id:"exact"});assert.deepEqual(calls,[["chat","message",3]]);
}
const {createGameChanceStreamFilter}=await import(moduleUrl("packages/server/dist/services/game/chance-stream-filter.js"));
const {RoleplayCommandStreamFilter}=await import(moduleUrl("packages/server/dist/services/generation/roleplay-commands.js"));
const {createAssistantSpatialDirectiveStreamFilter}=await import(moduleUrl("packages/server/dist/services/spatial-context/state-resolution.js"));
const make=new Function("roleplayCommandStreamFilter","gameChanceStreamFilter","turnHandoffStreamFilter","bridgedSpatialDirectiveStreamFilter","spatialDirectiveStreamFilter","recordReasoningDuration","emitTokenTextChunked",`return {push: ${push},flush:async()=>${flush}};`);
let cases=0;
for(const [text,expected] of [
 ["Hello ordinary text", "Hello ordinary text"],
 ['Visible <next_speaker>char-2</next_speaker>', 'Visible '],
 ['Visible &lt;next_speaker&gt;char-2&lt;/next_speaker&gt;', 'Visible '],
 ['Before [[roll: 1d6]] after', 'Before  after'],
 ['Before [[roll: 1d6 <next_speaker>char-2</next_speaker>', 'Before [[roll: 1d6 '],
 ['Before [[roll: 1d6 <spatial_move: destination_id="room"/>', 'Before [[roll: 1d6 '],
 ['Walk <spatial_move: destination_id="room"/> onward', 'Walk  onward'],
 ['Walk [spatial_move: destination_id="room"] onward', 'Walk  onward'],
])for(const chunkSize of [1,2,5,13,1000]){
 let output="";
 const stream=make(null,createGameChanceStreamFilter(),handoff.createTerminalMarkerStreamFilter(),createSpatialDirectiveCompatibilityStreamFilter(),createAssistantSpatialDirectiveStreamFilter(),()=>{},async chunk=>{output+=chunk;});
 for(let i=0;i<text.length;i+=chunkSize)await stream.push(text.slice(i,i+chunkSize));
 await stream.flush();assert.equal(output,expected,`chunk=${chunkSize} text=${text}`);cases++;
}
// A Roleplay command is consumed by its native owner before Bridge filters.
let output="";
const stream=make(new RoleplayCommandStreamFilter(),null,handoff.createTerminalMarkerStreamFilter(),null,null,()=>{},async s=>{output+=s;});
await stream.push('Hello [roll: 1d6] world <next_speaker>char-2</next_speaker>');await stream.flush();
assert.equal(output,'Hello  world ');
// No optional filter must leave streaming byte-for-byte intact, including EOF.
output="";const inert=make(null,null,null,null,null,()=>{},async s=>{output+=s;});await inert.push('unaltered <text>');await inert.flush();assert.equal(output,'unaltered <text>');
console.log(`Engine ${manifest.version}: current storage API, both exact snapshot callbacks, ${cases+2} executable stream-chain cases passed.`);

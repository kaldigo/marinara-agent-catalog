// Executes the actual patched worker, native storage, generation route and
// compiled client applier. All DB/overlay output is isolated in a temporary dir.
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
import { prepareServerOverlay } from "../src/server/server-overlay.js";
import { patchScriptGameStateClient, prepareClientOverlay } from "../src/server/client-overlay.js";
import { prepareScriptGameStatePatch, mergeScriptGameStateEffects } from "../src/server/script-game-state.js";

const args = Object.fromEntries(process.argv.slice(2).map((arg) => {
  const i = arg.indexOf("="); return [arg.slice(0, i), arg.slice(i + 1)];
}));
if (!args["--engine"] || !args["--typescript"]) throw Error("Required --engine=<built 2.4.6 checkout> --typescript=<typescript.js>");
const engine = path.resolve(args["--engine"]);
const root = await fs.mkdtemp(path.join(os.tmpdir(), "mari-script-game-state-"));
Object.assign(process.env, { MARI_BRIDGE_DISABLE: "1", DATA_DIR: path.join(root, "data"),
  FILE_STORAGE_DIR: path.join(root, "storage"), NODE_ENV: "test", MARINARA_LITE: "true", LOG_LEVEL: "silent",
  CUSTOM_TOOL_SCRIPT_ENABLED: "true", CUSTOM_TOOL_TIMEOUT_MS: "1000" });
const { patchServerModule, preflightServerPatches, SERVER_PATCH_TARGETS } = await import("../bootstrap/runtime.mjs");
assert.equal(preflightServerPatches(engine), true);
const overlay = await prepareServerOverlay({ engineRoot: engine, dataDir: root, engineVersion: "2.4.6",
  bridgeVersion: "test", patchTargets: SERVER_PATCH_TARGETS, patchModule: patchServerModule });
const module = (file) => import(pathToFileURL(path.join(overlay.root, file)).href);
const requireServer = createRequire(path.join(overlay.root, "entry.js"));
const shared = await module("node_modules/@marinara-engine/shared/dist/index.js");
const prepare = (patch, current = null, spatial = false) => prepareScriptGameStatePatch(patch, current, spatial,
  shared.applyTrackerFieldLocksToGameStatePatch, shared.normalizeWorldCustomFields);
let closeDB, app, originalProvider, Provider;
let assertions = 0;
try {
  const { executeToolCalls } = await module("services/tools/tool-executor.js");
  const toolCall = (name = "fixture_script", patch = {}) => ({ id: "script", type: "function",
    function: { name, arguments: JSON.stringify(patch) } });
  const execute = async (scriptBody, context = {}, patch = {}) => (await executeToolCalls([toolCall("fixture_script", patch)], {
    prepareScriptGameStatePatch: prepare,
    ...context,
    customTools: [{ name: "fixture_script", executionType: "script", scriptBody, validateArguments: () => null }],
  }))[0];
  const ordinary = await execute("return { unchanged: true };");
  assert.deepEqual(JSON.parse(ordinary.result), { unchanged: true });
  assert.equal(ordinary.noFollowup, undefined);
  for (const value of [true, false, "true", 1, null]) {
    const result = await execute(`return { noFollowup: ${JSON.stringify(value)}, result: "Done" };`);
    assert.equal(result.noFollowup === true, value === true);
    assert.deepEqual(JSON.parse(result.result), { noFollowup: value, result: "Done" });
  }
  const noFollowupPatch = await execute('mari.gameState.patch({time:"12:00"}); return {noFollowup:true};');
  assert.equal(noFollowupPatch.noFollowup, true);
  assert.deepEqual(noFollowupPatch.mariBridgeScriptPatch, {time:"12:00"});
  const noFollowupError = await execute('mari.gameState.patch({time:"12:00"}); return {error:"Handled failure",noFollowup:true};');
  assert.equal(noFollowupError.noFollowup, true);
  assert.equal(noFollowupError.success, false);
  assert.equal(noFollowupError.mariBridgeScriptPatch, undefined);
  const rejectedNoFollowupPatch = await execute('mari.gameState.patch({committed:true}); return {noFollowup:true};');
  assert.equal(rejectedNoFollowupPatch.noFollowup, true);
  assert.equal(rejectedNoFollowupPatch.success, false);
  assert.equal(rejectedNoFollowupPatch.mariBridgeScriptPatch, undefined);
  const successful = await execute('mari.gameState.patch({time:"12:00"}); mari.gameState.patch({weather:"Rain"}); mari.gameState.patch({time:"12:05"}); return {ok:true};');
  assert.equal(successful.success, true, successful.result);
  assert.deepEqual(successful.mariBridgeScriptPatch, { time: "12:05", weather: "Rain" });
  assert.equal(JSON.parse(successful.result).gameState.pending, true);
  for (const script of [
    'mari.gameState.patch({time:"12:00"}); throw Error("broken");',
    'mari.gameState.patch({time:"12:00"}); return {error:"failed"};',
    'mari.gameState.patch({time:"12:00"}); while(true){}',
    'mari.gameState.patch({committed:true});',
    'mari.gameState.patch({playerStats:{fieldLocks:{}}});',
    'mari.gameState.patch({personaStats:[{name:"HP",value:"bad",max:10,color:"red"}]});',
    'mari.gameState.patch(JSON.parse(\'{"__proto__":{}}\'));',
  ]) {
    const result = await execute(script);
    assert.equal(result.success, false, script);
    assert.equal(result.mariBridgeScriptPatch, undefined);
    assertions++;
  }
  assert.equal((await execute('mari.gameState.patch({time:"1"});', { prepareScriptGameStatePatch: undefined })).success, false);
  process.env.CUSTOM_TOOL_SCRIPT_ENABLED = "false";
  assert.equal((await execute('mari.gameState.patch({time:"1"});')).success, false);
  process.env.CUSTOM_TOOL_SCRIPT_ENABLED = "true";
  const stats = [{ name: "Energy", value: 8, max: 10, color: "green" }];
  const character = { characterId: "npc", name: "NPC", emoji: "N", mood: "Calm", appearance: null,
    outfit: null, customFields: { occupation: "Guard" }, stats, thoughts: null };
  const player = { stats, attributes: null, skills: {}, inventory: [{ name: "Key", description: "Brass", quantity: 1, location: "pocket" }],
    activeQuests: [{ questEntryId: "q", name: "Find key", currentStage: 0, objectives: [{text:"Search", completed:false}], completed:false }],
    status: "Ready", customTrackerFields: [{ name: "Trust", value: "High" }] };
  const initial = { chatId: "fixture", messageId: "old", swipeIndex: 0, date: "Day 1", time: "10:00", location: "Square",
    weather: "Clear", temperature: "20°C", worldCustomFields: [{name:"Season",value:"Summer",icon:"sun"}],
    presentCharacters: [character], recentEvents: ["Old event"], playerStats: player, personaStats: stats,
    fieldLocks: null, hiddenTrackerFields: {"world.date":true}, committed: true };
  for (const [patch, locks] of [
    [{ weather: "Rain", time: "12:00" }, { [shared.worldTrackerLockKey("weather")]: true }],
    [{ presentCharacters: [] }, { [shared.characterTrackerLockKey(character, 0, "mood")]: true }],
    [{ personaStats: null }, { [shared.personaStatTrackerLockKey(stats[0], "value", 0)]: true }],
    [{ playerStats: null }, { [shared.customTrackerLockKey(player.customTrackerFields[0], "value", 0)]: true }],
    [{ worldCustomFields: [{name:"Season",value:"Winter"}] }, { [shared.worldCustomFieldTrackerLockKey(initial.worldCustomFields[0], "value", 0)]: true }],
  ]) {
    assert.throws(() => prepare(patch, {...initial, fieldLocks: locks}), /locked/);
    assertions++;
  }
  assert.throws(() => prepare({location:"Elsewhere"}, initial, true), /Spatial Context/);
  assert.throws(()=>prepare({presentCharacters:[character,{...character,mood:"Bypass"}]},initial),/Duplicate/);
  assert.throws(()=>prepare({personaStats:[stats[0],{...stats[0],value:0}]},initial),/Duplicate/);
  assert.throws(()=>prepare({playerStats:{inventory:[player.inventory[0],player.inventory[0]]}},initial),/Duplicate/);
  assert.deepEqual(prepare({worldCustomFields:{removed:["Season"]}},initial).worldCustomFields,[]);
  assert.throws(()=>prepare({worldCustomFields:{removed:["Season"]}},{...initial,fieldLocks:{
    [shared.worldCustomFieldTrackerLockKey(initial.worldCustomFields[0],"value",0)]:true}}),/locked/);
  assert.equal(prepare({playerStats:{status:"Tired"}}, initial).playerStats.inventory[0].name, "Key");
  assert.deepEqual(mergeScriptGameStateEffects([{type:"game_state_patch",patch:{playerStats:{status:"Tired"}}},
    {type:"game_state_patch",patch:{playerStats:{skills:{Stealth:2}}}}]).playerStats, {status:"Tired",skills:{Stealth:2}});

  const connection = await module("db/connection.js");
  closeDB = connection.closeDB;
  const db = await connection.getDB();
  const { createGameStateStorage } = await module("services/storage/game-state.storage.js");
  const states = createGameStateStorage(db);
  await states.create(initial);
  const base = await states.getLatest("fixture");
  const target = {messageId:"new",swipeIndex:0,baseSnapshot:base,isAborted:()=>false};
  const patch = {date:"Day 2",time:"12:05",weather:"Rain",temperature:"14°C",location:"Harbor",
    recentEvents:["Arrived"], presentCharacters:[],personaStats:null,playerStats:{status:"Tired",activeQuests:[]}};
  const stored = await states.updateFromScript("fixture",patch,false,target);
  assert.equal(stored.messageId,"new");
  assert.equal(stored.weather,"Rain");
  assert.deepEqual(stored.recentEvents,["Arrived"]);
  assert.deepEqual(stored.playerStats.activeQuests,[]);
  assert.equal(stored.playerStats.inventory[0].name,"Key");
  assert.deepEqual(stored.hiddenTrackerFields,initial.hiddenTrackerFields);
  assert.equal((await states.getById(base.id,"fixture")).weather,"Clear");
  await states.updateFromScript("fixture",{recentEvents:["Updated"]},false,target);
  assert.deepEqual(JSON.parse((await states.getByChatAndMessage("fixture","new",0)).recentEvents),["Updated"]);
  await states.updateFromScript("fixture",{weather:"Snow"},false,{...target,swipeIndex:1,baseSnapshot:await states.getByChatAndMessage("fixture","new",0)});
  assert.equal((await states.getByChatAndMessage("fixture","new",0)).weather,"Rain");
  assert.equal((await states.getByChatAndMessage("fixture","new",1)).weather,"Snow");
  await states._applyUpdate(base,{fieldLocks:{[shared.worldTrackerLockKey("weather")]:true}});
  await assert.rejects(states.updateFromScript("fixture",{time:"99:00",weather:"Snow"},false,{...target,messageId:"blocked"}),/locked/);
  assert.equal(await states.getByChatAndMessage("fixture","blocked",0),null);
  await assert.rejects(states.updateFromScript("fixture",{time:"99:00"},false,{...target,isAborted:()=>true}),/cancelled/);

  // The full native generation route establishes the pending/save/failure contract.
  const { createChatsStorage } = await module("services/storage/chats.storage.js");
  const { createConnectionsStorage } = await module("services/storage/connections.storage.js");
  const { createCustomToolsStorage } = await module("services/storage/custom-tools.storage.js");
  const chats = createChatsStorage(db);
  const custom = createCustomToolsStorage(db);
  const customTool = await custom.create({name:"fixture_script",executionType:"script",enabled:true,
    description:"Fixture state patch",parametersSchema:{type:"object",properties:{}},
    includeHiddenContext:true,
    scriptBody:'mari.gameState.patch({weather:args.weather || "Rain", time:"12:05", recentEvents:["Tool updated state"], playerStats:{status:"Tired"}}); return {ok:true, previousWeather:context.gameState?.weather};'});
  const conn = await createConnectionsStorage(db).create({name:"Fixture",provider:"openai",model:"fixture",apiKey:"synthetic"});
  Provider = (await module("services/llm/providers/openai.provider.js")).OpenAIProvider;
  originalProvider = Provider.prototype.chatComplete;
  let failBeforeSave = false, emptyResponse = false, requestWeather = "Rain", beforeSave;
  const priorWeather=[];
  Provider.prototype.chatComplete = async (messages) => {
    const receipt = messages.findLast((m)=>m.role==="tool");
    if (!receipt) return {content:null,toolCalls:[toolCall("fixture_script",{weather:requestWeather})],finishReason:"tool_calls"};
    const result = JSON.parse(receipt.content);
    assert.equal(result.gameState?.pending,true,receipt.content);
    assert.equal(result.gameState.applied,false);
    priorWeather.push(result.result.previousWeather);
    if (failBeforeSave) throw Error("Fixture failure before save");
    await beforeSave?.();
    return {content:emptyResponse?"":"The rain begins.",toolCalls:[],finishReason:"stop"};
  };
  app = requireServer("fastify")(); app.decorate("db",db);
  await app.register((await module("routes/generate.routes.js")).generateRoutes,{prefix:"/api/generate"});
  for (const mode of ["roleplay","game"]) {
    const chat = await chats.create({name:"Script fixture",mode,characterIds:[],connectionId:conn.id,promptPresetId:null});
    await chats.patchMetadata(chat.id,{enableAgents:false,enableTools:true,activeToolIds:[customTool.name]});
    await states.create({...initial,chatId:chat.id,messageId:""});
    await chats.createMessage({chatId:chat.id,role:"user",content:"Continue."});
    const response = await app.inject({method:"POST",url:"/api/generate/",payload:{chatId:chat.id,streaming:true}});
    assert.equal(response.statusCode,200,response.body);
    const events = response.body.split("\n").filter((line)=>line.startsWith("data: ")).map((line)=>JSON.parse(line.slice(6)));
    const event = events.find((event)=>event.type==="game_state_patch"&&event.data.__mariBridgeScriptState);
    assert.ok(event,response.body);
    const saved = (await chats.listMessages(chat.id)).at(-1);
    assert.equal(event.data.messageId,saved.id);
    assert.equal(event.data.playerStats.status,"Tired");
    assert.equal((await states.getByChatAndMessage(chat.id,saved.id,saved.activeSwipeIndex)).weather,"Rain");
    requestWeather="Snow";
    const regenerated=await app.inject({method:"POST",url:"/api/generate/",payload:{chatId:chat.id,streaming:true,regenerateMessageId:saved.id}});
    assert.match(regenerated.body,/__mariBridgeScriptState/);
    assert.equal((await states.getByChatAndMessage(chat.id,saved.id,0)).weather,"Rain");
    assert.equal((await states.getByChatAndMessage(chat.id,saved.id,1)).weather,"Snow");
    requestWeather="Rain";
    failBeforeSave = true;
    const before = await states.getLatest(chat.id);
    await chats.createMessage({chatId:chat.id,role:"user",content:"Continue again."});
    const failed = await app.inject({method:"POST",url:"/api/generate/",payload:{chatId:chat.id,streaming:true}});
    assert.doesNotMatch(failed.body,/__mariBridgeScriptState/);
    assert.equal((await states.getLatest(chat.id)).id,before.id);
    assert.equal(priorWeather.at(-1),"Snow","next generation hidden context sees the selected swipe's saved state");
    failBeforeSave = false;
    emptyResponse = true;
    const hidden = await app.inject({method:"POST",url:"/api/generate/",payload:{chatId:chat.id,streaming:true}});
    assert.match(hidden.body,/__mariBridgeScriptState/);
    emptyResponse = false;
    beforeSave=async()=>{const row=await states.getLatest(chat.id);await states._applyUpdate(row,{fieldLocks:{[shared.worldTrackerLockKey("weather")]:true}});};
    requestWeather="Storm";
    await chats.createMessage({chatId:chat.id,role:"user",content:"Try a late-locked change."});
    const lateLocked=await app.inject({method:"POST",url:"/api/generate/",payload:{chatId:chat.id,streaming:true}});
    assert.doesNotMatch(lateLocked.body,/__mariBridgeScriptState/);
    assert.match(lateLocked.body,/locked/);
    assert.equal((await states.getLatest(chat.id)).weather,"Rain");
    beforeSave=undefined;requestWeather="Rain";
    assertions += 5;
  }

  // Count actual provider calls through native generation, including the final
  // forced follow-up and Game's separate tool planner/narrator path.
  const originalScript = customTool.scriptBody;
  const stateProvider = Provider.prototype.chatComplete;
  const originalChat = Provider.prototype.chat;
  const originalMaxRounds = process.env.MAX_TOOL_ROUNDS;
  const {createCharactersStorage}=await module("services/storage/characters.storage.js");
  const responder=await createCharactersStorage(db).create(shared.characterDataSchema.parse({name:"Fixture responder"}));
  const secondTool = await custom.create({name:"fixture_second",executionType:"script",enabled:true,
    description:"Second tool in one batch",parametersSchema:{type:"object",properties:{}},
    scriptBody:'mari.gameState.patch({time:"19:30"}); return {noFollowup:false};'});
  let followupCases = 0;
  try {
    for (const mode of ["roleplay", "game", "conversation"]) {
      const cases = [
        {name:"stop-empty",flag:true},
        {name:"stop-visible",flag:true,content:"Already narrated."},
        {name:"continue",flag:false},
        {name:"default"},
        {name:"not-boolean",flag:"true"},
        {name:"last-round-stop",flag:true,lastRound:true},
        {name:"last-round-continue",flag:false,lastRound:true},
        {name:"explicit-error",flag:true,error:true},
        {name:"exception",flag:true,throws:true},
        {name:"rejected-patch",flag:true,rejectedPatch:true},
        ...(mode !== "conversation" ? [
          {name:"save-patch",flag:true,patch:true,regenerate:true},
          {name:"save-visible-patch",flag:true,patch:true,content:"The weather changes."},
          {name:"mixed-batch",flag:true,patch:true,batch:true},
        ] : []),
        ...(mode === "game" ? [
          {name:"separate-planner-stop",flag:true,patch:true,planner:true},
          {name:"separate-planner-continue",flag:false,planner:true},
          {name:"no-dice-followup",flag:true,content:"A roll: [dice:1d6]"},
        ] : []),
      ];
      for (const scenario of cases) {
        let completeCalls=0, narrationCalls=0;
        const stops = scenario.flag === true && !scenario.throws;
        process.env.MAX_TOOL_ROUNDS = scenario.lastRound ? "1" : "3";
        await custom.update(customTool.id,{scriptBody:
          `${scenario.patch ? 'mari.gameState.patch({weather:args.weather});' : ''}
           ${scenario.rejectedPatch ? 'mari.gameState.patch({committed:true});' : ''}
           ${scenario.throws ? 'throw Error("Fixture exception");' : ''}
           return ${JSON.stringify({ok:!scenario.error,...(Object.hasOwn(scenario,"flag")?{noFollowup:scenario.flag}:{}),
             ...(scenario.error?{error:"Handled failure"}:{})})};`});
        Provider.prototype.chatComplete = async (_messages, options) => {
          completeCalls++;
          if (completeCalls > 1) {
            assert.equal(stops,false,`${mode}/${scenario.name} made another model request`);
            return {content:"Follow-up narration.",toolCalls:[],finishReason:"stop"};
          }
          const calls=[toolCall(customTool.name,{weather:"Stopped rain"})];
          if (scenario.batch) calls.push({...toolCall(secondTool.name),id:"second"});
          if (scenario.content && options.onToken) await options.onToken(scenario.content);
          return {content:scenario.content??null,toolCalls:calls,finishReason:"tool_calls"};
        };
        Provider.prototype.chat = async function* () {
          narrationCalls++;
          assert.equal(stops,false,`${mode}/${scenario.name} started a narrator request`);
          yield "Follow-up narration.";
          return {finishReason:"stop"};
        };
        const chat=await chats.create({name:`Follow-up ${mode}/${scenario.name}`,mode,characterIds:mode==="conversation"?[responder.id]:[],connectionId:conn.id,promptPresetId:null});
        await chats.patchMetadata(chat.id,{enableAgents:false,enableTools:true,
          activeToolIds:[customTool.name,...(scenario.batch?[secondTool.name]:[])],
          ...(scenario.planner?{gameGmToolConnectionId:conn.id}:{}),
          ...(scenario.name==="no-dice-followup"?{gameOneRequestDice:false,gameDiceOutcomeNarration:true}:{}),
        });
        await states.create({...initial,chatId:chat.id,messageId:""});
        await chats.createMessage({chatId:chat.id,role:"user",content:"Run the tool."});
        const run=()=>app.inject({method:"POST",url:"/api/generate/",payload:{chatId:chat.id,streaming:true}});
        const response=await run();
        assert.equal(response.statusCode,200,response.body);
        const events=response.body.split("\n").filter(line=>line.startsWith("data: ")).map(line=>JSON.parse(line.slice(6)));
        assert.equal(events.some(event=>event.type==="error"),false,response.body);
        assert.ok(events.some(event=>event.type==="done"),response.body);
        assert.equal(completeCalls,stops||scenario.planner?1:2,`${mode}/${scenario.name}`);
        assert.equal(narrationCalls,scenario.planner&&!stops?1:0,`${mode}/${scenario.name}`);
        const toolEvents=events.filter(event=>event.type==="tool_result");
        assert.ok(toolEvents.some(event=>event.data.name===customTool.name),response.body);
        if(scenario.rejectedPatch) {
          assert.ok(toolEvents.some(event=>event.data.name===customTool.name&&event.data.success===false));
          assert.doesNotMatch(response.body,/__mariBridgeScriptState/);
        }
        if(scenario.name==="no-dice-followup") assert.ok(toolEvents.some(event=>event.data.name==="roll_dice"),response.body);
        const saved=(await chats.listMessages(chat.id)).at(-1);
        assert.equal(saved.role,"assistant",response.body);
        if(stops&&!scenario.content) {
          assert.equal(saved.content,"");
          const extra=typeof saved.extra==="string"?JSON.parse(saved.extra):saved.extra;
          assert.equal(extra.hiddenFromUser,true);
        }
        if(stops&&scenario.content&&scenario.name!=="no-dice-followup") assert.equal(saved.content,scenario.content);
        if(scenario.patch) {
          assert.match(response.body,/__mariBridgeScriptState/);
          const snapshot=await states.getByChatAndMessage(chat.id,saved.id,saved.activeSwipeIndex);
          assert.equal(snapshot.weather,"Stopped rain");
          if(scenario.batch) {
            assert.equal(snapshot.time,"19:30","remaining batch tools still execute and save");
            assert.ok(toolEvents.some(event=>event.data.name===secondTool.name));
          }
          if(scenario.regenerate) {
            completeCalls=0;
            const regenerated=await app.inject({method:"POST",url:"/api/generate/",payload:{chatId:chat.id,streaming:false,regenerateMessageId:saved.id}});
            assert.equal(regenerated.statusCode,200,regenerated.body);
            assert.equal(completeCalls,1);
            assert.equal((await states.getByChatAndMessage(chat.id,saved.id,1)).weather,"Stopped rain");
            assert.ok(await states.getByChatAndMessage(chat.id,saved.id,0));
          }
        }
        followupCases++;
      }
    }
  } finally {
    Provider.prototype.chatComplete=stateProvider;
    Provider.prototype.chat=originalChat;
    if(originalMaxRounds===undefined) delete process.env.MAX_TOOL_ROUNDS;
    else process.env.MAX_TOOL_ROUNDS=originalMaxRounds;
    await custom.update(customTool.id,{scriptBody:originalScript});
  }
  console.log(`Script noFollowup: ${followupCases} native generation cases passed (provider call counts, mixed batches, hidden saves, regeneration and separate Game narration).`);

  // Exercise the compiled native UI applier: additions and removals reach the
  // same store consumed by docked HUD, World/Characters/Stats/Inventory/Quests.
  const ts = (await import(pathToFileURL(path.resolve(args["--typescript"])).href)).default;
  const assets = path.join(engine,"packages/client/dist/assets");
  let clientPatched;
  for (const file of await fs.readdir(assets)) {
    if (!file.endsWith(".js")) continue;
    const patched = patchScriptGameStateClient(await fs.readFile(path.join(assets,file),"utf8"));
    if (patched) { assert.equal(clientPatched,undefined); clientPatched=patched; }
  }
  assert.ok(clientPatched);
  const ast = ts.createSourceFile("client.js",clientPatched,ts.ScriptTarget.Latest,true,ts.ScriptKind.JS);
  let applier;
  const visit=(node)=>{if(ts.isFunctionDeclaration(node)&&node.getText(ast).includes("const {__mariBridgeScriptState,...snapshot}")) applier=node.getText(ast);ts.forEachChild(node,visit);};
  visit(ast); assert.ok(applier);
  const storeName = applier.match(/([\w$]+)\.getState\(\)\.setGameState\(snapshot\)/)[1];
  let visible=initial, cached=null;
  const symbol=Symbol.for("marinara.mari-bridge.client.v1");
  globalThis[symbol]={notifyScriptGameStateSaved:(value)=>{cached=value;}};
  const apply = new Function(storeName,`return (${applier});`)({getState:()=>({setGameState:(value)=>{visible=value;}})});
  apply("fixture",{...stored,__mariBridgeScriptState:true});
  assert.deepEqual(visible,stored);
  assert.deepEqual(cached,stored);
  assert.deepEqual(visible.playerStats.activeQuests,[]);
  assert.deepEqual(visible.presentCharacters,[]);
  assert.equal(visible.personaStats,null);
  delete globalThis[symbol];
  console.log(`Script GameState: worker isolation, validation/locks (${assertions} cases), transactional snapshots, Roleplay/Game saved and failed turns, hidden anchors, and native tracker UI applier passed.`);
  if (args["--serve"] === "1") {
    await app.close();
    const client = await prepareClientOverlay({dataDir:root,sourceRoot:path.join(engine,"packages/client/dist"),engineVersion:"2.4.6"});
    assert.deepEqual(client.failedPatches,[]);
    globalThis[Symbol.for("marinara.mari-bridge.kernel.v1")].clientRoot=client.root;
    app = await (await module("app.js")).buildApp();
    const chat = await chats.create({name:"Script GameState UI verification",mode:"roleplay",characterIds:[],connectionId:conn.id,promptPresetId:null});
    await chats.patchMetadata(chat.id,{enableAgents:true,enableTools:true,activeToolIds:[customTool.name],
      activeAgentIds:["world-state","character-tracker","persona-stats","quest","custom-tracker","inventory-tracker"]});
    const message=await chats.createMessage({chatId:chat.id,role:"assistant",content:"Ready for Script state verification."});
    await states.create({...initial,chatId:chat.id,messageId:message.id,fieldLocks:null});
    const {createAgentsStorage}=await module("services/storage/agents.storage.js");
    const agents=createAgentsStorage(db);
    for(const config of await agents.list()) await agents.update(config.id,{enabled:false});
    await custom.update(customTool.id,{scriptBody:`mari.gameState.patch(${JSON.stringify({
      weather:"Script rain",temperature:"13°C",date:"Day 22",time:"18:22",location:"Script Harbor",
      presentCharacters:[{...character,mood:"Script alert"}],personaStats:[{...stats[0],value:3}],
      playerStats:{status:"Script tired",customTrackerFields:[{name:"Trust",value:"Script earned"}],
        inventoryTrackerInventory:[{name:"Script key",description:"Freshly found"}],
        activeQuests:[{...player.activeQuests[0],name:"Script quest",objectives:[{text:"Script objective",completed:false}]}]}},null,0)}); return {ok:true};`});
    await app.listen({port:7861,host:"127.0.0.1"});
    console.log(JSON.stringify({uiChatId:chat.id,url:"http://127.0.0.1:7861",root}));
    await new Promise(resolve=>{process.once("SIGINT",resolve);process.once("SIGTERM",resolve);});
  }
} finally {
  if (Provider && originalProvider) Provider.prototype.chatComplete=originalProvider;
  await app?.close();
  await closeDB?.();
  await fs.rm(root,{recursive:true,force:true});
}

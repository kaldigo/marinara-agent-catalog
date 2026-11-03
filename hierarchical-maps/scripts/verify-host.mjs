import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {spawn} from 'node:child_process';
import {createRequire} from 'node:module';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {createServer} from 'node:http';
assert(process.env.HARNESS_LOCK_TOKEN,'Acquire the shared harness first');
const workspace=process.env.MARINARA_WORKSPACE_ROOT ? path.resolve(process.env.MARINARA_WORKSPACE_ROOT) : path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../../..');
const engine=path.join(workspace,'marinara-test-instance/engine');
const require=createRequire(path.join(engine,'package.json'));
const {chromium,expect}=require('@playwright/test');
const stamp=Date.now();
const out=path.join(workspace,'marinara-test-instance/evidence/maps-fork-'+stamp);
const data=path.join(workspace,'marinara-test-instance/tmp/maps-fork-'+stamp);
await fs.mkdir(out,{recursive:true});
const source=path.join(workspace,'packages/hierarchical-maps/dist/package');
const manifest=JSON.parse(await fs.readFile(path.join(source,'manifest.json'),'utf8'));
const target=path.join(data,'capability-packages/versions/hierarchical-maps',manifest.version);
await fs.mkdir(target,{recursive:true});
await fs.cp(source,target,{recursive:true});
manifest.files=[];
async function files(dir,prefix='') {
 for(const entry of await fs.readdir(dir,{withFileTypes:true})) {
  const relative=prefix+entry.name;
  if(entry.isDirectory()) await files(path.join(dir,entry.name),relative+'/');
  else if(relative!=='manifest.json') {const bytes=await fs.readFile(path.join(dir,entry.name));manifest.files.push({path:relative,bytes:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex')});}
 }
}
await files(target);
await fs.writeFile(path.join(target,'manifest.json'),JSON.stringify(manifest));
const worldStateSource=path.join(workspace,'references/marinara-agents/packages/world-state');
const worldStateManifest=JSON.parse(await fs.readFile(path.join(worldStateSource,'manifest.json'),'utf8'));
const worldStateTarget=path.join(data,'capability-packages/versions/world-state',worldStateManifest.version);
await fs.mkdir(worldStateTarget,{recursive:true});
for(const file of ['manifest.json','agents.json']) await fs.copyFile(path.join(worldStateSource,file),path.join(worldStateTarget,file));
await fs.writeFile(path.join(data,'capability-packages/installed.json'),JSON.stringify({schemaVersion:1,packages:[manifest,worldStateManifest].map(value=>({id:value.id,version:value.version,manifest:value,status:'active',installedAt:new Date().toISOString(),error:null,legacy:false}))}));
const base='http://127.0.0.1:7861';
async function api(route,body,method=body===undefined?'GET':'POST') {
 const response=await fetch(base+'/api'+route,{method,signal:AbortSignal.timeout(20000),headers:{'content-type':'application/json','x-marinara-csrf':'1'},...(body===undefined?{}:{body:JSON.stringify(body)})});
 const raw=await response.text();assert(response.ok,route+' '+response.status+' '+raw);return JSON.parse(raw);
}
const log=await fs.open(path.join(out,'engine.log'),'w');
let server,browser,page;
const modelRequests=[];
let modelText='We settle into the room.';
const model=createServer(async(req,res)=>{let raw='';for await(const chunk of req)raw+=chunk;if(req.method==='GET'){res.writeHead(200,{'content-type':'application/json'});res.end(JSON.stringify({data:[{id:'fixture',object:'model'}]}));return;}const body=JSON.parse(raw||'{}');modelRequests.push(body);const content=JSON.stringify(body.messages).includes('WORLD_STATE_SYNC_FIXTURE')?JSON.stringify({location:'Incorrect tracker location',weather:'Rain',time:'Evening',temperature:'12'}):modelText;res.writeHead(200,{'content-type':'application/json'});res.end(JSON.stringify({choices:[{message:{role:'assistant',content},finish_reason:'stop'}],usage:{prompt_tokens:12,completion_tokens:8}}));});
try {
 await new Promise((resolve,reject)=>{model.once('error',reject);model.listen(9864,'127.0.0.1',resolve);});
 try {await fetch(base+'/api/health',{signal:AbortSignal.timeout(2000)});throw new Error('Port already occupied');}catch(e){if(e.message==='Port already occupied')throw e;}
 server=spawn(process.execPath,['packages/server/dist/index.js'],{cwd:engine,windowsHide:true,stdio:['ignore',log.fd,log.fd],env:{...process.env,DATA_DIR:data,FILE_STORAGE_DIR:path.join(data,'storage'),PORT:'7861',NODE_OPTIONS:'',PROVIDER_LOCAL_URLS_ENABLED:'true',MARINARA_ENV_WATCH:'0',MARINARA_E2E_DISABLE_RATE_LIMIT:'true',NODE_ENV:'production'}});
 let ready=false;
 for(let i=0;i<80;i++) {assert.equal(server.exitCode,null);try {if((await fetch(base+'/api/health',{signal:AbortSignal.timeout(1000)})).ok){ready=true;break;}}catch{}await new Promise(r=>setTimeout(r,500));}
 assert(ready,'Server started');
 const character=await api('/characters',{data:{name:'Resident',description:'Lives at home.',first_mes:'Good morning.'}});
 const connection=await api('/connections',{name:'Deterministic fixture',provider:'custom',baseUrl:'http://127.0.0.1:9864/v1',apiKey:'fixture',model:'fixture',maxContext:32768});
 const preset=await api('/prompts',{name:'Maps fork fixture'});
 await api(`/prompts/${preset.id}/sections`,{identifier:'instruction',name:'Instruction',content:'Describe the scene.',role:'system'});
 await api(`/prompts/${preset.id}/sections`,{identifier:'lore',name:'Lorebook',isMarker:true,markerConfig:{type:'lorebook'},role:'system'});
 const chat=await api('/chats',{name:'Maps fork fixture',mode:'roleplay',characterIds:[character.id],connectionId:connection.id});
 await api(`/chats/${chat.id}/metadata`,{enableAgents:true,activeAgentIds:['hierarchical-maps'],unrelatedFixture:'preserve-me'},'PATCH');
 const location=(id,name,parentId=null)=>({id,name,parentId,kind:parentId?'room':'place',description:name==='Kitchen'?'A familiar kitchen.':'Away from home.',links:[],lorebookEntryIds:[],status:'active',childPresentation:'list'});
 const locations=[location('home','Home'),location('kitchen','Kitchen','home'),location('hall','Hall','home'),location('away','Away from home')];
 locations[1].links=[{targetId:'hall',bidirectional:true,state:'available'}];
 const definition={schemaVersion:1,ownerMode:'roleplay',enabled:true,revision:0,startingLocationId:'kitchen',locations};
 await api(`/chats/${chat.id}/spatial-context`,{expectedRevision:0,expectedCurrentLocationId:null,definition},'PUT');
 async function worldState(){return api(`/chats/${chat.id}/game-state`);}
 assert.equal((await worldState()).location,'Home, Kitchen','Map creates a native World State location without needing background/exclusion settings');
 await api(`/chats/${chat.id}/game-state`,{weather:'Rain',time:'Evening',temperature:'12',manual:true},'PATCH');
 await api(`/chats/${chat.id}/game-state`,{location:'Tracker-only location',manual:true},'PATCH');
 assert.equal((await api(`/chats/${chat.id}/spatial-context`)).currentLocationId,'kitchen','Tracker edits never move Maps');
 assert.equal((await worldState()).location,'Home, Kitchen','Maps remains the location source');
 async function compiled(){const result=await api('/generate/dryRun',{chatId:chat.id,presetId:preset.id,returnPrompt:true,streaming:false,wrapLastMessage:true,injectLorebook:true,injectTrackers:true,injectChatSummary:true});return {result,text:result.prompt.messages.map(m=>m.content).join('\n')};}
 const baseline=await compiled();assert(baseline.text.includes('Known map locations'));assert(baseline.text.includes('Away from home'));
 await fs.writeFile(path.join(out,'baseline.json'),JSON.stringify(baseline.result,null,2));
 browser=await chromium.launch({executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true});
 page=await browser.newPage({viewport:{width:1440,height:1100}});
 await page.addInitScript(({chatId})=>{localStorage.setItem('marinara-active-chat-id',chatId);localStorage.setItem('marinara:whats-new:seen-version','2.5.1');localStorage.setItem('marinara-engine-ui',JSON.stringify({state:{hasCompletedOnboarding:true},version:101}));},{chatId:chat.id});
 await page.goto(base);
 await page.waitForFunction(()=>!!customElements.get('marinara-capability-hierarchical-maps'),{},{timeout:30000});
 // Exercise the package's native agent-detail component with its documented slot props.
 async function mount(){await page.evaluate(({chatId})=>{document.getElementById('maps-fixture')?.remove();const el=document.createElement('marinara-capability-hierarchical-maps');el.id='maps-fixture';el.setAttribute('view','detail');el.style.cssText='position:fixed;inset:0;z-index:2147483647;overflow:auto;background:var(--background)';el.capabilityProps={chatId,chatName:'Maps fork fixture',chatMode:'roleplay',enabledForChat:true};document.body.append(el);},{chatId:chat.id});}
 await mount();
 let panel=page.locator('#maps-fixture');
 await panel.getByRole('button',{name:'Edit templates',exact:true}).click();
 let editor=panel.getByRole('textbox',{name:'Roleplay turn prompt template',exact:true});
 await expect(editor).toHaveValue(/\$\{knownLocationsBlock\}/);
 await editor.fill((await editor.inputValue()).replace('${knownLocationsBlock}',''));
 await panel.getByRole('button',{name:'Save templates',exact:true}).click();
 await expect(panel.getByRole('button',{name:'Edit templates',exact:true})).toBeVisible();
 const hidden=await compiled();assert(!hidden.text.includes('Known map locations'));assert(!hidden.text.includes('Away from home'));assert(hidden.text.includes('Hall [hall]'));assert(hidden.text.includes('Current location ID: kitchen'));assert(hidden.text.includes('Treat this as the authoritative'));
 await fs.writeFile(path.join(out,'hidden.json'),JSON.stringify(hidden.result,null,2));
 await page.reload();await page.waitForFunction(()=>!!customElements.get('marinara-capability-hierarchical-maps'));await mount();
 panel=page.locator('#maps-fixture');await panel.getByRole('button',{name:'Edit templates',exact:true}).click();
 editor=panel.getByRole('textbox',{name:'Roleplay turn prompt template',exact:true});await expect(editor).not.toHaveValue(/\$\{knownLocationsBlock\}/);
 await page.screenshot({path:path.join(out,'saved-template.png'),fullPage:true});
 await panel.getByRole('button',{name:'Restore built-in',exact:true}).click();await expect(editor).toHaveValue(/\$\{knownLocationsBlock\}/);
 await panel.getByRole('button',{name:'Save templates',exact:true}).click();await expect(panel.getByRole('button',{name:'Edit templates',exact:true})).toBeVisible();
 const restored=await compiled();assert(restored.text.includes('Known map locations'));assert(restored.text.includes('Away from home'));
 const book=await api('/lorebooks',{name:'Location effects fixture',isGlobal:true});
 const kitchenLore=await api(`/lorebooks/${book.id}/entries`,{name:'Kitchen awareness',content:'KITCHEN_AWARENESS_SENTINEL',constant:true});
 const hallLore=await api(`/lorebooks/${book.id}/entries`,{name:'Hall awareness',content:'HALL_AWARENESS_SENTINEL',constant:true});
 const disabledLore=await api(`/lorebooks/${book.id}/entries`,{name:'Already disabled',content:'DISABLED_SENTINEL',constant:true});
 await api(`/chats/${chat.id}/metadata`,{background:'Black.jpg',entryStateOverrides:{[disabledLore.id]:{enabled:false,ephemeral:8},[kitchenLore.id]:{ephemeral:17}}},'PATCH');
 const upload=new FormData();upload.append('file',new Blob([Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a0ioAAAAASUVORK5CYII=','base64')],{type:'image/png'}),'fixture.png');
 const imageResponse=await fetch(base+`/api/gallery/${chat.id}/upload`,{method:'POST',headers:{'x-marinara-csrf':'1'},body:upload});
 const image=await imageResponse.json();assert(imageResponse.ok,JSON.stringify(image));
 async function state(){return api(`/chats/${chat.id}/spatial-context`);}
 async function metadata(){const c=await api('/chats/'+chat.id);return typeof c.metadata==='string'?JSON.parse(c.metadata):c.metadata;}
 async function setLocation(id,change){const current=await state();const next=structuredClone(current.definition);if(change)change(next);return api(`/chats/${chat.id}/spatial-context`,{expectedRevision:next.revision,expectedCurrentLocationId:current.currentLocationId,replacementCurrentLocationId:id,definition:next},'PUT');}
 await setLocation('kitchen',d=>{d.locations.find(l=>l.id==='kitchen').referenceImageId=image.id;d.locations.find(l=>l.id==='kitchen').lorebookEntryIds=[kitchenLore.id];});
 await api(`/chats/${chat.id}/spatial-context/location-effects`,{locationId:'kitchen',excludedEntryIds:[kitchenLore.id,disabledLore.id]},'PATCH');
 await api(`/chats/${chat.id}/spatial-context/location-effects`,{locationId:'hall',excludedEntryIds:[hallLore.id]},'PATCH');
 let effectPrompt=await compiled();assert(!effectPrompt.text.includes('KITCHEN_AWARENESS_SENTINEL'),'Excluded entry cannot re-enter through linked lore');assert(effectPrompt.text.includes('HALL_AWARENESS_SENTINEL'));
 let meta=await metadata();assert.equal(meta.entryStateOverrides[kitchenLore.id].enabled,false);assert.equal(meta.entryStateOverrides[kitchenLore.id].ephemeral,17);
 // Use the actual checkbox to enable backgrounds and verify native UI update.
 await page.reload();await page.waitForFunction(()=>!!customElements.get('marinara-capability-hierarchical-maps'));await mount();panel=page.locator('#maps-fixture');
 const backgroundToggle=panel.getByRole('checkbox',{name:'Use location image as chat background',exact:true});
 await backgroundToggle.check();await expect(backgroundToggle).toBeEnabled();
 await expect.poll(async()=>(await metadata()).background).toContain('/api/gallery/');
 const backgroundUrl=(await metadata()).background;
 await expect.poll(()=>page.evaluate(()=>globalThis.__MARINARA_HOST__.stores.ui.getState().chatBackground)).toBe(backgroundUrl);
 await setLocation('hall');
 assert.equal((await worldState()).location,'Home, Hall');assert.equal((await worldState()).weather,'Rain');assert.equal((await worldState()).time,'Evening');assert.equal((await worldState()).temperature,'12');
 meta=await metadata();assert.equal(meta.background,'Black.jpg','Room without an image restores original background');assert.deepEqual(meta.entryStateOverrides[kitchenLore.id],{ephemeral:17});assert.equal(meta.entryStateOverrides[hallLore.id].enabled,false);assert.equal(meta.entryStateOverrides[disabledLore.id].enabled,false);
 effectPrompt=await compiled();assert(effectPrompt.text.includes('KITCHEN_AWARENESS_SENTINEL'));assert(!effectPrompt.text.includes('HALL_AWARENESS_SENTINEL'));
 await setLocation('kitchen');
 assert.equal((await worldState()).location,'Home, Kitchen');
 await api(`/chats/${chat.id}/game-state`,{location:'Locked location',fieldLocks:{'world.location':true},manual:true},'PATCH');
 await setLocation('hall');assert.equal((await worldState()).location,'Locked location','Native location lock is respected');
 await api(`/chats/${chat.id}/game-state`,{fieldLocks:{}},'PATCH');assert.equal((await worldState()).location,'Home, Hall','Unlock resumes one-way sync');
 await setLocation('kitchen');
 meta=await metadata();assert.equal(meta.background,backgroundUrl);assert.equal(meta.entryStateOverrides[kitchenLore.id].enabled,false);assert(!meta.entryStateOverrides[hallLore.id]);
 // An actual move and reply must use the destination's exclusions, not the cached departure metadata.
 const beforeMove=await state();
 const response=await fetch(base+'/api/generate',{method:'POST',headers:{'content-type':'application/json','x-marinara-csrf':'1'},body:JSON.stringify({chatId:chat.id,presetId:preset.id,userMessage:'We go to the hall.',streaming:false,pendingSpatialTransition:{destinationId:'hall',travelMode:'travel_now',expectedDefinitionRevision:beforeMove.definition.revision,expectedCurrentLocationId:'kitchen',commandId:'fixture-move-hall'}}),signal:AbortSignal.timeout(30000)});
 const responseText=await response.text();assert(response.ok,responseText);assert(modelRequests.length,'Main generation reached deterministic provider');
 const actualPrompt=modelRequests.at(-1).messages.map(m=>typeof m.content==='string'?m.content:JSON.stringify(m.content)).join('\n');
 await fs.writeFile(path.join(out,'move-provider-prompt.txt'),actualPrompt);
 assert(actualPrompt.includes('KITCHEN_AWARENESS_SENTINEL'),'Departure exclusion restored for the same reply');assert(!actualPrompt.includes('HALL_AWARENESS_SENTINEL'),'Destination exclusion applied before the same reply');
 assert.equal((await state()).currentLocationId,'hall');
 assert.equal((await worldState()).location,'Home, Hall');
 const requestsBeforeRejected=modelRequests.length;
 const rejected=await fetch(base+'/api/generate',{method:'POST',headers:{'content-type':'application/json','x-marinara-csrf':'1'},body:JSON.stringify({chatId:chat.id,presetId:preset.id,userMessage:'Invalid stale move.',streaming:false,pendingSpatialTransition:{destinationId:'kitchen',expectedDefinitionRevision:0,expectedCurrentLocationId:'kitchen',commandId:'stale-move'}})});
 await rejected.text();assert.equal(rejected.status,409);assert.equal(modelRequests.length,requestsBeforeRejected);assert.equal((await metadata()).entryStateOverrides[hallLore.id].enabled,false);
 modelText='We return to the kitchen.\n[spatial_move: destination_id="kitchen"]';
 const narrated=await fetch(base+'/api/generate',{method:'POST',headers:{'content-type':'application/json','x-marinara-csrf':'1'},body:JSON.stringify({chatId:chat.id,presetId:preset.id,userMessage:'We return to the kitchen now.',streaming:false}),signal:AbortSignal.timeout(30000)});
 const narratedText=await narrated.text();assert(narrated.ok,narratedText);assert.equal((await state()).currentLocationId,'kitchen','Narrated move commits location');
 assert.equal((await worldState()).location,'Home, Kitchen');
 const messages=await api(`/chats/${chat.id}/messages`);const assistant=messages.findLast(message=>message.role==='assistant');assert(assistant,'Assistant message persisted');
 await api(`/chats/${chat.id}/messages/${assistant.id}/swipes`,{content:'We stay in the hall.'});
 await api(`/chats/${chat.id}/messages/${assistant.id}/active-swipe`,{index:1},'PUT');
 assert.equal((await state()).currentLocationId,'hall');assert.equal((await metadata()).entryStateOverrides[hallLore.id].enabled,false);
 assert.equal((await worldState()).location,'Home, Hall');
 await api(`/chats/${chat.id}/messages/${assistant.id}/active-swipe`,{index:0},'PUT');
 assert.equal((await state()).currentLocationId,'kitchen');assert.equal((await metadata()).entryStateOverrides[kitchenLore.id].enabled,false);
 assert.equal((await worldState()).location,'Home, Kitchen');
 // Configure exclusions through the existing location inspector, including remove/add and reload.
 async function workspaceView(){await page.evaluate(()=>{const old=document.getElementById('maps-fixture');const el=document.createElement('marinara-capability-hierarchical-maps');el.id=old.id;el.style.cssText='display:contents';el.setAttribute('view','workspace');el.capabilityProps=old.capabilityProps;old.remove();document.body.append(el);});}
 await workspaceView();
 let exclusions=page.locator('[data-location-lore-exclusions]');
 await exclusions.locator('summary').click();
 let kitchenToggle=exclusions.getByRole('checkbox',{name:'Exclude Kitchen awareness here',exact:true});
 await expect(kitchenToggle).toBeChecked();await kitchenToggle.click();await expect(kitchenToggle).not.toBeChecked();await expect(kitchenToggle).toBeEnabled();
 assert(!(await api(`/chats/${chat.id}/spatial-context/location-effects`)).excludedEntriesByLocation.kitchen.includes(kitchenLore.id));
 await kitchenToggle.click();await expect(kitchenToggle).toBeChecked();await expect(kitchenToggle).toBeEnabled();
 await page.reload();await page.waitForFunction(()=>!!customElements.get('marinara-capability-hierarchical-maps'));await mount();await workspaceView();
 exclusions=page.locator('[data-location-lore-exclusions]');await exclusions.locator('summary').click();
 await expect(exclusions.getByRole('checkbox',{name:'Exclude Kitchen awareness here',exact:true})).toBeChecked();
 await expect.poll(()=>page.evaluate(()=>globalThis.__MARINARA_HOST__.stores.gameState.getState().current?.location)).toBe('Home, Kitchen');
 await page.screenshot({path:path.join(out,'location-exclusions.png'),fullPage:true});
 // Background setting also persists, and turning it off restores the previous selection.
 await page.reload();await page.waitForFunction(()=>!!customElements.get('marinara-capability-hierarchical-maps'));await mount();panel=page.locator('#maps-fixture');
 await expect(panel.getByRole('checkbox',{name:'Use location image as chat background',exact:true})).toBeChecked();
 await setLocation('kitchen');
 await page.reload();await page.waitForFunction(()=>!!customElements.get('marinara-capability-hierarchical-maps'));await mount();panel=page.locator('#maps-fixture');
 await panel.getByRole('checkbox',{name:'Use location image as chat background',exact:true}).uncheck();
 await expect.poll(async()=>(await metadata()).background).toBe('Black.jpg');
 await expect.poll(()=>page.evaluate(()=>globalThis.__MARINARA_HOST__.stores.ui.getState().chatBackground)).toBe('/api/backgrounds/file/Black.jpg');
 await setLocation('hall');
 // Native overrides remain per-chat; shared lorebook entries are untouched.
 const other=await api('/chats',{name:'Unaffected chat',mode:'roleplay',characterIds:[character.id],connectionId:connection.id});
 const otherPrompt=await api('/generate/dryRun',{chatId:other.id,presetId:preset.id,returnPrompt:true,streaming:false,injectLorebook:true});assert(JSON.stringify(otherPrompt).includes('HALL_AWARENESS_SENTINEL'));
 assert.equal(await api(`/chats/${other.id}/game-state`),null,'No World State created for unrelated chats');
 const gameChat=await api('/chats',{name:'Game location sync fixture',mode:'game',characterIds:[character.id],connectionId:connection.id});
 await api(`/chats/${gameChat.id}/game-state`,{location:'Initial game location',manual:true},'PATCH');
 await api(`/chats/${gameChat.id}/metadata`,{enableAgents:true,activeAgentIds:['hierarchical-maps']},'PATCH');
 await api(`/chats/${gameChat.id}/spatial-context`,{expectedRevision:0,expectedCurrentLocationId:null,definition:{...definition,ownerMode:'game'}},'PUT');
 assert.equal((await api(`/chats/${gameChat.id}/game-state`)).location,'Home, Kitchen','Native Game projection uses the same comma-separated hierarchy');
 await api(`/chats/${gameChat.id}/game-state`,{location:'Home, Hall',manual:false},'PATCH');
 assert.equal((await api(`/chats/${gameChat.id}/spatial-context`)).currentLocationId,'kitchen');
 await setLocation('bedroom',d=>{d.locations.push({...location('upstairs','Upstairs','home'),kind:'floor'},location('bedroom','Bedroom','upstairs'));});
 assert.equal((await worldState()).location,'Home, Upstairs, Bedroom','Full hierarchy is joined with comma-space');
 assert.equal((await worldState()).weather,'Rain');
 await api('/agents/type/world-state',{connectionId:connection.id,promptTemplate:'WORLD_STATE_SYNC_FIXTURE: Return JSON for location, weather, time, temperature.'},'PATCH');
 await api(`/chats/${chat.id}/metadata`,{activeAgentIds:['hierarchical-maps','world-state']},'PATCH');
 modelText='We rest in the bedroom.';
 const withTracker=await fetch(base+'/api/generate',{method:'POST',headers:{'content-type':'application/json','x-marinara-csrf':'1'},body:JSON.stringify({chatId:chat.id,presetId:preset.id,userMessage:'We stay here.',streaming:false}),signal:AbortSignal.timeout(30000)});
 const trackerResponse=await withTracker.text();assert(withTracker.ok,trackerResponse);
 assert(modelRequests.some(request=>JSON.stringify(request.messages).includes('WORLD_STATE_SYNC_FIXTURE')),'Native World State agent executed');
 await expect.poll(async()=>(await worldState()).location).toBe('Home, Upstairs, Bedroom');
 assert.equal((await state()).currentLocationId,'bedroom','Tracker agent output cannot move Maps');
 await api(`/chats/${chat.id}/spatial-context/location-effects`,{backgroundEnabled:true},'PATCH');
 await setLocation('kitchen');assert.equal((await metadata()).background,backgroundUrl);
 await api(`/chats/${chat.id}/metadata`,{enableAgents:false},'PATCH');
 meta=await metadata();assert(!meta.entryStateOverrides[hallLore.id]);assert(!Object.hasOwn(meta.entryStateOverrides[kitchenLore.id],'enabled'));assert.equal(meta.background,'Black.jpg');assert.equal(meta.entryStateOverrides[disabledLore.id].enabled,false);assert.equal(meta.unrelatedFixture,'preserve-me');
 await fs.writeFile(path.join(out,'effects-metadata.json'),JSON.stringify(meta,null,2));

 // Passageway settings persist through the native editor and drive real movement.
 await api(`/chats/${chat.id}/metadata`,{enableAgents:true,activeAgentIds:['hierarchical-maps']},'PATCH');
 await setLocation('kitchen',d=>{d.locations.find(l=>l.id==='hall').links=[{targetId:'bedroom',state:'available',bidirectional:true}];d.locations.find(l=>l.id==='bedroom').awarenessSummary='A quiet upstairs retreat.';d.locations.find(l=>l.id==='bedroom').links=[{targetId:'away',state:'available',bidirectional:true}];});
 let passageState=await state();
 const passageProfile=structuredClone(passageState.hierarchyProfile);
 passageProfile.types.push({id:'type_hallway',label:'Hallway',baseKind:'room'});
 passageProfile.locationTypeIds.hall='type_hallway';
 await api(`/chats/${chat.id}/spatial-context`,{expectedRevision:passageState.definition.revision,expectedCurrentLocationId:passageState.currentLocationId,definition:passageState.definition,hierarchyProfile:passageProfile},'PUT');
 assert(!(await state()).destinations.some(d=>d.id==='bedroom'));
 await page.reload();await page.waitForFunction(()=>!!customElements.get('marinara-capability-hierarchical-maps'));await mount();
 panel=page.locator('#maps-fixture');
 await panel.getByRole('button',{name:'Edit location types',exact:true}).click();
 await panel.getByRole('checkbox',{name:'Hallway passageway',exact:true}).check();
 await panel.getByRole('button',{name:'Save location types',exact:true}).click();
 await expect(panel.getByRole('button',{name:'Edit location types',exact:true})).toBeVisible();
 passageState=await state();assert(passageState.destinations.some(d=>d.id==='bedroom'));assert(!passageState.destinations.some(d=>d.id==='away'),'Ordinary bedroom stops expansion');
 assert((await compiled()).text.includes('Bedroom [bedroom] — via Hall — A quiet upstairs retreat.'),'Compiled generation prompt includes passageway route and destination cue');
 await page.reload();await page.waitForFunction(()=>!!customElements.get('marinara-capability-hierarchical-maps'));await mount();panel=page.locator('#maps-fixture');
 await expect(panel.getByRole('checkbox',{name:'Hallway passageway',exact:true})).toBeChecked();
 await panel.getByRole('button',{name:'Edit location types',exact:true}).click();
 await panel.getByRole('checkbox',{name:'Hallway passageway',exact:true}).uncheck();
 await panel.getByRole('button',{name:'Save location types',exact:true}).click();
 await expect(panel.getByRole('button',{name:'Edit location types',exact:true})).toBeVisible();
 assert(!(await state()).destinations.some(d=>d.id==='bedroom'),'Unchecking restores direct destinations');
 await panel.getByRole('button',{name:'Edit location types',exact:true}).click();
 await panel.getByRole('checkbox',{name:'Hallway passageway',exact:true}).check();
 await panel.getByRole('button',{name:'Save location types',exact:true}).click();
 await expect(panel.getByRole('button',{name:'Edit location types',exact:true})).toBeVisible();
 await page.screenshot({path:path.join(out,'passageway-types.png'),fullPage:true});
 passageState=await state();modelText='We settle into the bedroom.';
 const passageMove=await fetch(base+'/api/generate',{method:'POST',headers:{'content-type':'application/json','x-marinara-csrf':'1'},body:JSON.stringify({chatId:chat.id,presetId:preset.id,userMessage:'Go to the bedroom through the hall.',streaming:false,pendingSpatialTransition:{destinationId:'bedroom',expectedDefinitionRevision:passageState.definition.revision,expectedCurrentLocationId:'kitchen',commandId:'passageway-move'}}),signal:AbortSignal.timeout(30000)});
 const passageReply=await passageMove.text();assert(passageMove.ok,passageReply);assert.equal((await state()).currentLocationId,'bedroom');assert.equal((await worldState()).location,'Home, Upstairs, Bedroom');
 assert(!(await metadata()).entryStateOverrides[hallLore.id],'Passing through hall does not apply hall exclusions');
 const result={passed:true,engineVersion:'2.5.1',packageVersion:manifest.version,checks:['passageway checkbox enable/disable/save/reload, prompt destinations and real move-and-reply','fork server activation and native spatial routes','template edit/save/reload/restore','excluded entry blocked from ordinary and linked lore','room changes restore and apply per-chat flags','preexisting disabled entries and counters preserved','background checkbox sets native renderer and persisted background','room without image and checkbox off restore previous background','actual move-and-reply uses destination exclusions in same prompt','narrated movement and switching swipes reconcile location effects','stale move rejected without changed exclusions or model call','exclusion checkbox remove/add and reload persistence','background setting reload persistence','another chat remains unaffected','disabling Maps restores backgrounds and overrides and preserves unrelated metadata','map-only configuration creates native World State location','one-way comma-separated World State hierarchy including three levels','weather/time/temperature survive map location writes','World State edits do not move Maps','native location lock pauses sync and unlock resumes it','swipes and browser reload show the mapped location in native tracker store','native World State agent conflicting location is corrected after processing without moving Maps','native Game location projection uses comma-space without reverse movement'],evidence:out};
 await fs.writeFile(path.join(out,'result.json'),JSON.stringify(result,null,2));console.log(JSON.stringify(result,null,2));
} catch(error) {
 if(page){await fs.writeFile(path.join(out,'failure-page.html'),await page.content());await page.screenshot({path:path.join(out,'failure.png')});}
 throw error;
} finally {
 await browser?.close();
 if(server&&server.exitCode===null){const done=new Promise(r=>server.once('exit',r));server.kill();await done;}
 await log.close();
 await new Promise(resolve=>model.close(resolve));
}

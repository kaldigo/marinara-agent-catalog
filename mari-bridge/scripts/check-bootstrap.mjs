// Execute first installation and a forced update through the current native
// supervisor, without opening ports or using the shared harness data.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {openSync,closeSync} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {pathToFileURL} from 'node:url';
const engineArg=process.argv.find(v=>v.startsWith('--engine='))?.slice(9);
if(!engineArg)throw Error('Required --engine=<current Engine checkout>');
const engine=path.resolve(engineArg);
const docker=process.argv.includes('--docker');
assert.equal(JSON.parse(await fs.readFile(path.join(engine,'package.json'),'utf8')).version,'2.4.6');
const root=await fs.mkdtemp(path.join(os.tmpdir(),'mari-bridge-bootstrap-246-'));
const entry=path.join(root,'packages/server/dist/index.js'), preload=path.join(root,'data/mari-bridge/bootstrap/register.mjs');
const restartUrl=new URL('../src/server/bootstrap-restart.js',import.meta.url).href;
try{
 await fs.mkdir(path.dirname(entry),{recursive:true});
 await fs.mkdir(path.dirname(preload),{recursive:true});
 await fs.mkdir(path.join(root,'scripts'),{recursive:true});
 await fs.writeFile(path.join(root,'package.json'),'{"type":"module"}');
 const dockerEntry=path.join(root,'marinara-docker-entrypoint.mjs');
 if(docker)await fs.copyFile(path.join(engine,'scripts/docker-entrypoint.mjs'),dockerEntry);
 else await fs.copyFile(path.join(engine,'scripts/run-server.mjs'),path.join(root,'scripts/run-server.mjs'));
 await fs.copyFile(new URL('../bootstrap/register.mjs',import.meta.url),preload);
 await fs.writeFile(path.join(path.dirname(preload),'runtime.mjs'),`globalThis[Symbol.for('marinara.mari-bridge.kernel.v1')]={active:true};`);
 await fs.writeFile(entry,`
import fs from 'node:fs/promises';
import assert from 'node:assert/strict';
import {schedulePackageBootstrapRestart} from ${JSON.stringify(restartUrl)};
const root=${JSON.stringify(root)},preload=${JSON.stringify(preload)};
const active=globalThis[Symbol.for('marinara.mari-bridge.kernel.v1')]?.active===true;
const eventsFile=root+'/events.jsonl';
await fs.appendFile(eventsFile,JSON.stringify({active,pid:process.pid,ppid:process.ppid,supervisor:process.env.MARINARA_RESTART_SUPERVISOR})+'\\n');
if(active){
 if(${docker})assert.equal(process.env.MARINARA_RESTART_SUPERVISOR,undefined);
 else assert.equal(process.env.MARINARA_RESTART_SUPERVISOR,String(process.ppid));
 const done=await fs.access(root+'/forced').then(()=>true,()=>false);
 if(done){await fs.writeFile(root+'/passed','1');process.exit(0);}
 await fs.writeFile(root+'/forced','1');
}
setInterval(()=>{},1000);
const hooks=[];
const result=await schedulePackageBootstrapRestart({dataDir:root+'/data',app:{addHook:(_name,hook)=>hooks.push(hook),close:async()=>{await fs.appendFile(root+'/closed',String(process.pid)+'\\n');}},api:{runtime:{logger:{error:(e)=>{console.error(e);process.exit(1);}}}}},preload,active?{force:true}:{});
assert.equal(result.scheduled,true);
for(const hook of hooks)await hook();
`);
 const env={...process.env,NODE_OPTIONS:'',MARI_BRIDGE_DISABLE:'0',MARI_BRIDGE_ENGINE_ROOT:root};
 delete env.MARINARA_RESTART_SUPERVISOR;
 delete env.MARINARA_DOCKER;delete env.MARINARA_DOCKER_USER;delete env.MARINARA_DOCKER_GROUP;
 if(docker)env.MARINARA_DOCKER='true';
 const log=path.join(root,'child.log'),fd=openSync(log,'w');
 const supervised=process.argv.includes('--supervised');
 const result=spawnSync(process.execPath,docker?[dockerEntry,process.execPath,entry]:supervised?[path.join(root,'scripts/run-server.mjs'),entry]:[entry],{env,encoding:'utf8',stdio:['ignore',fd,fd],timeout:15000,windowsHide:true});
 closeSync(fd);
 assert.equal(result.error,undefined);assert.equal(result.status,0,await fs.readFile(log,'utf8'));
 // Check the descendant assertion marker as well as the launcher exit status.
 const deadline=Date.now()+12000;
 while(!await fs.access(path.join(root,'passed')).then(()=>true,()=>false)){
  assert.ok(Date.now()<deadline,'native supervised replacement did not complete: '+await fs.readFile(log,'utf8')+'; events: '+await fs.readFile(path.join(root,'events.jsonl'),'utf8'));
  await new Promise(resolve=>setTimeout(resolve,50));
 }
 const events=(await fs.readFile(path.join(root,'events.jsonl'),'utf8')).trim().split('\n').map(JSON.parse);
 assert.deepEqual(events.map(e=>e.active),[false,true,true]);
 if(docker&&process.platform!=='win32'){
  assert.equal(new Set(events.map(e=>e.pid)).size,1,'Docker execve retains the server child PID across installation and update');
  assert.equal(new Set(events.map(e=>e.ppid)).size,1,'Docker keeps the official entrypoint parent');
 }else if(!docker){
  assert.equal(events[1].ppid,events[2].ppid,'forced update retains the native supervisor');
  assert.notEqual(events[1].pid,events[2].pid,'forced update creates a fresh server process');
 }
 assert.equal((await fs.readFile(path.join(root,'closed'),'utf8')).trim().split('\n').length,2,'both restart paths close the app first');

 const overlay=path.join(root,'overlay.mjs'),redirect=path.join(root,'redirect.mjs');
 await fs.writeFile(overlay,`console.log(JSON.stringify({overlay:true,pid:process.pid}));`);
 await fs.writeFile(redirect,`import {redirectServerEntryToOverlay} from ${JSON.stringify(new URL('../src/server/server-overlay.js',import.meta.url).href)};redirectServerEntryToOverlay({engineRoot:${JSON.stringify(root)},entry:${JSON.stringify(overlay)}});`);
 const redirected=spawnSync(process.execPath,['--import='+pathToFileURL(redirect).href,entry],{env,encoding:'utf8',timeout:10000,windowsHide:true});
 assert.equal(redirected.status,0,redirected.stderr);
 assert.deepEqual(JSON.parse(redirected.stdout),{overlay:true,pid:redirected.pid},'overlay runs in the supervised server process');
 console.log(`Engine 2.4.6: ${docker?'Docker entrypoint without run-server.mjs':supervised?'native-supervised':'direct'} first-install preload, forced update, process ownership, app close and same-process overlay passed.`);
}finally{await fs.rm(root,{recursive:true,force:true});}

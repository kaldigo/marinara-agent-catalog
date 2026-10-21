// Requires the shared harness lease. Uses isolated data and a deterministic local provider.
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
const workspace = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const engine = path.join(workspace,"marinara-test-instance/engine");
const upstream = process.argv.includes("--upstream");
const packageRoot = path.join(workspace, upstream ? "references/marinara-agents/packages/quartermaster" : "packages/quartermaster");
const engineVersion = JSON.parse(await fs.readFile(path.join(engine,"package.json"),"utf8")).version;
const require = createRequire(path.join(engine,"package.json"));
const { chromium } = require("@playwright/test");
if (!process.env.HARNESS_LOCK_TOKEN) throw new Error("Acquire the shared harness lease and set HARNESS_LOCK_TOKEN before running this check.");
const stamp = Date.now();
const out = path.join(workspace,"marinara-test-instance/evidence/quartermaster-"+(upstream ? "upstream-" : "fork-")+stamp);
const data = path.join(workspace,"marinara-test-instance/tmp/quartermaster-auth-"+stamp);
await fs.mkdir(out,{recursive:true});
const source = upstream ? packageRoot : path.join(packageRoot,"dist/package");
const manifest = JSON.parse(await fs.readFile(path.join(source,"manifest.json"),"utf8"));
const target = path.join(data,"capability-packages/versions/quartermaster",manifest.version);
await fs.mkdir(target,{recursive:true});
await fs.cp(source,target,{recursive:true});
manifest.files=[];
for(const file of await fs.readdir(target,{recursive:true})) {
 if(file==="manifest.json" || !(await fs.stat(path.join(target,file))).isFile())continue;
 const bytes=await fs.readFile(path.join(target,file));
 manifest.files.push({path:file.replaceAll('\\','/'),bytes:bytes.length,sha256:createHash("sha256").update(bytes).digest("hex")});
}
await fs.writeFile(path.join(target,"manifest.json"),JSON.stringify(manifest));
await fs.writeFile(path.join(data,"capability-packages/installed.json"),JSON.stringify({schemaVersion:1,packages:[
 {id:manifest.id,version:manifest.version,manifest,status:"active",installedAt:new Date().toISOString(),error:null,legacy:false}
]}));
const secret="quartermaster-isolated-fixture-secret";
const log=await fs.open(path.join(out,"engine.log"),"w");
const server=spawn(process.execPath,["packages/server/dist/index.js"],{cwd:engine,env:{...process.env,DATA_DIR:data,FILE_STORAGE_DIR:path.join(data,"storage"),PORT:"7861",NODE_OPTIONS:"",MARINARA_ENV_WATCH:"0",NODE_ENV:"production",ADMIN_SECRET:secret,MARINARA_REQUIRE_ADMIN_SECRET_ON_LOOPBACK:"true"},windowsHide:true,stdio:["ignore",log.fd,log.fd]});
const base="http://127.0.0.1:7861";
let browser;
async function api(route,body,method=body===undefined?"GET":"POST"){
 const headers={"X-Admin-Secret":secret,"x-marinara-csrf":"1"};
 if(body!==undefined)headers["Content-Type"]="application/json";
 const r=await fetch(base+"/api"+route,{method,headers,...(body===undefined?{}:{body:JSON.stringify(body)})});
 const text=await r.text();assert(r.ok,route+" "+r.status+" "+text);return JSON.parse(text);
}
try {
 let ready=false;
 for(let i=0;i<120;i++){
  if(server.exitCode!==null)throw new Error("Engine exited "+server.exitCode);
  try{if((await fetch(base+"/api/health")).ok){ready=true;break;}}catch{}
  await new Promise(r=>setTimeout(r,500));
 }
 assert(ready,"Engine readiness");
 const persona=await api("/characters/personas",{name:"Quartermaster Test",description:"Inventory auth fixture"});
 const chat=await api("/chats",{name:"Quartermaster authentication",mode:"roleplay",personaId:persona.id});
 const denied=await fetch(base+"/api/quartermaster/inventory/"+chat.id+"/persona");
 assert.equal(denied.status,403);
 assert.match(await denied.text(),/Invalid or missing X-Admin-Secret/);
 browser=await chromium.launch({executablePath:"C:/Program Files/Google/Chrome/Application/chrome.exe",headless:true});
 const page=await browser.newPage();
 await page.goto(base);
 await page.evaluate(secret=>localStorage.setItem("marinara_admin_secret",secret),secret);
 const apiSource=await fs.readFile(path.join(packageRoot,"src/00-api.js"),"utf8");
 await page.evaluate('(() => {'+apiSource+';window.testQM=QM;})()');
 const result=await page.evaluate(async({chatId,secret})=>{
  const q=window.testQM;
  let state=await q.listItems(chatId,"persona");
  if(state.items.length)throw new Error("Fixture not empty");
  state=await q.addItem(chatId,"persona",{name:"Auth Sword",quantity:1});
  const id=state.items[0].id;
  await q.updateItem(chatId,"persona",id,{name:"Saved Sword",quantity:2});
  state=await q.listItems(chatId,"persona");
  if(state.items[0].name!=="Saved Sword"||state.items[0].quantity!==2)throw new Error("Edit did not persist");
  const canvas=document.createElement("canvas");canvas.width=4;canvas.height=4;
  const c=canvas.getContext("2d");c.fillStyle="red";c.fillRect(0,0,4,4);
  await q.uploadItemImage(chatId,"persona",id,canvas.toDataURL());
  async function checkImage(url){
   const img=document.createElement("img");document.body.appendChild(img);
   await new Promise((resolve,reject)=>{
    img.onload=resolve;img.onerror=()=>reject(new Error("Protected image failed to load"));
    (q.setImageSource ?? q.setImageSrc)(img,url);
   });
   if(!img.naturalWidth||!(/^(data:image\/|blob:)/.test(img.src)))throw new Error("Protected image did not load");img.remove();
  }
  await checkImage(q.slotIconUrl("head"));
  await checkImage(q.itemImageUrl(chatId,"persona",id));
  const outfitResult=await q.createOutfit(chatId,"persona",{name:"Test Outfit"});
  const outfitId=outfitResult.outfits[0].id;
  await q.uploadOutfitPortrait(chatId,"persona",outfitId,canvas.toDataURL());
  await checkImage(q.outfitPortraitUrl(chatId,"persona",outfitId));
  await q.listImageConnections();
  localStorage.setItem("marinara_admin_secret","wrong");
  let rejected=false;try{await q.listItems(chatId,"persona");}catch(e){rejected=/Invalid or missing|Admin Secret/.test(e.message);}
  if(!rejected)throw new Error("Wrong secret accepted");
  localStorage.setItem("marinara_admin_secret",secret);
  await q.listItems(chatId,"persona");
  return {id,outfitId};
 },{chatId:chat.id,secret});
 await page.reload();
 await page.evaluate('(() => {'+apiSource+';window.testQM=QM;})()');
 await page.evaluate(async({chatId,id,outfitId})=>{
  const q=window.testQM;const state=await q.listItems(chatId,"persona");
  if(state.items[0].name!=="Saved Sword")throw new Error("Reload lost inventory");
  await q.deleteItemImage(chatId,"persona",id);
  await q.deleteOutfitPortrait(chatId,"persona",outfitId);
  await q.deleteOutfit(chatId,"persona",outfitId);
  await q.deleteItem(chatId,"persona",id);
  if((await q.listItems(chatId,"persona")).items.length)throw new Error("Delete failed");
 },{chatId:chat.id,...result});
 await fs.writeFile(path.join(out,"result.json"),JSON.stringify({passed:true,engine:engineVersion,source:upstream ? "upstream" : "fork",version:manifest.version,checks:["native privileged rejection without secret","browser inventory create/edit/read/delete","reload persistence","authenticated slot/item/outfit images","image upload/delete","outfit create/delete","connection listing","wrong-secret rejection and recovery"]},null,2));
 console.log("PASS: native Engine authentication and browser CRUD/image/reload checks. Evidence: "+out);
} finally {
 await browser?.close();server.kill();
 if(server.exitCode===null)await new Promise(resolve=>server.once("exit",resolve));
 await log.close();
}

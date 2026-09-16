import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import vm from 'node:vm';
const document=new EventTarget();document.visibilityState='visible';
const window=new EventTarget();window.setTimeout=setTimeout;
let resolveRequest,requests=0;
const navigator={wakeLock:{request(){requests++;return new Promise(resolve=>{resolveRequest=resolve;});}}};
const context=vm.createContext({navigator,document,window,PACKAGE_ID:'pwa-helper',PACKAGE_NAME:'PWA Helper'});
for(const file of ['wake-lock','generation-monitor'])vm.runInContext(await fs.readFile(new URL(`../src/client/${file}.js`,import.meta.url),'utf8'),context);
const controller=context.createWakeLockController({setWakeLockStatus(){},warn(){}});
function sentinel(){const s=new EventTarget();s.released=false;s.release=async()=>{s.released=true;s.dispatchEvent(new Event('release'));};return s;}
async function settle(){await new Promise(resolve=>setImmediate(resolve));}
const pending=controller.hold({id:'pending'});pending.release();const cancelled=sentinel();resolveRequest(cancelled);await settle();assert.equal(cancelled.released,true);assert.equal(controller.status().active,false);
controller.hold({id:'destroy'});const destroyed=sentinel();controller.destroy();resolveRequest(destroyed);await settle();assert.equal(destroyed.released,true);
const lease=controller.hold({id:'active'}),old=sentinel();resolveRequest(old);await settle();assert.equal(controller.status().active,true);lease.release();
controller.hold({id:'replacement'});const next=sentinel();resolveRequest(next);await settle();old.dispatchEvent(new Event('release'));assert.equal(controller.status().active,true,'late release from an old sentinel cannot clear the replacement');
document.visibilityState='hidden';await controller.reconcile();assert.equal(next.released,true);document.visibilityState='visible';controller.destroy();
let callback,active=false,reconciles=0,holds=0,releases=0;
const monitor=context.createGenerationMonitor({bridgeGeneration:{getSnapshot:()=>({mainActive:active}),subscribe(listener){callback=listener;return()=>{callback=null;};}},wakeLock:{hold(){holds++;return{release(){releases++;}};},reconcile(){reconciles++;}},setGenerationStatus(){},warn(){}});
monitor.start();active=true;callback({mainActive:true});callback({mainActive:true});assert.equal(holds,1);
const before=reconciles;window.dispatchEvent(new Event('focus'));window.dispatchEvent(new Event('pageshow'));document.dispatchEvent(new Event('visibilitychange'));assert.equal(reconciles-before,3,'focus/pageshow/visibility retry a denied or dropped wake lock');
active=false;callback({mainActive:false});assert.equal(releases,1);monitor.stop();const stopped=reconciles;window.dispatchEvent(new Event('focus'));assert.equal(reconciles,stopped);assert.equal(callback,null);
console.log(`PWA wake-lock cancellation, destruction, stale release, focus recovery and lifecycle cleanup passed (${requests} requests).`);

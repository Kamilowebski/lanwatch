const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');
const app = fs.readFileSync(path.join(__dirname,'public/app.js'),'utf8');
function extract(start,end){return app.slice(app.indexOf(start),app.indexOf(end,app.indexOf(start)));}

test('an older refresh cannot replace the results of a newer refresh',async()=>{
 const pending=[];
 const context={refreshVersion:0, quickFilter:"all", document:{getElementById:()=>({classList:{contains:()=>true}})}, metadataRefreshedAt:0, categories:[],locations:[],onlineTtlMs:300000,sshUser:"",window:{setTimeout,clearTimeout},setConnectionState(){}, statusFilter:'', elements:{deviceDialog:{open:false}},
 api:url=>url==='/api/devices'?new Promise(resolve=>pending.push(resolve)):Promise.resolve({}),
 inventoryMetadataChanged:()=>true,trackMonitorStatusChanges(){},renderSettings(){},renderDevices(){},renderMonitor(){},scheduleStatusExpiry(){}};
 vm.createContext(context);vm.runInContext(extract('async function refresh(', '\nasync function saveMonitorSettings'),context);
 const older=context.refresh(),newer=context.refresh();
 pending[1]([{id:2}]);await newer;
 pending[0]([{id:1}]);await older;
 assert.equal(context.devices[0].id,2);
});

test('clock skew cannot start an immediate refresh loop',()=>{
 let delay;
 const context={devices:[{status:'online',statusCheckedAt:'2000-01-01T00:00:00Z'}],statusExpiryTimer:null,
 window:{clearTimeout(){},setTimeout(fn,ms){delay=ms;}},Date};
 vm.createContext(context);vm.runInContext(extract('function scheduleStatusExpiry(', '\nfunction makeCell'),context);
 context.scheduleStatusExpiry(300000);assert.equal(delay,5000);
});

test('blocked browser storage cannot stop startup preferences',()=>{
 const context={localStorage:{getItem(){throw Error('blocked');},setItem(){throw Error('blocked');}}};
 vm.createContext(context);vm.runInContext(extract('function readPreference(', '\nconst savedPageSize'),context);
 assert.equal(context.readPreference('theme'),null);
 assert.doesNotThrow(()=>context.savePreference('theme','dark'));
});

test('hung DNS lookup releases ping requests and queue slots',async()=>{
 let callback,cleared=false;
 const context={require:name=>name==='node:dns'?{promises:{lookup:()=>new Promise(()=>{})}}:require(name),
 module:{exports:{}},setTimeout:fn=>{callback=fn;return 1;},clearTimeout:()=>{cleared=true;}};
 vm.createContext(context);vm.runInContext(fs.readFileSync(path.join(__dirname,'ping.js'),'utf8'),context);
 const pending=context.module.exports.pingLocalTarget('unresolved-host');callback();
 const result=await pending;assert.equal(result.status,'unknown');assert.equal(result.attempts,0);assert.equal(cleared,true);
});

test('a stalled response body is covered by the API timeout and timer is cleared',async()=>{
 let callback,cleared=false;
 const context={AbortController,performance,window:{setTimeout:fn=>{callback=fn;return 1;},clearTimeout:()=>{cleared=true;}},
 fetch:async(_,options)=>({status:200,ok:true,json:()=>new Promise((resolve,reject)=>options.signal.addEventListener('abort',()=>reject(Error('aborted'))))})};
 vm.createContext(context);vm.runInContext(extract('async function api(', '\nfunction notify'),context);
 const pending=context.api('/test');await new Promise(resolve=>setImmediate(resolve));callback();
 await assert.rejects(pending,/Serwer nie odpowiedział/);assert.equal(cleared,true);
});


test('an unanswered notification prompt does not block enabling or disabling monitoring',async()=>{
 let saved=false,refreshed=false;
 const context={pendingMonitorUpdates:new Set(),renderMonitor(){},
 window:{Notification:true},Notification:{permission:'default',requestPermission:()=>new Promise(()=>{})},
 api:async()=>{saved=true;},refresh:async()=>{refreshed=true;},notify(){},console};
 vm.createContext(context);vm.runInContext(extract('async function saveMonitorSettings(', '\nfunction scheduleLiveRefresh'),context);
 await context.saveMonitorSettings({id:1},{enabled:true,notifyOnline:true,notifyOffline:false});
 assert.equal(saved,true);assert.equal(refreshed,true);assert.equal(context.pendingMonitorUpdates.size,0);
});

test('relative monitor time handles missing data, seconds, minutes and future clocks',()=>{
 const context={};vm.createContext(context);
 vm.runInContext(extract('function relativeCheckTime(', '\nfunction updateMonitorTime'),context);
 const now=Date.parse('2026-11-17T12:00:00Z');
 assert.equal(context.relativeCheckTime(null,now),'Nie sprawdzono');
 assert.equal(context.relativeCheckTime('2026-11-17T11:59:48Z',now),'12 s temu');
 assert.equal(context.relativeCheckTime('2026-11-17T11:58:00Z',now),'2 min temu');
 assert.equal(context.relativeCheckTime('2026-11-17T11:00:00Z',now),'1 godz. temu');
 assert.equal(context.relativeCheckTime('2026-11-18T12:00:00Z',now),'0 s temu');
});

test('hostname category suggestions cover requested prefixes and ignore case',()=>{
 const context={};vm.createContext(context);
 vm.runInContext(extract('function suggestedHostCategory(', '\nfunction updateHostCategoryHint'),context);
 for(const [host,expected] of [['T001','Terminal'],['t01','Terminal'],['D01','Komputer'],['n01','Komputer'],['P01','drukarka'],['z01','drukarka'],['  T01','Terminal'],['X01',null],['',null]]) {
  assert.equal(context.suggestedHostCategory(host),expected,host);
 }
});


test('hostname resolution explicitly requests IPv4',async()=>{
 let options;
 const context={require:name=>name==='node:dns'?{promises:{lookup:async(host,input)=>{options=input;return [{address:'192.168.1.10',family:4}];}}}:require(name),module:{exports:{}},setTimeout,clearTimeout};
 vm.createContext(context);vm.runInContext(fs.readFileSync(path.join(__dirname,'ping.js'),'utf8'),context);
 assert.equal(await context.module.exports.resolvePrivateAddress('host.local'),'192.168.1.10');
 assert.equal(options.family,4);
});

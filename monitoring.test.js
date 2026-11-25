const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),vm=require('node:vm');
const {execFileSync}=require('node:child_process');
const {validate,isPaused}=require('./monitoring');
test('monitor settings validate limits and normalize per-group pause without confusing global pause',()=>{
 const settings=validate({pausedGroups:[' EVO ','evo','']});assert.deepEqual(settings.pausedGroups,['evo','']);
 assert.equal(isPaused({groupName:'EVO'},settings),true);assert.equal(isPaused({groupName:'other'},settings),false);
 assert.equal(isPaused({groupName:'other'},{...settings,paused:true}),true);
 for(const value of [{attempts:0},{attempts:6},{concurrency:0},{concurrency:17},{intervalSeconds:14},{intervalSeconds:3601},{failureThreshold:0},{failureThreshold:11},{paused:'yes'},{pausedGroups:[5]},{unknown:true}])assert.throws(()=>validate(value),{status:400});
});
test('failure confirmation uses actual samples, resets correctly, and settings persist across restart',()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'lanwatch-monitor-test-')),env={...process.env,DB_PATH:path.join(dir,'test.sqlite')};
 try{
 execFileSync(process.execPath,['-e',`
 const assert=require('node:assert/strict'),d=require('./database');d.createLocation('Hala');
 const device=d.createDevice({hostName:'T-TEST',ip:'192.168.1.1',groupName:'EVO',location:'Hala',categoryId:d.getCategories()[0].id,description:'',lineNumber:'',numerator:''});
 const save=status=>d.saveDeviceStatus(device.id,{status,checkedAt:new Date().toISOString(),replies:status==='online'?1:0,target:device.ip,message:''});
 d.setMonitorSettings({...d.getMonitorSettings(),failureThreshold:3,paused:true,intervalSeconds:300,attempts:1,concurrency:2,pausedGroups:[' EVO ']});
 save('offline');assert.equal(d.getDevice(device.id).failureStreak,1);assert.equal(d.getDevices()[0].notificationStatus,'unknown');
 for(let i=0;i<5;i++)d.getDevices();assert.equal(d.getDevice(device.id).failureStreak,1);
 save('offline');assert.equal(d.getDevice(device.id).notificationStatus,'unknown');save('offline');assert.equal(d.getDevice(device.id).notificationStatus,'offline');
 save('unknown');assert.equal(d.getDevice(device.id).failureStreak,0);save('offline');assert.equal(d.getDevice(device.id).failureStreak,1);
 save('online');assert.equal(d.getDevice(device.id).notificationStatus,'online');assert.equal(d.getDevice(device.id).failureStreak,0);
 save('offline');d.updateDeviceMonitor(device.id,{enabled:false,notifyOnline:false,notifyOffline:false});assert.equal(d.getDevice(device.id).failureStreak,0);
 save('offline');d.updateDevice(device.id,{...device,ip:'192.168.1.2'});assert.equal(d.getDevice(device.id).failureStreak,0);
 `],{cwd:__dirname,env});
 const settings=JSON.parse(execFileSync(process.execPath,['-e',"console.log(JSON.stringify(require('./database').getMonitorSettings()))"],{cwd:__dirname,env,encoding:'utf8'}));assert.equal(settings.paused,true);assert.equal(settings.intervalSeconds,300);assert.equal(settings.attempts,1);assert.deepEqual(settings.pausedGroups,['evo']);
 }finally{fs.rmSync(dir,{recursive:true,force:true});}
});
test('paused automatic jobs skip probing while a promoted manual job still runs with the configured attempts',async()=>{
 const source=fs.readFileSync(path.join(__dirname,'server.js'),'utf8');
 const settings={concurrency:1,attempts:5,paused:false};const starts=[],releases=[],saved=[];
 const devices=Array.from({length:4},(_,id)=>({id,hostName:`T-${id}`,ip:`192.168.1.${id+1}`,monitorEnabled:true}));
 const context={getMonitorSettings:()=>settings,isMonitorPaused:()=>settings.paused,getDevice:id=>devices[id],saveDeviceStatus:id=>saved.push(id),pingLocalTarget:(target,attempts)=>{starts.push({target,attempts});return new Promise(resolve=>releases.push(()=>resolve({status:'online'})));}};
 vm.createContext(context);vm.runInContext(source.slice(source.indexOf('const activePings'),source.indexOf('\nclass HttpError')),context);
 const jobs=devices.map(device=>context.checkDevice(device));const manual=context.checkDevice(devices[3],true);
 settings.paused=true;releases[0]();await new Promise(resolve=>setImmediate(resolve));
 assert.equal(starts.length,2);assert.equal(starts[1].target,devices[3].ip);assert.equal(starts[1].attempts,5);releases[1]();
 const results=await Promise.all([...jobs,manual]);assert.equal(results.filter(result=>result.skipped).length,2);assert.deepEqual(saved,[0,3]);
});
test('changing concurrency drains queue without exceeding the new limit',async()=>{
 const source=fs.readFileSync(path.join(__dirname,'server.js'),'utf8'),settings={concurrency:1,attempts:1};
 const releases=[],started=[];const devices=Array.from({length:4},(_,id)=>({id,hostName:`T-${id}`,ip:`192.168.1.${id+1}`}));
 const context={getMonitorSettings:()=>settings,getDevice:id=>devices[id],saveDeviceStatus(){},pingLocalTarget:target=>{started.push(target);return new Promise(resolve=>releases.push(()=>resolve({status:'online'})));}};
 vm.createContext(context);vm.runInContext(source.slice(source.indexOf('const activePings'),source.indexOf('\nclass HttpError')),context);
 const jobs=devices.map(device=>context.checkDevice(device,true));assert.equal(started.length,1);
 settings.concurrency=3;context.drainPingQueue();await new Promise(resolve=>setImmediate(resolve));assert.equal(started.length,3);
 settings.concurrency=1;releases[0]();await new Promise(resolve=>setImmediate(resolve));assert.equal(started.length,3);
 releases[1]();releases[2]();await new Promise(resolve=>setImmediate(resolve));assert.equal(started.length,4);releases[3]();await Promise.all(jobs);
});
test('offline notifications wait for confirmed samples and do not repeat on refresh',()=>{
 const source=fs.readFileSync(path.join(__dirname,'public/app.js'),'utf8'),events=[];
 const context={knownMonitorStatuses:new Map(),hasLoadedMonitorStatuses:false,notifyMonitorTransition:(device,status)=>events.push(status)};
 vm.createContext(context);vm.runInContext(source.slice(source.indexOf('function trackMonitorStatusChanges('),source.indexOf('\nfunction inventoryMetadataChanged')),context);
 const sample=status=>context.trackMonitorStatusChanges([{id:1,monitorEnabled:true,notifyOnline:true,notifyOffline:true,status:status==='unknown'?'offline':status,notificationStatus:status}]);
 sample('online');sample('unknown');sample('unknown');assert.deepEqual(events,[]);sample('offline');sample('offline');assert.deepEqual(events,['offline']);sample('online');assert.deepEqual(events,['offline','online']);
});
test('configured probe count reaches native Windows ping without invoking a shell',async()=>{
 const {EventEmitter}=require('node:events'),calls=[];
 const nativeRequire=require;
 const context={module:{exports:{}},process:{platform:'win32'},setTimeout,clearTimeout,require:name=>name==='node:child_process'?{spawn:(command,args,options)=>{
  calls.push({command,args,options});const child=new EventEmitter();child.stdout=new EventEmitter();child.stderr=new EventEmitter();child.kill=()=>{};setImmediate(()=>{child.stdout.emit('data','Reply from 192.168.1.1: time=1ms TTL=64');child.emit('close',0);});return child;
 }}:nativeRequire(name)};
 vm.createContext(context);vm.runInContext(fs.readFileSync(path.join(__dirname,'ping.js'),'utf8'),context);
 for(const attempts of [1,5]){const result=await context.module.exports.pingLocalTarget('192.168.1.1',attempts);assert.equal(result.attempts,attempts);assert.equal(result.status,'online');}
 assert.equal(calls[0].command,'ping.exe');assert.equal(calls[0].args[1],'1');assert.equal(calls[1].args[1],'5');assert.equal(calls[0].options.shell,undefined);
 await assert.rejects(context.module.exports.pingLocalTarget('192.168.1.1',0));
});

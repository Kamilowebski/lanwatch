const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {execFileSync}=require('node:child_process');
function run(script){const dir=fs.mkdtempSync(path.join(os.tmpdir(),'lanwatch-insights-'));try{return execFileSync(process.execPath,['-e',script],{cwd:__dirname,env:{...process.env,DB_PATH:path.join(dir,'test.sqlite')},encoding:'utf8'});}finally{fs.rmSync(dir,{recursive:true,force:true});}}
const setup=`const assert=require('node:assert/strict'),d=require('./database');d.createLocation('Hala');const category=d.getCategories().find(v=>v.name==='Terminal');const make=(host,ip='')=>d.createDevice({hostName:host,ip,groupName:'',location:'Hala',categoryId:category.id,description:'',lineNumber:'',numerator:''});`;
test('long history reports exact totals while keeping chart points bounded, and retention prunes by age',()=>{
 run(setup+`(async()=>{
 const device=make('T-HISTORY');const {DatabaseSync}=require('node:sqlite');const db=new DatabaseSync(process.env.DB_PATH);db.exec('PRAGMA busy_timeout=5000; BEGIN');
 const insert=db.prepare('INSERT INTO device_history(device_id,status,checked_at,replies,target,message,latency_ms) VALUES(?,?,?,?,?,?,?)');
 const now=Date.now();let online=0,offline=0,latencySum=0;
 for(let i=0;i<5000;i++){const status=['online','offline','unknown'][i%3];if(status==='online'){online++;latencySum+=i%100;}if(status==='offline')offline++;insert.run(device.id,status,new Date(now-i*60000).toISOString(),status==='online'?3:0,'192.168.1.1','',status==='online'?i%100:null);}
 db.exec('COMMIT');
 const report=d.getDeviceReportData(device.id,null);assert.equal(report.summary.total,5000);assert.equal(report.summary.counts.online,online);assert.equal(report.summary.counts.offline,offline);assert.equal(report.summary.averageMs,latencySum/online);assert.ok(report.items.length<=1803);assert.equal(report.sampled,true);
 assert.equal(d.getHistorySettings().retentionDays,7);assert.throws(()=>d.setHistorySettings(2),{status:400});
 d.setHistorySettings(30);insert.run(device.id,'online',new Date(now-20*86400000).toISOString(),3,'192.168.1.1','',1);assert.equal(d.getDeviceReportData(device.id,null).summary.total,5001);
 d.setHistorySettings(1);await d.pruneDeviceHistory();const count=db.prepare('SELECT COUNT(*) AS n FROM device_history').get().n;assert.ok(count>=1439&&count<=1441);assert.equal(d.getDeviceReportData(device.id,null).summary.total,count);assert.ok(d.getDeviceHistory(device.id).items.every(item=>Date.parse(item.checkedAt)>=Date.now()-86400000));db.close();
 })().catch(error=>{console.error(error);process.exitCode=1;});`);
});
test('audit records actual field changes atomically and isolates a reused device id after deletion',()=>{
 run(setup+`
 const a=make('T-A'),b=make('T-B');const initial=d.getDeviceChanges().items.length;
 d.updateDevice(a.id,a);assert.equal(d.getDeviceChanges().items.length,initial);
 d.updateDevice(b.id,{...b,hostName:'T-B-NEW',ip:'192.168.1.25'});
 const edit=d.getDeviceChanges({deviceId:b.id}).items[0];assert.equal(edit.action,'update');assert.deepEqual(edit.changes.find(c=>c.field==='hostName'),{field:'hostName',before:'T-B',after:'T-B-NEW'});
 d.updateCategory(category.id,'Terminale');assert.ok(d.getDeviceChanges({deviceId:a.id}).items.some(v=>v.changes.some(c=>c.field==='category'&&c.after==='Terminale')));
 const location=d.getLocations()[0];d.updateLocation(location.id,'Nowa hala');assert.ok(d.getDeviceChanges({deviceId:a.id}).items.some(v=>v.changes.some(c=>c.field==='location'&&c.before==='Hala'&&c.after==='Nowa hala')));
 d.updateDeviceDependencies(a.id,[b.id]);d.deleteDevice(b.id);
 assert.ok(d.getDeviceChanges().items.some(v=>v.action==='delete'&&v.hostName==='T-B-NEW'));
 assert.ok(d.getDeviceChanges({deviceId:a.id}).items[0].changes.some(c=>c.field==='dependencies'&&c.after.length===0));
 const c=d.createDevice({...a,hostName:'T-C',location:'Nowa hala',dependencyIds:[]});assert.equal(c.id,b.id);assert.equal(d.getDeviceChanges({deviceId:c.id}).items.length,1);assert.equal(d.getDeviceChanges({deviceId:c.id}).items[0].hostName,'T-C');
 const before=d.getDeviceChanges().items.length;assert.throws(()=>d.bulkUpdateDevices([a.id,999999],{categoryId:category.id}),{status:404});assert.equal(d.getDeviceChanges().items.length,before);
 const preview=d.importDeviceRows([{...a,hostName:'T-PREVIEW',category:'Terminale',location:'Nowa hala',dependencyHosts:[],csvRow:2}],true);assert.equal(preview.imported,1);assert.equal(d.getDeviceChanges().items.length,before);
 d.updateDeviceFavorite(a.id,true);assert.equal(d.getDevice(a.id).favorite,true);assert.equal(d.getDevices().find(v=>v.id===a.id).favorite,true);assert.equal(d.getDeviceChanges().items.length,before);
 `);
});
test('automatic monitor origin survives reads, preserves manual machines and resets on disable',()=>{
 run(setup+`
 const a=make('T-ROOT'),b=make('D-DEPENDENCY'),c=make('P-SHARED');
 d.updateDeviceDependencies(a.id,[b.id]);d.updateDeviceDependencies(b.id,[c.id]);d.updateDeviceDependencies(c.id,[a.id]);
 d.updateDeviceMonitor(c.id,{enabled:true,notifyOnline:true,notifyOffline:false});
 assert.equal(d.getDevice(c.id).monitorAutomatic,false);
 assert.equal(d.getDevice(a.id).monitorAutomatic,true);assert.equal(d.getDevice(b.id).monitorAutomatic,true);
 d.updateDeviceMonitor(b.id,{enabled:true,notifyOnline:true,notifyOffline:true});
 assert.equal(d.getDevice(b.id).monitorAutomatic,true);
 d.bulkUpdateDevices([a.id],{monitorEnabled:true});
 assert.equal(d.getDevice(a.id).monitorAutomatic,false);assert.equal(d.getDevice(b.id).monitorAutomatic,true);
 assert.equal(d.getDevices().find(v=>v.id===c.id).monitorAutomatic,false);
 const {DatabaseSync}=require('node:sqlite');const db=new DatabaseSync(process.env.DB_PATH);
 assert.equal(db.prepare('SELECT automatic FROM device_monitor WHERE device_id=?').get(b.id).automatic,1);db.close();
 d.updateDeviceMonitor(a.id,{enabled:false,notifyOnline:false,notifyOffline:false});
 assert.equal(d.getDevice(a.id).monitorAutomatic,false);assert.equal(d.getDevice(b.id).monitorEnabled,true);
 d.updateDeviceMonitor(b.id,{enabled:false,notifyOnline:true,notifyOffline:true});
 assert.equal(d.getDevice(b.id).monitorAutomatic,false);
 `);
});

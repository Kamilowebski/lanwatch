const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {execFileSync}=require('node:child_process');
test('CSV preview rolls back, import resolves forward dependencies, and duplicate rows roll back all new data',()=>{
 const directory=fs.mkdtempSync(path.join(os.tmpdir(),'lanwatch-csv-'));
 try {
 const script=`
 const assert=require('node:assert/strict'),d=require('./database');
 const base={hostName:'T01',ip:'192.168.1.10',groupName:'',location:'Nowa hala',category:'Nowa kategoria',description:'',lineNumber:'',numerator:'',csvRow:2,dependencyHosts:['D01']};
 const rows=[base,{...base,hostName:'D01',ip:'',csvRow:3,dependencyHosts:[]}];
 const preview=d.importDeviceRows(rows,true);assert.equal(preview.imported,2);assert.equal(d.getDevices().length,0);
 assert.ok(!d.getLocations().some(item=>item.name==='Nowa hala'));assert.ok(!d.getCategories().some(item=>item.name==='Nowa kategoria'));
 assert.equal(d.importDeviceRows(rows).imported,2);const devices=d.getDevices();
 assert.deepEqual(devices.find(v=>v.hostName==='T01').dependencies,['D01']);
 const failed=[{...base,hostName:'P01',ip:'',location:'Rollback location',category:'Rollback category',dependencyHosts:[]},{...base,csvRow:3}];
 assert.throws(()=>d.importDeviceRows(failed),{status:409});assert.equal(d.getDevices().length,2);
 assert.ok(!d.getLocations().some(item=>item.name==='Rollback location'));assert.ok(!d.getCategories().some(item=>item.name==='Rollback category'));
 const t=devices.find(v=>v.hostName==='T01');
 d.bulkUpdateDevices(devices.map(v=>v.id),{monitorEnabled:true});assert.ok(d.getDevices().every(v=>v.monitorEnabled));
 d.updateMonitorNote(t.id,'Temporary');d.bulkUpdateDevices([t.id],{monitorEnabled:false});assert.equal(d.getDevice(t.id).monitorNote,'');
 assert.throws(()=>d.bulkUpdateDevices([t.id,999999],{location:'Rollback location'}),{status:404});
 assert.equal(d.getDevice(t.id).location,'Nowa hala');
 d.bulkUpdateDevices(devices.map(v=>v.id),{monitorEnabled:false});
 const dependency=devices.find(v=>v.hostName==='D01');
 d.importDeviceRows([{...base,hostName:'N-LEAF',ip:'',dependencyHosts:[]},{...base,hostName:'N-OTHER',ip:'',dependencyHosts:[]}]);
 const leaf=d.getDevices().find(v=>v.hostName==='N-LEAF');
 const other=d.getDevices().find(v=>v.hostName==='N-OTHER');
 d.updateDeviceDependencies(dependency.id,[leaf.id]);d.updateDeviceDependencies(leaf.id,[t.id]);
 d.updateDeviceMonitor(dependency.id,{enabled:true,notifyOnline:true,notifyOffline:true});
 d.updateMonitorNote(dependency.id,'Keep this');
 const enabled=d.bulkUpdateDevices([t.id,dependency.id],{monitorEnabled:true});
 assert.equal(enabled.monitored,3);assert.equal(enabled.dependenciesAdded,1);
 assert.ok(d.getDevice(leaf.id).monitorEnabled);assert.equal(d.getDevice(other.id).monitorEnabled,false);
 assert.equal(d.getDevice(dependency.id).notifyOnline,true);assert.equal(d.getDevice(dependency.id).monitorNote,'Keep this');
 d.bulkUpdateDevices([t.id],{monitorEnabled:false});assert.ok(d.getDevice(dependency.id).monitorEnabled);assert.ok(d.getDevice(leaf.id).monitorEnabled);
 d.bulkUpdateDevices([t.id],{location:'Nowa hala',monitorEnabled:true});assert.equal(d.getDevice(leaf.id).location,'Nowa hala');
 const category=d.getCategories().find(v=>v.name==='Terminal');
 d.bulkUpdateDevices(devices.map(v=>v.id),{categoryId:category.id});assert.ok(devices.every(v=>d.getDevice(v.id).categoryId===category.id));
 `;
 execFileSync(process.execPath,['-e',script],{cwd:__dirname,env:{...process.env,DB_PATH:path.join(directory,'test.sqlite')},stdio:'pipe'});
 }finally{fs.rmSync(directory,{recursive:true,force:true});}
});

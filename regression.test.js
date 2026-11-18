const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const { execFileSync } = require('node:child_process');

test('category changes survive restart including an empty list', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lanwatch-categories-'));
  const env = { ...process.env, DB_PATH: path.join(dir, 'test.sqlite') };
  const run = (script) => execFileSync(process.execPath, ['-e', script], { cwd: __dirname, env, encoding: 'utf8' }).trim();
  try {
    run(`const d=require('./database'); d.updateCategory(d.getCategories()[0].id,'Custom'); for(const c of d.getCategories()) if(c.name!=='Custom') d.deleteCategory(c.id);`);
    assert.equal(run(`console.log(JSON.stringify(require('./database').getCategories().map(c=>c.name)))`), '["Custom"]');
    run(`const d=require('./database'); for(const c of d.getCategories()) d.deleteCategory(c.id)`);
    assert.equal(run(`console.log(require('./database').getCategories().length)`), '0');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('live refresh rebuilds status-filtered inventory when a device changes status', async () => {
  const source = fs.readFileSync(path.join(__dirname, 'public/app.js'), 'utf8');
  const refresh = source.slice(source.indexOf('async function refresh('), source.indexOf('\nasync function saveMonitorSettings'));
  let fullRenders = 0;
  let incrementalRenders = 0;
  const context = {
    refreshVersion: 0, quickFilter:"all", document:{getElementById:()=>({classList:{contains:()=>true}})}, metadataRefreshedAt:0, categories:[],locations:[],onlineTtlMs:300000,sshUser:"",window:{setTimeout,clearTimeout},setConnectionState(){}, statusFilter: 'online', inventoryMetadataChanged: () => false,
    api: async (url) => url === '/api/devices' ? [{ id: 1, status: 'offline' }] : {},
    trackMonitorStatusChanges() {}, renderSettings() {}, renderMonitor() {}, scheduleStatusExpiry() {},
    renderDevices() { fullRenders++; }, updateVisibleDeviceStatuses() { incrementalRenders++; },
    elements: { deviceDialog: { open: false } },
  };
  vm.createContext(context);
  vm.runInContext(refresh, context);
  await vm.runInContext('refresh({preserveInventory:true})', context);
  assert.equal(fullRenders, 1);
  assert.equal(incrementalRenders, 0);
  context.statusFilter = '';
  await vm.runInContext('refresh({preserveInventory:true})', context);
  assert.equal(incrementalRenders, 1);
});

test('ping queue limits concurrency, shares requests and ignores results after address edits', async () => {
  const source = fs.readFileSync(path.join(__dirname, 'server.js'), 'utf8');
  const queue = source.slice(source.indexOf('const activePings'), source.indexOf('\nclass HttpError'));
  let running = 0;
  let peak = 0;
  let calls = 0;
  const saved = [];
  const devices = Array.from({length: 20}, (_, id) => ({id, hostName: `host${id}`, ip: `192.168.1.${id+1}`}));
  const context = {
    pingLocalTarget: async () => {
      calls++; peak = Math.max(peak, ++running);
      await new Promise(resolve => setTimeout(resolve, 2));
      running--;
      return {status:'online'};
    },
    getDevice: id => devices[id], saveDeviceStatus: id => saved.push(id),
  };
  vm.createContext(context);
  vm.runInContext(queue, context);
  const pending = devices.map(device => context.checkDevice(device));
  pending.push(context.checkDevice(devices[0]));
  devices[1] = {...devices[1], ip:'192.168.2.1'};
  await Promise.all(pending);
  assert.equal(calls, 20);
  assert.equal(peak, 8);
  assert.equal(saved.includes(1), false);
  assert.equal(saved.length, 19);
});

test('history persists, paginates, retains 1000 entries and cascades on deletion', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lanwatch-history-'));
  const env = {...process.env, DB_PATH:path.join(dir,'test.sqlite')};
  const run = script => execFileSync(process.execPath,['-e',script],{cwd:__dirname,env,encoding:'utf8'}).trim();
  try {
    run(`const d=require('./database'); d.createLocation('Test'); const device=d.createDevice({hostName:'test',ip:'192.168.1.1',groupName:'',location:'Test',categoryId:d.getCategories()[0].id,description:'',lineNumber:'',numerator:''});
      for(let i=0;i<1002;i++) d.saveDeviceStatus(device.id,{status:i%2?'online':'offline',checkedAt:new Date().toISOString(),replies:i%2,target:'192.168.1.1',message:'',latencyMs:i%2?12:null});`);
    const data=JSON.parse(run(`const d=require('./database'); const id=d.getDevices()[0].id; const first=d.getDeviceHistory(id); const second=d.getDeviceHistory(id,first.nextBefore); const {DatabaseSync}=require('node:sqlite'); const db=new DatabaseSync(process.env.DB_PATH); console.log(JSON.stringify({first,second,count:db.prepare('SELECT COUNT(*) AS n FROM device_history').get().n})); db.close();`));
    assert.equal(data.count,1000);
    assert.equal(data.first.items.length,50);
    assert.equal(data.second.items.length,50);
    assert.ok(data.second.items[0].id < data.first.items[49].id);
    assert.equal(data.first.items[0].latencyMs,12);
    assert.equal(run(`const d=require('./database'); d.deleteDevice(d.getDevices()[0].id); const {DatabaseSync}=require('node:sqlite'); const db=new DatabaseSync(process.env.DB_PATH); console.log(db.prepare('SELECT COUNT(*) AS n FROM device_history').get().n); db.close();`),'0');
  } finally {fs.rmSync(dir,{recursive:true,force:true});}
});

test('manual requests promote queued monitoring without duplicate probes', async () => {
 const source=fs.readFileSync(path.join(__dirname,'server.js'),'utf8');
 const context={getDevice:id=>devices[id],saveDeviceStatus(){},pingLocalTarget:target=>{
   started.push(target);return new Promise(resolve=>releases.push(()=>resolve({status:'online'})));
 }};
 const started=[],releases=[];
 const devices=Array.from({length:10},(_,id)=>({id,hostName:`host${id}`,ip:`192.168.1.${id+1}`}));
 vm.createContext(context);vm.runInContext(source.slice(source.indexOf('const activePings'),source.indexOf('\nclass HttpError')),context);
 const pending=devices.map(device=>context.checkDevice(device));
 const manual=context.checkDevice(devices[9],true);
 releases[0]();await new Promise(resolve=>setImmediate(resolve));
 assert.equal(started[8],devices[9].ip);
 releases[1]();await new Promise(resolve=>setImmediate(resolve));
 assert.equal(started[9],devices[8].ip);
 for(const release of releases)release();
 await Promise.all([...pending,manual]);assert.equal(started.length,10);
});

test('monitor notes persist until disabled and reports contain recorded samples',()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'lanwatch-notes-'));
 const env={...process.env,DB_PATH:path.join(dir,'test.sqlite')};
 const run=script=>execFileSync(process.execPath,['-e',script],{cwd:__dirname,env,encoding:'utf8'}).trim();
 try {
  run(`const d=require('./database');d.createLocation('Test');const v=d.createDevice({hostName:'note-host',ip:'',groupName:'',location:'Test',categoryId:d.getCategories()[0].id,description:'Permanent',lineNumber:'',numerator:''});d.updateDeviceMonitor(v.id,{enabled:true,notifyOnline:false,notifyOffline:false});d.updateMonitorNote(v.id,'Temporary');d.saveDeviceStatus(v.id,{status:'online',checkedAt:new Date().toISOString(),replies:3,target:'192.168.1.1',message:'',latencyMs:10});`);
  const data=JSON.parse(run(`const d=require('./database');const v=d.getDevices()[0];const before=v.monitorNote;const report=d.getDeviceReport(v.id,24);d.updateDeviceMonitor(v.id,{enabled:false,notifyOnline:false,notifyOffline:false});const after=d.getDevice(v.id);console.log(JSON.stringify({before,after:after.monitorNote,description:after.description,report}));`));
  assert.equal(data.before,'Temporary');assert.equal(data.after,'');assert.equal(data.description,'Permanent');assert.equal(data.report.length,1);assert.equal(data.report[0].latencyMs,10);
 } finally {fs.rmSync(dir,{recursive:true,force:true});}
});

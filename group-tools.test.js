const test=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs');
const app=fs.readFileSync(require.resolve('./public/app.js'),'utf8');
function extract(text,start,end){return text.slice(text.indexOf(start),text.indexOf(end,text.indexOf(start)));}
test('group problem filter traverses external dependencies, handles cycles and ignores unrelated failures',()=>{
 const devices=[{id:1,status:'online',dependencyIds:[2]},{id:2,status:'online',dependencyIds:[3]},{id:3,status:'offline',dependencyIds:[1]},{id:4,status:'offline',dependencyIds:[]}];
 const context={devices,document:{getElementById:()=>({checked:true})},quickFilter:'all',categoryFilter:'',locationFilter:'',statusFilter:''};
 vm.createContext(context);vm.runInContext(extract(app,'function inventoryGroupTargets(', 'async function checkExpandedGroup'),context);vm.runInContext(extract(app,'function matchesDeviceFilters(', 'function summaryValues'),context);
 const group={devices:[devices[0]],groupName:'EVO'};
 assert.equal(context.inventoryGroupTargets(group).length,3);assert.equal(context.matchesDeviceFilters(group),true);
 devices[2].status='unknown';assert.equal(context.matchesDeviceFilters(group),false);
 devices[2].status='online';assert.equal(context.matchesDeviceFilters(group),false);
});
test('manual series summary counts the returned results including unknown failures',async()=>{
 const server=fs.readFileSync(require.resolve('./server.js'),'utf8');
 const devices=[{id:1},{id:2},{id:3}];
 const context={getDevices:()=>devices,checkDevice:async device=>({status:['online','offline','unknown'][device.id-1]}),HttpError:Error};
 vm.createContext(context);vm.runInContext(extract(server,'async function pingSelectedDevices(', 'async function pollMonitoredDevices'),context);
 const result=await context.pingSelectedDevices([1,2,3]);assert.equal(result.checked,3);assert.equal(result.summary.online,1);assert.equal(result.summary.offline,1);assert.equal(result.summary.unknown,1);assert.ok(Number.isFinite(Date.parse(result.finishedAt)));
});

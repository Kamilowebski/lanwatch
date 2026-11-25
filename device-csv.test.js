const test=require('node:test'),assert=require('node:assert/strict');
const {parseDeviceCsv,exportDeviceCsv}=require('./device-csv');
test('CSV round-trip preserves Polish, quotes, multiline text and dependencies and protects spreadsheet formulas',()=>{
 const device={hostName:'T-ŁÓDŹ',ip:'192.168.1.1',groupName:'A;B',location:'Hala',category:'Terminal',description:'=TEST("opis")\nDruga linia',lineNumber:"'01",numerator:'',dependencies:['D-001','P-002']};
 const csv=exportDeviceCsv([device]);assert.ok(csv.startsWith('\uFEFF'));assert.ok(csv.includes("'=TEST"));
 const [row]=parseDeviceCsv(csv);
 for(const key of ['hostName','ip','groupName','location','category','description','lineNumber','numerator'])assert.equal(row[key],device[key],key);
 assert.deepEqual(row.dependencyHosts,device.dependencies);
});
test('CSV supports minimal comma exports and refuses malformed imports',()=>{
 const [row]=parseDeviceCsv('hostName,location,category\r\nT01,"Hala, A",Terminal\r\n');assert.equal(row.location,'Hala, A');assert.equal(row.ip,'');
 for(const csv of ['','hostName;location;category\n"unclosed;Test;Terminal','hostName;location\nT01;Test','hostName;location;category\nT01;Hala','hostName;location;category;category\nT01;Hala;A;B','hostName;location;category;dependencyHosts\nT01;Hala;A;not-json'])assert.throws(()=>parseDeviceCsv(csv),{status:400});
});

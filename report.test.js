const test=require('node:test');
const assert=require('node:assert/strict');
const {summarizeReport}=require('./public/report');
test('report percentages include unknown samples; latency uses only measured online replies',()=>{
 const result=summarizeReport([{status:'online',latencyMs:10},{status:'online',latencyMs:20},{status:'offline',latencyMs:null},{status:'unknown',latencyMs:100}]);
 assert.equal(result.percentages.online,50);assert.equal(result.percentages.offline,25);assert.equal(result.percentages.unknown,25);assert.equal(result.averageMs,15);
 const empty=summarizeReport([]);assert.equal(empty.total,0);assert.equal(empty.averageMs,null);assert.equal(empty.percentages.online,0);
});

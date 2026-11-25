const test=require('node:test'),assert=require('node:assert/strict'),{validateLocalRequest,parseBoundedJson}=require('./security');
function request(host,method='GET',headers={}){return {method,url:'/api/devices',headers:{host,...headers},rawHeaders:['Host',host]};}
test('Host allowlist accepts only exact loopback authorities with the listening port',()=>{
 for(const host of ['localhost:3000','LOCALHOST:3000','127.0.0.1:3000'])assert.doesNotThrow(()=>validateLocalRequest(request(host),3000));
 for(const host of ['evil.invalid:3000','localhost.evil.invalid:3000','127.1:3000','0.0.0.0:3000','[::1]:3000','localhost.:3000','localhost:3001','localhost','127.0.0.1:3000@evil.invalid'])assert.throws(()=>validateLocalRequest(request(host),3000),{status:403});
 assert.throws(()=>validateLocalRequest({...request('localhost:3000'),rawHeaders:['Host','localhost:3000','Host','localhost:3000']},3000),{status:403});
 assert.throws(()=>validateLocalRequest({...request('localhost:3000'),url:'http://evil.invalid/api/devices'},3000),{status:400});
});
test('unsafe methods reject cross-origin, same-site and null origins but preserve local command-line clients',()=>{
 for(const headers of [{origin:'http://evil.invalid'},{origin:'null'},{origin:'http://localhost:4000'},{'sec-fetch-site':'same-site'},{'sec-fetch-site':'cross-site'},{referer:'http://evil.invalid/form'}])for(const method of ['POST','PUT','DELETE'])assert.throws(()=>validateLocalRequest(request('localhost:3000',method,headers),3000),{status:403});
 for(const headers of [{},{origin:'http://localhost:3000','sec-fetch-site':'same-origin'},{referer:'http://localhost:3000/'}])assert.doesNotThrow(()=>validateLocalRequest(request('localhost:3000','POST',headers),3000));
});
test('JSON depth checks ignore command text and escaped quotes while rejecting deeply nested structures',()=>{
 const command='echo "[[[{test}]]]" \\ path';assert.equal(parseBoundedJson(JSON.stringify({command})).command,command);
 assert.doesNotThrow(()=>parseBoundedJson('['.repeat(64)+'0'+']'.repeat(64)));
 assert.throws(()=>parseBoundedJson('['.repeat(65)+'0'+']'.repeat(65)),{status:400});
 assert.throws(()=>parseBoundedJson('{bad}'),{status:400});
});

const test=require('node:test'),assert=require('node:assert/strict'),http=require('node:http'),net=require('node:net'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),{spawn}=require('node:child_process');
test('HTTP rejects hostile authorities and cross-site writes, enforces byte/depth limits and sets security headers',async()=>{
 const listener=net.createServer();await new Promise(resolve=>listener.listen(0,'127.0.0.1',resolve));const port=listener.address().port;await new Promise(resolve=>listener.close(resolve));
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'lanwatch-http-security-'));const child=spawn(process.execPath,[path.join(__dirname,'server.js')],{cwd:__dirname,env:{...process.env,PORT:String(port),DB_PATH:path.join(dir,'test.sqlite')},stdio:'ignore'});
 const stop=async()=>{if(child.exitCode!==null||child.signalCode!==null)return;const exited=new Promise(resolve=>child.once('exit',resolve));child.kill('SIGTERM');await exited;};
 const send=(method,url,headers={},body)=>new Promise((resolve,reject)=>{const request=http.request({host:'127.0.0.1',port,path:url,method,headers},response=>{let text='';response.setEncoding('utf8');response.on('data',chunk=>text+=chunk);response.on('end',()=>resolve({status:response.statusCode,headers:response.headers,body:text}));});request.on('error',reject);request.end(body);});
 try{
  for(let i=0;i<100;i++){try{if((await send('GET','/api/devices')).status===200)break;}catch{}await new Promise(resolve=>setTimeout(resolve,50));}
  const policy=(await send('GET','/')).headers;assert.match(policy['content-security-policy'],/script-src 'self'/);assert.match(policy['content-security-policy'],/frame-ancestors 'none'/);assert.equal(policy['x-content-type-options'],'nosniff');assert.equal(policy['x-frame-options'],'DENY');assert.equal(policy['referrer-policy'],'no-referrer');assert.equal(policy['cross-origin-resource-policy'],'same-origin');
  for(const authority of [`review.invalid:${port}`,`localhost:${port+1}`,`127.1:${port}`]){const response=await send('GET','/api/devices',{Host:authority});assert.equal(response.status,403);assert.equal(response.headers['x-frame-options'],'DENY');}
  const fakeCredential='not-a-real-credential-for-review';
  const hostile=await send('POST','/api/locations',{Host:`review.invalid:${port}`,Origin:`http://review.invalid:${port}`,'Sec-Fetch-Site':'same-origin','Content-Type':'application/json',Authorization:fakeCredential,Cookie:fakeCredential},JSON.stringify({name:'Forbidden'}));assert.equal(hostile.status,403);
  for(const headers of [{Origin:'null'},{Origin:'http://review.invalid'},{'Sec-Fetch-Site':'same-site'},{'Sec-Fetch-Site':'cross-site'}])assert.equal((await send('POST','/api/locations',{'Content-Type':'application/json',...headers},JSON.stringify({name:'Forbidden'}))).status,403);
  assert.equal((await send('POST','/api/locations',{Host:`localhost:${port}`,Origin:`http://localhost:${port}`,'Sec-Fetch-Site':'same-origin','Content-Type':'application/json'},JSON.stringify({name:'Local UI'}))).status,201);
  assert.equal((await send('POST','/api/locations',{'Content-Type':'application/json'},JSON.stringify({name:'Local CLI'}))).status,201);
  const category=JSON.parse((await send('GET','/api/categories')).body)[0];
  const create=async host=>JSON.parse((await send('POST','/api/devices',{'Content-Type':'application/json'},JSON.stringify({hostName:host,ip:'',location:'Local UI',categoryId:category.id}))).body);
  const device=await create('T-DELETE-TEST');
  for(const headers of [{Origin:'http://review.invalid'},{'Sec-Fetch-Site':'cross-site'},{Referer:'http://review.invalid/form'},{Host:`review.invalid:${port}`,Origin:`http://review.invalid:${port}`,'Sec-Fetch-Site':'same-origin'}])assert.equal((await send('DELETE',`/api/devices/${device.id}`,headers)).status,403);
  assert.equal(JSON.parse((await send('GET','/api/devices')).body).some(v=>v.id===device.id),true);assert.equal(JSON.parse((await send('GET','/api/trash')).body).items.length,0);
  assert.equal((await send('DELETE',`/api/devices/${device.id}`)).status,200);
  const browserDevice=await create('T-DELETE-BROWSER');assert.equal((await send('DELETE',`/api/devices/${browserDevice.id}`,{Origin:`http://127.0.0.1:${port}`,'Sec-Fetch-Site':'same-origin'})).status,200);
  assert.equal((await send('POST','/api/locations',{'Content-Type':'text/plain'},'{}')).status,415);
  assert.equal((await send('POST','/api/locations',{'Content-Type':'application/json'},'['.repeat(65)+'0'+']'.repeat(65))).status,400);
  const large=JSON.stringify({version:1,snippets:Array.from({length:30},(_,i)=>({title:'Test '+i,platform:'Windows',shell:'CMD',category:'Test',description:'',tags:'',command:'ą'.repeat(15000)}))});assert.ok(Buffer.byteLength(large)>900000);
  assert.equal((await send('POST','/api/snippets/import',{'Content-Type':'application/json','Content-Length':String(Buffer.byteLength(large))},large)).status,413);
  assert.equal((await send('POST','/api/snippets/import',{'Content-Type':'application/json','Transfer-Encoding':'chunked'},large)).status,413);
  await new Promise(resolve=>{const request=http.request({host:'127.0.0.1',port,path:'/api/snippets/import',method:'POST',headers:{'Content-Type':'application/json','Content-Length':'900001'}},response=>{response.resume();response.once('end',resolve);});request.on('error',()=>resolve());request.flushHeaders();setTimeout(()=>{request.destroy();resolve();},20);});
  await new Promise(resolve=>setTimeout(resolve,30));assert.equal((await send('GET','/api/devices')).status,200);
  const locations=JSON.parse((await send('GET','/api/locations')).body);assert.equal(locations.some(v=>v.name==='Forbidden'),false);
  assert.equal((await send('PUT','/api/settings',{'Content-Type':'application/json',Origin:`http://127.0.0.1:${port}`},JSON.stringify({sshUser:'-bad'}))).status,400);
  await stop();const log=fs.readFileSync(path.join(dir,'logs','lanwatch.log'),'utf8');assert.equal(log.includes(fakeCredential),false);
 }finally{await stop();fs.rmSync(dir,{recursive:true,force:true});}
});

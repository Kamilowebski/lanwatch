const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const {createLogger} = require('./diagnostics');

test('diagnostic logs preserve request correlation and rotate without losing the new record',async()=>{
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'lanwatch-logs-'));
 try {
   const logger=createLogger(dir);
   logger.log('info','request.start',{requestId:'test-1'});
   logger.log('info','request.finish',{requestId:'test-1',status:200});
   await logger.flush();
   const file=path.join(dir,'lanwatch.log');
   const rows=(await fs.readFile(file,'utf8')).trim().split('\n').map(JSON.parse);
   assert.equal(rows.length,2);assert.equal(rows[0].requestId,rows[1].requestId);
   await fs.writeFile(file,'x'.repeat(5*1024*1024));
   logger.log('info','server.started',{});await logger.flush();
   assert.equal(JSON.parse((await fs.readFile(file,'utf8')).trim()).event,'server.started');
   assert.equal((await fs.stat(path.join(dir,'lanwatch.1.log'))).size,5*1024*1024);
 } finally {await fs.rm(dir,{recursive:true,force:true});}
});

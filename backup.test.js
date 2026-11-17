const assert = require("node:assert/strict");
const test = require("node:test");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { DatabaseSync } = require("node:sqlite");
const { createDailyBackup } = require("./backup");

test("daily backups include WAL data, survive restore and retain seven dates", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "lanwatch-backup-"));
  const dbPath = path.join(dir, "custom.sqlite");
  const db = new DatabaseSync(dbPath);
  try {
    db.exec("PRAGMA journal_mode=WAL; CREATE TABLE sample(value TEXT); INSERT INTO sample VALUES ('first');");
    const first = createDailyBackup(db, dbPath, new Date(2026, 0, 1));
    db.exec("INSERT INTO sample VALUES ('second')");
    assert.equal(createDailyBackup(db, dbPath, new Date(2026, 0, 1)), first);
    const snapshot = new DatabaseSync(first);
    try {
      assert.equal(snapshot.prepare("PRAGMA integrity_check").get().integrity_check, "ok");
      assert.equal(snapshot.prepare("SELECT COUNT(*) AS count FROM sample").get().count, 1);
    } finally { snapshot.close(); }
    fs.writeFileSync(path.join(dir,"backups","keep.txt"), "unrelated");
    for (let day=2;day<=9;day++) createDailyBackup(db, dbPath, new Date(2026, 0, day));
    const files = fs.readdirSync(path.join(dir,"backups"));
    assert.equal(files.filter(f=>f.endsWith('.sqlite')).length,7);
    assert.ok(files.includes('lanwatch-2026-01-03.sqlite'));
    assert.ok(files.includes('keep.txt'));
    const latest = new DatabaseSync(path.join(dir,"backups","lanwatch-2026-01-09.sqlite"));
    try { assert.equal(latest.prepare("SELECT COUNT(*) AS count FROM sample").get().count,2); }
    finally {latest.close();}
    const before = fs.readdirSync(path.join(dir,"backups"));
    assert.throws(()=>createDailyBackup({prepare(){return {run(file){fs.writeFileSync(file,'partial');throw Error('disk full');}};}},dbPath,new Date(2026,0,10)),/disk full/);
    assert.deepEqual(fs.readdirSync(path.join(dir,"backups")),before);
  } finally {db.close();fs.rmSync(dir,{recursive:true,force:true});}
});


test("worker backup creates a readable snapshot without blocking the main connection", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "lanwatch-worker-"));
  const dbPath = path.join(dir, "test.sqlite");
  const db = new DatabaseSync(dbPath);
  try {
    db.exec("CREATE TABLE sample(value); INSERT INTO sample VALUES (42)");
    const pending = require("./backup").backupInWorker(dbPath);
    assert.equal(db.prepare("SELECT value FROM sample").get().value,42);
    const destination = await pending;
    const restored = new DatabaseSync(destination);
    try { assert.equal(restored.prepare("SELECT value FROM sample").get().value,42); }
    finally {restored.close();}
  } finally { db.close();fs.rmSync(dir,{recursive:true,force:true}); }
});


test("backup does not interrupt concurrent WAL writes", async () => {
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'lanwatch-contention-'));
 const dbPath=path.join(dir,'test.sqlite');
 const db=new DatabaseSync(dbPath);
 try {
   db.exec("PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000; CREATE TABLE sample(value TEXT); INSERT INTO sample VALUES (zeroblob(2000000));");
   const pending=require('./backup').backupInWorker(dbPath);
   let writes=0;
   const insert=db.prepare("INSERT INTO sample VALUES (?)");
   for(let batch=0;batch<20;batch++) {
     for(let i=0;i<20;i++){insert.run('value');writes++;}
     await new Promise(resolve=>setTimeout(resolve,2));
   }
   await pending;
   assert.equal(writes,400);
   assert.equal(db.prepare('SELECT COUNT(*) AS n FROM sample').get().n,401);
 } finally {db.close();fs.rmSync(dir,{recursive:true,force:true});}
});

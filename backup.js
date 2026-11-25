const fs = require("node:fs");
const path = require("node:path");

// VACUUM INTO produces a consistent SQLite snapshot, including committed WAL data.
function createDailyBackup(database, databasePath, now = new Date()) {
  const directory = path.join(path.dirname(databasePath), "backups");
  fs.mkdirSync(directory, { recursive: true });
  const day = [now.getFullYear(), String(now.getMonth() + 1).padStart(2, "0"),
    String(now.getDate()).padStart(2, "0")].join("-");
  const destination = path.join(directory, `lanwatch-${day}.sqlite`);
  if (!fs.existsSync(destination)) {
    const temporary = path.join(directory, `.${path.basename(destination)}.${process.pid}.tmp`);
    try {
      // A crash may leave a partial temporary file; it is never treated as a backup.
      fs.rmSync(temporary, { force: true });
      database.prepare("VACUUM INTO ?").run(temporary);
      fs.renameSync(temporary, destination);
    } finally {
      fs.rmSync(temporary, { force: true });
    }
  }
  const backups = fs.readdirSync(directory)
    .filter((name) => /^lanwatch-\d{4}-\d{2}-\d{2}\.sqlite$/.test(name))
    .sort().reverse();
  // Prune only after a complete backup for today exists.
  for (const name of backups.slice(7)) fs.unlinkSync(path.join(directory, name));
  return destination;
}

function createManualBackup(database,databasePath,now=new Date()) {
 const directory=path.join(path.dirname(databasePath),"backups");fs.mkdirSync(directory,{recursive:true});
 const name=`lanwatch-manual-${now.toISOString().replace(/[:.]/g,'-')}-${require('node:crypto').randomUUID()}.sqlite`;
 const destination=path.join(directory,name),temporary=destination+'.tmp';
 try{database.prepare('VACUUM INTO ?').run(temporary);fs.renameSync(temporary,destination);}finally{fs.rmSync(temporary,{force:true});}
 const names=fs.readdirSync(directory).filter(name=>/^lanwatch-manual-[A-Za-z0-9_-]+\.sqlite$/.test(name)).sort().reverse();
 for(const name of names.slice(7))fs.unlinkSync(path.join(directory,name));return destination;
}
module.exports = { createDailyBackup,createManualBackup };

// Use a separate SQLite connection in a worker so disk I/O cannot freeze HTTP requests.
function backupInWorker(databasePath,manual=false) {
  const { Worker } = require("node:worker_threads");
  return new Promise((resolve, reject) => {
    const worker = new Worker(__filename, { workerData: { databasePath,manual } });
    const timer = setTimeout(() => {
      worker.terminate();
      reject(new Error("Przekroczono czas wykonywania kopii bazy."));
    }, 120000);
    worker.once("message", (result) => {
      clearTimeout(timer);
      if (result.error) reject(new Error(result.error));
      else resolve(result.path);
    });
    worker.once("error", (error) => { clearTimeout(timer); reject(error); });
    worker.once("exit", (code) => {
      clearTimeout(timer);
      if (code !== 0) reject(new Error(`Proces kopii zakończył się kodem ${code}.`));
    });
  });
}
module.exports.backupInWorker = backupInWorker;
const { isMainThread, workerData, parentPort } = require("node:worker_threads");
if (!isMainThread && workerData?.databasePath) {
  const { DatabaseSync } = require("node:sqlite");
  let database;
  try {
    database = new DatabaseSync(workerData.databasePath, { readOnly: true });
    database.exec("PRAGMA busy_timeout = 5000");
    parentPort.postMessage({ path: (workerData.manual?createManualBackup:createDailyBackup)(database, workerData.databasePath) });
  } catch (error) {
    parentPort.postMessage({ error: error.message });
  } finally { database?.close(); }
}

const fs = require('node:fs/promises');
const path = require('node:path');

function createLogger(directory) {
  let queue = Promise.resolve();
  let pending = 0;
  let warned = false;
  function log(level, event, details = {}) {
    const entry = { ...details, time: new Date().toISOString(), level, event };
    if (level === 'error') console.error('[Lanwatch]', event, details);
    else if (level === 'warn') console.warn('[Lanwatch]', event, details);
    if (pending >= 500) return;
    pending++;
    queue = queue.then(async () => {
      await fs.mkdir(directory, { recursive: true });
      const file = path.join(directory, 'lanwatch.log');
      const size = await fs.stat(file).then(s => s.size).catch(() => 0);
      if (size >= 5 * 1024 * 1024) {
        await fs.rm(path.join(directory, 'lanwatch.6.log'), { force: true });
        for (let i=5;i>=1;i--) {
          const source=path.join(directory, `lanwatch.${i}.log`);
          try { await fs.rename(source,path.join(directory,`lanwatch.${i+1}.log`)); }
          catch(error) { if(error.code!=='ENOENT') throw error; }
        }
        await fs.rename(file,path.join(directory,'lanwatch.1.log'));
      }
      await fs.appendFile(file, JSON.stringify(entry) + '\n', 'utf8');
      warned = false;
    }).catch(error => {
      if (!warned) console.error('[Lanwatch] Nie można zapisać logu:',error.message);
      warned = true;
    }).finally(() => { pending--; });
  }
  return { log, flush: () => queue };
}
module.exports = { createLogger };

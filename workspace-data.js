const {randomUUID}=require('node:crypto');
const fail=message=>{throw Object.assign(new Error(message),{status:400});};
function validateView(value){
 if(!value||!['inventory','monitor'].includes(value.scope)||typeof value.name!=='string'||!value.name.trim()||value.name.length>60)fail('Podaj nazwę widoku (do 60 znaków) i prawidłową zakładkę.');
 const f=value.filters;if(!f||typeof f!=='object'||Array.isArray(f))fail('Nieprawidłowe filtry.');
 const allowed=value.scope==='inventory'?['query','category','location','status','quick','problems']:['query','problems','offlineFirst'];
 if(Object.keys(f).some(key=>!allowed.includes(key)))fail('Nieznane filtry widoku.');
 for(const [key,item] of Object.entries(f))if(['problems','offlineFirst'].includes(key)?typeof item!=='boolean':typeof item!=='string'||item.length>200)fail('Nieprawidłowa wartość filtra.');
 if(f.status!==undefined&&!['','online','offline','unknown'].includes(f.status))fail('Nieprawidłowy status.');
 if(f.quick!==undefined&&!['all','offline','monitored','favorites'].includes(f.quick))fail('Nieprawidłowy filtr szybki.');
 return {name:value.name.trim(),scope:value.scope,filters:f};
}
function createWorkspaceStore(db){
 db.exec(`CREATE TABLE IF NOT EXISTS saved_views(id TEXT PRIMARY KEY,name TEXT NOT NULL,scope TEXT NOT NULL,filters TEXT NOT NULL);
 CREATE TABLE IF NOT EXISTS machine_events(id INTEGER PRIMARY KEY,device_id INTEGER NOT NULL REFERENCES devices(id) ON DELETE CASCADE,kind TEXT NOT NULL,recorded_at TEXT NOT NULL,threshold INTEGER NOT NULL);
 CREATE INDEX IF NOT EXISTS machine_events_device ON machine_events(device_id,id);
 CREATE TABLE IF NOT EXISTS machine_event_state(device_id INTEGER PRIMARY KEY REFERENCES devices(id) ON DELETE CASCADE,streak INTEGER NOT NULL,incident INTEGER NOT NULL,confirmed INTEGER NOT NULL);
 CREATE TABLE IF NOT EXISTS group_summaries(member_key TEXT PRIMARY KEY,summary TEXT NOT NULL,finished_at TEXT NOT NULL);`);
 return {
  listViews:()=>db.prepare('SELECT * FROM saved_views ORDER BY name COLLATE NOCASE,id').all().map(v=>({...v,filters:JSON.parse(v.filters)})),
  saveView:value=>{const v=validateView(value);if(db.prepare('SELECT COUNT(*) AS n FROM saved_views').get().n>=40)fail('Można zapisać najwyżej 40 widoków.');const id=randomUUID();db.prepare('INSERT INTO saved_views VALUES(?,?,?,?)').run(id,v.name,v.scope,JSON.stringify(v.filters));return {id,...v};},
  deleteView:id=>{if(!db.prepare('DELETE FROM saved_views WHERE id=?').run(id).changes)throw Object.assign(new Error('Widok już nie istnieje.'),{status:404});},
  recordStatus:(id,status,time,threshold,actualStreak=null)=>{
   const old=db.prepare('SELECT * FROM machine_event_state WHERE device_id=?').get(id)||{streak:0,incident:0,confirmed:0};
   let {streak,incident,confirmed}=old;const emit=kind=>db.prepare('INSERT INTO machine_events(device_id,kind,recorded_at,threshold) VALUES(?,?,?,?)').run(id,kind,time,threshold);
   if(status==='offline'){streak=actualStreak??streak+1;if(streak===1)emit('failure');incident=1;if(!confirmed&&streak>=threshold){emit('confirmed');confirmed=1;}}
   else {streak=0;if(status==='online'){if(incident)emit('recovery');incident=0;confirmed=0;}}
   db.prepare('INSERT INTO machine_event_state VALUES(?,?,?,?) ON CONFLICT(device_id) DO UPDATE SET streak=excluded.streak,incident=excluded.incident,confirmed=excluded.confirmed').run(id,streak,incident,confirmed);
  },
  resetState:id=>db.prepare('DELETE FROM machine_event_state WHERE device_id=?').run(id),
  events:(id,before=Number.MAX_SAFE_INTEGER)=>{const rows=db.prepare('SELECT id,kind,recorded_at AS recordedAt,threshold FROM machine_events WHERE device_id=? AND id<? ORDER BY id DESC LIMIT 51').all(id,before);return {items:rows.slice(0,50),nextBefore:rows.length>50?rows[49].id:null};},
  saveSummary:(members,summary,finishedAt)=>{const key=members.map(v=>v.auditUid).sort().join('|');db.prepare('INSERT INTO group_summaries VALUES(?,?,?) ON CONFLICT(member_key) DO UPDATE SET summary=excluded.summary,finished_at=excluded.finished_at').run(key,JSON.stringify(summary),finishedAt);},
  summaries:()=>{const valid=new Set(db.prepare('SELECT audit_uid FROM devices').all().map(v=>v.audit_uid));return db.prepare('SELECT member_key AS memberKey,summary,finished_at AS finishedAt FROM group_summaries ORDER BY finished_at DESC LIMIT 500').all().filter(row=>row.memberKey.split('|').every(id=>valid.has(id))).map(row=>({...row,summary:JSON.parse(row.summary)}));}
 };
}
module.exports={createWorkspaceStore,validateView};

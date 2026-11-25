const {randomUUID}=require('node:crypto');
function bad(message,status=400){throw Object.assign(new Error(message),{status});}
function tags(value){if(!Array.isArray(value)||value.length>12||value.some(v=>typeof v!=='string'||!v.trim()||v.length>40))bad('Podaj do 12 tagów, każdy do 40 znaków.');return [...new Set(value.map(v=>v.trim().toLocaleLowerCase('pl')))];}
function createMachineTools(db){
 db.exec(`CREATE TABLE IF NOT EXISTS device_tags(device_id INTEGER NOT NULL REFERENCES devices(id) ON DELETE CASCADE,tag TEXT NOT NULL,PRIMARY KEY(device_id,tag));
 CREATE TABLE IF NOT EXISTS device_journal(id INTEGER PRIMARY KEY,device_id INTEGER NOT NULL REFERENCES devices(id) ON DELETE CASCADE,body TEXT NOT NULL,created_at TEXT NOT NULL);
 CREATE TABLE IF NOT EXISTS machine_templates(id TEXT PRIMARY KEY,name TEXT NOT NULL,fields TEXT NOT NULL);
 CREATE TABLE IF NOT EXISTS device_trash(id TEXT PRIMARY KEY,uid TEXT NOT NULL,host_name TEXT NOT NULL,deleted_at TEXT NOT NULL,payload TEXT NOT NULL);
 CREATE TABLE IF NOT EXISTS trash_links(from_uid TEXT NOT NULL,to_uid TEXT NOT NULL,PRIMARY KEY(from_uid,to_uid));`);
 return {validateTags:tags,
  tags:id=>db.prepare('SELECT tag FROM device_tags WHERE device_id=? ORDER BY tag').all(id).map(v=>v.tag),
  setTags:(id,value)=>{const normalized=tags(value);db.prepare('DELETE FROM device_tags WHERE device_id=?').run(id);for(const tag of normalized)db.prepare('INSERT INTO device_tags VALUES(?,?)').run(id,tag);},
  journal:(id,before)=>{const rows=db.prepare('SELECT id,body,created_at AS createdAt FROM device_journal WHERE device_id=? AND id<? ORDER BY id DESC LIMIT 51').all(id,before);return {items:rows.slice(0,50),nextBefore:rows.length>50?rows[49].id:null};},
  addNote:(id,body)=>{if(typeof body!=='string'||!body.trim()||body.length>5000)bad('Wpis musi mieć od 1 do 5000 znaków.');const createdAt=new Date().toISOString();const result=db.prepare('INSERT INTO device_journal(device_id,body,created_at) VALUES(?,?,?)').run(id,body.trim(),createdAt);return {id:Number(result.lastInsertRowid),body:body.trim(),createdAt};},
  deleteNote:(id,noteId)=>{if(!db.prepare('DELETE FROM device_journal WHERE id=? AND device_id=?').run(noteId,id).changes)bad('Wpis już nie istnieje.',404);},
  templates:()=>db.prepare('SELECT * FROM machine_templates ORDER BY name COLLATE NOCASE').all().map(v=>({...v,fields:JSON.parse(v.fields)})),
  saveTemplate:value=>{if(!value||typeof value.name!=='string'||!value.name.trim()||value.name.length>60)bad('Podaj nazwę szablonu do 60 znaków.');if(db.prepare('SELECT COUNT(*) AS n FROM machine_templates').get().n>=50)bad('Limit: 50 szablonów.');const f=value.fields;if(!f||typeof f!=='object'||Array.isArray(f))bad('Nieprawidłowy szablon.');const fields={};for(const key of ['category','location','groupName','description','lineNumber','numerator']){const v=f[key]??'';if(typeof v!=='string'||v.length>(key==='description'?5000:255))bad('Nieprawidłowe pole szablonu.');fields[key]=v.trim();}fields.tags=tags(f.tags||[]);const id=randomUUID();db.prepare('INSERT INTO machine_templates VALUES(?,?,?)').run(id,value.name.trim(),JSON.stringify(fields));return {id,name:value.name.trim(),fields};},
  deleteTemplate:id=>{if(!db.prepare('DELETE FROM machine_templates WHERE id=?').run(id).changes)bad('Szablon już nie istnieje.',404);},
  capture:(id,device)=>{const rows={};for(const table of ['device_status','device_history','device_monitor','monitor_failures','machine_events','machine_event_state','device_journal','device_tags'])rows[table]=db.prepare(`SELECT * FROM ${table} WHERE device_id=?${['device_history','machine_events','device_journal'].includes(table)?' ORDER BY id':''}`).all(id);const links=db.prepare('SELECT a.audit_uid AS a,b.audit_uid AS b FROM device_dependencies x JOIN devices a ON a.id=x.device_id JOIN devices b ON b.id=x.dependency_id WHERE x.device_id=? OR x.dependency_id=?').all(id,id);for(const link of links)db.prepare('INSERT OR IGNORE INTO trash_links VALUES(?,?)').run(link.a,link.b);const trashId=randomUUID();db.prepare('INSERT INTO device_trash VALUES(?,?,?,?,?)').run(trashId,device.auditUid,device.hostName,new Date().toISOString(),JSON.stringify({device,rows}));return trashId;},
  trash:()=>db.prepare('SELECT id,host_name AS hostName,deleted_at AS deletedAt FROM device_trash ORDER BY deleted_at DESC').all(),
  getTrash:id=>{const row=db.prepare('SELECT * FROM device_trash WHERE id=?').get(id);if(!row)bad('Maszyna nie istnieje w koszu.',404);return {...row,payload:JSON.parse(row.payload)};},
  eraseTrash:id=>{const row=db.prepare('SELECT uid FROM device_trash WHERE id=?').get(id);if(!row)bad('Maszyna nie istnieje w koszu.',404);db.prepare('DELETE FROM trash_links WHERE from_uid=? OR to_uid=?').run(row.uid,row.uid);db.prepare('DELETE FROM device_trash WHERE id=?').run(id);}
 };
}
module.exports={createMachineTools,tags};

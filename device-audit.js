const FIELDS=['hostName','ip','groupName','location','category','description','lineNumber','numerator','dependencies','tags'];
function createAuditStore(database) {
  database.exec(`CREATE TABLE IF NOT EXISTS device_changes (
    id INTEGER PRIMARY KEY, device_id INTEGER NOT NULL, device_uid TEXT NOT NULL,
    host_name TEXT NOT NULL, action TEXT NOT NULL, recorded_at TEXT NOT NULL, changes TEXT NOT NULL
  ); CREATE INDEX IF NOT EXISTS device_changes_uid ON device_changes(device_uid,id DESC);`);
  return {
    record(before,after,action) {
      const changes=FIELDS.filter(field=>JSON.stringify(before?.[field] ?? null)!==JSON.stringify(after?.[field] ?? null))
        .map(field=>({field,before:before?.[field] ?? null,after:after?.[field] ?? null}));
      if(!changes.length)return;
      const device=after || before;
      database.prepare('INSERT INTO device_changes(device_id,device_uid,host_name,action,recorded_at,changes) VALUES(?,?,?,?,?,?)')
        .run(device.id,device.uid,device.hostName,action,new Date().toISOString(),JSON.stringify(changes));
    },
    list({before=Number.MAX_SAFE_INTEGER,uid=null,query=''}={}) {
      const rows=database.prepare(`SELECT id,device_id AS deviceId,host_name AS hostName,action,recorded_at AS recordedAt,changes
        FROM device_changes WHERE id < ? AND (? IS NULL OR device_uid=?) AND (?='' OR instr(lower(host_name),lower(?))>0)
        ORDER BY id DESC LIMIT 51`).all(before,uid,uid,query,query);
      const items=rows.slice(0,50).map(row=>({...row,changes:JSON.parse(row.changes)}));
      return {items,nextBefore:rows.length>50?items.at(-1).id:null};
    },
  };
}
module.exports={createAuditStore};

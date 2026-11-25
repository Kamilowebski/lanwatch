const fs = require("node:fs");
const path = require("node:path");
const { randomUUID } = require("node:crypto");
const { DatabaseSync } = require("node:sqlite");

const databasePath = process.env.DB_PATH
  ? path.resolve(process.env.DB_PATH)
  : path.join(__dirname, "data", "lanwatch.sqlite");
fs.mkdirSync(path.dirname(databasePath), { recursive: true });

const database = new DatabaseSync(databasePath);
database.exec("PRAGMA journal_mode = WAL; PRAGMA busy_timeout = 5000;");
const hadCategories = Boolean(database.prepare(
  "SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'categories'",
).get());
const ONLINE_STATUS_TTL_MINUTES = 5;
const ONLINE_STATUS_TTL_MS = ONLINE_STATUS_TTL_MINUTES * 60 * 1000;
const onlineStatusExpression = `
  CASE
    WHEN s.status = 'online'
      AND julianday(s.checked_at) <= julianday('now', '-${ONLINE_STATUS_TTL_MINUTES} minutes')
    THEN 'unknown'
    ELSE COALESCE(s.status, 'unknown')
  END
`;
const statusMessageExpression = `
  CASE
    WHEN s.status = 'online'
      AND julianday(s.checked_at) <= julianday('now', '-${ONLINE_STATUS_TTL_MINUTES} minutes')
    THEN ''
    ELSE COALESCE(s.message, '')
  END
`;
database.exec(`
  PRAGMA foreign_keys = ON;
  CREATE TABLE IF NOT EXISTS categories (
    id INTEGER PRIMARY KEY,
    name TEXT NOT NULL COLLATE NOCASE UNIQUE
  );
  CREATE TABLE IF NOT EXISTS locations (
    id INTEGER PRIMARY KEY,
    name TEXT NOT NULL COLLATE NOCASE UNIQUE
  );
  CREATE TABLE IF NOT EXISTS app_settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );
  INSERT OR IGNORE INTO app_settings (key, value) VALUES ('ssh_user', '');
  CREATE TABLE IF NOT EXISTS devices (
    id INTEGER PRIMARY KEY,
    host_name TEXT NOT NULL,
    ip TEXT NOT NULL,
    group_name TEXT NOT NULL DEFAULT '',
    location TEXT NOT NULL,
    category_id INTEGER NOT NULL REFERENCES categories(id) ON DELETE RESTRICT,
    description TEXT NOT NULL DEFAULT '',
    line_number TEXT NOT NULL DEFAULT '',
    numerator TEXT NOT NULL DEFAULT ''
  );
  CREATE TABLE IF NOT EXISTS device_dependencies (
    device_id INTEGER NOT NULL REFERENCES devices(id) ON DELETE CASCADE,
    dependency_id INTEGER NOT NULL REFERENCES devices(id) ON DELETE CASCADE,
    PRIMARY KEY (device_id, dependency_id),
    CHECK (device_id != dependency_id)
  );
  CREATE TABLE IF NOT EXISTS device_status (
    device_id INTEGER PRIMARY KEY REFERENCES devices(id) ON DELETE CASCADE,
    status TEXT NOT NULL CHECK (status IN ('online', 'offline', 'unknown')),
    checked_at TEXT NOT NULL,
    replies INTEGER NOT NULL DEFAULT 0,
    target TEXT NOT NULL DEFAULT '',
    message TEXT NOT NULL DEFAULT '',
    latency_ms REAL
  );
  CREATE TABLE IF NOT EXISTS device_history (
    id INTEGER PRIMARY KEY,
    device_id INTEGER NOT NULL REFERENCES devices(id) ON DELETE CASCADE,
    status TEXT NOT NULL CHECK (status IN ('online', 'offline', 'unknown')),
    checked_at TEXT NOT NULL,
    replies INTEGER NOT NULL,
    target TEXT NOT NULL,
    message TEXT NOT NULL,
    latency_ms REAL
  );
  CREATE INDEX IF NOT EXISTS device_history_device_id ON device_history(device_id, id DESC);
  CREATE TABLE IF NOT EXISTS device_monitor (
    device_id INTEGER PRIMARY KEY REFERENCES devices(id) ON DELETE CASCADE,
    enabled INTEGER NOT NULL DEFAULT 0,
    notify_online INTEGER NOT NULL DEFAULT 0,
    notify_offline INTEGER NOT NULL DEFAULT 0
  );
`);

database.exec(`CREATE TABLE IF NOT EXISTS monitor_failures (
 device_id INTEGER PRIMARY KEY REFERENCES devices(id) ON DELETE CASCADE,
 streak INTEGER NOT NULL DEFAULT 0
)`);
const monitorColumns = database.prepare("PRAGMA table_info(device_monitor)").all();
if (!monitorColumns.some(column => column.name === "note")) {
  database.exec("ALTER TABLE device_monitor ADD COLUMN note TEXT NOT NULL DEFAULT ''");
}
if (!monitorColumns.some(column => column.name === "automatic")) {
  database.exec("ALTER TABLE device_monitor ADD COLUMN automatic INTEGER NOT NULL DEFAULT 0");
}
const deviceColumns = database.prepare("PRAGMA table_info(devices)").all();
if (!deviceColumns.some((column) => column.name === "group_name")) {
  database.exec("ALTER TABLE devices ADD COLUMN group_name TEXT NOT NULL DEFAULT ''");
}
if (!deviceColumns.some(column => column.name === "favorite")) database.exec("ALTER TABLE devices ADD COLUMN favorite INTEGER NOT NULL DEFAULT 0");
if (!deviceColumns.some(column => column.name === "audit_uid")) database.exec("ALTER TABLE devices ADD COLUMN audit_uid TEXT NOT NULL DEFAULT ''");
for (const row of database.prepare("SELECT id FROM devices WHERE audit_uid = ''").all()) database.prepare("UPDATE devices SET audit_uid = ? WHERE id = ?").run(randomUUID(),row.id);
database.exec("CREATE UNIQUE INDEX IF NOT EXISTS devices_audit_uid ON devices(audit_uid) WHERE audit_uid <> ''; CREATE INDEX IF NOT EXISTS history_device_time ON device_history(device_id,checked_at,id); CREATE INDEX IF NOT EXISTS history_time ON device_history(checked_at); INSERT OR IGNORE INTO app_settings(key,value) VALUES('history_retention_days','7');");
const auditStore = require("./device-audit").createAuditStore(database);

const deviceStatusColumns = database.prepare("PRAGMA table_info(device_status)").all();
if (!deviceStatusColumns.some((column) => column.name === "latency_ms")) {
  database.exec("ALTER TABLE device_status ADD COLUMN latency_ms REAL");
}

database.exec(`
  INSERT OR IGNORE INTO locations (name)
  SELECT DISTINCT location FROM devices WHERE trim(location) <> '';
`);

const defaultCategories = [
  "Terminal",
  "Komputer",
  "Server",
  "drukarka",
  "Raspberry pi",
  "kamera",
  "detektor",
  "waga",
  "bizerba",
  "minebea",
  "inne",
];
const insertCategory = database.prepare("INSERT OR IGNORE INTO categories (name) VALUES (?)");
if (!hadCategories) {
  for (const name of defaultCategories) insertCategory.run(name);
}

function getCategory(id) {
  return database.prepare("SELECT id, name FROM categories WHERE id = ?").get(id);
}

function getLocation(id) {
  return database.prepare("SELECT id, name FROM locations WHERE id = ?").get(id);
}

function getLocationByName(name) {
  return database.prepare("SELECT id, name FROM locations WHERE name = ? COLLATE NOCASE").get(name);
}

function getDevice(id) {
  const device = database.prepare(`
    SELECT d.id, d.host_name AS hostName, d.ip, d.group_name AS groupName, l.name AS location,
      d.category_id AS categoryId, c.name AS category,
      d.description, d.line_number AS lineNumber, d.numerator, d.favorite, d.audit_uid AS auditUid,
      ${onlineStatusExpression} AS status, s.checked_at AS statusCheckedAt,
      COALESCE(s.replies, 0) AS pingReplies, COALESCE(s.target, '') AS pingTarget,
      ${statusMessageExpression} AS statusMessage, s.latency_ms AS pingLatencyMs,
      COALESCE(m.enabled, 0) AS monitorEnabled, COALESCE(m.automatic, 0) AS monitorAutomatic,
      COALESCE(m.notify_online, 0) AS notifyOnline,
      COALESCE(m.notify_offline, 0) AS notifyOffline, COALESCE(m.note, '') AS monitorNote
    FROM devices d
    JOIN categories c ON c.id = d.category_id
    JOIN locations l ON l.name = d.location COLLATE NOCASE
    LEFT JOIN device_status s ON s.device_id = d.id
    LEFT JOIN device_monitor m ON m.device_id = d.id
    WHERE d.id = ?
  `).get(id);
  if (!device) return undefined;
  device.favorite = Boolean(device.favorite);
  device.monitorEnabled = Boolean(device.monitorEnabled);
  device.monitorAutomatic = Boolean(device.monitorAutomatic);
  device.notifyOnline = Boolean(device.notifyOnline);
  device.notifyOffline = Boolean(device.notifyOffline);
  device.dependencyIds = database.prepare(
    "SELECT dependency_id AS id FROM device_dependencies WHERE device_id = ? ORDER BY dependency_id",
  ).all(id).map((row) => row.id);
  return failureState(device);
}

function saveDependencies(deviceId, dependencyIds) {
  if (dependencyIds.includes(deviceId)) {
    throw Object.assign(new Error("Maszyna nie może zależeć od samej siebie."), { status: 400 });
  }
  const existing = new Set(
    database.prepare("SELECT id FROM devices").all().map((row) => row.id),
  );
  if (dependencyIds.some((id) => !existing.has(id))) {
    throw Object.assign(new Error("Jedna z wybranych maszyn już nie istnieje."), { status: 400 });
  }
  database.prepare("DELETE FROM device_dependencies WHERE device_id = ?").run(deviceId);
  const insertDependency = database.prepare(
    "INSERT INTO device_dependencies (device_id, dependency_id) VALUES (?, ?)",
  );
  for (const dependencyId of dependencyIds) insertDependency.run(deviceId, dependencyId);
}

let transactionSequence = 0;
function withTransaction(callback) {
  const name = `lanwatch_${++transactionSequence}`;
  database.exec(`SAVEPOINT ${name}`);
  try {
    const result = callback();
    database.exec(`RELEASE SAVEPOINT ${name}`);
    return result;
  } catch (error) {
    database.exec(`ROLLBACK TO SAVEPOINT ${name}`);
    database.exec(`RELEASE SAVEPOINT ${name}`);
    throw error;
  }
}

function getCategories() {
  return database.prepare("SELECT id, name FROM categories ORDER BY name COLLATE NOCASE").all();
}

function getLocations() {
  return database.prepare("SELECT id, name FROM locations ORDER BY name COLLATE NOCASE").all();
}

function getDevices() {
  const devices = database.prepare(`
    SELECT d.id, d.host_name AS hostName, d.ip, d.group_name AS groupName, l.name AS location,
      d.category_id AS categoryId, c.name AS category,
      d.description, d.line_number AS lineNumber, d.numerator, d.favorite, d.audit_uid AS auditUid,
      ${onlineStatusExpression} AS status, s.checked_at AS statusCheckedAt,
      COALESCE(s.replies, 0) AS pingReplies, COALESCE(s.target, '') AS pingTarget,
      ${statusMessageExpression} AS statusMessage, s.latency_ms AS pingLatencyMs,
      COALESCE(m.enabled, 0) AS monitorEnabled, COALESCE(m.automatic, 0) AS monitorAutomatic,
      COALESCE(m.notify_online, 0) AS notifyOnline,
      COALESCE(m.notify_offline, 0) AS notifyOffline, COALESCE(m.note, '') AS monitorNote
    FROM devices d
    JOIN categories c ON c.id = d.category_id
    JOIN locations l ON l.name = d.location COLLATE NOCASE
    LEFT JOIN device_status s ON s.device_id = d.id
    LEFT JOIN device_monitor m ON m.device_id = d.id
    ORDER BY d.host_name COLLATE NOCASE
  `).all();
  const dependencyQuery = database.prepare(`
    SELECT dep.id, dep.host_name AS hostName
    FROM device_dependencies relation
    JOIN devices dep ON dep.id = relation.dependency_id
    WHERE relation.device_id = ?
    ORDER BY dep.host_name COLLATE NOCASE
  `);
  return devices.map((device) => {
    const dependencies = dependencyQuery.all(device.id);
    return {
      ...failureState(device),
      favorite: Boolean(device.favorite),
      monitorEnabled: Boolean(device.monitorEnabled),
      monitorAutomatic: Boolean(device.monitorAutomatic),
      notifyOnline: Boolean(device.notifyOnline),
      notifyOffline: Boolean(device.notifyOffline),
      dependencyIds: dependencies.map((dependency) => dependency.id),
      dependencies: dependencies.map((dependency) => dependency.hostName),
    };
  });
}

function getSummary() {
  const summary = database.prepare(`
    SELECT COUNT(*) AS devices,
      COALESCE(SUM(CASE WHEN ${onlineStatusExpression} = 'online' THEN 1 ELSE 0 END), 0) AS online,
      COALESCE(SUM(CASE WHEN ${onlineStatusExpression} = 'offline' THEN 1 ELSE 0 END), 0) AS offline,
      COALESCE(SUM(CASE WHEN ${onlineStatusExpression} = 'unknown' THEN 1 ELSE 0 END), 0) AS unchecked
    FROM devices d
    LEFT JOIN device_status s ON s.device_id = d.id
  `).get();
  return { ...summary, onlineTtlMs: ONLINE_STATUS_TTL_MS };
}

const machineTools = require("./machine-tools").createMachineTools(database);
const workspaceStore = require("./workspace-data").createWorkspaceStore(database);
const monitorSettingsStore = require("./monitoring").createMonitorStore(database);
function getMonitorSettings() { return monitorSettingsStore.get(); }
function setMonitorSettings(value) { return monitorSettingsStore.set(value); }
function failureState(device) {
  device.tags = machineTools.tags(device.id);
  device.failureStreak = database.prepare("SELECT streak FROM monitor_failures WHERE device_id=?").get(device.id)?.streak || 0;
  device.notificationStatus = device.status === "offline" && device.failureStreak < getMonitorSettings().failureThreshold ? "unknown" : device.status;
  return device;
}

function getAppSettings() {
  const setting = database.prepare("SELECT value FROM app_settings WHERE key = 'ssh_user'").get();
  return { sshUser: setting?.value || "" };
}

function updateSshUser(sshUser) {
  database.prepare(`
    INSERT INTO app_settings (key, value) VALUES ('ssh_user', ?)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value
  `).run(sshUser);
  return getAppSettings();
}

function saveDeviceStatus(deviceId, result) {
  withTransaction(() => {
  database.prepare(`INSERT INTO monitor_failures(device_id,streak) VALUES(?,?)
    ON CONFLICT(device_id) DO UPDATE SET streak=CASE WHEN excluded.streak=1 THEN MIN(streak+1,1000000) ELSE 0 END`).run(deviceId,result.status==='offline'?1:0);
  workspaceStore.recordStatus(deviceId,result.status,result.checkedAt,getMonitorSettings().failureThreshold,database.prepare("SELECT streak FROM monitor_failures WHERE device_id=?").get(deviceId).streak);
  database.prepare(`
    INSERT INTO device_status (device_id, status, checked_at, replies, target, message, latency_ms)
    VALUES (?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(device_id) DO UPDATE SET
      status = excluded.status,
      checked_at = excluded.checked_at,
      replies = excluded.replies,
      target = excluded.target,
      message = excluded.message,
      latency_ms = excluded.latency_ms
  `).run(
    deviceId,
    result.status,
    result.checkedAt,
    result.replies,
    result.target,
    result.message,
    result.latencyMs ?? null,
  );
  database.prepare(`
    INSERT INTO device_history (device_id, status, checked_at, replies, target, message, latency_ms)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(deviceId, result.status, result.checkedAt, result.replies, result.target,
    result.message, result.latencyMs ?? null);

  });
}

function getDeviceHistory(deviceId, before = Number.MAX_SAFE_INTEGER) {
  if (!getDevice(deviceId)) {
    throw Object.assign(new Error("Nie znaleziono maszyny."), { status: 404 });
  }
  const rows = database.prepare(`
    SELECT id, status, checked_at AS checkedAt, replies, target, message, latency_ms AS latencyMs
    FROM device_history WHERE device_id = ? AND id < ? AND checked_at >= ? ORDER BY id DESC LIMIT 51
  `).all(deviceId, before, historyCutoff());
  const items = rows.slice(0, 50);
  return { items, nextBefore: rows.length > 50 ? items[items.length - 1].id : null };
}

function updateDeviceMonitor(deviceId, settings) {
  return withTransaction(() => {
    const wasEnabled = getDevice(deviceId)?.monitorEnabled;
    const result = updateSingleDeviceMonitor(deviceId, settings, wasEnabled ? null : false);
    if (settings.enabled) {
      const visited = new Set([deviceId]);
      const queue = [getDevice(deviceId)];
      for (let index = 0; index < queue.length; index++) {
        for (const id of queue[index].dependencyIds) {
          if (visited.has(id)) continue;
          visited.add(id);
          const device = getDevice(id);
          if (!device) continue;
          updateSingleDeviceMonitor(id, {enabled:true, notifyOnline:device.notifyOnline, notifyOffline:device.notifyOffline}, device.monitorEnabled ? null : true);
          queue.push(device);
        }
      }
    }
    return result;
  });
}

function updateSingleDeviceMonitor(deviceId, settings, automatic = null) {
  if (!getDevice(deviceId)) {
    throw Object.assign(new Error("Nie znaleziono maszyny."), { status: 404 });
  }
  database.prepare(`
    INSERT INTO device_monitor (device_id, enabled, notify_online, notify_offline)
    VALUES (?, ?, ?, ?)
    ON CONFLICT(device_id) DO UPDATE SET
      enabled = excluded.enabled,
      notify_online = excluded.notify_online,
      notify_offline = excluded.notify_offline,
      note = CASE WHEN excluded.enabled = 0 THEN '' ELSE device_monitor.note END
  `).run(deviceId, Number(settings.enabled), Number(settings.notifyOnline), Number(settings.notifyOffline));
  if (!settings.enabled) { database.prepare("DELETE FROM monitor_failures WHERE device_id=?").run(deviceId);workspaceStore.resetState(deviceId); }
  if (automatic !== null || !settings.enabled) {
    database.prepare("UPDATE device_monitor SET automatic = ? WHERE device_id = ?").run(settings.enabled ? Number(automatic) : 0, deviceId);
  }
  const saved = database.prepare(`
    SELECT enabled, notify_online AS notifyOnline, notify_offline AS notifyOffline
    FROM device_monitor WHERE device_id = ?
  `).get(deviceId);
  return {
    enabled: Boolean(saved.enabled),
    notifyOnline: Boolean(saved.notifyOnline),
    notifyOffline: Boolean(saved.notifyOffline),
  };
}

function updateMonitorNote(id, note) {
  const device = getDevice(id);
  if (!device) throw Object.assign(new Error("Nie znaleziono maszyny."), {status:404});
  if (!device.monitorEnabled) throw Object.assign(new Error("Maszyna nie jest monitorowana."), {status:409});
  database.prepare("UPDATE device_monitor SET note = ? WHERE device_id = ?").run(note, id);
  return {note};
}

function getHistorySettings() {
  const value=Number(database.prepare("SELECT value FROM app_settings WHERE key='history_retention_days'").get()?.value);
  return {retentionDays:[1,7,30].includes(value)?value:7};
}
function historyCutoff(hours=null) {
  const maxHours=getHistorySettings().retentionDays*24;
  return new Date(Date.now()-Math.min(hours || maxHours,maxHours)*3600000).toISOString();
}
let historyCleanupPromise = null;
function pruneDeviceHistory() {
  if(historyCleanupPromise)return historyCleanupPromise;
  historyCleanupPromise=(async()=>{
    let removed=0;
    do {
      const result=database.prepare("DELETE FROM device_history WHERE id IN (SELECT id FROM device_history WHERE checked_at < ? LIMIT 5000)").run(historyCutoff());
      removed+=result.changes;
      if(result.changes<5000)break;
      await new Promise(resolve=>setImmediate(resolve));
    } while(true);
    return {removed};
  })().finally(()=>{historyCleanupPromise=null;});
  return historyCleanupPromise;
}
function setHistorySettings(days) {
  if(![1,7,30].includes(days))throw Object.assign(new Error("Wybierz 1, 7 albo 30 dni."),{status:400});
  database.prepare("UPDATE app_settings SET value=? WHERE key='history_retention_days'").run(String(days));
  return getHistorySettings();
}
function getDeviceReport(id, hours) {
  if (!getDevice(id)) throw Object.assign(new Error("Nie znaleziono maszyny."), {status:404});
  return database.prepare(`SELECT id,status,checked_at AS checkedAt,latency_ms AS latencyMs,target
    FROM device_history WHERE device_id=? AND checked_at>=? ORDER BY checked_at,id`).all(id,historyCutoff(hours));
}
function getDeviceReportData(id, hours) {
  if(!getDevice(id))throw Object.assign(new Error("Nie znaleziono maszyny."),{status:404});
  const since=historyCutoff(hours);
  const totals=database.prepare(`SELECT COUNT(*) AS total,
    COALESCE(SUM(status='online'),0) AS online,COALESCE(SUM(status='offline'),0) AS offline,
    COALESCE(SUM(status='unknown'),0) AS unknown,
    AVG(CASE WHEN status='online' THEN latency_ms END) AS averageMs,
    MIN(checked_at) AS firstAt,MAX(checked_at) AS lastAt FROM device_history WHERE device_id=? AND checked_at>=?`).get(id,since);
  const counts={online:totals.online,offline:totals.offline,unknown:totals.unknown};
  let items=[];
  if(totals.total<=1800) items=getDeviceReport(id,hours);
  else {
    const width=Math.max(1,(Date.parse(totals.lastAt)-Date.parse(totals.firstAt))/600);
    items=database.prepare(`SELECT id,status,checked_at AS checkedAt,latency_ms AS latencyMs,target FROM device_history WHERE id IN (
      SELECT MIN(id) FROM device_history WHERE device_id=? AND checked_at>=?
      GROUP BY CAST((julianday(checked_at)-julianday(?))*86400000/? AS INTEGER),status
    ) ORDER BY checked_at,id`).all(id,since,totals.firstAt,width);
  }
  return {items,summary:{counts,total:totals.total,averageMs:totals.averageMs,
    percentages:Object.fromEntries(Object.entries(counts).map(([key,value])=>[key,totals.total?value/totals.total*100:0]))},
    retentionDays:getHistorySettings().retentionDays,sampled:items.length<totals.total,firstAt:totals.firstAt,lastAt:totals.lastAt};
}
function inventorySnapshot(device) {
  if(!device)return null;
  const uid=database.prepare("SELECT audit_uid FROM devices WHERE id=?").get(device.id)?.audit_uid;
  const dependencies=device.dependencyIds.map(id=>database.prepare("SELECT host_name FROM devices WHERE id=?").get(id)?.host_name).filter(Boolean).sort();
  return {...device,uid,dependencies};
}
function recordDeviceChange(before,after,action='update') {
  auditStore.record(before,inventorySnapshot(after),action);
}
function getDeviceChanges(options={}) {
  let uid=null;
  if(options.deviceId!==undefined) {
    const row=database.prepare("SELECT audit_uid FROM devices WHERE id=?").get(options.deviceId);
    if(!row)throw Object.assign(new Error("Nie znaleziono maszyny."),{status:404});uid=row.audit_uid;
  }
  return auditStore.list({...options,uid});
}
function updateDeviceFavorite(id,favorite) {
  if(typeof favorite!=='boolean')throw Object.assign(new Error("Nieprawidłowe oznaczenie ulubionej maszyny."),{status:400});
  if(!database.prepare("UPDATE devices SET favorite=? WHERE id=?").run(Number(favorite),id).changes)throw Object.assign(new Error("Nie znaleziono maszyny."),{status:404});
  return getDevice(id);
}

function assertDeviceIdentifiersUnique(device, excludedId = null) {
  const ignoredId = excludedId || -1;
  const duplicateHost = database.prepare(`
    SELECT id FROM devices
    WHERE host_name = ? COLLATE NOCASE AND id != ?
  `).get(device.hostName, ignoredId);
  if (duplicateHost) {
    throw Object.assign(new Error("Nazwa hosta jest już przypisana do innej maszyny."), { status: 409 });
  }
  if (device.ip) {
    const duplicateIp = database.prepare(`
      SELECT id FROM devices
      WHERE ip = ? COLLATE NOCASE AND ip <> '' AND id != ?
    `).get(device.ip, ignoredId);
    if (duplicateIp) {
      throw Object.assign(new Error("Adres IP jest już przypisany do innej maszyny."), { status: 409 });
    }
  }
}

function createNamedItem(table, label, name) {
  const existing = database.prepare(`SELECT id FROM ${table} WHERE name = ? COLLATE NOCASE`).get(name);
  if (existing) {
    throw Object.assign(new Error(`${label} o tej nazwie już istnieje.`), { status: 409 });
  }
  const result = database.prepare(`INSERT INTO ${table} (name) VALUES (?)`).run(name);
  return database.prepare(`SELECT id, name FROM ${table} WHERE id = ?`).get(Number(result.lastInsertRowid));
}

function updateNamedItem(table, label, genitive, id, name) {
  const existing = database.prepare(`SELECT id, name FROM ${table} WHERE id = ?`).get(id);
  if (!existing) {
    throw Object.assign(new Error(`Nie znaleziono ${genitive}.`), { status: 404 });
  }
  if (
    database.prepare(`SELECT id FROM ${table} WHERE name = ? COLLATE NOCASE AND id != ?`).get(name, id)
  ) {
    throw Object.assign(new Error(`${label} o tej nazwie już istnieje.`), { status: 409 });
  }
  withTransaction(()=>{
    const affected = getDevices().filter(device=>table === "locations" ? device.location.toLowerCase()===existing.name.toLowerCase() : device.categoryId===id).map(inventorySnapshot);
    if(table === "locations")database.prepare("UPDATE devices SET location=? WHERE location=? COLLATE NOCASE").run(name,existing.name);
    database.prepare(`UPDATE ${table} SET name=? WHERE id=?`).run(name,id);
    for(const before of affected)recordDeviceChange(before,getDevice(before.id),'classification');
  });
  return database.prepare(`SELECT id, name FROM ${table} WHERE id = ?`).get(id);
}

function deleteNamedItem(table, genitive, id, usageQuery, usageMessage) {
  const existing = database.prepare(`SELECT id FROM ${table} WHERE id = ?`).get(id);
  if (!existing) {
    throw Object.assign(new Error(`Nie znaleziono ${genitive}.`), { status: 404 });
  }
  if (usageQuery && usageQuery(id).count) {
    throw Object.assign(new Error(usageMessage), { status: 409 });
  }
  database.prepare(`DELETE FROM ${table} WHERE id = ?`).run(id);
}

function createCategory(name) {
  return createNamedItem("categories", "Kategoria", name);
}

function updateCategory(id, name) {
  return updateNamedItem("categories", "Kategoria", "kategorii", id, name);
}

function deleteCategory(id) {
  deleteNamedItem(
    "categories",
    "kategorii",
    id,
    (categoryId) => database.prepare("SELECT COUNT(*) AS count FROM devices WHERE category_id = ?").get(categoryId),
    "Nie można usunąć kategorii używanej przez maszyny.",
  );
}

function createLocation(name) {
  return createNamedItem("locations", "Lokalizacja", name);
}

function updateLocation(id, name) {
  return updateNamedItem("locations", "Lokalizacja", "lokalizacji", id, name);
}

function deleteLocation(id) {
  deleteNamedItem(
    "locations",
    "lokalizacji",
    id,
    (locationId) => {
      const location = getLocation(locationId);
      return database.prepare("SELECT COUNT(*) AS count FROM devices WHERE location = ? COLLATE NOCASE")
        .get(location.name);
    },
    "Nie można usunąć lokalizacji używanej przez maszyny.",
  );
}

function createDevice(device) {
  if (!getCategory(device.categoryId)) {
    throw Object.assign(new Error("Wybrana kategoria już nie istnieje."), { status: 400 });
  }
  const location = getLocationByName(device.location);
  if (!location) {
    throw Object.assign(new Error("Wybrana lokalizacja już nie istnieje."), { status: 400 });
  }
  const id = withTransaction(() => {
    assertDeviceIdentifiersUnique(device);
    const result = database.prepare(`
      INSERT INTO devices (host_name, ip, group_name, location, category_id, description, line_number, numerator, audit_uid)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      device.hostName,
      device.ip,
      device.groupName,
      location.name,
      device.categoryId,
      device.description,
      device.lineNumber,
      device.numerator,
      randomUUID(),
    );
    const newId = Number(result.lastInsertRowid);
    saveDependencies(newId, device.dependencyIds || []);
    if(device.tags!==undefined)machineTools.setTags(newId,device.tags);
    recordDeviceChange(null,getDevice(newId),'create');
    return newId;
  });
  return getDevice(id);
}

function updateDevice(id, device) {
  const existing = getDevice(id);
  if (!existing) {
    throw Object.assign(new Error("Nie znaleziono maszyny."), { status: 404 });
  }
  if (!getCategory(device.categoryId)) {
    throw Object.assign(new Error("Wybrana kategoria już nie istnieje."), { status: 400 });
  }
  const location = getLocationByName(device.location);
  if (!location) {
    throw Object.assign(new Error("Wybrana lokalizacja już nie istnieje."), { status: 400 });
  }
  withTransaction(() => {
    const before=inventorySnapshot(existing);
    assertDeviceIdentifiersUnique(device, id);
    database.prepare(`
      UPDATE devices
      SET host_name = ?, ip = ?, group_name = ?, location = ?, category_id = ?,
        description = ?, line_number = ?, numerator = ?
      WHERE id = ?
    `).run(
      device.hostName,
      device.ip,
      device.groupName,
      location.name,
      device.categoryId,
      device.description,
      device.lineNumber,
      device.numerator,
      id,
    );
    if (device.dependencyIds !== undefined) saveDependencies(id, device.dependencyIds);
    if (existing.hostName !== device.hostName || existing.ip !== device.ip) {
      database.prepare("DELETE FROM device_status WHERE device_id = ?").run(id);
      database.prepare("DELETE FROM monitor_failures WHERE device_id = ?").run(id);
      workspaceStore.resetState(id);
    }
    if(device.tags!==undefined)machineTools.setTags(id,device.tags);
    recordDeviceChange(before,getDevice(id));
  });
  return getDevice(id);
}

function updateDeviceDependencies(id, dependencyIds) {
  if (!getDevice(id)) {
    throw Object.assign(new Error("Nie znaleziono maszyny."), { status: 404 });
  }
  withTransaction(() => {
    const before=inventorySnapshot(getDevice(id));
    saveDependencies(id,dependencyIds);
    recordDeviceChange(before,getDevice(id),'dependencies');
  });
  return getDevice(id);
}

function deleteDevice(id) {
  withTransaction(()=>{
    const device=getDevice(id);
    if(!device)throw Object.assign(new Error("Nie znaleziono maszyny."),{status:404});
    const before=inventorySnapshot(device);
    const affected=database.prepare("SELECT device_id AS id FROM device_dependencies WHERE dependency_id=?").all(id).map(row=>inventorySnapshot(getDevice(row.id)));
    database.prepare("DELETE FROM devices WHERE id=?").run(id);
    auditStore.record(before,null,'delete');
    for(const snapshot of affected)recordDeviceChange(snapshot,getDevice(snapshot.id),'dependencies');
  });
}

function updateDeviceTags(id,tags) {return withTransaction(()=>{const device=getDevice(id);if(!device)throw Object.assign(new Error('Nie znaleziono maszyny.'),{status:404});const before=inventorySnapshot(device);machineTools.setTags(id,tags);recordDeviceChange(before,getDevice(id));return getDevice(id);});}
function eraseTrashDevice(id){return withTransaction(()=>machineTools.eraseTrash(id));}
function trashDevice(id) {
 return withTransaction(()=>{const device=getDevice(id);if(!device)throw Object.assign(new Error("Nie znaleziono maszyny."),{status:404});const trashId=machineTools.capture(id,device);deleteDevice(id);return {id:trashId};});
}
function restoreDevice(trashId) {
 return withTransaction(()=>{
  const archived=machineTools.getTrash(trashId),{device,rows}=archived.payload;
  assertDeviceIdentifiersUnique(device);
  let category=getCategories().find(v=>v.name.toLocaleLowerCase('pl')===device.category.toLocaleLowerCase('pl'));
  if(!category)category=createCategory(device.category);
  let location=getLocations().find(v=>v.name.toLocaleLowerCase('pl')===device.location.toLocaleLowerCase('pl'));
  if(!location)location=createLocation(device.location);
  const restored=createDevice({...device,categoryId:category.id,location:location.name,dependencyIds:[],tags:[]});
  database.prepare('DELETE FROM device_changes WHERE device_uid=?').run(restored.auditUid);
  database.prepare('UPDATE devices SET audit_uid=?,favorite=? WHERE id=?').run(archived.uid,Number(device.favorite),restored.id);
  for(const [table,items] of Object.entries(rows)){if(!items.length)continue;const keys=Object.keys(items[0]).filter(key=>key!=='id');const insert=database.prepare(`INSERT INTO ${table} (${keys.join(',')}) VALUES (${keys.map(()=>'?').join(',')})`);for(const row of items)insert.run(...keys.map(key=>key==='device_id'?restored.id:row[key]));}
  const pending=database.prepare('SELECT a.id AS a,b.id AS b,l.from_uid,l.to_uid FROM trash_links l JOIN devices a ON a.audit_uid=l.from_uid JOIN devices b ON b.audit_uid=l.to_uid').all();
  const affected=new Map(pending.filter(link=>link.a!==restored.id).map(link=>[link.a,inventorySnapshot(getDevice(link.a))]));
  for(const link of pending){database.prepare('INSERT OR IGNORE INTO device_dependencies VALUES(?,?)').run(link.a,link.b);database.prepare('DELETE FROM trash_links WHERE from_uid=? AND to_uid=?').run(link.from_uid,link.to_uid);}
  for(const [id,before] of affected)recordDeviceChange(before,getDevice(id),'dependencies');
  database.prepare('DELETE FROM device_trash WHERE id=?').run(trashId);
  recordDeviceChange(null,getDevice(restored.id),'restore');return getDevice(restored.id);
 });
}
function compareDeviceReports(id,ranges) {
 if(!getDevice(id))throw Object.assign(new Error('Nie znaleziono maszyny.'),{status:404});
 const cutoff=historyCutoff();
 return ranges.map(({from,to})=>{
  const start=Date.parse(from),end=Date.parse(to);
  if(!Number.isFinite(start)||!Number.isFinite(end)||start>=end||end-start>30*86400000)throw Object.assign(new Error('Wybierz dwa poprawne okresy, każdy do 30 dni.'),{status:400});
  const effectiveFrom=new Date(Math.max(start,Date.parse(cutoff))).toISOString();
  const row=database.prepare(`SELECT COUNT(*) AS total,COALESCE(SUM(status='online'),0) AS online,COALESCE(SUM(status='offline'),0) AS offline,COALESCE(SUM(status='unknown'),0) AS unknown,AVG(CASE WHEN status='online' THEN latency_ms END) AS averageMs FROM device_history WHERE device_id=? AND checked_at>=? AND checked_at<?`).get(id,effectiveFrom,new Date(end).toISOString());
  return {...row,from:new Date(start).toISOString(),to:new Date(end).toISOString(),effectiveFrom,truncated:start<Date.parse(cutoff),onlinePercent:row.total?row.online/row.total*100:null};
 });
}

function importDeviceRows(rows, preview = false) {
  const previewRollback = {};
  let summary;
  try {
    return withTransaction(() => {
      const categoryNames = [], locationNames = [], created = [];
      for (const row of rows) {
        try {
          let category = database.prepare("SELECT id FROM categories WHERE name = ? COLLATE NOCASE").get(row.category);
          if (!category) { category = createCategory(row.category); categoryNames.push(row.category); }
          if (!getLocationByName(row.location)) { createLocation(row.location); locationNames.push(row.location); }
          created.push(createDevice({...row, categoryId:category.id, dependencyIds:[]}));
        } catch(error) { error.message = `Wiersz ${row.csvRow}: ${error.message}`;throw error; }
      }
      rows.forEach((row,index) => {
        const ids = row.dependencyHosts.map(host => {
          const target = database.prepare("SELECT id FROM devices WHERE host_name = ? COLLATE NOCASE").get(host);
          if (!target) throw Object.assign(new Error(`Wiersz ${row.csvRow}: nie istnieje zależność ${host}.`),{status:400});
          return target.id;
        });
        try {
          const before=inventorySnapshot(getDevice(created[index].id));
          saveDependencies(created[index].id,[...new Set(ids)]);
          recordDeviceChange(before,getDevice(created[index].id),'dependencies');
        }
        catch(error){error.message=`Wiersz ${row.csvRow}: ${error.message}`;throw error;}
      });
      summary={imported:created.length,newCategories:categoryNames,newLocations:locationNames};
      if (preview) throw previewRollback;
      return summary;
    });
  } catch(error) { if (error===previewRollback) return summary;throw error; }
}

function bulkUpdateDevices(ids, changes) {
  return withTransaction(() => {
    const existing = ids.map(id => {
      const device=getDevice(id);
      if(!device)throw Object.assign(new Error(`Maszyna ${id} już nie istnieje. Odśwież listę.`),{status:404});
      return device;
    });
    const location = changes.location === undefined ? null : getLocationByName(changes.location);
    if (changes.location !== undefined && !location) throw Object.assign(new Error("Wybrana lokalizacja już nie istnieje."),{status:400});
    if (changes.categoryId !== undefined && !getCategory(changes.categoryId)) throw Object.assign(new Error("Wybrana kategoria już nie istnieje."),{status:400});
    // Expand only enabling: disabling must not stop shared dependencies.
    const monitored = new Map(existing.map(device => [device.id, device]));
    if (changes.monitorEnabled === true) {
      const queue = [...existing];
      for (let index = 0; index < queue.length; index++) {
        for (const id of queue[index].dependencyIds) {
          if (monitored.has(id)) continue;
          const dependency = getDevice(id);
          if (dependency) { monitored.set(id, dependency); queue.push(dependency); }
        }
      }
    }
    for (const device of existing) {
      const before=inventorySnapshot(device);
      if (location) database.prepare("UPDATE devices SET location = ? WHERE id = ?").run(location.name,device.id);
      if (changes.categoryId !== undefined) database.prepare("UPDATE devices SET category_id = ? WHERE id = ?").run(changes.categoryId,device.id);
      recordDeviceChange(before,getDevice(device.id),'bulk');
    }
    if (changes.monitorEnabled !== undefined) {
      for (const device of monitored.values()) {
        updateSingleDeviceMonitor(device.id, {enabled:changes.monitorEnabled, notifyOnline:device.notifyOnline, notifyOffline:device.notifyOffline}, ids.includes(device.id) ? false : device.monitorEnabled ? null : true);
      }
    }
    return {updated:existing.length, ...(changes.monitorEnabled === true ? {monitored:monitored.size, dependenciesAdded:monitored.size-existing.length} : {})};
  });
}

function backupDatabase(manual=false) {
  return require("./backup").backupInWorker(databasePath,manual);
}

const snippetStore = require("./snippets").createSnippetStore(database);

module.exports = {
  updateDeviceTags,eraseTrashDevice,machineTools,trashDevice,restoreDevice,compareDeviceReports,
  workspaceStore,
  getMonitorSettings,setMonitorSettings,
  getHistorySettings,setHistorySettings,pruneDeviceHistory,getDeviceReportData,getDeviceChanges,updateDeviceFavorite,
  importDeviceRows, bulkUpdateDevices,
  snippetStore,
  updateMonitorNote, getDeviceReport,
  backupDatabase,
  getDeviceHistory,
  createCategory,
  createDevice,
  createLocation,
  deleteCategory,
  deleteDevice,
  deleteLocation,
  getCategories,
  getDevice,
  getDevices,
  getLocations,
  getAppSettings,
  getSummary,
  saveDeviceStatus,
  updateCategory,
  updateDevice,
  updateDeviceDependencies,
  updateDeviceMonitor,
  updateLocation,
  updateSshUser,
};


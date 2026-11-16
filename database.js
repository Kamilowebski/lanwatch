const fs = require("node:fs");
const path = require("node:path");
const { DatabaseSync } = require("node:sqlite");

const databasePath = process.env.DB_PATH
  ? path.resolve(process.env.DB_PATH)
  : path.join(__dirname, "data", "lanwatch.sqlite");
fs.mkdirSync(path.dirname(databasePath), { recursive: true });

const database = new DatabaseSync(databasePath);
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
  CREATE TABLE IF NOT EXISTS devices (
    id INTEGER PRIMARY KEY,
    host_name TEXT NOT NULL,
    ip TEXT NOT NULL,
    group_name TEXT NOT NULL DEFAULT '',
    ssh_user TEXT NOT NULL DEFAULT '',
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
    message TEXT NOT NULL DEFAULT ''
  );
`);

const deviceColumns = database.prepare("PRAGMA table_info(devices)").all();
if (!deviceColumns.some((column) => column.name === "group_name")) {
  database.exec("ALTER TABLE devices ADD COLUMN group_name TEXT NOT NULL DEFAULT ''");
}
if (!deviceColumns.some((column) => column.name === "ssh_user")) {
  database.exec("ALTER TABLE devices ADD COLUMN ssh_user TEXT NOT NULL DEFAULT ''");
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
for (const name of defaultCategories) insertCategory.run(name);

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
      d.ssh_user AS sshUser,
      d.category_id AS categoryId, c.name AS category,
      d.description, d.line_number AS lineNumber, d.numerator,
      ${onlineStatusExpression} AS status, s.checked_at AS statusCheckedAt,
      COALESCE(s.replies, 0) AS pingReplies, COALESCE(s.target, '') AS pingTarget,
      ${statusMessageExpression} AS statusMessage
    FROM devices d
    JOIN categories c ON c.id = d.category_id
    JOIN locations l ON l.name = d.location COLLATE NOCASE
    LEFT JOIN device_status s ON s.device_id = d.id
    WHERE d.id = ?
  `).get(id);
  if (!device) return undefined;
  device.dependencyIds = database.prepare(
    "SELECT dependency_id AS id FROM device_dependencies WHERE device_id = ? ORDER BY dependency_id",
  ).all(id).map((row) => row.id);
  return device;
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

function withTransaction(callback) {
  database.exec("BEGIN");
  try {
    const result = callback();
    database.exec("COMMIT");
    return result;
  } catch (error) {
    database.exec("ROLLBACK");
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
      d.ssh_user AS sshUser,
      d.category_id AS categoryId, c.name AS category,
      d.description, d.line_number AS lineNumber, d.numerator,
      ${onlineStatusExpression} AS status, s.checked_at AS statusCheckedAt,
      COALESCE(s.replies, 0) AS pingReplies, COALESCE(s.target, '') AS pingTarget,
      ${statusMessageExpression} AS statusMessage
    FROM devices d
    JOIN categories c ON c.id = d.category_id
    JOIN locations l ON l.name = d.location COLLATE NOCASE
    LEFT JOIN device_status s ON s.device_id = d.id
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
      ...device,
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

function saveDeviceStatus(deviceId, result) {
  database.prepare(`
    INSERT INTO device_status (device_id, status, checked_at, replies, target, message)
    VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT(device_id) DO UPDATE SET
      status = excluded.status,
      checked_at = excluded.checked_at,
      replies = excluded.replies,
      target = excluded.target,
      message = excluded.message
  `).run(
    deviceId,
    result.status,
    result.checkedAt,
    result.replies,
    result.target,
    result.message,
  );
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
  if (table === "locations") {
    withTransaction(() => {
      database.prepare("UPDATE devices SET location = ? WHERE location = ? COLLATE NOCASE").run(name, existing.name);
      database.prepare("UPDATE locations SET name = ? WHERE id = ?").run(name, id);
    });
  } else {
    database.prepare(`UPDATE ${table} SET name = ? WHERE id = ?`).run(name, id);
  }
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
      INSERT INTO devices (host_name, ip, group_name, ssh_user, location, category_id, description, line_number, numerator)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      device.hostName,
      device.ip,
      device.groupName,
      device.sshUser,
      location.name,
      device.categoryId,
      device.description,
      device.lineNumber,
      device.numerator,
    );
    const newId = Number(result.lastInsertRowid);
    saveDependencies(newId, device.dependencyIds);
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
    assertDeviceIdentifiersUnique(device, id);
    database.prepare(`
      UPDATE devices
      SET host_name = ?, ip = ?, group_name = ?, ssh_user = ?, location = ?, category_id = ?,
        description = ?, line_number = ?, numerator = ?
      WHERE id = ?
    `).run(
      device.hostName,
      device.ip,
      device.groupName,
      device.sshUser,
      location.name,
      device.categoryId,
      device.description,
      device.lineNumber,
      device.numerator,
      id,
    );
    saveDependencies(id, device.dependencyIds);
    if (existing.hostName !== device.hostName || existing.ip !== device.ip) {
      database.prepare("DELETE FROM device_status WHERE device_id = ?").run(id);
    }
  });
  return getDevice(id);
}

function deleteDevice(id) {
  const result = database.prepare("DELETE FROM devices WHERE id = ?").run(id);
  if (!result.changes) {
    throw Object.assign(new Error("Nie znaleziono maszyny."), { status: 404 });
  }
}

module.exports = {
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
  getSummary,
  saveDeviceStatus,
  updateCategory,
  updateDevice,
  updateLocation,
};

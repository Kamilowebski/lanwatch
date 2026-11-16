const fs = require("node:fs");
const path = require("node:path");
const { DatabaseSync } = require("node:sqlite");

const databasePath = process.env.DB_PATH
  ? path.resolve(process.env.DB_PATH)
  : path.join(__dirname, "data", "lanwatch.sqlite");
fs.mkdirSync(path.dirname(databasePath), { recursive: true });

const database = new DatabaseSync(databasePath);
database.exec(`
  PRAGMA foreign_keys = ON;
  CREATE TABLE IF NOT EXISTS categories (
    id INTEGER PRIMARY KEY,
    name TEXT NOT NULL COLLATE NOCASE UNIQUE
  );
  CREATE TABLE IF NOT EXISTS devices (
    id INTEGER PRIMARY KEY,
    host_name TEXT NOT NULL,
    ip TEXT NOT NULL,
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

function getDevice(id) {
  const device = database.prepare(`
    SELECT d.id, d.host_name AS hostName, d.ip, d.location,
      d.category_id AS categoryId, c.name AS category,
      d.description, d.line_number AS lineNumber, d.numerator
    FROM devices d
    JOIN categories c ON c.id = d.category_id
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

function getDevices() {
  const devices = database.prepare(`
    SELECT d.id, d.host_name AS hostName, d.ip, d.location,
      d.category_id AS categoryId, c.name AS category,
      d.description, d.line_number AS lineNumber, d.numerator
    FROM devices d
    JOIN categories c ON c.id = d.category_id
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
  return {
    devices: database.prepare("SELECT COUNT(*) AS count FROM devices").get().count,
    categories: database.prepare("SELECT COUNT(*) AS count FROM categories").get().count,
    locations: database.prepare("SELECT COUNT(DISTINCT location) AS count FROM devices").get().count,
  };
}

function createCategory(name) {
  if (database.prepare("SELECT id FROM categories WHERE name = ? COLLATE NOCASE").get(name)) {
    throw Object.assign(new Error("Kategoria o tej nazwie już istnieje."), { status: 409 });
  }
  const result = database.prepare("INSERT INTO categories (name) VALUES (?)").run(name);
  return getCategory(Number(result.lastInsertRowid));
}

function updateCategory(id, name) {
  if (!getCategory(id)) {
    throw Object.assign(new Error("Nie znaleziono kategorii."), { status: 404 });
  }
  if (database.prepare("SELECT id FROM categories WHERE name = ? COLLATE NOCASE AND id != ?").get(name, id)) {
    throw Object.assign(new Error("Kategoria o tej nazwie już istnieje."), { status: 409 });
  }
  database.prepare("UPDATE categories SET name = ? WHERE id = ?").run(name, id);
  return getCategory(id);
}

function deleteCategory(id) {
  if (!getCategory(id)) {
    throw Object.assign(new Error("Nie znaleziono kategorii."), { status: 404 });
  }
  const usage = database.prepare("SELECT COUNT(*) AS count FROM devices WHERE category_id = ?").get(id);
  if (usage.count) {
    throw Object.assign(new Error("Nie można usunąć kategorii używanej przez maszyny."), { status: 409 });
  }
  database.prepare("DELETE FROM categories WHERE id = ?").run(id);
}

function createDevice(device) {
  if (!getCategory(device.categoryId)) {
    throw Object.assign(new Error("Wybrana kategoria już nie istnieje."), { status: 400 });
  }
  const id = withTransaction(() => {
    const result = database.prepare(`
      INSERT INTO devices (host_name, ip, location, category_id, description, line_number, numerator)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(
      device.hostName,
      device.ip,
      device.location,
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
  if (!getDevice(id)) {
    throw Object.assign(new Error("Nie znaleziono maszyny."), { status: 404 });
  }
  if (!getCategory(device.categoryId)) {
    throw Object.assign(new Error("Wybrana kategoria już nie istnieje."), { status: 400 });
  }
  withTransaction(() => {
    database.prepare(`
      UPDATE devices
      SET host_name = ?, ip = ?, location = ?, category_id = ?,
        description = ?, line_number = ?, numerator = ?
      WHERE id = ?
    `).run(
      device.hostName,
      device.ip,
      device.location,
      device.categoryId,
      device.description,
      device.lineNumber,
      device.numerator,
      id,
    );
    saveDependencies(id, device.dependencyIds);
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
  deleteCategory,
  deleteDevice,
  getCategories,
  getDevices,
  getSummary,
  updateCategory,
  updateDevice,
};

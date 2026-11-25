const assert = require("node:assert/strict");
const { spawn } = require("node:child_process");
const { DatabaseSync } = require("node:sqlite");
const fs = require("node:fs");
const net = require("node:net");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

async function findAvailablePort() {
  const listener = net.createServer();
  await new Promise((resolve, reject) => {
    listener.once("error", reject);
    listener.listen(0, "127.0.0.1", resolve);
  });
  const { port } = listener.address();
  await new Promise((resolve) => listener.close(resolve));
  return port;
}

async function waitForServer(child, url) {
  let lastError;
  for (let attempt = 0; attempt < 50; attempt += 1) {
    if (child.exitCode !== null) throw new Error("Lanwatch server exited before becoming ready.");
    try {
      const response = await fetch(`${url}/api/categories`);
      if (response.ok) return;
    } catch (error) {
      lastError = error;
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error("Lanwatch server did not become ready.", { cause: lastError });
}

test("validates devices, expires old online status, and restricts SSH tunnel launching", async (t) => {
  const temporaryDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "lanwatch-test-"));
  const databasePath = path.join(temporaryDirectory, "lanwatch.sqlite");
  const port = await findAvailablePort();
  const baseUrl = `http://127.0.0.1:${port}`;
  const legacyDatabase = new DatabaseSync(databasePath);
  legacyDatabase.exec(`
    CREATE TABLE devices (
      id INTEGER PRIMARY KEY,
      host_name TEXT NOT NULL,
      ip TEXT NOT NULL,
      group_name TEXT NOT NULL DEFAULT '',
      location TEXT NOT NULL,
      category_id INTEGER NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      line_number TEXT NOT NULL DEFAULT '',
      numerator TEXT NOT NULL DEFAULT ''
    );
    CREATE TABLE device_status (
      device_id INTEGER PRIMARY KEY,
      status TEXT NOT NULL,
      checked_at TEXT NOT NULL,
      replies INTEGER NOT NULL DEFAULT 0,
      target TEXT NOT NULL DEFAULT '',
      message TEXT NOT NULL DEFAULT ''
    )
  `);
  legacyDatabase.close();
  const child = spawn(process.execPath, [path.join(__dirname, "server.js")], {
    cwd: __dirname,
    env: {
      ...process.env,
      DB_PATH: databasePath,
      HOST: "127.0.0.1",
      PORT: String(port),
    },
    stdio: "ignore",
  });

  t.after(async () => {
    if (child.exitCode === null) {
      child.kill("SIGTERM");
      await new Promise((resolve) => child.once("exit", resolve));
    }
    for (const suffix of ["", "-shm", "-wal"]) {
      const file = `${databasePath}${suffix}`;
      if (fs.existsSync(file)) fs.unlinkSync(file);
    }
    fs.rmSync(temporaryDirectory, { recursive: true, force: true });
  });

  await waitForServer(child, baseUrl);
  async function request(resource, method = "GET", body, headers = {}) {
    const response = await fetch(`${baseUrl}${resource}`, {
      method,
      headers: body === undefined ? headers : { "Content-Type": "application/json", ...headers },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const result = await response.json();
    return { status: response.status, result };
  }

  const missingHistory = await request("/api/devices/999999/history");
  assert.equal(missingHistory.status, 404);
  const invalidHistoryPage = await request("/api/devices/1/history?before=invalid");
  assert.equal(invalidHistoryPage.status, 400);
  const backupStatus = await request("/api/backups/status");
  assert.equal(backupStatus.status, 200);
  assert.equal(typeof backupStatus.result.active, "boolean");
  assert.equal(typeof backupStatus.result.count, "number");
  assert.equal(path.dirname(backupStatus.result.directory), temporaryDirectory);
  const home = await fetch(baseUrl);
  const markup = await home.text();
  const expectedVersion = require("./package.json").version;
  assert.equal(home.headers.get("x-lanwatch-version"), expectedVersion);
  assert.ok(markup.includes(`v${expectedVersion}`));
  assert.equal(markup.includes("{{APP_VERSION}}"), false);
  const categories = await request("/api/categories");
  const terminalCategory = categories.result.find((category) => category.name === "Terminal");
  const crossSiteWrite = await request(
    "/api/locations", "POST", { name: "Forbidden" }, { Origin: "http://attacker.example" },
  );
  assert.equal(crossSiteWrite.status, 403);
  const plainTextWrite = await request(
    "/api/locations", "POST", { name: "Forbidden" }, { "Content-Type": "text/plain" },
  );
  assert.equal(plainTextWrite.status, 415);
  const locationResponse = await request("/api/locations", "POST", { name: "Test lokalizacja" });
  assert.equal(locationResponse.status, 201, JSON.stringify(locationResponse.result));
  const location = locationResponse.result;
  const initialSettings = await request("/api/settings");
  assert.deepEqual(initialSettings.result, { sshUser: "" });
  const remoteSettingsUpdate = await request(
    "/api/settings",
    "PUT",
    { sshUser: "admin" },
    { Origin: "http://attacker.example" },
  );
  assert.equal(remoteSettingsUpdate.status, 403);
  const savedSettings = await request(
    "/api/settings",
    "PUT",
    { sshUser: "testuser" },
    { Origin: baseUrl },
  );
  assert.equal(savedSettings.status, 200);
  assert.deepEqual(savedSettings.result, { sshUser: "testuser" });
  const invalidSshUser = await request(
    "/api/settings",
    "PUT",
    { sshUser: "admin;id" },
    { Origin: baseUrl },
  );
  assert.equal(invalidSshUser.status, 400);
  const newDevice = (hostName, ip) => ({
    hostName,
    ip,
    location: location.name,
    categoryId: terminalCategory.id,
    dependencyIds: [],
  });
  for (const ip of ["192.168.1.999", "192.168.1", "192.168.001.1", "::1", "fd12::1", "host.local", "192.168.1.1/24", "192.168.1.1:22"]) {
    const rejected = await request("/api/devices", "POST", newDevice("Invalid IP", ip));
    assert.equal(rejected.status, 400, ip);
    assert.match(rejected.result.error, /IPv4/);
  }
  assert.equal((await request("/api/devices")).result.length, 0);
  const first = await request(
    "/api/devices",
    "POST",
    newDevice("Terminal A", "192.168.10.10"),
  );
  assert.equal(first.status, 201, JSON.stringify(first.result));
  const emptyHistory = await request(`/api/devices/${first.result.id}/history`);
  assert.equal(emptyHistory.status, 200);
  assert.deepEqual(emptyHistory.result, {items: [], nextBefore: null});

  const badIpUpdate = await request(`/api/devices/${first.result.id}`, "PUT", {...first.result, ip:"::1"});
  assert.equal(badIpUpdate.status, 400);
  assert.equal((await request("/api/devices")).result.find(item=>item.id===first.result.id).ip,"192.168.10.10");
  const trimmedIpUpdate = await request(`/api/devices/${first.result.id}`, "PUT", {...first.result, ip:" 192.168.10.10 "});
  assert.equal(trimmedIpUpdate.status,200);
  assert.equal(trimmedIpUpdate.result.ip,"192.168.10.10");
  assert.equal("sshUser" in first.result, false);
  assert.equal(first.result.monitorEnabled, false);
  const invalidMonitorSettings = await request(
    `/api/devices/${first.result.id}/monitor`,
    "PUT",
    { enabled: true, notifyOnline: "yes", notifyOffline: false },
  );
  assert.equal(invalidMonitorSettings.status, 400);
  const invalidBulkPing = await request("/api/ping", "POST", { deviceIds: ["1"] });
  assert.equal(invalidBulkPing.status, 400);
  const emptyBulkPing = await request("/api/ping", "POST", { deviceIds: [] });
  assert.equal(emptyBulkPing.status, 400);
  const monitorSettings = await request(
    `/api/devices/${first.result.id}/monitor`,
    "PUT",
    { enabled: true, notifyOnline: true, notifyOffline: false },
  );
  assert.equal(monitorSettings.status, 200);
  assert.deepEqual(monitorSettings.result, {
    enabled: true,
    notifyOnline: true,
    notifyOffline: false,
  });
  const listedDevices = await request("/api/devices");
  const monitoredDevice = listedDevices.result.find((device) => device.id === first.result.id);
  assert.equal(monitoredDevice.monitorEnabled, true);
  assert.equal(monitoredDevice.notifyOnline, true);
  assert.equal(monitoredDevice.notifyOffline, false);
  const disabledMonitor = await request(
    `/api/devices/${first.result.id}/monitor`,
    "PUT",
    { enabled: false, notifyOnline: true, notifyOffline: false },
  );
  assert.equal(disabledMonitor.result.enabled, false);

  const duplicateHost = await request(
    "/api/devices",
    "POST",
    newDevice("terminal a", "192.168.10.11"),
  );
  assert.equal(duplicateHost.status, 409);

  const duplicateIp = await request(
    "/api/devices",
    "POST",
    newDevice("Terminal B", "192.168.10.10"),
  );
  assert.equal(duplicateIp.status, 409);

  const second = await request("/api/devices", "POST", newDevice("Terminal B", ""));
  assert.equal(second.status, 201);
  const third = await request("/api/devices", "POST", {
    ...newDevice("Terminal C", ""),
    dependencyIds: [first.result.id],
  });
  assert.equal(third.status, 201);
  assert.deepEqual(third.result.dependencyIds, [first.result.id]);

  const conflictingUpdate = await request(
    `/api/devices/${second.result.id}`,
    "PUT",
    { ...second.result, hostName: "Terminal A" },
  );
  assert.equal(conflictingUpdate.status, 409);
  const updatedDependencies = await request(
    `/api/devices/${first.result.id}`,
    "PUT",
    { ...first.result, dependencyIds: [second.result.id] },
  );
  assert.deepEqual(updatedDependencies.result.dependencyIds, [second.result.id]);
  const sameDeviceUpdate = await request(
    `/api/devices/${first.result.id}`,
    "PUT",
    first.result,
  );
  assert.equal(sameDeviceUpdate.status, 200);
  assert.deepEqual(sameDeviceUpdate.result.dependencyIds, []);

  const addedDependency = await request(
    `/api/devices/${third.result.id}/dependencies`,
    "PUT",
    { dependencyIds: [second.result.id] },
  );
  assert.equal(addedDependency.status, 200);
  assert.deepEqual(addedDependency.result.dependencyIds, [second.result.id]);
  const editedWithoutDependencies = await request(
    `/api/devices/${third.result.id}`,
    "PUT",
    { ...addedDependency.result, dependencyIds: undefined, description: "Opis po edycji" },
  );
  assert.equal(editedWithoutDependencies.status, 200);
  assert.deepEqual(editedWithoutDependencies.result.dependencyIds, [second.result.id]);
  const removedDependency = await request(
    `/api/devices/${third.result.id}/dependencies`,
    "PUT",
    { dependencyIds: [] },
  );
  assert.equal(removedDependency.status, 200);
  assert.deepEqual(removedDependency.result.dependencyIds, []);
  const invalidSelfDependency = await request(
    `/api/devices/${third.result.id}/dependencies`,
    "PUT",
    { dependencyIds: [third.result.id] },
  );
  assert.equal(invalidSelfDependency.status, 400);
  const missingDependency = await request(
    `/api/devices/${third.result.id}/dependencies`,
    "PUT",
    { dependencyIds: [Number.MAX_SAFE_INTEGER] },
  );
  assert.equal(missingDependency.status, 400);
  const missingDeviceDependencies = await request(
    "/api/devices/999999/dependencies",
    "PUT",
    { dependencyIds: [] },
  );
  assert.equal(missingDeviceDependencies.status, 404);

  const forbiddenTunnel = await request(
    `/api/devices/${first.result.id}/terminal/tunnel`,
    "POST",
    undefined,
    { Origin: "http://attacker.example" },
  );
  assert.equal(forbiddenTunnel.status, 403);

  const removedBrowserCommand = await request(
    `/api/devices/${first.result.id}/terminal/command`,
    "POST",
    { command: "whoami" },
    { Origin: baseUrl },
  );
  assert.equal(removedBrowserCommand.status, 404);

  const database = new DatabaseSync(databasePath);
  try {
    const storedSshUser = database
      .prepare("SELECT value FROM app_settings WHERE key = 'ssh_user'")
      .get();
    assert.equal(storedSshUser.value, "testuser");
    database.prepare(`
      INSERT INTO device_dependencies (device_id, dependency_id) VALUES (?, ?)
    `).run(first.result.id, third.result.id);
    await request(
      `/api/devices/${first.result.id}/monitor`,
      "PUT",
      { enabled: true, notifyOnline: false, notifyOffline: false },
    );
    const monitorSelection = await request("/api/devices");
    assert.equal(
      monitorSelection.result.find((device) => device.id === first.result.id).monitorEnabled,
      true,
    );
    assert.equal(
      monitorSelection.result.find((device) => device.id === second.result.id).monitorEnabled,
      false,
    );
    const migratedStatusColumns = database.prepare("PRAGMA table_info(device_status)").all();
    assert.ok(migratedStatusColumns.some((column) => column.name === "latency_ms"));
    const checkedAt = new Date().toISOString();
    database.prepare(`
      INSERT OR REPLACE INTO device_status
        (device_id, status, checked_at, replies, target, message, latency_ms)
      VALUES (?, 'online', ?, 1, '192.168.10.10', '', 12.5)
    `).run(first.result.id, checkedAt);
    database.prepare(`
      INSERT OR REPLACE INTO device_status (device_id, status, checked_at, replies, target, message)
      VALUES (?, 'offline', ?, 0, '192.168.10.20', '')
    `).run(second.result.id, new Date(Date.now() - 10 * 60 * 1000).toISOString());
    const freshDevices = await request("/api/devices");
    assert.equal(freshDevices.result.find((device) => device.id === first.result.id).status, "online");
    assert.equal(freshDevices.result.find((device) => device.id === first.result.id).pingLatencyMs, 12.5);

    const expiredAt = new Date(Date.now() - 6 * 60 * 1000).toISOString();
    database.prepare("UPDATE device_status SET checked_at = ? WHERE device_id = ?")
      .run(expiredAt, first.result.id);
    const expiredDevices = await request("/api/devices");
    assert.equal(expiredDevices.result.find((device) => device.id === first.result.id).status, "unknown");
    assert.equal(expiredDevices.result.find((device) => device.id === second.result.id).status, "offline");
    const summary = await request("/api/summary");
    assert.equal(summary.result.online, 0);
    assert.equal(summary.result.offline, 1);
    assert.equal(summary.result.unchecked, 2);
    assert.equal(summary.result.onlineTtlMs, 5 * 60 * 1000);
  } finally {
    database.close();
  }
  const unchangedCount = (await request("/api/devices")).result.length;
  const badBulk = await request("/api/devices/bulk", "PUT", {deviceIds:[first.result.id,999999],changes:{monitorEnabled:false}});
  assert.equal(badBulk.status,404);
  assert.equal((await request("/api/devices")).result.find(item=>item.id===first.result.id).monitorEnabled,true);
  assert.equal((await request("/api/devices/bulk", "PUT", {deviceIds:[first.result.id],changes:{monitorEnabled:"yes"}})).status,400);
  const csvResponse = await fetch(`${baseUrl}/api/devices/export.csv`);
  assert.equal(csvResponse.status,200);
  assert.match(csvResponse.headers.get("content-type"),/text\/csv/);
  assert.equal(require("./device-csv").parseDeviceCsv(await csvResponse.text()).length,unchangedCount);
  const csv = require("./device-csv").exportDeviceCsv([
    {hostName:"CSV-A",ip:"",location:"CSV Hala",category:"CSV Typ",dependencies:["CSV-B"]},
    {hostName:"CSV-B",ip:"192.168.99.20",location:"CSV Hala",category:"CSV Typ",dependencies:[]},
  ]);
  const preview=await request("/api/devices/import/preview","POST",{csv});
  assert.equal(preview.status,200);
  assert.equal(preview.result.imported,2);
  assert.equal((await request("/api/devices")).result.length,unchangedCount);
  const imported=await request("/api/devices/import","POST",{csv});assert.equal(imported.status,200);
  const afterCsv=(await request("/api/devices")).result;
  assert.equal(afterCsv.length,unchangedCount+2);
  assert.deepEqual(afterCsv.find(item=>item.hostName==='CSV-A').dependencies,['CSV-B']);
  assert.equal((await request("/api/devices/import","POST",{csv})).status,409);
  const vendor=await fetch(`${baseUrl}/vendor/bootstrap-5.3.8.min.css`);
  assert.equal(vendor.status,200);assert.match(await vendor.text(),/Bootstrap  v5\.3\.8/);
  assert.equal(markup.includes('cdn.jsdelivr.net'),false);

});


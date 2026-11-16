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
    fs.rmdirSync(temporaryDirectory);
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

  const categories = await request("/api/categories");
  const terminalCategory = categories.result.find((category) => category.name === "Terminal");
  const locationResponse = await request("/api/locations", "POST", { name: "Test lokalizacja" });
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
    { sshUser: "StarachowiceSWRBis" },
    { Origin: baseUrl },
  );
  assert.equal(savedSettings.status, 200);
  assert.deepEqual(savedSettings.result, { sshUser: "StarachowiceSWRBis" });
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
  const first = await request(
    "/api/devices",
    "POST",
    newDevice("Terminal A", "192.168.10.10"),
  );
  assert.equal(first.status, 201);
  assert.equal("sshUser" in first.result, false);

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
  const third = await request("/api/devices", "POST", newDevice("Terminal C", ""));
  assert.equal(third.status, 201);

  const conflictingUpdate = await request(
    `/api/devices/${second.result.id}`,
    "PUT",
    { ...second.result, hostName: "Terminal A" },
  );
  assert.equal(conflictingUpdate.status, 409);
  const sameDeviceUpdate = await request(
    `/api/devices/${first.result.id}`,
    "PUT",
    first.result,
  );
  assert.equal(sameDeviceUpdate.status, 200);

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
    assert.equal(storedSshUser.value, "StarachowiceSWRBis");
    const checkedAt = new Date().toISOString();
    database.prepare(`
      INSERT OR REPLACE INTO device_status (device_id, status, checked_at, replies, target, message)
      VALUES (?, 'online', ?, 1, '192.168.10.10', '')
    `).run(first.result.id, checkedAt);
    database.prepare(`
      INSERT OR REPLACE INTO device_status (device_id, status, checked_at, replies, target, message)
      VALUES (?, 'offline', ?, 0, '192.168.10.20', '')
    `).run(second.result.id, new Date(Date.now() - 10 * 60 * 1000).toISOString());
    const freshDevices = await request("/api/devices");
    assert.equal(freshDevices.result.find((device) => device.id === first.result.id).status, "online");

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
});

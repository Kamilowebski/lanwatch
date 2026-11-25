const fs = require("node:fs");
const http = require("node:http");
const net = require("node:net");
const { isValidIPv4 } = require("./public/ipv4");
const path = require("node:path");
const { version: appVersion } = require("./package.json");
const { randomUUID } = require("node:crypto");
const { monitorEventLoopDelay } = require("node:perf_hooks");
const databaseFile = process.env.DB_PATH ? path.resolve(process.env.DB_PATH) : path.join(__dirname,"data","lanwatch.sqlite");
const diagnostics = require("./diagnostics").createLogger(path.join(path.dirname(databaseFile),"logs"));
const {
  backupDatabase,
  importDeviceRows, bulkUpdateDevices,
  snippetStore,
  updateMonitorNote, getDeviceReport,
  createCategory,
  createDevice,
  createLocation,
  deleteCategory,
  deleteDevice,
  deleteLocation,
  getCategories,
  getDevice,
  getDeviceHistory,
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
} = require("./database");
const { pingLocalTarget } = require("./ping");
const { parseDeviceCsv, exportDeviceCsv } = require("./device-csv");
const { startVncTunnel } = require("./terminal");

const port = Number(process.env.PORT) || 3000;
const host = "127.0.0.1";
const MONITOR_POLL_INTERVAL_MS = 15 * 1000;
const publicDirectory = path.join(__dirname, "public");
const staticFiles = {
  "/": { file: "index.html", type: "text/html; charset=utf-8" },
  "/vendor/bootstrap-5.3.8.min.css": {file:"vendor/bootstrap-5.3.8.min.css",type:"text/css; charset=utf-8"},
  "/clipboard.js": {file:"clipboard.js",type:"text/javascript; charset=utf-8"},
  "/inventory-tools.js": {file:"inventory-tools.js",type:"text/javascript; charset=utf-8"},
  "/ipv4.js": {file:"ipv4.js",type:"text/javascript; charset=utf-8"},
  "/snippets.js": {file:"snippets.js",type:"text/javascript; charset=utf-8"},
  "/report.js": {file:"report.js",type:"text/javascript; charset=utf-8"},
  "/diagnostics.js": { file: "diagnostics.js", type: "text/javascript; charset=utf-8" },
  "/app.js": { file: "app.js", type: "text/javascript; charset=utf-8" },
  "/styles.css": { file: "styles.css", type: "text/css; charset=utf-8" },
};
const activePings = new Map();
const MAX_CONCURRENT_PINGS = 8;
let runningPings = 0;
const pingWaiters = [];
let monitorPollActive = false;
let monitorTimer;
let backupTimer;

let backupActive = false;
let lastBackupError = null;
async function runBackup() {
  if (backupActive) return;
  backupActive = true;
  const started = Date.now();
  diagnostics.log("info","backup.started");
  try {
    await backupDatabase();
    lastBackupError = null;
    diagnostics.log("info","backup.finished",{durationMs:Date.now()-started});
  }
  catch (error) { lastBackupError = error.message; diagnostics.log("error","backup.error",{message:error.message,stack:error.stack}); }
  finally { backupActive = false; }
}

async function checkDevice(device, priority = false) {
  const key = `${device.id}:${device.hostName}:${device.ip}`;
  if (activePings.has(key)) {
    if (priority) {
      const index = pingWaiters.findIndex(item => item.key === key);
      if (index >= 0 && !pingWaiters[index].priority) {
        const [item] = pingWaiters.splice(index, 1);
        item.priority = true;
        const firstAutomatic = pingWaiters.findIndex(entry => !entry.priority);
        pingWaiters.splice(firstAutomatic < 0 ? pingWaiters.length : firstAutomatic, 0, item);
      }
    }
    return activePings.get(key);
  }
  const job = (async () => {
    if (runningPings >= MAX_CONCURRENT_PINGS) {
      await new Promise((resolve) => {
        const item = {key, resolve, priority};
        const firstAutomatic = priority ? pingWaiters.findIndex(entry => !entry.priority) : -1;
        pingWaiters.splice(firstAutomatic < 0 ? pingWaiters.length : firstAutomatic, 0, item);
      });
    } else {
      runningPings += 1;
    }
    try {
      const result = await pingLocalTarget(device.ip || device.hostName);
      const checkedResult = {
        ...result, deviceId: device.id, hostName: device.hostName,
        checkedAt: new Date().toISOString(),
      };
      const current = getDevice(device.id);
      if (current && current.hostName === device.hostName && current.ip === device.ip) {
        saveDeviceStatus(device.id, checkedResult);
      }
      return checkedResult;
    } finally {
      const next = pingWaiters.shift();
      if (next) next.resolve();
      else runningPings -= 1;
    }
  })();
  activePings.set(key, job);
  try { return await job; }
  finally { activePings.delete(key); }
}

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

function sendJson(response, status, data) {
  response.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
  });
  response.end(JSON.stringify(data));
}

function readJson(request) {
  return new Promise((resolve, reject) => {
    let body = "";
    request.setEncoding("utf8");
    request.on("data", (chunk) => {
      body += chunk;
      if (body.length > (request.url?.startsWith("/api/devices/import") ? 2 : 1) * 1024 * 1024) {
        reject(new HttpError(413, "Przesłane dane są zbyt duże."));
        request.destroy();
      }
    });
    request.on("end", () => {
      try {
        resolve(JSON.parse(body));
      } catch {
        reject(new HttpError(400, "Nieprawidłowy format danych."));
      }
    });
    request.on("error", reject);
  });
}

function validateDevice(input) {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new HttpError(400, "Nieprawidłowe dane maszyny.");
  }

  const requiredTextFields = ["hostName", "location"];
  for (const field of requiredTextFields) {
    if (typeof input[field] !== "string" || !input[field].trim()) {
      throw new HttpError(400, "Uzupełnij nazwę hosta i lokalizację.");
    }
  }

  const textFields = [
    "hostName",
    "ip",
    "groupName",
    "location",
    "description",
    "lineNumber",
    "numerator",
  ];
  const device = {};
  for (const field of textFields) {
    const value = input[field] === undefined ? "" : input[field];
    if (typeof value !== "string" || value.length > (field === "description" ? 5000 : 255)) {
      throw new HttpError(400, "Nieprawidłowa wartość jednego z pól maszyny.");
    }
    device[field] = value.trim();
  }

  if (device.ip && !isValidIPv4(device.ip)) {
    throw new HttpError(400, "Podaj poprawny adres IPv4, np. 192.168.1.10, albo pozostaw pole puste. IPv6 nie jest obsługiwany.");
  }
  const categoryId = Number(input.categoryId);
  if (!Number.isSafeInteger(categoryId) || categoryId < 1) {
    throw new HttpError(400, "Wybierz prawidłową kategorię.");
  }
  device.categoryId = categoryId;

  if (input.dependencyIds !== undefined) {
    device.dependencyIds = validateDependencyIds(input.dependencyIds);
  }
  return device;
}

function validateDependencyIds(dependencyIds) {
  if (
    !Array.isArray(dependencyIds) ||
    dependencyIds.some((id) => !Number.isSafeInteger(Number(id)) || Number(id) < 1)
  ) {
    throw new HttpError(400, "Nieprawidłowa lista zależności.");
  }
  return [...new Set(dependencyIds.map(Number))];
}

function validateDependencyUpdate(input) {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new HttpError(400, "Nieprawidłowa lista zależności.");
  }
  return validateDependencyIds(input.dependencyIds);
}

function validateNamedItem(input, label) {
  if (
    !input ||
    typeof input !== "object" ||
    Array.isArray(input) ||
    typeof input.name !== "string" ||
    !input.name.trim() ||
    input.name.length > 100
  ) {
    throw new HttpError(400, `Podaj nazwę ${label} (maksymalnie 100 znaków).`);
  }
  return input.name.trim();
}

function validateSshUsername(input) {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new HttpError(400, "Nieprawidłowe ustawienia SSH.");
  }
  const username = input.sshUser;
  if (
    typeof username !== "string" ||
    username.length > 64 ||
    (username.trim() && !/^[A-Za-z0-9_.-]+$/.test(username.trim()))
  ) {
    throw new HttpError(400, "Nazwa użytkownika SSH może zawierać tylko litery, cyfry, kropki, myślniki i podkreślenia.");
  }
  return username.trim();
}

function validateMonitorSettings(input) {
  if (
    !input ||
    typeof input !== "object" ||
    Array.isArray(input) ||
    ["enabled", "notifyOnline", "notifyOffline"].some((key) => typeof input[key] !== "boolean")
  ) {
    throw new HttpError(400, "Nieprawidłowe ustawienia monitorowania.");
  }
  return {
    enabled: input.enabled,
    notifyOnline: input.notifyOnline,
    notifyOffline: input.notifyOffline,
  };
}

function isLoopbackAddress(address) {
  if (!address) return false;
  const normalized = address.toLowerCase().replace(/^::ffff:/, "");
  if (normalized === "::1") return true;
  return normalized.startsWith("127.") && net.isIP(normalized) === 4;
}

function isLocalOrigin(request) {
  if (!request.headers.origin || !request.headers.host) return false;
  try {
    const origin = new URL(request.headers.origin);
    const originHost = origin.hostname.replace(/^\[|\]$/g, "").toLowerCase();
    return origin.protocol === "http:"
      && origin.host.toLowerCase() === request.headers.host.toLowerCase()
      && (originHost === "localhost" || isLoopbackAddress(originHost));
  } catch {
    return false;
  }
}

function assertLocalTerminalRequest(request) {
  if (
    !isLoopbackAddress(request.socket.remoteAddress) ||
    !isLocalOrigin(request)
  ) {
    throw new HttpError(403, "Funkcje SSH są dostępne wyłącznie lokalnie z aplikacji Lanwatch.");
  }
}

function getTerminalDevice(id) {
  const device = getDevice(id);
  if (!device) throw new HttpError(404, "Nie znaleziono maszyny.");
  if (device.category.toLocaleLowerCase("pl") !== "terminal") {
    throw new HttpError(400, "Funkcje SSH są dostępne tylko dla kategorii Terminal.");
  }
  return device;
}

async function pingDeviceAndDependencies(deviceId) {
  const devices = getDevices();
  const devicesById = new Map(devices.map((device) => [device.id, device]));
  const device = devicesById.get(deviceId);
  if (!device) throw new HttpError(404, "Nie znaleziono maszyny.");

  const groupName = device.groupName.trim().toLocaleLowerCase("pl");
  const groupMembers = groupName
    ? devices.filter((item) => item.groupName.trim().toLocaleLowerCase("pl") === groupName)
    : [device];
  const targetIds = [
    device.id,
    ...groupMembers.filter((item) => item.id !== device.id).map((item) => item.id),
    ...groupMembers.flatMap((item) => item.dependencyIds),
  ];
  const targets = [...new Set(targetIds)].map((id) => devicesById.get(id)).filter(Boolean);
  return Promise.all(targets.map(target => checkDevice(target, true)));
}

async function pingSelectedDevices(deviceIds) {
  const devices = getDevices();
  const devicesById = new Map(devices.map((device) => [device.id, device]));
  if (deviceIds.some((id) => !devicesById.has(id))) {
    throw new HttpError(404, "Nie znaleziono jednej z wybranych maszyn.");
  }

  await Promise.all(deviceIds.map((id) => checkDevice(devicesById.get(id), true)));
  return { checked: deviceIds.length };
}

async function pollMonitoredDevices() {
  if (monitorPollActive) return;
  monitorPollActive = true;
  const started = Date.now();
  try {
    const monitored = getDevices().filter((device) => device.monitorEnabled);
    if(monitored.length) diagnostics.log("info","monitor.started",{devices:monitored.length});
    const results = await Promise.allSettled(monitored.map(device => checkDevice(device)));
    const failures = results.filter(result=>result.status === "rejected");
    for(const failure of failures) diagnostics.log("error","monitor.device_error",{
      message:failure.reason?.message,stack:failure.reason?.stack});
    if(monitored.length) diagnostics.log("info","monitor.finished",{
      devices:monitored.length,errors:failures.length,durationMs:Date.now()-started});
  } catch (error) {
    diagnostics.log("error","monitor.error",{message:error.message,stack:error.stack});
  } finally {
    monitorPollActive = false;
  }
}

async function handleApi(request, response, pathname) {
  const historyMatch = pathname.match(/^\/api\/devices\/(\d+)\/history$/);
  if (historyMatch && request.method === "GET") {
    const url = new URL(request.url, "http://localhost");
    const before = url.searchParams.has("before") ? Number(url.searchParams.get("before")) : Number.MAX_SAFE_INTEGER;
    if (!Number.isSafeInteger(before) || before < 1) {
      throw new HttpError(400, "Nieprawidłowa strona historii.");
    }
    sendJson(response, 200, getDeviceHistory(Number(historyMatch[1]), before));
    return;
  }

  if (!["GET", "HEAD"].includes(request.method)) {
    const origin = request.headers.origin;
    if (origin && origin !== `http://${request.headers.host}`) {
      throw new HttpError(403, "Żądanie pochodzi z innej witryny.");
    }
    if (request.headers["sec-fetch-site"] === "cross-site") {
      throw new HttpError(403, "Żądanie pochodzi z innej witryny.");
    }
    if (["PUT", "POST"].includes(request.method) &&
        (Number(request.headers["content-length"]) > 0 || request.headers["transfer-encoding"]) &&
        request.headers["content-type"]?.split(";")[0].trim().toLowerCase() !== "application/json") {
      throw new HttpError(415, "Wymagany format application/json.");
    }
  }

  if (pathname === "/api/client-errors" && request.method === "POST") {
    assertLocalTerminalRequest(request);
    const entry = await readJson(request);
    if (!entry || typeof entry.event !== "string") throw new HttpError(400,"Nieprawidłowy wpis diagnostyczny.");
    const fields = {};
    for (const key of ["event","message","stack","file","line","requestId","url","method","status","durationMs","gapMs"]) {
      if (["string","number"].includes(typeof entry[key])) fields[key] = String(entry[key]).slice(0,key === "stack" ? 6000 : 1000);
    }
    fields.clientEvent = fields.event;
    delete fields.event;
    diagnostics.log(entry.level === "warn" ? "warn" : "error", "client.report", fields);
    sendJson(response,200,{ok:true});
    return;
  }
  const reportMatch = pathname.match(/^\/api\/devices\/(\d+)\/report$/);
  if (reportMatch && request.method === "GET") {
    const range = new URL(request.url,"http://localhost").searchParams.get("hours") || "all";
    if (!["1","24","168","all"].includes(range)) throw new HttpError(400,"Nieprawidłowy zakres raportu.");
    sendJson(response,200,{items:getDeviceReport(Number(reportMatch[1]),range === "all" ? null : Number(range))});
    return;
  }
  const noteMatch = pathname.match(/^\/api\/devices\/(\d+)\/monitor\/note$/);
  if (noteMatch && request.method === "PUT") {
    const body = await readJson(request);
    if (!body || typeof body.note !== "string" || body.note.length > 1000) throw new HttpError(400,"Notatka może mieć do 1000 znaków.");
    sendJson(response,200,updateMonitorNote(Number(noteMatch[1]),body.note.trim()));
    return;
  }
  if (pathname === "/api/snippets" && request.method === "GET") { sendJson(response,200,snippetStore.list());return; }
  if (pathname === "/api/snippets" && request.method === "POST") { sendJson(response,201,snippetStore.create(await readJson(request)));return; }
  if (pathname === "/api/snippets/import" && request.method === "POST") { sendJson(response,200,snippetStore.import(await readJson(request)));return; }
  const snippetMatch = pathname.match(/^\/api\/snippets\/(\d+)(\/favorite)?$/);
  if (snippetMatch && request.method === "PUT") {
    const body=await readJson(request);
    sendJson(response,200,snippetMatch[2] ? snippetStore.favorite(Number(snippetMatch[1]),body?.favorite) : snippetStore.update(Number(snippetMatch[1]),body));return;
  }
  if (snippetMatch && !snippetMatch[2] && request.method === "DELETE") {snippetStore.remove(Number(snippetMatch[1]));sendJson(response,200,{ok:true});return;}
  if (pathname === "/api/backups/status" && request.method === "GET") {
    const directory = path.join(path.dirname(databaseFile),"backups");
    let names;
    try { names = await fs.promises.readdir(directory); }
    catch (error) { if (error.code !== "ENOENT") throw error; names = []; }
    names = names.filter(name => /^lanwatch-\d{4}-\d{2}-\d{2}\.sqlite$/.test(name)).sort().reverse();
    const latest = names[0] ? path.join(directory,names[0]) : null;
    const stat = latest ? await fs.promises.stat(latest) : null;
    sendJson(response,200,{active:backupActive,error:lastBackupError,count:names.length,directory,
      latestFile:latest,lastSuccessAt:stat?.mtime.toISOString() || null});
    return;
  }
  if (pathname === "/api/settings" && request.method === "GET") {
    sendJson(response, 200, getAppSettings());
    return;
  }
  if (pathname === "/api/settings" && request.method === "PUT") {
    assertLocalTerminalRequest(request);
    const username = validateSshUsername(await readJson(request));
    sendJson(response, 200, updateSshUser(username));
    return;
  }
  if (pathname === "/api/summary" && request.method === "GET") {
    sendJson(response, 200, getSummary());
    return;
  }
  if (pathname === "/api/categories" && request.method === "GET") {
    sendJson(response, 200, getCategories());
    return;
  }
  if (pathname === "/api/locations" && request.method === "GET") {
    sendJson(response, 200, getLocations());
    return;
  }
  if (pathname === "/api/devices/export.csv" && request.method === "GET") {
    response.writeHead(200,{"Content-Type":"text/csv; charset=utf-8","Content-Disposition":"attachment; filename=lanwatch-maszyny.csv","Cache-Control":"no-store"});
    response.end(exportDeviceCsv(getDevices()));return;
  }
  if (["/api/devices/import/preview","/api/devices/import"].includes(pathname) && request.method === "POST") {
    const body = await readJson(request);
    const rows = parseDeviceCsv(body?.csv).map(row => {
      try {
        const data = validateDevice({...row,categoryId:1});
        const category = validateNamedItem({name:row.category},"kategorii");
        data.location = validateNamedItem({name:row.location},"lokalizacji");
        return {...data,category,dependencyHosts:row.dependencyHosts,csvRow:row.csvRow};
      } catch(error){error.message=`Wiersz ${row.csvRow}: ${error.message}`;throw error;}
    });
    sendJson(response,200,importDeviceRows(rows,pathname.endsWith("/preview")));return;
  }
  if (pathname === "/api/devices/bulk" && request.method === "PUT") {
    const body = await readJson(request);
    if (!body || !Array.isArray(body.deviceIds) || !body.deviceIds.length || body.deviceIds.length>500 || body.deviceIds.some(id=>!Number.isSafeInteger(id)||id<1)) throw new HttpError(400,"Zaznacz od 1 do 500 maszyn.");
    const changes = body.changes;
    if (!changes || typeof changes!=="object" || Array.isArray(changes) || !Object.keys(changes).length || Object.keys(changes).some(key=>!["location","categoryId","monitorEnabled"].includes(key))) throw new HttpError(400,"Wybierz prawidłową operację zbiorczą.");
    if (changes.location!==undefined) changes.location=validateNamedItem({name:changes.location},"lokalizacji");
    if (changes.categoryId!==undefined && (!Number.isSafeInteger(changes.categoryId)||changes.categoryId<1)) throw new HttpError(400,"Wybierz prawidłową kategorię.");
    if (changes.monitorEnabled!==undefined && typeof changes.monitorEnabled!=="boolean") throw new HttpError(400,"Nieprawidłowy stan monitorowania.");
    sendJson(response,200,bulkUpdateDevices([...new Set(body.deviceIds)],changes));return;
  }
  if (pathname === "/api/devices" && request.method === "GET") {
    sendJson(response, 200, getDevices());
    return;
  }
  if (pathname === "/api/ping" && request.method === "POST") {
    const body = await readJson(request);
    if (
      !body ||
      typeof body !== "object" ||
      Array.isArray(body) ||
      !Array.isArray(body.deviceIds) ||
      body.deviceIds.length === 0 ||
      body.deviceIds.some((id) => !Number.isSafeInteger(id) || id < 1)
    ) {
      throw new HttpError(400, "Wybierz prawidłowe maszyny do sprawdzenia.");
    }
    const deviceIds = [...new Set(body.deviceIds)];
    sendJson(response, 200, await pingSelectedDevices(deviceIds));
    return;
  }

  if (pathname === "/api/categories" && request.method === "POST") {
    const body = await readJson(request);
    sendJson(response, 201, createCategory(validateNamedItem(body, "kategorii")));
    return;
  }
  if (pathname === "/api/locations" && request.method === "POST") {
    const body = await readJson(request);
    sendJson(response, 201, createLocation(validateNamedItem(body, "lokalizacji")));
    return;
  }

  const categoryMatch = pathname.match(/^\/api\/categories\/(\d+)$/);
  if (categoryMatch && request.method === "PUT") {
    const body = await readJson(request);
    sendJson(response, 200, updateCategory(
      Number(categoryMatch[1]),
      validateNamedItem(body, "kategorii"),
    ));
    return;
  }
  const locationMatch = pathname.match(/^\/api\/locations\/(\d+)$/);
  if (locationMatch && request.method === "PUT") {
    const body = await readJson(request);
    sendJson(response, 200, updateLocation(
      Number(locationMatch[1]),
      validateNamedItem(body, "lokalizacji"),
    ));
    return;
  }
  if (categoryMatch && request.method === "DELETE") {
    deleteCategory(Number(categoryMatch[1]));
    sendJson(response, 200, { ok: true });
    return;
  }
  if (locationMatch && request.method === "DELETE") {
    deleteLocation(Number(locationMatch[1]));
    sendJson(response, 200, { ok: true });
    return;
  }

  if (pathname === "/api/devices" && request.method === "POST") {
    const device = createDevice(validateDevice(await readJson(request)));
    sendJson(response, 201, device);
    return;
  }

  const terminalMatch = pathname.match(/^\/api\/devices\/(\d+)\/terminal\/tunnel$/);
  if (terminalMatch) {
    const deviceId = Number(terminalMatch[1]);
    if (request.method === "POST") {
      assertLocalTerminalRequest(request);
      const device = getTerminalDevice(deviceId);
      sendJson(response, 200, await startVncTunnel(device, getAppSettings().sshUser));
      return;
    }
  }

  const pingMatch = pathname.match(/^\/api\/devices\/(\d+)\/ping$/);
  if (pingMatch && request.method === "POST") {
    const results = await pingDeviceAndDependencies(Number(pingMatch[1]));
    sendJson(response, 200, { results });
    return;
  }

  const monitorMatch = pathname.match(/^\/api\/devices\/(\d+)\/monitor$/);
  if (monitorMatch && request.method === "PUT") {
    const settings = validateMonitorSettings(await readJson(request));
    sendJson(response, 200, updateDeviceMonitor(Number(monitorMatch[1]), settings));
    return;
  }

  const dependenciesMatch = pathname.match(/^\/api\/devices\/(\d+)\/dependencies$/);
  if (dependenciesMatch && request.method === "PUT") {
    const dependencyIds = validateDependencyUpdate(await readJson(request));
    sendJson(
      response,
      200,
      updateDeviceDependencies(Number(dependenciesMatch[1]), dependencyIds),
    );
    return;
  }

  const deviceMatch = pathname.match(/^\/api\/devices\/(\d+)$/);
  if (deviceMatch && request.method === "PUT") {
    const deviceId = Number(deviceMatch[1]);
    const device = updateDevice(deviceId, validateDevice(await readJson(request)));
    sendJson(response, 200, device);
    return;
  }
  if (deviceMatch && request.method === "DELETE") {
    const deviceId = Number(deviceMatch[1]);
    deleteDevice(deviceId);
    sendJson(response, 200, { ok: true });
    return;
  }

  throw new HttpError(404, "Nie znaleziono żądanego zasobu.");
}

const server = http.createServer(async (request, response) => {
  const requestId = /^[A-Za-z0-9-]{1,80}$/.test(request.headers["x-request-id"] || "")
    ? request.headers["x-request-id"] : randomUUID();
  response.setHeader("X-Request-ID",requestId);
  response.setHeader("X-Lanwatch-Version",appVersion);
  const start = performance.now();
  const requestPath = String(request.url || "").split("?")[0].slice(0,300);
  const info = {requestId, method:request.method, url:requestPath};
  const isApi = requestPath.startsWith("/api/") && requestPath !== "/api/client-errors";
  if(isApi) diagnostics.log("info","request.start",info);
  const slowTimer = setTimeout(()=>{
    diagnostics.log("warn","request.waiting",{...info,durationMs:Math.round(performance.now()-start),
      activePings:activePings.size,queuedPings:pingWaiters.length,backupActive});
  },8000);
  response.once("finish",()=>{
    clearTimeout(slowTimer);
    if(isApi) diagnostics.log(response.statusCode>=500?"error":response.statusCode>=400?"warn":"info",
      "request.finish",{...info,status:response.statusCode,durationMs:Math.round(performance.now()-start)});
  });
  response.once("close",()=>{
    clearTimeout(slowTimer);
    if(!response.writableFinished && isApi) diagnostics.log("warn","request.disconnected",info);
  });
  try {
    const url = new URL(request.url, `http://${request.headers.host || "localhost"}`);
    if (url.pathname.startsWith("/api/")) {
      await handleApi(request, response, url.pathname);
      return;
    }

    const asset = staticFiles[url.pathname];
    if (request.method !== "GET" || !asset) {
      throw new HttpError(404, "Nie znaleziono żądanego zasobu.");
    }
    let content = fs.readFileSync(path.join(publicDirectory, asset.file));
    if (asset.file === "index.html") content = content.toString("utf8").replaceAll("{{APP_VERSION}}", appVersion);
    response.writeHead(200, {
      "Content-Type": asset.type,
      "Cache-Control": "no-cache",
    });
    response.end(content);
  } catch (error) {
    diagnostics.log(Number.isInteger(error.status) && error.status < 500 ? "warn" : "error",
      "request.error",{...info,message:error.message,stack:error.stack});
    if (response.headersSent || response.destroyed) return;
    if (error instanceof HttpError || Number.isInteger(error.status)) {
      sendJson(response, error.status, { error: error.message });
      return;
    }
    console.error("Błąd obsługi żądania:", error);
    sendJson(response, 500, { error: "Wystąpił błąd serwera." });
  }
});

server.listen(port, host, () => {
  console.log(`Lanwatch v${appVersion} działa pod adresem http://localhost:${port}`);
  console.log(`Nasłuchuje na interfejsie ${host}.`);
  diagnostics.log("info","server.started",{version:appVersion,port,host,node:process.version,pid:process.pid});
  runBackup();
  backupTimer = setInterval(runBackup, 60 * 60 * 1000);
  monitorTimer = setInterval(pollMonitoredDevices, MONITOR_POLL_INTERVAL_MS);
});

const loopDelay = monitorEventLoopDelay({resolution:100});
loopDelay.enable();
const lagTimer = setInterval(()=>{
  const maxMs = loopDelay.max / 1e6;
  if(maxMs>2000) diagnostics.log("warn","server.event_loop_delayed",{maxMs:Math.round(maxMs),
    activePings:activePings.size,queuedPings:pingWaiters.length,backupActive});
  loopDelay.reset();
},5000);
lagTimer.unref();
process.on("unhandledRejection",error=>{
  diagnostics.log("error","server.unhandled_rejection",{message:String(error?.message || error),stack:error?.stack});
});
process.on("uncaughtExceptionMonitor",error=>{
  diagnostics.log("error","server.uncaught_exception",{message:error.message,stack:error.stack});
});

function shutdown() {
  clearInterval(lagTimer);
  loopDelay.disable();
  clearInterval(monitorTimer);
  clearInterval(backupTimer);
  server.close(async () => { await diagnostics.flush(); process.exit(0); });
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);


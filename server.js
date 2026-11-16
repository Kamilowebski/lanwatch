const fs = require("node:fs");
const http = require("node:http");
const path = require("node:path");
const {
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
} = require("./database");
const { pingLocalTarget } = require("./ping");

const port = Number(process.env.PORT) || 3000;
const host = process.env.HOST || "0.0.0.0";
const publicDirectory = path.join(__dirname, "public");
const staticFiles = {
  "/": { file: "index.html", type: "text/html; charset=utf-8" },
  "/app.js": { file: "app.js", type: "text/javascript; charset=utf-8" },
  "/styles.css": { file: "styles.css", type: "text/css; charset=utf-8" },
};
let pingJobActive = false;

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
      if (body.length > 1024 * 1024) {
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

  const textFields = ["hostName", "ip", "groupName", "location", "description", "lineNumber", "numerator"];
  const device = {};
  for (const field of textFields) {
    const value = input[field] === undefined ? "" : input[field];
    if (typeof value !== "string" || value.length > (field === "description" ? 5000 : 255)) {
      throw new HttpError(400, "Nieprawidłowa wartość jednego z pól maszyny.");
    }
    device[field] = value.trim();
  }

  const categoryId = Number(input.categoryId);
  if (!Number.isSafeInteger(categoryId) || categoryId < 1) {
    throw new HttpError(400, "Wybierz prawidłową kategorię.");
  }
  device.categoryId = categoryId;

  const dependencyIds = input.dependencyIds === undefined ? [] : input.dependencyIds;
  if (
    !Array.isArray(dependencyIds) ||
    dependencyIds.some((id) => !Number.isSafeInteger(Number(id)) || Number(id) < 1)
  ) {
    throw new HttpError(400, "Nieprawidłowa lista zależności.");
  }
  device.dependencyIds = [...new Set(dependencyIds.map(Number))];
  return device;
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

async function pingDeviceAndDependencies(deviceId) {
  const devices = getDevices();
  const devicesById = new Map(devices.map((device) => [device.id, device]));
  const device = devicesById.get(deviceId);
  if (!device) throw new HttpError(404, "Nie znaleziono maszyny.");
  if (pingJobActive) throw new HttpError(409, "Inne sprawdzanie ping jest już w toku.");

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
  pingJobActive = true;
  try {
    const results = [];
    for (const target of targets) {
      const result = await pingLocalTarget(target.ip || target.hostName);
      const checkedResult = {
        ...result,
        deviceId: target.id,
        hostName: target.hostName,
        checkedAt: new Date().toISOString(),
      };
      if (getDevice(target.id)) saveDeviceStatus(target.id, checkedResult);
      results.push(checkedResult);
    }
    return results;
  } finally {
    pingJobActive = false;
  }
}

async function handleApi(request, response, pathname) {
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
  if (pathname === "/api/devices" && request.method === "GET") {
    sendJson(response, 200, getDevices());
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

  const pingMatch = pathname.match(/^\/api\/devices\/(\d+)\/ping$/);
  if (pingMatch && request.method === "POST") {
    const results = await pingDeviceAndDependencies(Number(pingMatch[1]));
    sendJson(response, 200, { results });
    return;
  }

  const deviceMatch = pathname.match(/^\/api\/devices\/(\d+)$/);
  if (deviceMatch && request.method === "PUT") {
    const device = updateDevice(Number(deviceMatch[1]), validateDevice(await readJson(request)));
    sendJson(response, 200, device);
    return;
  }
  if (deviceMatch && request.method === "DELETE") {
    deleteDevice(Number(deviceMatch[1]));
    sendJson(response, 200, { ok: true });
    return;
  }

  throw new HttpError(404, "Nie znaleziono żądanego zasobu.");
}

const server = http.createServer(async (request, response) => {
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
    const content = fs.readFileSync(path.join(publicDirectory, asset.file));
    response.writeHead(200, {
      "Content-Type": asset.type,
      "Cache-Control": "no-cache",
    });
    response.end(content);
  } catch (error) {
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
  console.log(`Lanwatch działa pod adresem http://localhost:${port}`);
  console.log(`Nasłuchuje na interfejsie ${host}.`);
});

function shutdown() {
  server.close(() => process.exit(0));
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

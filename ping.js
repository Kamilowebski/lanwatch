const { spawn } = require("node:child_process");
const dns = require("node:dns").promises;
const net = require("node:net");

const ATTEMPTS = 3;
const REPLY_TIMEOUT_MS = 1000;
const PROCESS_TIMEOUT_MS = 6000;

function isPrivateIPv4(address) {
  const octets = address.split(".").map(Number);
  if (octets.length !== 4 || octets.some((octet) => !Number.isInteger(octet) || octet < 0 || octet > 255)) {
    return false;
  }
  return octets[0] === 10 ||
    (octets[0] === 172 && octets[1] >= 16 && octets[1] <= 31) ||
    (octets[0] === 192 && octets[1] === 168) ||
    (octets[0] === 169 && octets[1] === 254);
}

function isPrivateIPv6(address) {
  const normalized = address.split("%")[0].toLowerCase();
  const mappedIPv4 = normalized.match(/^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/);
  if (mappedIPv4) return isPrivateIPv4(mappedIPv4[1]);
  return /^f[cd]/.test(normalized) || /^fe[89ab]/.test(normalized);
}

function isPrivateAddress(address) {
  const version = net.isIP(address.split("%")[0]);
  if (version === 4) return isPrivateIPv4(address.split("%")[0]);
  if (version === 6) return isPrivateIPv6(address);
  return false;
}

function classifyPingResult(output, exitCode) {
  const replies = [...output.matchAll(/\b(?:ttl|hlim)\s*=\s*\d+/gi)].length;
  const latencyMatch = output.match(/\btime[=<]\s*(\d+(?:[.,]\d+)?)\s*ms\b/i);
  const latencyMs = latencyMatch
    ? Number(latencyMatch[1].replace(",", ".")) * (latencyMatch[0].includes("<") ? 0.5 : 1)
    : null;
  if (replies > 0 || exitCode === 0) {
    return { status: "online", replies: Math.max(replies, 1), latencyMs, message: "" };
  }
  if (exitCode === 1) {
    return { status: "offline", replies: 0, latencyMs: null, message: "Brak odpowiedzi po trzech próbach ICMP." };
  }
  return { status: "unknown", replies: 0, latencyMs: null, message: "Nie udało się ustalić statusu poleceniem ping." };
}

async function resolvePrivateAddress(target) {
  if (!target || typeof target !== "string" || !target.trim()) {
    throw new Error("Brak adresu IP ani nazwy hosta do sprawdzenia.");
  }

  const normalized = target.trim();
  const version = net.isIP(normalized.split("%")[0]);
  if (version) {
    if (isPrivateAddress(normalized)) return normalized;
    throw new Error("Ping jest dozwolony wyłącznie do adresów lokalnych.");
  }

  let addresses;
  try {
    addresses = await dns.lookup(normalized, { all: true, verbatim: true });
  } catch {
    throw new Error("Nie można rozpoznać nazwy hosta w sieci lokalnej.");
  }
  const localAddress = addresses.find(({ address }) => isPrivateAddress(address));
  if (!localAddress) {
    throw new Error("Nazwa hosta nie wskazuje na adres w sieci lokalnej.");
  }
  return localAddress.address;
}

function runSystemPing(address) {
  const isWindows = process.platform === "win32";
  const command = isWindows ? "ping.exe" : "ping";
  const args = isWindows
    ? ["-n", String(ATTEMPTS), "-w", String(REPLY_TIMEOUT_MS), address]
    : process.platform === "darwin"
      ? ["-c", String(ATTEMPTS), "-W", String(REPLY_TIMEOUT_MS), address]
      : ["-c", String(ATTEMPTS), "-W", String(Math.ceil(REPLY_TIMEOUT_MS / 1000)), address];

  return new Promise((resolve) => {
    let output = "";
    let settled = false;
    let timeout;
    const finish = (result) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      resolve({ ...result, target: address, attempts: result.attempts ?? ATTEMPTS });
    };

    let child;
    try {
      child = spawn(command, args, { windowsHide: true });
    } catch {
      finish({ status: "unknown", replies: 0, attempts: 0, message: "Nie udało się uruchomić polecenia ping." });
      return;
    }

    child.stdout.on("data", (chunk) => {
      if (output.length < 32768) output += chunk.toString();
    });
    child.stderr.on("data", (chunk) => {
      if (output.length < 32768) output += chunk.toString();
    });
    child.on("error", () => {
      finish({ status: "unknown", replies: 0, attempts: 0, message: "Nie udało się uruchomić polecenia ping." });
    });
    child.on("close", (code) => {
      finish(classifyPingResult(output, code));
    });

    timeout = setTimeout(() => {
      child.kill();
      finish({ status: "unknown", replies: 0, message: "Przekroczono czas oczekiwania na polecenie ping." });
    }, PROCESS_TIMEOUT_MS);
  });
}

async function pingLocalTarget(target) {
  let address;
  try {
    address = await resolvePrivateAddress(target);
  } catch (error) {
    return {
      status: "unknown",
      replies: 0,
      target: target || "",
      attempts: 0,
      message: error.message,
    };
  }
  return runSystemPing(address);
}

module.exports = {
  ATTEMPTS,
  classifyPingResult,
  isPrivateAddress,
  pingLocalTarget,
  resolvePrivateAddress,
};

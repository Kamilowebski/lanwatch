const { spawn } = require("node:child_process");
const { resolvePrivateAddress } = require("./ping");

const COMMAND_TIMEOUT_MS = 30_000;
const MAX_OUTPUT_LENGTH = 32_768;
const SSH_HOST_KEY_OPTIONS = [
  "-F", "none",
  "-o", "BatchMode=yes",
  "-o", "StrictHostKeyChecking=yes",
  "-o", "ConnectTimeout=10",
  "-o", "ServerAliveInterval=30",
  "-o", "ServerAliveCountMax=3",
];
let activeTunnel = null;
let tunnelStartPending = false;
const activeCommands = new Set();
let lastTunnelState = { status: "stopped", deviceId: null, username: "", message: "" };

function sshExecutable() {
  return process.platform === "win32" ? "ssh.exe" : "ssh";
}

function validateTerminal(device) {
  if (!device || device.category.toLocaleLowerCase("pl") !== "terminal") {
    throw Object.assign(new Error("Funkcje SSH są dostępne tylko dla kategorii Terminal."), { status: 400 });
  }
  if (!/^[A-Za-z0-9_.-]{1,64}$/.test(device.sshUser || "")) {
    throw Object.assign(new Error("Ustaw prawidłową nazwę użytkownika SSH w danych terminala."), { status: 400 });
  }
}

async function getPrivateTarget(device) {
  try {
    return await resolvePrivateAddress(device.ip || device.hostName);
  } catch (error) {
    throw Object.assign(new Error(error.message), { status: 400 });
  }
}

function commonSshArguments(device, target) {
  return [
    ...SSH_HOST_KEY_OPTIONS,
    "-l", device.sshUser,
    target,
  ];
}

function appendOutput(current, chunk) {
  const remaining = MAX_OUTPUT_LENGTH - current.length;
  if (remaining <= 0) return current;
  const text = chunk.toString("utf8");
  return current + text.slice(0, remaining);
}

async function runSshCommand(device, command) {
  validateTerminal(device);
  if (
    typeof command !== "string" ||
    !command.trim() ||
    command.length > 2000 ||
    /[\r\n\0]/.test(command)
  ) {
    throw Object.assign(new Error("Podaj jedno polecenie SSH (maksymalnie 2000 znaków, bez nowych linii)."), { status: 400 });
  }
  if (activeCommands.has(device.id)) {
    throw Object.assign(new Error("Polecenie SSH dla tego terminala jest już wykonywane."), { status: 409 });
  }
  activeCommands.add(device.id);
  try {
    const target = await getPrivateTarget(device);
    const args = [...commonSshArguments(device, target), command.trim()];
    return await new Promise((resolve, reject) => {
      let stdout = "";
      let stderr = "";
      let outputTruncated = false;
      let totalOutputLength = 0;
      let timedOut = false;
      let timeout;
      let child;
      const finish = (error, result) => {
        clearTimeout(timeout);
        if (error) reject(error);
        else resolve(result);
      };

      try {
        child = spawn(sshExecutable(), args, { windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
      } catch (error) {
        finish(Object.assign(new Error(`Nie udało się uruchomić OpenSSH: ${error.message}`), { status: 503 }));
        return;
      }

      child.stdout.on("data", (chunk) => {
        const text = chunk.toString("utf8");
        const remaining = MAX_OUTPUT_LENGTH - totalOutputLength;
        if (text.length > remaining) outputTruncated = true;
        const appended = text.slice(0, Math.max(0, remaining));
        stdout += appended;
        totalOutputLength += appended.length;
      });
      child.stderr.on("data", (chunk) => {
        const text = chunk.toString("utf8");
        const remaining = MAX_OUTPUT_LENGTH - totalOutputLength;
        if (text.length > remaining) outputTruncated = true;
        const appended = text.slice(0, Math.max(0, remaining));
        stderr += appended;
        totalOutputLength += appended.length;
      });
      child.on("error", (error) => {
        finish(Object.assign(new Error(`Nie udało się uruchomić OpenSSH: ${error.message}`), { status: 503 }));
      });
      child.on("close", (exitCode) => {
        finish(null, { exitCode, stdout, stderr, timedOut, outputTruncated });
      });
      timeout = setTimeout(() => {
        timedOut = true;
        child.kill();
      }, COMMAND_TIMEOUT_MS);
    });
  } finally {
    activeCommands.delete(device.id);
  }
}

function publicTunnelState(state) {
  return {
    status: state.status,
    deviceId: state.deviceId,
    username: state.username,
    message: state.message,
    address: state.status === "active" ? "127.0.0.1:5900" : "",
  };
}

async function startVncTunnel(device) {
  validateTerminal(device);
  if (activeTunnel && activeTunnel.child.exitCode === null) {
    if (activeTunnel.deviceId === device.id) return publicTunnelState(activeTunnel);
    throw Object.assign(new Error("Zamknij najpierw aktywny tunel VNC do innego terminala."), { status: 409 });
  }
  if (tunnelStartPending) {
    throw Object.assign(new Error("Uruchamianie tunelu VNC jest już w toku."), { status: 409 });
  }

  tunnelStartPending = true;
  try {
    const target = await getPrivateTarget(device);
    const args = [
      ...SSH_HOST_KEY_OPTIONS,
      "-v",
      "-N",
      "-o", "ExitOnForwardFailure=yes",
      "-L", "127.0.0.1:5900:127.0.0.1:5900",
      ...commonSshArguments(device, target),
    ];
    let child;
    try {
      child = spawn(sshExecutable(), args, { windowsHide: true, stdio: ["ignore", "ignore", "pipe"] });
    } catch (error) {
      throw Object.assign(new Error(`Nie udało się uruchomić OpenSSH: ${error.message}`), { status: 503 });
    }

    const state = {
      child,
      deviceId: device.id,
      username: device.sshUser,
      status: "starting",
      message: "",
    };
    activeTunnel = state;
    lastTunnelState = state;
    tunnelStartPending = false;
    child.stderr.on("data", (chunk) => {
      if (state.status === "active") return;
      state.message = appendOutput(state.message, chunk).slice(-2000);
      if (/Local forwarding listening on 127\.0\.0\.1 port 5900/i.test(state.message)) {
        state.status = "active";
        state.message = "";
      }
    });
    child.on("error", (error) => {
      state.status = "error";
      state.message = `Nie udało się uruchomić OpenSSH: ${error.message}`;
      if (activeTunnel === state) activeTunnel = null;
    });
    child.on("exit", (code, signal) => {
      state.status = code === 0 || signal ? "stopped" : "error";
      if (state.status === "error" && !state.message) {
        state.message = `Połączenie SSH zakończyło się kodem ${code}.`;
      }
      if (activeTunnel === state) activeTunnel = null;
    });
    return publicTunnelState(state);
  } catch (error) {
    tunnelStartPending = false;
    throw error;
  }
}

function getVncTunnelState() {
  return publicTunnelState(activeTunnel || lastTunnelState);
}

function stopVncTunnel(deviceId) {
  if (!activeTunnel || activeTunnel.deviceId !== deviceId) {
    throw Object.assign(new Error("Nie ma aktywnego tunelu VNC dla tego terminala."), { status: 404 });
  }
  activeTunnel.status = "stopping";
  activeTunnel.child.kill();
  return publicTunnelState(activeTunnel);
}

function closeVncTunnel() {
  if (activeTunnel && activeTunnel.child.exitCode === null) {
    activeTunnel.child.kill();
  }
}

module.exports = {
  closeVncTunnel,
  getVncTunnelState,
  runSshCommand,
  startVncTunnel,
  stopVncTunnel,
};

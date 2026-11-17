const { spawn } = require("node:child_process");
const path = require("node:path");
const { resolvePrivateAddress } = require("./ping");

function validateTerminal(device, sshUser) {
  if (!device || device.category.toLocaleLowerCase("pl") !== "terminal") {
    throw Object.assign(new Error("Funkcje SSH są dostępne tylko dla kategorii Terminal."), { status: 400 });
  }
  if (!/^[A-Za-z0-9_.-]{1,64}$/.test(sshUser || "")) {
    throw Object.assign(new Error("Ustaw globalną nazwę użytkownika SSH w Ustawieniach."), { status: 400 });
  }
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,254}$/.test(device.hostName || "")) {
    throw Object.assign(new Error("Nazwa hosta nie może być użyta jako cel połączenia SSH."), { status: 400 });
  }
}

function quotePowerShell(value) {
  return `'${String(value).replace(/'/g, "''")}'`;
}

async function validateLocalSshHost(hostName) {
  try {
    await resolvePrivateAddress(hostName);
  } catch (error) {
    throw Object.assign(
      new Error(`Nazwa hosta SSH musi wskazywać na adres lokalny: ${error.message}`),
      { status: 400 },
    );
  }
}

function vncTunnelArguments(device, sshUser) {
  return ["-L", "5900:localhost:5900", `${sshUser}@${device.hostName}`];
}

function powerShellScript(args) {
  if (
    !Array.isArray(args) ||
    args.length !== 3 ||
    args[0] !== "-L" ||
    args[1] !== "5900:localhost:5900" ||
    !/^[A-Za-z0-9_.-]{1,64}@[A-Za-z0-9][A-Za-z0-9._-]{0,254}$/.test(args[2])
  ) {
    throw Object.assign(new Error("Nieprawidłowe argumenty tunelu SSH."), { status: 400 });
  }
  const command = `ssh ${args.join(" ")}`;
  return [
    `Write-Host ${quotePowerShell(command)}`,
    command,
    "$sshExitCode = $LASTEXITCODE",
    "if ($sshExitCode -ne 0) {",
    "    Write-Host ('SSH zakończył się kodem ' + $sshExitCode)",
    "    Read-Host 'Naciśnij Enter, aby zamknąć okno' | Out-Null",
    "}",
  ].join("\r\n");
}

function powerShellExecutable() {
  const windowsDirectory = process.env.SystemRoot || process.env.WINDIR;
  if (!windowsDirectory) {
    throw Object.assign(new Error("Nie można ustalić lokalizacji Windows PowerShell."), { status: 503 });
  }
  return path.join(windowsDirectory, "System32", "WindowsPowerShell", "v1.0", "powershell.exe");
}

function powerShellLauncherScript(script, executable) {
  const encodedScript = Buffer.from(script, "utf16le").toString("base64");
  return [
    "$ErrorActionPreference = 'Stop'",
    `$windowArguments = @('-NoLogo', '-NoProfile', '-NoExit', '-EncodedCommand', '${encodedScript}')`,
    "try {",
    `    Start-Process -FilePath ${quotePowerShell(executable)} -ArgumentList $windowArguments -WindowStyle Normal -ErrorAction Stop | Out-Null`,
    "    exit 0",
    "} catch {",
    "    [Console]::Error.WriteLine($_.Exception.Message)",
    "    exit 1",
    "}",
  ].join("\r\n");
}

function launchPowerShellWindow(script) {
  const executable = powerShellExecutable();
  const launcherScript = powerShellLauncherScript(script, executable);
  return new Promise((resolve, reject) => {
    let child;
    let stderr = "";
    try {
      child = spawn(
        executable,
        ["-NoLogo", "-NoProfile", "-Command", launcherScript],
        { stdio: ["ignore", "ignore", "pipe"], windowsHide: true, timeout: 10000 },
      );
    } catch (error) {
      reject(Object.assign(new Error(`Nie udało się otworzyć PowerShell: ${error.message}`), { status: 503 }));
      return;
    }

    child.stderr.on("data", (chunk) => {
      if (stderr.length < 2048) stderr += chunk.toString("utf8").slice(0, 2048 - stderr.length);
    });
    child.once("error", (error) => {
      reject(Object.assign(new Error(`Nie udało się otworzyć PowerShell: ${error.message}`), { status: 503 }));
    });
    child.once("close", (code) => {
      if (code === 0) {
        resolve();
        return;
      }
      reject(Object.assign(
        new Error(
          stderr.trim() ||
          `PowerShell nie otworzył okna z tunelem (kod ${code === null ? "brak" : code}).`,
        ),
        { status: 503 },
      ));
    });
  });
}

async function startVncTunnel(device, sshUser) {
  validateTerminal(device, sshUser);
  await validateLocalSshHost(device.hostName);
  if (process.platform !== "win32") {
    throw Object.assign(new Error("Otwieranie tunelu w PowerShell jest dostępne tylko w systemie Windows."), { status: 501 });
  }

  const args = vncTunnelArguments(device, sshUser);
  await launchPowerShellWindow(powerShellScript(args));
  return { launched: true };
}

module.exports = {
  powerShellLauncherScript,
  powerShellScript,
  startVncTunnel,
  vncTunnelArguments,
};


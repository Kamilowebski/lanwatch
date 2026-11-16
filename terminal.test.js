const assert = require("node:assert/strict");
const test = require("node:test");
const {
  powerShellLauncherScript,
  powerShellScript,
  startVncTunnel,
  vncTunnelArguments,
} = require("./terminal");

const terminal = {
  id: 1,
  category: "Terminal",
  hostName: "terminal-test",
  ip: "8.8.8.8",
};

test("builds the requested PowerShell tunnel command", () => {
  const tunnelArguments = vncTunnelArguments(
    { ...terminal, hostName: "T104-0173" },
    "StarachowiceSWRBis",
  );
  assert.deepEqual(tunnelArguments, [
    "-L",
    "5900:localhost:5900",
    "StarachowiceSWRBis@T104-0173",
  ]);

  const script = powerShellScript(tunnelArguments);
  assert.ok(script.includes("Write-Host 'ssh -L 5900:localhost:5900 StarachowiceSWRBis@T104-0173'"));
  assert.equal(
    script.split(/\r?\n/)[1],
    "ssh -L 5900:localhost:5900 StarachowiceSWRBis@T104-0173",
  );
});

test("refuses PowerShell tunnels to non-local addresses", async () => {
  await assert.rejects(
    startVncTunnel({ ...terminal, hostName: "8.8.8.8" }, "lanadmin"),
    { status: 400, message: /musi wskazywać na adres lokalny/ },
  );
});

test("rejects unsafe SSH usernames and hostnames before launching PowerShell", async () => {
  await assert.rejects(
    startVncTunnel({ ...terminal, ip: "192.168.1.20" }, "admin;id"),
    { status: 400, message: /Ustaw globalną nazwę użytkownika SSH w Ustawieniach/ },
  );
  await assert.rejects(
    startVncTunnel(
      { ...terminal, ip: "192.168.1.20", hostName: "host;malicious" },
      "lanadmin",
    ),
    { status: 400, message: /Nazwa hosta nie może być użyta/ },
  );
});

test("rejects unsafe values in the PowerShell SSH command", () => {
  assert.throws(
    () => powerShellScript(["-L", "5900:localhost:5900", "host;malicious"]),
    { status: 400, message: /Nieprawidłowe argumenty tunelu SSH/ },
  );
});

test("launches the tunnel script in a separate visible PowerShell window", () => {
  const script = powerShellScript(vncTunnelArguments(
    { ...terminal, hostName: "T104-0173" },
    "StarachowiceSWRBis",
  ));
  const launcher = powerShellLauncherScript(
    script,
    "C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe",
  );
  const encodedScript = launcher.match(/-EncodedCommand', '([^']+)'/)[1];

  assert.ok(launcher.includes("Start-Process"));
  assert.ok(launcher.includes("-WindowStyle Normal"));
  assert.equal(Buffer.from(encodedScript, "base64").toString("utf16le"), script);
});

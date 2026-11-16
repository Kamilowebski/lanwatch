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
    "192.168.10.17",
    "StarachowiceSWRBis",
  );
  const forwardIndex = tunnelArguments.indexOf("-L");
  assert.equal(tunnelArguments[forwardIndex + 1], "5900:localhost:5900");
  assert.ok(tunnelArguments.includes("StarachowiceSWRBis@T104-0173"));

  const script = powerShellScript(tunnelArguments);
  assert.ok(script.includes("ssh -L 5900:localhost:5900"));
  assert.ok(script.includes("'StarachowiceSWRBis@T104-0173'"));
});

test("refuses PowerShell tunnels to non-local addresses", async () => {
  await assert.rejects(
    startVncTunnel(terminal, "lanadmin"),
    { status: 400, message: /wyłącznie do adresów lokalnych/ },
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

test("escapes string arguments in the PowerShell script", () => {
  const script = powerShellScript(["-L", "5900:localhost:5900", "host'name"]);
  assert.ok(script.includes("'host''name'"));
});

test("launches the tunnel script in a separate visible PowerShell window", () => {
  const script = powerShellScript(vncTunnelArguments(
    { ...terminal, hostName: "T104-0173" },
    "192.168.10.17",
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

const assert = require("node:assert/strict");
const test = require("node:test");
const { runSshCommand, startVncTunnel } = require("./terminal");

const terminal = {
  id: 1,
  category: "Terminal",
  hostName: "terminal-test",
  ip: "8.8.8.8",
  sshUser: "lanadmin",
};

test("refuses SSH commands and VNC tunnels to non-local addresses", async () => {
  await assert.rejects(
    runSshCommand(terminal, "whoami"),
    { status: 400, message: /wyłącznie do adresów lokalnych/ },
  );
  await assert.rejects(
    startVncTunnel(terminal),
    { status: 400, message: /wyłącznie do adresów lokalnych/ },
  );
});

test("rejects malformed or oversized SSH commands before starting a process", async () => {
  await assert.rejects(
    runSshCommand({ ...terminal, ip: "192.168.1.20" }, "whoami\nhostname"),
    { status: 400, message: /bez nowych linii/ },
  );
  await assert.rejects(
    runSshCommand({ ...terminal, ip: "192.168.1.20" }, "x".repeat(2001)),
    { status: 400, message: /maksymalnie 2000 znaków/ },
  );
});

test("rejects terminals without a configured safe SSH username", async () => {
  await assert.rejects(
    runSshCommand({ ...terminal, sshUser: "admin;id" }, "whoami"),
    { status: 400, message: /Ustaw prawidłową nazwę użytkownika SSH/ },
  );
});

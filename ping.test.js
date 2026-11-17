const assert = require("node:assert/strict");
const test = require("node:test");
const { classifyPingResult, isPrivateAddress, pingLocalTarget } = require("./ping");

test("accepts private and link-local network addresses only", () => {
  for (const address of ["10.0.0.1", "172.20.1.2", "192.168.1.5", "169.254.10.2", "fd12::1", "fe80::1"]) {
    assert.equal(isPrivateAddress(address), true, `${address} should be local`);
  }
  for (const address of ["8.8.8.8", "172.32.0.1", "192.0.2.1", "127.0.0.1", "::1", "2001:4860:4860::8888"]) {
    assert.equal(isPrivateAddress(address), false, `${address} should not be probed`);
  }
});

test("refuses a public target without sending ICMP", async () => {
  const result = await pingLocalTarget("8.8.8.8");
  assert.equal(result.status, "unknown");
  assert.equal(result.attempts, 0);
  assert.match(result.message, /wyłącznie do adresów lokalnych/);
});

test("one reply is enough to avoid a false offline status", () => {
  const result = classifyPingResult("Reply from 192.168.1.5: bytes=32 time<1ms TTL=64", 1);
  assert.equal(result.status, "online");
  assert.equal(result.replies, 1);
  assert.equal(result.latencyMs, 0.5);
});

test("records the measured latency from a ping reply", () => {
  const result = classifyPingResult("Reply from 192.168.1.5: bytes=32 time=12.4ms TTL=64", 0);
  assert.equal(result.status, "online");
  assert.equal(result.latencyMs, 12.4);
});

test("marks a completed ping with no replies as offline", () => {
  const result = classifyPingResult("Request timed out.", 1);
  assert.equal(result.status, "offline");
  assert.equal(result.replies, 0);
});

test("keeps command failures unknown rather than reporting the device offline", () => {
  assert.equal(classifyPingResult("ping failed", 2).status, "unknown");
});


test("does not treat Windows unreachable with exit zero as an echo reply", () => {
  const result = classifyPingResult("Reply from 192.168.1.1: Destination host unreachable.", 0);
  assert.equal(result.status, "offline");
  assert.equal(result.replies, 0);
});

test("reads Polish Windows latency and IPv6 replies", () => {
  assert.equal(classifyPingResult("Odpowiedź z 192.168.1.5: bajtów=32 czas=12ms TTL=64", 0).latencyMs, 12);
  const result = classifyPingResult("Reply from fd12::1: time=2ms", 0);
  assert.equal(result.status, "online");
  assert.equal(result.replies, 1);
});

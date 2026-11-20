"use strict";
// End-to-end smoke test: starts the server, connects two clients, checks sync + concurrent-edit merge + persistence.
const { spawn } = require("child_process"), WebSocket = require("ws"), fs = require("fs"), os = require("os"), path = require("path"), assert = require("assert");
const PORT = 3111, DATA = fs.mkdtempSync(path.join(os.tmpdir(), "cn-"));
const start = () => new Promise((res) => { const p = spawn("node", ["server.js"], { env: { ...process.env, PORT, DATA_DIR: DATA }, stdio: ["ignore", "pipe", "inherit"] }); p.stdout.on("data", (d) => /running/.test(d) && res(p)); });
function client(room) {
  return new Promise((res) => {
    const ws = new WebSocket(`ws://localhost:${PORT}/ws?room=${room}`), c = { ws, msgs: [], text: "", rev: 0 };
    ws.on("message", (d) => { const m = JSON.parse(d); c.msgs.push(m); if (m.type === "init" || m.type === "text") { c.text = m.text; c.rev = m.rev; c.id = c.id || m.you; } if (m.type === "init") res(c); });
    c.set = (text, baseRev, sid) => ws.send(JSON.stringify({ type: "set", text, baseRev, sid }));
  });
}
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
(async () => {
  let srv = await start();
  const a = await client("test-room"), b = await client("test-room");
  a.set("hello world", 0, "a1"); await wait(150);
  assert.strictEqual(b.text, "hello world", "B receives A's edit");
  // concurrent edits from the same base revision (rev 1): A prepends, B appends
  a.set(">> hello world", 1, "a2"); b.set("hello world <<", 1, "b2"); await wait(250);
  assert.strictEqual(a.text, b.text, "clients converge");
  assert.ok(a.text.includes(">>") && a.text.includes("<<"), "both concurrent edits survive: " + a.text);
  const final = a.text; await wait(1300);
  srv.kill("SIGTERM"); await wait(300);
  srv = await start();
  const c = await client("test-room");
  assert.strictEqual(c.text, final, "text survives a server restart");
  const other = await client("other-room"); assert.strictEqual(other.text, "", "rooms are isolated");
  srv.kill(); console.log("OK — sync, merge, persistence and room isolation verified"); process.exit(0);
})().catch((e) => { console.error("FAIL:", e.message); process.exit(1); });

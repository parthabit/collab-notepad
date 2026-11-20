"use strict";
const http = require("http"), fs = require("fs"), path = require("path"), crypto = require("crypto");
const { WebSocketServer } = require("ws");
const Merge = require("./public/merge.js");

const PORT = +process.env.PORT || 3000;
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, "data");
const FILE = path.join(DATA_DIR, "rooms.json");
const PUB = path.join(__dirname, "public");
const MAX_LEN = 100000, MAX_CLIENTS = 50, HIST = 40;
const MIME = { ".html": "text/html; charset=utf-8", ".css": "text/css; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".svg": "image/svg+xml" };
const CSP = "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; img-src 'self' data:; connect-src 'self' ws: wss:";

/* ---------- persistence (JSON file, atomic writes) ---------- */
let stored = {}, dirty = false;
try { stored = JSON.parse(fs.readFileSync(FILE, "utf8")); } catch (e) { /* first run */ }
function persist() {
  if (!dirty) return; dirty = false;
  try {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    fs.writeFileSync(FILE + ".tmp", JSON.stringify(stored));
    fs.renameSync(FILE + ".tmp", FILE);
  } catch (e) { console.error("persist failed:", e.message); dirty = true; }
}
setInterval(persist, 1000).unref();

/* ---------- rooms ---------- */
const rooms = new Map();
const clean = (s) => String(s || "").toLowerCase().replace(/[^a-z0-9_-]/g, "").slice(0, 40);
function getRoom(id) {
  let r = rooms.get(id);
  if (!r) {
    const text = (stored[id] && stored[id].text) || "";
    r = { id, text, rev: 0, hist: new Map([[0, text]]), clients: new Set() };
    rooms.set(id, r);
  }
  return r;
}
const send = (ws, m) => { if (ws.readyState === 1) ws.send(JSON.stringify(m)); };
const broadcast = (room, m) => { const s = JSON.stringify(m); room.clients.forEach((c) => c.ws.readyState === 1 && c.ws.send(s)); };
const peersOf = (room) => [...room.clients].map((c) => ({ id: c.id, name: c.name, color: c.color, typing: c.typing }));

function applySet(room, c, m) {
  let next;
  if (m.baseRev === room.rev) next = m.text;
  else {
    const B = room.hist.get(m.baseRev);
    next = B === undefined ? m.text : Merge.merge(B, m.text, room.text).text; // 3-way merge
  }
  next = next.slice(0, MAX_LEN);
  if (next !== room.text) {
    room.text = next; room.rev++;
    room.hist.set(room.rev, next);
    room.hist.delete(room.rev - HIST);
    if (next) stored[room.id] = { text: next, updatedAt: Date.now() }; else delete stored[room.id];
    dirty = true;
  }
  broadcast(room, { type: "text", text: room.text, rev: room.rev, sid: m.sid, from: c.id });
}

/* ---------- HTTP (static) + WebSocket ---------- */
const server = http.createServer((req, res) => {
  let p;
  try { p = decodeURIComponent(new URL(req.url, "http://x").pathname); } catch (e) { res.writeHead(400).end(); return; }
  if (p === "/healthz") { res.end("ok"); return; }
  if (p === "/") p = "/index.html";
  const f = path.normalize(path.join(PUB, p));
  if (!f.startsWith(PUB + path.sep)) { res.writeHead(403).end(); return; }
  fs.readFile(f, (err, buf) => {
    if (err) { res.writeHead(404, { "Content-Type": "text/plain" }).end("Not found"); return; }
    res.writeHead(200, { "Content-Type": MIME[path.extname(f)] || "application/octet-stream", "Cache-Control": "no-cache", "X-Content-Type-Options": "nosniff", "Content-Security-Policy": CSP });
    res.end(buf);
  });
});

const wss = new WebSocketServer({ server, path: "/ws", maxPayload: 300 * 1024 });
wss.on("connection", (ws, req) => {
  const id = clean(new URL(req.url, "http://x").searchParams.get("room"));
  if (id.length < 3) { ws.close(1008, "bad room"); return; }
  const room = getRoom(id);
  if (room.clients.size >= MAX_CLIENTS) { ws.close(1013, "room full"); return; }
  const c = { ws, id: crypto.randomBytes(4).toString("hex"), name: "Guest", color: "#5b5ef0", typing: false, alive: true };
  room.clients.add(c);
  send(ws, { type: "init", you: c.id, text: room.text, rev: room.rev });
  broadcast(room, { type: "peers", peers: peersOf(room) });

  ws.on("pong", () => { c.alive = true; });
  ws.on("message", (raw) => {
    let m; try { m = JSON.parse(raw); } catch (e) { return; }
    if (!m || typeof m !== "object") return;
    if (m.type === "hello") {
      c.name = String(m.name || "Guest").slice(0, 24) || "Guest";
      if (/^#[0-9a-f]{6}$/i.test(m.color)) c.color = m.color;
      broadcast(room, { type: "peers", peers: peersOf(room) });
    } else if (m.type === "presence") {
      c.typing = !!m.typing; broadcast(room, { type: "peers", peers: peersOf(room) });
    } else if (m.type === "set" && typeof m.text === "string" && m.text.length <= MAX_LEN && Number.isInteger(m.baseRev)) {
      applySet(room, c, m);
    }
  });
  ws.on("close", () => {
    room.clients.delete(c);
    if (!room.clients.size) rooms.delete(room.id); else broadcast(room, { type: "peers", peers: peersOf(room) });
  });
});
const hb = setInterval(() => {
  rooms.forEach((r) => r.clients.forEach((c) => { if (!c.alive) return c.ws.terminate(); c.alive = false; c.ws.ping(); }));
}, 30000); hb.unref();

process.on("SIGTERM", () => { persist(); process.exit(0); });
process.on("SIGINT", () => { persist(); process.exit(0); });
server.listen(PORT, () => console.log("Collab Notepad running on http://localhost:" + PORT));

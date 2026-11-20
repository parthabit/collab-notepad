# 📝 Collab Notepad

A real-time collaborative text editor. Open a room, share the link, and everyone types in the same note live.

**Features:** unique rooms · live sync over WebSockets · presence (avatars, "is typing") · shareable room links · conflict-safe merging · persistence across restarts · saved-notes library · `.txt` download · light/dark mode · responsive UI.

## Run locally
```bash
npm install
npm start          # http://localhost:3000
npm test           # end-to-end smoke test (sync, merge, persistence, room isolation)
```
Open the page in two tabs (or send the link to a friend on the same network) and type.

## How it works
- `server.js` – plain Node `http` server (static files + `/healthz`) and a `ws` WebSocket endpoint at `/ws?room=<id>`.
- **Rooms:** one document per room id. The room code lives in the URL hash (`/#abcd-1234`), so a link opens that room.
- **Sync:** the client sends its full text with the revision it last saw. If the server has moved on, it does a **three-way merge** (`public/merge.js`: single-splice diff and rebase) against the stored base revision, so concurrent edits are both kept. The merged text is broadcast to everyone, and clients remap the caret so typing never jumps.
- **Presence:** names, colors and typing state are held in memory per room, never stored.
- **Persistence:** rooms are written to `DATA_DIR/rooms.json` (atomic write, about once a second), so notes survive restarts.
- **Hardening:** room-id validation, 100k-character cap, 300 KB message cap, 50 users per room, heartbeat to drop dead sockets, CSP header.
- **Saved notes:** stored in the browser's `localStorage` (private to that browser).

## Deploy
The app needs a host that supports long-lived WebSocket connections and (for persistence) a disk.

- **Render / Railway / Fly.io:** create a Node web service from this repo. Build: `npm install`. Start: `npm start`. They set `PORT` for you. For persistence, attach a disk and set `DATA_DIR` to its mount path (for example `/data`). Without a disk, notes reset on redeploy.
- **Docker:** `docker build -t collab-notepad . && docker run -p 3000:3000 -v notepad-data:/data collab-notepad`
- **VPS:** `npm ci --omit=dev && PORT=3000 node server.js` behind nginx or Caddy (enable WebSocket upgrade on `/ws`) or under `pm2`.

> Static-only hosts (GitHub Pages, Netlify drop, Vercel static) can't run this, because the WebSocket server is required.

## Environment variables
| Name | Default | Purpose |
|---|---|---|
| `PORT` | `3000` | HTTP/WebSocket port |
| `DATA_DIR` | `./data` | Where `rooms.json` is written |

## Known limits / next steps
Rooms are public to anyone who has the code (no auth). Merging handles one contiguous change per sync; a CRDT (for example Yjs) would give finer-grained merging, remote cursors and offline editing. Persistence uses a JSON file, so a database (SQLite/Redis) would suit multiple server instances.

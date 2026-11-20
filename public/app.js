(function () {
  "use strict";
  var $ = function (i) { return document.getElementById(i); };
  var ta = $("ta");
  var ws = null, gen = 0, retry = 0, retryTimer = null, saveTimer = null, typingTimer = null;
  var roomId = "", you = null, base = "", rev = 0, sent = "", inflight = null, sidN = 0, ready = false;
  var COLORS = ["#5b5ef0", "#e0457b", "#0ea5a4", "#e08a1e", "#7c4dff", "#2f9e5b", "#d6455d", "#3b82f6"];

  /* ---------- helpers ---------- */
  function store(k, v) { try { if (v === undefined) return localStorage.getItem(k); localStorage.setItem(k, v); } catch (e) { return null; } }
  function toast(m) { var t = $("toast"); t.textContent = m; t.className = "show"; clearTimeout(toast.t); toast.t = setTimeout(function () { t.className = ""; }, 1800); }
  function status(txt, cls) { $("status").textContent = txt; $("dot").className = "dot " + (cls || ""); }
  function clean(s) { return (s || "").toLowerCase().replace(/[^a-z0-9_-]/g, "").slice(0, 40); }
  function genId() { var c = "abcdefghjkmnpqrstuvwxyz23456789", s = ""; for (var i = 0; i < 8; i++) s += c[Math.floor(Math.random() * c.length)]; return s.slice(0, 4) + "-" + s.slice(4); }
  function link(id) { return location.origin + location.pathname + "#" + id; }
  function words(t) { t = t.trim(); return t ? t.split(/\s+/).length : 0; }
  function counts() { $("count").textContent = words(ta.value) + " words · " + ta.value.length + " chars"; }
  function title(t) { var l = t.split("\n").filter(function (x) { return x.trim(); })[0] || "Untitled note"; return l.trim().slice(0, 60); }
  function fmt(ts) { try { return new Date(ts).toLocaleString([], { dateStyle: "medium", timeStyle: "short" }); } catch (e) { return ""; } }

  var me = { name: store("cn-name") || "Guest-" + (100 + Math.floor(Math.random() * 900)), color: store("cn-color") || COLORS[Math.floor(Math.random() * COLORS.length)] };
  store("cn-color", me.color);
  $("name").value = me.name;
  $("name").addEventListener("change", function () {
    me.name = $("name").value.trim().slice(0, 24) || "Guest"; $("name").value = me.name; store("cn-name", me.name);
    wsSend({ type: "hello", name: me.name, color: me.color });
  });

  /* ---------- theme ---------- */
  var SUN = '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/></svg>';
  var MOON = '<svg viewBox="0 0 24 24"><path d="M21 12.8A9 9 0 1111.2 3a7 7 0 009.8 9.8z"/></svg>';
  function effTheme() { return document.documentElement.getAttribute("data-theme") || (matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light"); }
  function paintTheme() { $("theme").innerHTML = effTheme() === "dark" ? SUN : MOON; }
  paintTheme();
  $("theme").onclick = function () { var n = effTheme() === "dark" ? "light" : "dark"; document.documentElement.setAttribute("data-theme", n); store("cn-theme", n); paintTheme(); };

  /* ---------- realtime sync ---------- */
  function wsSend(m) { if (ws && ws.readyState === 1) ws.send(JSON.stringify(m)); }

  function setText(out, s, e) {
    ta.value = out.text;
    try { ta.setSelectionRange(out.caret(s), out.caret(e)); } catch (x) {}
    counts();
  }
  function applyRemote(R, r) {
    if (R === base) { rev = r; return; }
    var L = ta.value, s = ta.selectionStart, e = ta.selectionEnd, out;
    if (L === base) { var rp = Merge.splice(base, R); out = { text: R, caret: function (p) { return Merge.mapPos(p, rp); } }; }
    else out = Merge.merge(base, L, R);
    base = R; rev = r;
    setText(out, s, e);
    if (ta.value !== base) schedule(); else status("Synced", "ok");
  }
  function handle(m) {
    if (m.type === "init") {
      you = m.you; ready = true; ta.readOnly = false;
      applyRemote(m.text, m.rev); rev = m.rev; counts();
      if (ta.value !== base) schedule(); else status("Synced", "ok");
    } else if (m.type === "text") {
      if (inflight) {
        if (m.sid !== inflight || m.from !== you) return;      // our result will include these changes
        var L = ta.value, s = ta.selectionStart, e = ta.selectionEnd;
        var out = Merge.merge(sent, L, m.text);
        inflight = null; base = m.text; rev = m.rev;
        setText(out, s, e);
        if (ta.value !== base) schedule(); else status("Synced", "ok");
      } else if (m.rev > rev) applyRemote(m.text, m.rev);
    } else if (m.type === "peers") renderPeers(m.peers);
  }
  function schedule() { status("Saving…", "warn"); clearTimeout(saveTimer); saveTimer = setTimeout(flush, 200); }
  function flush() {
    if (!ready || inflight) return;
    var L = ta.value;
    if (L === base) { status("Synced", "ok"); return; }
    sent = L; var sid = (inflight = "s" + (++sidN) + "-" + Math.random().toString(36).slice(2, 7));
    wsSend({ type: "set", text: L, baseRev: rev, sid: sid });
    setTimeout(function () { if (inflight === sid && ws) ws.close(); }, 8000);   // no ack: reconnect
  }
  ta.addEventListener("input", function () {
    counts(); schedule();
    wsSend({ type: "presence", typing: true });
    clearTimeout(typingTimer); typingTimer = setTimeout(function () { wsSend({ type: "presence", typing: false }); }, 1500);
  });

  function connect() {
    var g = gen; ready = false; inflight = null; status("Connecting…");
    ws = new WebSocket((location.protocol === "https:" ? "wss://" : "ws://") + location.host + "/ws?room=" + encodeURIComponent(roomId));
    var mine = ws;
    ws.onopen = function () { retry = 0; wsSend({ type: "hello", name: me.name, color: me.color }); };
    ws.onmessage = function (ev) { if (g !== gen || mine !== ws) return; var m; try { m = JSON.parse(ev.data); } catch (x) { return; } handle(m); };
    ws.onclose = function () {
      if (g !== gen || mine !== ws) return;
      ready = false; inflight = null; renderPeers([]); status("Offline — reconnecting…", "err");
      retryTimer = setTimeout(connect, Math.min(1000 * Math.pow(2, retry++), 8000));
    };
  }
  function enter(id) {
    gen++; clearTimeout(retryTimer); clearTimeout(saveTimer);
    if (ws) { ws.onclose = null; try { ws.close(); } catch (e) {} }
    roomId = id; base = ""; rev = 0; inflight = null; ready = false; retry = 0;
    ta.value = ""; ta.readOnly = true; counts(); renderPeers([]);
    $("code").textContent = id; $("link").value = link(id);
    try { history.replaceState(null, "", "#" + id); } catch (e) {}
    connect();
  }

  /* ---------- presence UI ---------- */
  function renderPeers(list) {
    var box = $("peers"); box.textContent = "";
    list.slice(0, 8).forEach(function (p) {
      var el = document.createElement("div");
      el.className = "av" + (p.id === you ? " me" : ""); el.style.background = p.color || "#888";
      el.title = p.name + (p.id === you ? " (you)" : ""); el.textContent = (p.name[0] || "?").toUpperCase(); box.appendChild(el);
    });
    if (list.length > 8) { var m = document.createElement("div"); m.className = "av"; m.style.background = "#667"; m.textContent = "+" + (list.length - 8); box.appendChild(m); }
    var t = list.filter(function (p) { return p.id !== you && p.typing; }).map(function (p) { return p.name; });
    $("typing").textContent = t.length ? t.slice(0, 2).join(", ") + " typing…" : "";
  }

  /* ---------- rooms / sharing ---------- */
  function go(id) { id = clean(id); if (id.length < 3) { toast("Enter a valid room code"); return; } enter(id); }
  function parseRoom(s) { s = (s || "").trim(); var i = s.lastIndexOf("#"); if (i >= 0) s = s.slice(i + 1); return clean(s); }
  $("new").onclick = function () { go(genId()); };
  $("go").onclick = function () { var v = parseRoom($("join").value); $("join").value = ""; go(v); };
  $("join").addEventListener("keydown", function (e) { if (e.key === "Enter") $("go").click(); });
  $("copy").onclick = function () {
    function fb() { $("link").select(); var ok = false; try { ok = document.execCommand("copy"); } catch (e) {} toast(ok ? "Link copied" : "Press Ctrl/Cmd+C to copy"); }
    if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText($("link").value).then(function () { toast("Link copied"); }, fb); else fb();
  };
  window.addEventListener("hashchange", function () { var h = clean(location.hash.slice(1)); if (h.length >= 3 && h !== roomId) enter(h); });

  /* ---------- saved notes (this browser) + download ---------- */
  var armed = {};
  function notes() { try { return JSON.parse(store("cn-notes") || "[]"); } catch (e) { return []; } }
  function putNotes(a) { store("cn-notes", JSON.stringify(a.slice(0, 100))); }
  function download(name, text) {
    var f = (name || "note").replace(/[^\w -]+/g, "").trim().replace(/\s+/g, "-").slice(0, 50) || "note";
    var a = document.createElement("a"), url = URL.createObjectURL(new Blob([text], { type: "text/plain" }));
    a.href = url; a.download = f + ".txt"; document.body.appendChild(a); a.click(); a.remove();
    setTimeout(function () { URL.revokeObjectURL(url); }, 1000); toast("Download ready");
  }
  function saveNote() {
    var t = ta.value; if (!t.trim()) { toast("Nothing to save yet"); return; }
    var a = notes(); a.unshift({ id: "n" + Date.now().toString(36), title: title(t), text: t, room: roomId, savedAt: Date.now() });
    putNotes(a); renderLib(); toast("Saved to My notes");
  }
  function arm(btn, key, label, fn) {
    btn.onclick = function () {
      if (armed[key]) { clearTimeout(armed[key]); delete armed[key]; btn.textContent = label; fn(); return; }
      btn.textContent = "Sure?"; armed[key] = setTimeout(function () { delete armed[key]; btn.textContent = label; }, 2500);
    };
  }
  function renderLib() {
    var box = $("dlist"), list = notes(); box.textContent = "";
    if (!list.length) { var e = document.createElement("div"); e.className = "empty"; e.textContent = "No saved notes yet. Press Save note to keep a copy in this browser."; box.appendChild(e); return; }
    list.forEach(function (n) {
      var el = document.createElement("div"); el.className = "note";
      var b = document.createElement("b"); b.textContent = n.title || "Untitled note";
      var sm = document.createElement("small"); sm.textContent = fmt(n.savedAt) + " · " + words(n.text || "") + " words · room " + (n.room || "—");
      var a = document.createElement("div"); a.className = "acts";
      var r = document.createElement("button"), o = document.createElement("button"), x = document.createElement("button");
      r.textContent = "Restore"; o.textContent = "Download"; x.textContent = "Delete"; x.className = "danger";
      arm(r, "r" + n.id, "Restore", function () { ta.value = n.text || ""; counts(); schedule(); closeP(); toast("Restored into this room"); });
      o.onclick = function () { download(n.title, n.text || ""); };
      arm(x, "x" + n.id, "Delete", function () { putNotes(notes().filter(function (k) { return k.id !== n.id; })); renderLib(); });
      a.appendChild(r); a.appendChild(o); a.appendChild(x); el.appendChild(b); el.appendChild(sm); el.appendChild(a); box.appendChild(el);
    });
  }
  function openP(el) { el.classList.add("open"); $("scrim").classList.add("open"); }
  function closeP() { ["drawer", "about"].forEach(function (i) { $(i).classList.remove("open"); }); $("scrim").classList.remove("open"); }
  $("lib").onclick = function () { renderLib(); openP($("drawer")); };
  $("dclose").onclick = closeP; $("scrim").onclick = closeP; $("aclose").onclick = closeP;
  $("aboutBtn").onclick = function () { openP($("about")); };
  $("save").onclick = saveNote;
  $("dlcur").onclick = function () { if (!ta.value.trim()) { toast("Nothing to download yet"); return; } download(title(ta.value), ta.value); };
  document.addEventListener("keydown", function (e) {
    if (e.key === "Escape") closeP();
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "s") { e.preventDefault(); saveNote(); }
  });

  /* ---------- boot ---------- */
  var start = clean(location.hash.slice(1)); if (start.length < 3) start = genId();
  enter(start);
})();

/* Shared by server and browser: single-splice diff + three-way rebase merge. */
(function (g, f) { if (typeof module === "object" && module.exports) module.exports = f(); else g.Merge = f(); })(
typeof self !== "undefined" ? self : this, function () {
  function splice(a, b) {
    var s = 0, m = Math.min(a.length, b.length);
    while (s < m && a.charCodeAt(s) === b.charCodeAt(s)) s++;
    var ea = a.length, eb = b.length;
    while (ea > s && eb > s && a.charCodeAt(ea - 1) === b.charCodeAt(eb - 1)) { ea--; eb--; }
    return { start: s, del: ea - s, ins: b.slice(s, eb) };
  }
  function mapPos(p, pt) {
    if (p <= pt.start) return p;
    if (p >= pt.start + pt.del) return p + pt.ins.length - pt.del;
    return pt.start + pt.ins.length;
  }
  /* B = common base, L = local text, R = remote text. Returns L's change rebased onto R. */
  function merge(B, L, R) {
    var rp = splice(B, R), lp = splice(B, L), s2, d2 = lp.del;
    if (lp.start >= rp.start + rp.del) s2 = lp.start + rp.ins.length - rp.del;
    else if (lp.start + lp.del <= rp.start) s2 = lp.start;
    else { s2 = rp.start + rp.ins.length; d2 = 0; }
    s2 = Math.max(0, Math.min(s2, R.length));
    var text = R.slice(0, s2) + lp.ins + R.slice(s2 + d2);
    function caret(p) {
      if (p >= lp.start && p <= lp.start + lp.ins.length) return s2 + (p - lp.start);
      var pb = p < lp.start ? p : p - lp.ins.length + lp.del;
      return mapPos(mapPos(pb, rp), { start: s2, del: d2, ins: lp.ins });
    }
    return { text: text, caret: caret };
  }
  return { splice: splice, mapPos: mapPos, merge: merge };
});

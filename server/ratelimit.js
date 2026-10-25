// Einfache Ratenbegrenzung pro IP mit gleitendem Zeitfenster – im Speicher, ohne Abhängigkeiten.
"use strict";

const UNITS = { s: 1000, sec: 1000, m: 60000, min: 60000, h: 3600000 };

// "30/min", "5/10s", "100/h" → { limit, windowMs }; "0", "off" oder leer → aus
function parse(spec, fallback) {
  const value = (spec === undefined || spec === "" ? fallback : spec).trim().toLowerCase();
  if (/^(0|off|false|no)$/.test(value)) return null;
  const m = value.match(/^(\d+)\s*\/\s*(\d*)\s*(s|sec|m|min|h)$/);
  if (!m) throw new Error(`Ungültige Ratenbegrenzung: "${value}" (Beispiel: 30/min)`);
  return { limit: Number(m[1]), windowMs: (Number(m[2]) || 1) * UNITS[m[3]] };
}

function createLimiter(rule) {
  const hits = new Map(); // ip → Zeitstempel der Anfragen im Fenster

  // Alte Einträge regelmäßig wegräumen, damit der Speicher nicht wächst.
  const sweep = setInterval(() => {
    const cutoff = Date.now() - rule.windowMs;
    for (const [ip, list] of hits) {
      while (list.length && list[0] <= cutoff) list.shift();
      if (!list.length) hits.delete(ip);
    }
  }, Math.min(rule.windowMs, 60000));
  sweep.unref();

  // Liefert 0, wenn die Anfrage erlaubt ist, sonst die Wartezeit in Sekunden.
  return function check(ip) {
    const now = Date.now();
    const list = hits.get(ip) || [];
    while (list.length && list[0] <= now - rule.windowMs) list.shift();
    if (list.length >= rule.limit) return Math.max(1, Math.ceil((list[0] + rule.windowMs - now) / 1000));
    list.push(now);
    hits.set(ip, list);
    return 0;
  };
}

// Hinter einem Proxy (z. B. bei mittwald) steht die echte Adresse im letzten X-Forwarded-For-Eintrag,
// den der Proxy selbst angehängt hat. Weiter links stehende Einträge kann der Client fälschen.
function clientIp(req, trustProxy) {
  const xff = trustProxy && req.headers["x-forwarded-for"];
  if (xff) {
    const parts = String(xff).split(",").map((s) => s.trim()).filter(Boolean);
    if (parts.length) return parts[parts.length - 1];
  }
  return req.socket.remoteAddress || "unbekannt";
}

module.exports = { parse, createLimiter, clientIp };

// Kleiner Server ohne Abhängigkeiten: liefert die Seite aus und dreht Redewendungen per LLM.
"use strict";

const http = require("http");
const fs = require("fs");
const path = require("path");
const { loadConfig, combine, combineStream, userMessage, SYSTEM_PROMPT } = require("./llm");
const { parse, createLimiter, clientIp } = require("./ratelimit");

const PUBLIC = path.join(__dirname, "..", "public");
const PORT = Number(process.env.PORT) || 8080;
const config = loadConfig();
const TEST_PAGE = !/^(0|false|no|off)$/i.test(process.env.TEST_PAGE || "");
const TRUST_PROXY = !/^(0|false|no|off)$/i.test(process.env.TRUST_PROXY || "");

// Ratenbegrenzung pro IP – schützt vor allem das LLM-Kontingent.
const limits = {
  dreh: parse(process.env.RATE_LIMIT_SPIN, "20/min"),
  test: parse(process.env.RATE_LIMIT_TEST, "10/10min"),
};
const limiters = Object.fromEntries(Object.entries(limits).map(([k, rule]) => [k, rule ? createLimiter(rule) : () => 0]));

// true = weiter; sonst ist die 429-Antwort schon verschickt.
function allow(kind, req, res) {
  const wait = limiters[kind](clientIp(req, TRUST_PROXY));
  if (!wait) return true;
  res.setHeader("Retry-After", String(wait));
  sendJson(res, 429, { error: `Zu viele Anfragen – bitte in ${wait} s erneut versuchen.`, retryAfter: wait });
  return false;
}

// Dieselbe Liste und derselbe Mischmotor wie im Browser.
global.window = {};
require(path.join(PUBLIC, "redewendungen.js"));
const Dreher = require(path.join(PUBLIC, "dreher.js"));
const dreher = Dreher.createDreher(global.window.REDEWENDUNGEN);
const known = new Set(global.window.REDEWENDUNGEN);

const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
};

function sendJson(res, status, data) {
  res.writeHead(status, { "Content-Type": TYPES[".json"], "Cache-Control": "no-store" });
  res.end(JSON.stringify(data));
}

async function dreh(res) {
  // Der Mischmotor wählt zwei Redewendungen, die gut zusammenpassen,
  // und liefert gleich eine Notlösung, falls das LLM streikt.
  const local = dreher.spin();
  if (config.apiKey) {
    try {
      const text = await combine(local.sources[0], local.sources[1], config);
      return sendJson(res, 200, { text, by: "llm" });
    } catch (err) {
      console.error("LLM-Fehler, nehme Notlösung:", err.message, err.cause ? `(${err.cause.code || err.cause.message})` : "");
    }
  }
  sendJson(res, 200, { text: local.text, by: "local" });
}

// ---------- Testseite ----------
function readJson(req, limit = 16 * 1024) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on("data", (c) => {
      size += c.length;
      if (size > limit) { reject(new Error("zu groß")); req.destroy(); return; }
      chunks.push(c);
    });
    req.on("end", () => {
      try { resolve(JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}")); } catch (e) { reject(e); }
    });
    req.on("error", reject);
  });
}

// Streamt Denken und Antwort als NDJSON: eine JSON-Zeile pro Ereignis.
async function test(req, res) {
  let input;
  try { input = await readJson(req); } catch (e) { return sendJson(res, 400, { error: "Ungültige Anfrage" }); }
  const { a, b } = input;
  const system = typeof input.system === "string" ? input.system.slice(0, 8000) : "";
  if (!known.has(a) || !known.has(b)) return sendJson(res, 400, { error: "Bitte zwei Redewendungen aus der Liste wählen" });
  if (!config.apiKey) return sendJson(res, 503, { error: "Kein LLM_API_KEY gesetzt" });

  res.writeHead(200, { "Content-Type": "application/x-ndjson; charset=utf-8", "Cache-Control": "no-store", "X-Accel-Buffering": "no" });
  const send = (event) => res.write(JSON.stringify(event) + "\n");
  const abort = new AbortController();
  res.on("close", () => abort.abort());
  const started = Date.now();
  try {
    const result = await combineStream(a, b, {
      system: system.trim() || SYSTEM_PROMPT,
      signal: AbortSignal.any([abort.signal, AbortSignal.timeout(Math.max(config.timeoutMs, 180000))]),
    }, send, config);
    send({ type: "done", ...result, ms: Date.now() - started });
  } catch (err) {
    if (!abort.signal.aborted) send({ type: "error", message: err.message });
  }
  res.end();
}

function serveStatic(req, res) {
  let urlPath = decodeURIComponent(new URL(req.url, "http://x").pathname);
  if (urlPath === "/") urlPath = "/index.html";
  if (urlPath === "/test/" && TEST_PAGE) { res.writeHead(301, { Location: "../test" }); return res.end(); }
  if (urlPath === "/test") {
    if (!TEST_PAGE) { res.writeHead(404); return res.end(); }
    urlPath = "/test.html";
  }
  if (urlPath === "/test.html" && !TEST_PAGE) { res.writeHead(404); return res.end(); }
  const file = path.normalize(path.join(PUBLIC, urlPath));
  if (!file.startsWith(PUBLIC + path.sep)) { res.writeHead(403); return res.end(); }
  fs.readFile(file, (err, data) => {
    if (err) { res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" }); return res.end("Da liegt der Hund begraben: 404"); }
    res.writeHead(200, { "Content-Type": TYPES[path.extname(file)] || "application/octet-stream" });
    res.end(data);
  });
}

const server = http.createServer((req, res) => {
  if (req.url === "/api/dreh" && req.method === "POST") return void (allow("dreh", req, res) && dreh(res));
  if (req.url === "/healthz") return sendJson(res, 200, { ok: true });
  if (TEST_PAGE && req.url === "/api/test" && req.method === "POST") return void (allow("test", req, res) && test(req, res));
  if (TEST_PAGE && req.url === "/api/prompt") {
    return sendJson(res, 200, {
      system: SYSTEM_PROMPT,
      user: userMessage("{1}", "{2}"),
      model: config.model,
      thinking: config.thinking ? config.reasoningEffort : "aus",
      ready: !!config.apiKey,
    });
  }
  if (req.method !== "GET" && req.method !== "HEAD") { res.writeHead(405); return res.end(); }
  serveStatic(req, res);
});

server.listen(PORT, () => {
  console.log(`Phrasendreher läuft auf Port ${PORT}`);
  console.log(config.apiKey
    ? `LLM: ${config.model} @ ${config.baseUrl} (Thinking: ${config.thinking ? config.reasoningEffort : "aus"})`
    : "Kein LLM_API_KEY gesetzt – es dreht nur der eingebaute Mischmotor.");
  const show = (r) => (r ? `${r.limit} pro ${r.windowMs / 1000} s` : "aus");
  console.log(`Ratenbegrenzung: Automat ${show(limits.dreh)}, Testlabor ${show(limits.test)} (Proxy-IP: ${TRUST_PROXY ? "ja" : "nein"})`);
});

const stop = () => server.close(() => process.exit(0));
process.on("SIGTERM", stop);
process.on("SIGINT", stop);

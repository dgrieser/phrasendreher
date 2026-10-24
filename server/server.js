// Kleiner Server ohne Abhängigkeiten: liefert die Seite aus und dreht Redewendungen per LLM.
"use strict";

const http = require("http");
const fs = require("fs");
const path = require("path");
const { loadConfig, combine } = require("./llm");

const PUBLIC = path.join(__dirname, "..", "public");
const PORT = Number(process.env.PORT) || 8080;
const config = loadConfig();

// Dieselbe Liste und derselbe Mischmotor wie im Browser.
global.window = {};
require(path.join(PUBLIC, "redewendungen.js"));
const Dreher = require(path.join(PUBLIC, "dreher.js"));
const dreher = Dreher.createDreher(global.window.REDEWENDUNGEN);

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

function serveStatic(req, res) {
  const urlPath = decodeURIComponent(new URL(req.url, "http://x").pathname);
  const file = path.normalize(path.join(PUBLIC, urlPath === "/" ? "index.html" : urlPath));
  if (!file.startsWith(PUBLIC + path.sep)) { res.writeHead(403); return res.end(); }
  fs.readFile(file, (err, data) => {
    if (err) { res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" }); return res.end("Da liegt der Hund begraben: 404"); }
    res.writeHead(200, { "Content-Type": TYPES[path.extname(file)] || "application/octet-stream" });
    res.end(data);
  });
}

const server = http.createServer((req, res) => {
  if (req.url === "/api/dreh" && req.method === "POST") return void dreh(res);
  if (req.url === "/healthz") return sendJson(res, 200, { ok: true });
  if (req.method !== "GET" && req.method !== "HEAD") { res.writeHead(405); return res.end(); }
  serveStatic(req, res);
});

server.listen(PORT, () => {
  console.log(`Phrasendreher läuft auf Port ${PORT}`);
  console.log(config.apiKey
    ? `LLM: ${config.model} @ ${config.baseUrl} (Thinking: ${config.thinking ? config.reasoningEffort : "aus"})`
    : "Kein LLM_API_KEY gesetzt – es dreht nur der eingebaute Mischmotor.");
});

const stop = () => server.close(() => process.exit(0));
process.on("SIGTERM", stop);
process.on("SIGINT", stop);

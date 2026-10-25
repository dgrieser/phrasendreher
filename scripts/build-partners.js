#!/usr/bin/env node
// Erzeugt server/data/partners.json. Für jede Redewendung:
//   meaning   kurze Umschreibung der Bedeutung (per LLM, von Hand korrigierbar)
//   similar   die 10 Redewendungen mit der ähnlichsten Bedeutung (Embeddings der Umschreibungen)
//   image     die 10 Redewendungen mit dem ähnlichsten Bild/Wortlaut (Embeddings der Redewendung selbst)
// Klang-Partner braucht es hier nicht – die berechnet der Server selbst (server/pairs.js).
//
//   LLM_API_KEY=… node scripts/build-partners.js          nur fehlende Umschreibungen erzeugen, Nachbarn neu berechnen
//   LLM_API_KEY=… node scripts/build-partners.js --all    alle Umschreibungen neu erzeugen (überschreibt Korrekturen!)
//   node scripts/build-partners.js --check                prüft ohne API, ob die Datei zur Liste passt
"use strict";

const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const OUT = path.join(ROOT, "server", "data", "partners.json");
const BASE_URL = (process.env.LLM_BASE_URL || "https://llm.aihosting.mittwald.de/v1").replace(/\/+$/, "");
const API_KEY = process.env.LLM_API_KEY || "";
const CHAT_MODEL = process.env.PARTNERS_MODEL || "Qwen3.8-27B-NVFP4";
const EMBED_MODEL = process.env.PARTNERS_EMBED_MODEL || "Qwen3-Embedding-8B";
const NEIGHBORS = 10;

function loadList() {
  global.window = {};
  delete require.cache[require.resolve(path.join(ROOT, "public", "redewendungen.js"))];
  require(path.join(ROOT, "public", "redewendungen.js"));
  return global.window.REDEWENDUNGEN;
}

function loadExisting() {
  try { return JSON.parse(fs.readFileSync(OUT, "utf8")); } catch (e) { return null; }
}

// Was fehlt oder überzählig ist – Grundlage für --check und den Server.
function diff(list, data) {
  const entries = (data && data.entries) || {};
  return {
    missing: list.filter((p) => !entries[p]),
    extra: Object.keys(entries).filter((p) => !list.includes(p)),
  };
}

async function api(endpoint, body) {
  for (let attempt = 1; ; attempt++) {
    const res = await fetch(BASE_URL + endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: "Bearer " + API_KEY },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(180000),
    });
    if (res.ok) return res.json();
    const text = await res.text();
    if (attempt >= 3 || res.status < 500 && res.status !== 429) throw new Error(`${endpoint}: HTTP ${res.status} ${text.slice(0, 200)}`);
    await new Promise((r) => setTimeout(r, 2000 * attempt));
  }
}

// ---------- Bedeutungen ----------
const MEANING_PROMPT = `Erkläre für jede deutsche Redewendung ihre übertragene Bedeutung in einfachen Worten (5–12 Wörter).
Wiederhole keine Wörter oder Bilder der Redewendung – es geht nur um den Sinn, so wie man ihn einem Kind erklären würde.
Achte auf Ironie und regionale Bedeutungen. Beispiele:
"Auf dem Schlauch stehen" → "etwas gerade nicht begreifen"
"Polen ist offen" → "jetzt ist alles möglich, es herrscht Chaos"
"Pünktlich wie die Maurer" → "auf die Minute genau Feierabend machen"
Antworte nur mit JSON: {"1": "…", "2": "…"}`;

async function describeBatch(batch) {
  const data = await api("/chat/completions", {
    model: CHAT_MODEL,
    messages: [{ role: "system", content: MEANING_PROMPT }, { role: "user", content: batch.map((p, i) => `${i + 1}. ${p}`).join("\n") }],
    temperature: 0.6,
    max_tokens: 12000,
    chat_template_kwargs: { enable_thinking: true, reasoning_effort: "low" },
  });
  const raw = data.choices[0].message.content || "";
  const json = JSON.parse(raw.slice(raw.indexOf("{"), raw.lastIndexOf("}") + 1));
  const out = {};
  batch.forEach((p, i) => {
    const text = typeof json[String(i + 1)] === "string" ? json[String(i + 1)].trim().replace(/\.$/, "") : "";
    if (text) out[p] = text;
  });
  return out;
}

async function describe(todo) {
  const result = {};
  let rest = todo;
  for (let round = 1; rest.length && round <= 3; round++) {
    // Bei Wiederholungen kleinere Stapel – manche Antworten scheitern nur an der Menge.
    const size = 20 >> (round - 1);
    const batches = [];
    for (let i = 0; i < rest.length; i += size) batches.push(rest.slice(i, i + size));
    // Ein paar Stapel gleichzeitig, damit es nicht ewig dauert.
    for (let i = 0; i < batches.length; i += 6) {
      await Promise.all(batches.slice(i, i + 6).map((b) => describeBatch(b)
        .then((r) => Object.assign(result, r))
        .catch((err) => console.error(`\n  Stapel fehlgeschlagen: ${err.message}`))));
      process.stdout.write(`\r  Umschreibungen: ${Object.keys(result).length}/${todo.length}`);
    }
    rest = rest.filter((p) => !result[p]);
  }
  process.stdout.write("\n");
  if (rest.length) console.warn(`  Ohne Umschreibung geblieben (${rest.length}): ${rest.join(" | ")}`);
  return result;
}

// ---------- Bild-Nachbarn ----------
async function embed(texts, label) {
  const vectors = [];
  for (let i = 0; i < texts.length; i += 200) {
    const data = await api("/embeddings", { model: EMBED_MODEL, input: texts.slice(i, i + 200) });
    for (const item of data.data.sort((a, b) => a.index - b.index)) {
      const norm = Math.hypot(...item.embedding);
      vectors.push(item.embedding.map((x) => x / norm));
    }
    process.stdout.write(`\r  Embeddings (${label}): ${vectors.length}/${texts.length}`);
  }
  process.stdout.write("\n");
  return vectors;
}

function neighbors(list, vectors) {
  const out = {};
  list.forEach((p, i) => {
    const scores = [];
    for (let j = 0; j < list.length; j++) {
      if (j === i) continue;
      let s = 0;
      const a = vectors[i], b = vectors[j];
      for (let k = 0; k < a.length; k++) s += a[k] * b[k];
      scores.push([j, s]);
    }
    scores.sort((x, y) => y[1] - x[1]);
    out[p] = scores.slice(0, NEIGHBORS).map(([j]) => list[j]);
  });
  return out;
}

// ---------- Ablauf ----------
async function main() {
  const list = loadList();
  const existing = loadExisting();
  const args = process.argv.slice(2);

  if (args.includes("--check")) {
    const { missing, extra } = diff(list, existing);
    if (!missing.length && !extra.length) { console.log(`partners.json passt zur Liste (${list.length} Einträge).`); return; }
    console.error(`partners.json ist veraltet – fehlend: ${missing.length}, überzählig: ${extra.length}`);
    if (missing.length) console.error("  fehlend: " + missing.slice(0, 20).join(" | "));
    if (extra.length) console.error("  überzählig: " + extra.slice(0, 20).join(" | "));
    console.error("Bitte ausführen: LLM_API_KEY=… node scripts/build-partners.js");
    process.exit(1);
  }
  if (!API_KEY) { console.error("LLM_API_KEY fehlt."); process.exit(1); }

  const all = args.includes("--all");
  const old = (existing && existing.entries) || {};
  const meanings = {};
  for (const p of list) if (!all && old[p] && old[p].meaning) meanings[p] = old[p].meaning;
  const todo = list.filter((p) => !meanings[p]);
  console.log(`Redewendungen: ${list.length} · neue Umschreibungen: ${todo.length}${all ? " (alle)" : ""}`);
  if (todo.length) Object.assign(meanings, await describe(todo));

  console.log("Nachbarn werden berechnet …");
  // Die Aufgabenbeschreibung und die Redewendung selbst machen die Bedeutungs-Nachbarn deutlich treffsicherer
  // als die Umschreibung allein (an den Beispielpaaren aus dem Prompt gemessen).
  const instruct = "Instruct: Finde Redewendungen mit derselben übertragenen Bedeutung\nQuery: ";
  const similar = neighbors(list, await embed(list.map((p) => instruct + p + " – " + (meanings[p] || "")), "Bedeutung"));
  const image = neighbors(list, await embed(list, "Bild"));

  const entries = {};
  for (const p of list) entries[p] = { meaning: meanings[p] || "", similar: similar[p], image: image[p] };
  const data = { generated: new Date().toISOString(), models: { meaning: CHAT_MODEL, embeddings: EMBED_MODEL }, entries };
  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, JSON.stringify(data, null, 1) + "\n");
  console.log(`Geschrieben: ${path.relative(ROOT, OUT)}`);
}

if (require.main === module) {
  main().catch((err) => { console.error(err.message); process.exit(1); });
}

module.exports = { diff };

// Modellkatalog: wie jedes Modell sein Denken steuert und welche Einstellungen mittwald empfiehlt.
// Quelle: die Modellseiten unter https://developer.mittwald.de/de/docs/v2/platform/aihosting/models/
// Die Modellliste selbst kommt live von der API; dieser Katalog ergänzt nur, was die API nicht verrät.
"use strict";

// reasoning.mode:
//   "template-effort"  chat_template_kwargs: enable_thinking + reasoning_effort (Qwen3.8)
//   "template-toggle"  chat_template_kwargs: nur enable_thinking an/aus (Qwen3.5/3.6)
//   "effort"           reasoning_effort als Top-Level-Parameter, Denken nicht abschaltbar (gpt-oss)
//   "none"             keine Denksteuerung; chat_template_kwargs wird abgelehnt (Ministral)
const QWEN_TOGGLE_PROFILES = [
  { id: "thinking", label: "Thinking · allgemein", thinking: true, temperature: 1.0, top_p: 0.95, top_k: 20, presence_penalty: 1.5 },
  { id: "thinking-precise", label: "Thinking · präzise", thinking: true, temperature: 0.6, top_p: 0.95, top_k: 20, presence_penalty: 0.0 },
  { id: "instruct", label: "Ohne Thinking · allgemein", thinking: false, temperature: 0.7, top_p: 0.8, top_k: 20, presence_penalty: 1.5 },
  { id: "instruct-reasoning", label: "Ohne Thinking · knifflig", thinking: false, temperature: 1.0, top_p: 1.0, top_k: 40, presence_penalty: 2.0 },
];

const CATALOG = {
  "Qwen3.8-27B-NVFP4": {
    reasoning: { mode: "template-effort", efforts: ["low", "medium", "xhigh"], defaultEffort: "xhigh", defaultOn: true },
    profiles: [
      { id: "thinking", label: "Thinking", thinking: true, effort: "medium", temperature: 1.0, top_p: 0.95, top_k: 20, presence_penalty: 0.0 },
      { id: "instruct", label: "Ohne Thinking", thinking: false, temperature: 0.7, top_p: 0.8, top_k: 20, presence_penalty: 1.5 },
    ],
  },
  "Qwen3.6-35B-A3B-FP8": { reasoning: { mode: "template-toggle", defaultOn: true }, profiles: QWEN_TOGGLE_PROFILES },
  "Qwen3.5-122B-A10B-FP8": { reasoning: { mode: "template-toggle", defaultOn: true }, profiles: QWEN_TOGGLE_PROFILES },
  "Qwen3.5-0.8B": {
    reasoning: { mode: "template-toggle", defaultOn: false },
    profiles: [
      { id: "standard", label: "Standard (ohne Thinking)", thinking: false, temperature: 1.0, top_p: 1.0, top_k: 20, presence_penalty: 2.0 },
      { id: "thinking", label: "Thinking · allgemein", thinking: true, temperature: 1.0, top_p: 0.95, top_k: 20, presence_penalty: 1.5 },
      { id: "thinking-precise", label: "Thinking · präzise", thinking: true, temperature: 0.6, top_p: 0.95, top_k: 20, presence_penalty: 0.0 },
    ],
  },
  "gpt-oss-120b": {
    reasoning: { mode: "effort", efforts: ["low", "medium", "high"], defaultEffort: "medium", defaultOn: true },
    profiles: [{ id: "recommended", label: "Empfohlen", thinking: true, effort: "medium", temperature: 1.0, top_p: 1.0 }],
  },
  "Ministral-3-14B-Instruct-2512": {
    reasoning: { mode: "none" },
    profiles: [{ id: "recommended", label: "Empfohlen", temperature: 0.1 }],
  },
  // Reines OCR-Modell – für Redewendungen ungeeignet.
  "GLM-OCR": { hidden: true },
};

const UNKNOWN = { reasoning: { mode: "none" }, profiles: [{ id: "default", label: "Modell-Standard" }] };

function describe(id) {
  return CATALOG[id] || UNKNOWN;
}

// Baut die modellspezifischen Felder der Anfrage aus neutralen Einstellungen.
function requestFields(settings) {
  const { reasoning } = describe(settings.model);
  const out = {};
  for (const key of ["temperature", "top_p", "top_k", "presence_penalty", "max_tokens"]) {
    if (typeof settings[key] === "number" && Number.isFinite(settings[key])) out[key] = settings[key];
  }
  const effort = reasoning.efforts && reasoning.efforts.includes(settings.effort) ? settings.effort : undefined;
  if (reasoning.mode === "template-effort") {
    out.chat_template_kwargs = settings.thinking
      ? { enable_thinking: true, ...(effort ? { reasoning_effort: effort } : {}) }
      : { enable_thinking: false };
  } else if (reasoning.mode === "template-toggle") {
    out.chat_template_kwargs = { enable_thinking: !!settings.thinking };
  } else if (reasoning.mode === "effort" && effort) {
    out.reasoning_effort = effort;
  }
  return out;
}

// ---------- Live-Modellliste ----------
const MITTWALD_MODELS = "https://api.mittwald.de/v2/ai-hosting-models";
const CACHE_MS = 10 * 60 * 1000;
let cache = null;

async function getJson(url, headers = {}) {
  const res = await fetch(url, { headers, signal: AbortSignal.timeout(10000) });
  if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
  return res.json();
}

// Chat-Modelle aus /v1/models (was der Key wirklich darf), angereichert mit
// Anzeigename, Reifegrad, Token-Faktor und Doku-Link aus der mittwald-API.
async function listModels(cfg) {
  if (cache && Date.now() - cache.at < CACHE_MS) return cache.models;
  let available = [];
  try {
    const data = await getJson(cfg.baseUrl + "/models", { Authorization: "Bearer " + cfg.apiKey });
    available = (data.data || []).filter((m) => !m.mode || m.mode === "chat");
  } catch (err) {
    console.error("Modellliste nicht abrufbar:", err.message);
    available = [{ id: cfg.model }];
  }
  const meta = new Map();
  if (/mittwald\.de/.test(cfg.baseUrl)) {
    try {
      for (const m of await getJson(MITTWALD_MODELS)) meta.set(m.name, m);
    } catch (err) {
      console.error("mittwald-Modelldaten nicht abrufbar:", err.message);
    }
  }
  const models = available
    .filter((m) => !describe(m.id).hidden)
    .map((m) => {
      const info = meta.get(m.id) || {};
      const { reasoning, profiles } = describe(m.id);
      return {
        id: m.id,
        name: info.displayName || m.id,
        label: info.label || null,
        tokenFactor: info.tokenFactor ?? null,
        docLink: info.docLink || null,
        maxOutput: m.max_output_tokens || null,
        reasoning,
        profiles,
      };
    })
    .sort((x, y) => (x.id === cfg.model ? -1 : y.id === cfg.model ? 1 : x.name.localeCompare(y.name)));
  cache = { at: Date.now(), models };
  return models;
}

module.exports = { describe, requestFields, listModels };

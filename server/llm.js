// Spricht mit einem OpenAI-kompatiblen Endpunkt (Standard: mittwald AI Hosting).
"use strict";

const env = process.env;
const { describe, requestFields } = require("./models");

const num = (v, fallback) => (v === undefined || v === "" ? fallback : Number(v));
const bool = (v, fallback) => (v === undefined || v === "" ? fallback : !/^(0|false|no|off)$/i.test(v));

// Ohne eigene Werte gelten die von mittwald empfohlenen Einstellungen des gewählten Modells
// (passendes Profil aus server/models.js); gesetzte Umgebungsvariablen haben Vorrang.
function loadConfig() {
  const model = env.LLM_MODEL || "Qwen3.8-27B-NVFP4";
  const { reasoning, profiles } = describe(model);
  const thinking = bool(env.LLM_ENABLE_THINKING, reasoning.defaultOn !== false);
  const p = profiles.find((x) => !!x.thinking === thinking) || profiles[0] || {};
  return {
    apiKey: env.LLM_API_KEY || "",
    baseUrl: (env.LLM_BASE_URL || "https://llm.aihosting.mittwald.de/v1").replace(/\/+$/, ""),
    timeoutMs: num(env.LLM_TIMEOUT_MS, 45000),
    settings: {
      model,
      thinking,
      effort: env.LLM_REASONING_EFFORT || p.effort || "medium",
      temperature: num(env.LLM_TEMPERATURE, p.temperature),
      top_p: num(env.LLM_TOP_P, p.top_p),
      top_k: num(env.LLM_TOP_K, p.top_k),
      presence_penalty: num(env.LLM_PRESENCE_PENALTY, p.presence_penalty),
      max_tokens: num(env.LLM_MAX_TOKENS, 4096),
    },
  };
}

const SYSTEM_PROMPT = `Du bist ein Meister der verdrehten Redewendung. Du bekommst zwei deutsche Redewendungen und verschmilzt sie zu genau EINER neuen, verdrehten Redewendung – so, wie Menschen im Eifer des Gefechts zwei Sprüche durcheinanderbringen.

So geht's:
- Nimm das Satzgerüst der einen Redewendung und setze ein markantes Bild (meist ein Substantiv) aus der anderen ein – oder hänge den Anfang der einen an das Ende der anderen.
- Aus beiden Redewendungen müssen erkennbare Teile vorkommen. Erfinde keine neuen Wörter dazu, die in keiner der beiden stehen (Artikel und Endungen anpassen ist erlaubt).
- Das Ergebnis ist eine vollständige Redewendung: Hat das Gerüst ein Verb, hat das Ergebnis auch eins.
- Grammatisch korrekt: Artikel, Fälle und Verbformen passen zusammen.
- Es soll so klingen, als würde jemand es völlig selbstbewusst sagen. Der Witz entsteht durch den schiefen Bildbruch – je absurder das Bild, desto besser.
- Kurz und knackig: höchstens 12 Wörter.
- Überlege dir mehrere Varianten und nimm die lustigste.
- Antworte ausschließlich mit der neuen Redewendung: keine Anführungszeichen, keine Erklärung, kein Satz davor oder danach.

Beispiele:
„Zwei Fliegen mit einer Klappe schlagen“ + „Den Nagel auf den Kopf treffen“ → Zwei Nägel mit einer Klappe treffen
„Mit Kanonen auf Spatzen schießen“ + „Die Spatzen pfeifen es von den Dächern“ → Mit Kanonen von den Dächern pfeifen
„Den Kopf in den Sand stecken“ + „Den Hut in den Ring werfen“ → Den Kopf in den Ring werfen`;

const userMessage = (a, b) => `„${a}“ + „${b}“ →`;

function buildMessages(a, b, system = SYSTEM_PROMPT) {
  return [
    { role: "system", content: system },
    { role: "user", content: userMessage(a, b) },
  ];
}

function buildBody(a, b, settings, system) {
  return { model: settings.model, messages: buildMessages(a, b, system), ...requestFields(settings) };
}

function request(body, cfg, signal) {
  return fetch(cfg.baseUrl + "/chat/completions", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: "Bearer " + cfg.apiKey },
    body: JSON.stringify(body),
    signal,
  });
}

// Entfernt Anführungszeichen, Pfeile, Denk-Reste und alles nach der ersten Zeile.
function clean(text) {
  if (!text) return "";
  let t = String(text).replace(/<think>[\s\S]*?<\/think>/g, "").trim();
  t = t.split(/\n/).map((l) => l.trim()).filter(Boolean)[0] || "";
  t = t.replace(/^.*→\s*/, "").replace(/^["„“”'»«‚‘’\s]+|["„“”'»«‚‘’\s]+$/g, "").replace(/\.$/, "").trim();
  return t.length > 160 ? "" : t;
}

async function combine(a, b, cfg = loadConfig()) {
  if (!cfg.apiKey) throw new Error("LLM_API_KEY fehlt");
  const res = await request(buildBody(a, b, cfg.settings), cfg, AbortSignal.timeout(cfg.timeoutMs));
  if (!res.ok) throw new Error(`LLM antwortet mit HTTP ${res.status}: ${(await res.text()).slice(0, 300)}`);
  const data = await res.json();
  const choice = data.choices && data.choices[0];
  const text = clean(choice && choice.message && choice.message.content);
  if (!text) throw new Error(`Leere LLM-Antwort (finish_reason: ${choice && choice.finish_reason})`);
  return text;
}

// Wie combine(), aber gestreamt: meldet Denk- und Antwort-Häppchen einzeln über onEvent.
// Für die Testseite – dort darf der System-Prompt überschrieben werden.
async function combineStream(a, b, { system, signal, settings } = {}, onEvent, cfg = loadConfig()) {
  if (!cfg.apiKey) throw new Error("LLM_API_KEY fehlt");
  const body = { ...buildBody(a, b, settings || cfg.settings, system || SYSTEM_PROMPT), stream: true, stream_options: { include_usage: true } };
  const res = await request(body, cfg, signal);
  if (!res.ok) throw new Error(`LLM antwortet mit HTTP ${res.status}: ${(await res.text()).slice(0, 300)}`);
  const decoder = new TextDecoder();
  let buffer = "";
  let content = "";
  let finish = null;
  let usage = null;
  for await (const chunk of res.body) {
    buffer += decoder.decode(chunk, { stream: true });
    let nl;
    while ((nl = buffer.indexOf("\n")) >= 0) {
      const line = buffer.slice(0, nl).trim();
      buffer = buffer.slice(nl + 1);
      if (!line.startsWith("data:")) continue;
      const data = line.slice(5).trim();
      if (data === "[DONE]") continue;
      let json;
      try { json = JSON.parse(data); } catch (e) { continue; }
      if (json.usage) usage = json.usage;
      const choice = json.choices && json.choices[0];
      if (!choice) continue;
      if (choice.finish_reason) finish = choice.finish_reason;
      const delta = choice.delta || {};
      const reasoning = delta.reasoning_content || delta.reasoning;
      if (reasoning) onEvent({ type: "reasoning", text: reasoning });
      if (delta.content) { content += delta.content; onEvent({ type: "content", text: delta.content }); }
    }
  }
  return { raw: content, text: clean(content), finish, usage };
}

module.exports = { loadConfig, combine, combineStream, clean, userMessage, SYSTEM_PROMPT };

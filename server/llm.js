// Spricht mit einem OpenAI-kompatiblen Endpunkt (Standard: mittwald AI Hosting).
"use strict";

const env = process.env;
const num = (v, fallback) => (v === undefined || v === "" ? fallback : Number(v));
const bool = (v, fallback) => (v === undefined || v === "" ? fallback : !/^(0|false|no|off)$/i.test(v));

function loadConfig() {
  const thinking = bool(env.LLM_ENABLE_THINKING, true);
  // Empfohlene Sampling-Werte laut mittwald-Doku, je nach Thinking-Modus.
  const d = thinking
    ? { temperature: 1.0, top_p: 0.95, top_k: 20, presence_penalty: 0.0 }
    : { temperature: 0.7, top_p: 0.8, top_k: 20, presence_penalty: 1.5 };
  return {
    apiKey: env.LLM_API_KEY || "",
    baseUrl: (env.LLM_BASE_URL || "https://llm.aihosting.mittwald.de/v1").replace(/\/+$/, ""),
    model: env.LLM_MODEL || "Qwen3.8-27B-NVFP4",
    thinking,
    reasoningEffort: env.LLM_REASONING_EFFORT || "medium",
    temperature: num(env.LLM_TEMPERATURE, d.temperature),
    topP: num(env.LLM_TOP_P, d.top_p),
    topK: num(env.LLM_TOP_K, d.top_k),
    presencePenalty: num(env.LLM_PRESENCE_PENALTY, d.presence_penalty),
    maxTokens: num(env.LLM_MAX_TOKENS, 4096),
    timeoutMs: num(env.LLM_TIMEOUT_MS, 45000),
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

function buildMessages(a, b) {
  return [
    { role: "system", content: SYSTEM_PROMPT },
    { role: "user", content: `„${a}“ + „${b}“ →` },
  ];
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
  const body = {
    model: cfg.model,
    messages: buildMessages(a, b),
    temperature: cfg.temperature,
    top_p: cfg.topP,
    top_k: cfg.topK,
    presence_penalty: cfg.presencePenalty,
    max_tokens: cfg.maxTokens,
    chat_template_kwargs: cfg.thinking
      ? { enable_thinking: true, reasoning_effort: cfg.reasoningEffort }
      : { enable_thinking: false },
  };
  const res = await fetch(cfg.baseUrl + "/chat/completions", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: "Bearer " + cfg.apiKey },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(cfg.timeoutMs),
  });
  if (!res.ok) throw new Error(`LLM antwortet mit HTTP ${res.status}: ${(await res.text()).slice(0, 300)}`);
  const data = await res.json();
  const choice = data.choices && data.choices[0];
  const text = clean(choice && choice.message && choice.message.content);
  if (!text) throw new Error(`Leere LLM-Antwort (finish_reason: ${choice && choice.finish_reason})`);
  return text;
}

module.exports = { loadConfig, combine, clean, SYSTEM_PROMPT };

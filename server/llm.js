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

const SYSTEM_PROMPT = `Du bist ein Meister der verdrehten Redewendung. Du bekommst zwei deutsche Redewendungen und verschmilzt sie zu genau EINER neuen, verdrehten Redewendung – so, wie Menschen im Eifer des Gefechts zwei Sprüche durcheinanderbringen und es trotzdem völlig selbstbewusst sagen.

Erlaubte Kniffe (gern kombiniert):
- Gerüst der einen Redewendung nehmen und ein markantes Bild aus der anderen einsetzen („Nicht das Gelbe vom Daumen“).
- Den Anfang der einen an das Ende der anderen hängen („Der frühe Vogel fällt nicht weit vom Stamm“).
- Zwei Schlüsselwörter zu einem neuen Wort verschmelzen („Ponyhof“ + „Zuckerschlecken“ → „Ponyschlecken“).
- Ein Wort durch ein ähnlich klingendes ersetzen („Schnippchen“ → „Schnäppchen“, „Sinn“ → „Finn“).
- Ein Wort durch ein verwandtes oder ähnliches ersetzen („Knüppel“ → „Stöcke“, „Luft“ → „Sonne“, „Gelbe“ → „Grüne“).
- Präpositionen und Verben vertauschen („auf dem Schlauch“ → „vor’m Schlauch“, „aufzäumen“ → „aufrollen“).
- Die Form frei anpassen: Ich-Form, Vergangenheit, Ausruf, Umgangssprache („Da steh’ ich mal wieder …“).

Regeln:
- Beide Redewendungen müssen erkennbar bleiben – mindestens ein markantes Wort oder Bild aus jeder.
- Das Ergebnis klingt wie ein echter Spruch: grammatisch korrekt und natürlich gesprochen.
- Der Witz entsteht durch den schiefen Bildbruch oder den Beinahe-Treffer, nie durch Erklärungen oder Zusätze.
- Kurz und knackig: höchstens 12 Wörter.
- Überlege dir mehrere Varianten und nimm die lustigste.
- Antworte ausschließlich mit der neuen Redewendung: keine Anführungszeichen, keine Erklärung, kein Satz davor oder danach.

Beispiele:
„Jemandem Knüppel zwischen die Beine werfen“ + „Jemandem Steine in den Weg legen“ → Da haben sie mir Stöcke vor die Füße geworfen
„Jemandem ein Schnippchen schlagen“ + „Ein Schnäppchen machen“ → Da hat uns die Natur wieder ein Schnäppchen geschlagen!
„Das ist ein schmaler Grat“ + „Einen Spagat machen“ → Das ist nur ein ganz schmaler Spagat
„Das Leben ist kein Ponyhof“ + „Das Leben ist kein Zuckerschlecken“ → Das Leben ist kein Ponyschlecken
„Das Pferd von hinten aufzäumen“ + „Einen Fall von hinten aufrollen“ → Das Pferd von hinten aufrollen
„Das schlägt dem Fass den Boden aus“ + „Das ist ein Schlag ins Gesicht“ → Das schlägt dem Fass den Boden ins Gesicht
„Das ist die Spitze des Eisbergs“ + „Das setzt der Sache die Krone auf“ → Das setzt dem Eisberg die Spitze auf
„Auf dem Schlauch stehen“ + „Vor einem Rätsel stehen“ → Da steh’ ich mal wieder vor’m Schlauch
„Der frühe Vogel fängt den Wurm“ + „Der Apfel fällt nicht weit vom Stamm“ → Der frühe Vogel fällt nicht weit vom Stamm
„Die Zeit drängt“ + „Die Pflicht ruft“ → Die Zeit ruft
„Ich bin auf dem Zenit meines Schaffens“ + „Das übersteigt meinen Horizont“ → Ich bin auf dem Zenit meines Horizonts
„Ich gehe mal an die frische Luft“ + „Ich gehe mal in die Sonne“ → Ich geh mal an die frische Sonne!
„Lange Rede, kurzer Sinn“ + „Alter Schwede“ → Langer Schwede, kurzer Finn
„Nicht das Gelbe vom Ei“ + „Pi mal Daumen“ → Nicht das Gelbe vom Daumen
„Nicht das Gelbe vom Ei“ + „Einen grünen Daumen haben“ → Nicht das Grüne vom Ei
„Schwamm drüber“ + „Scherz beiseite“ → Schwamm beiseite
„Der Zahn der Zeit“ + „Der Mantel der Geschichte“ → Der Mantel der Zeit zog an mir vorüber`;

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

(function () {
  "use strict";

  const $ = (id) => document.getElementById(id);
  const phrases = [...window.REDEWENDUNGEN].sort((x, y) => x.localeCompare(y, "de"));
  const dreher = Dreher.createDreher(window.REDEWENDUNGEN);
  let defaults = { system: "", user: "„{1}“ + „{2}“ →" };
  let controller = null;
  let timer = null;

  // ---------- Auswahl ----------
  for (const id of ["a", "b"]) {
    $(id).append(...phrases.map((p) => new Option(p, p)));
  }

  // Dasselbe Paar-Verfahren wie im Automaten (Stapel + passender Partner); ohne Server mischt der Browser.
  async function randomPair() {
    let pair = null;
    try {
      const res = await fetch("api/pair");
      if (res.ok) pair = await res.json();
    } catch (e) { /* Notlösung unten */ }
    if (!pair) {
      const r = dreher.spin();
      pair = { a: r.sources[0], b: r.sources[1], label: "Grammatik" };
    }
    $("a").value = pair.a;
    $("b").value = pair.b;
    $("pairSource").textContent = "Partner über: " + pair.label;
    updatePreview();
  }

  function updatePreview() {
    $("userPreview").textContent = defaults.user.replace("{1}", $("a").value).replace("{2}", $("b").value);
  }

  function updateCount() {
    $("charCount").textContent = $("system").value.length.toLocaleString("de-DE");
  }

  const manualPair = () => { $("pairSource").textContent = "Von Hand gewählt"; updatePreview(); };
  $("a").addEventListener("change", manualPair);
  $("b").addEventListener("change", manualPair);
  $("randomBtn").addEventListener("click", randomPair);
  $("system").addEventListener("input", updateCount);
  $("resetBtn").addEventListener("click", () => { $("system").value = defaults.system; updateCount(); });

  // ---------- Ausgabe ----------
  const reasoning = $("reasoning");
  const result = $("result");

  // Mitscrollen, solange man unten ist; wer nach oben scrollt, wird in Ruhe gelassen.
  function appendReasoning(text) {
    const atBottom = reasoning.scrollHeight - reasoning.scrollTop - reasoning.clientHeight < 40;
    reasoning.append(text);
    if (atBottom) reasoning.scrollTop = reasoning.scrollHeight;
  }

  function setStatus(text, error) {
    $("status").textContent = text;
    $("status").classList.toggle("error", !!error);
  }

  function setRunning(on) {
    if (models.length) setModelControls(!on);
    $("runBtn").disabled = on;
    $("randomBtn").disabled = on;
    $("stopBtn").hidden = !on;
    $("live").hidden = !on;
    result.classList.toggle("streaming", on);
  }

  function reset() {
    reasoning.replaceChildren();
    result.textContent = "";
    result.classList.remove("empty");
    $("copyBtn").disabled = true;
    $("rawBox").hidden = true;
    ["mTime", "mTokens", "mFinish"].forEach((id) => { $(id).textContent = "–"; });
  }

  const seconds = (ms) => (ms / 1000).toLocaleString("de-DE", { minimumFractionDigits: 1, maximumFractionDigits: 1 }) + " s";

  // ---------- Lauf ----------
  $("form").addEventListener("submit", async (e) => {
    e.preventDefault();
    if (controller) return;
    reset();
    setRunning(true);
    const started = performance.now();
    let phase = "Verbinde …";
    setStatus(phase);
    timer = setInterval(() => setStatus(`${phase} ${seconds(performance.now() - started)}`), 100);
    controller = new AbortController();
    let content = "";

    try {
      const res = await fetch("api/test", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ a: $("a").value, b: $("b").value, system: $("system").value, settings: settings() }),
        signal: controller.signal,
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || "HTTP " + res.status);
      }
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        let nl;
        while ((nl = buffer.indexOf("\n")) >= 0) {
          const line = buffer.slice(0, nl);
          buffer = buffer.slice(nl + 1);
          if (!line.trim()) continue;
          const ev = JSON.parse(line);
          if (ev.type === "reasoning") { phase = "Denkt …"; appendReasoning(ev.text); }
          else if (ev.type === "content") { phase = "Schreibt …"; content += ev.text; result.textContent = content.trim(); }
          else if (ev.type === "done") finish(ev);
          else if (ev.type === "error") throw new Error(ev.message);
        }
      }
    } catch (err) {
      clearInterval(timer);
      if (err.name === "AbortError") setStatus("Abgebrochen nach " + seconds(performance.now() - started));
      else setStatus("Fehler: " + err.message, true);
      if (!result.textContent) { result.textContent = "Kein Ergebnis."; result.classList.add("empty"); }
    } finally {
      clearInterval(timer);
      controller = null;
      setRunning(false);
      if (!reasoning.textContent) reasoning.innerHTML = '<span class="placeholder">Kein Denkprozess übertragen.</span>';
    }
  });

  function finish(ev) {
    clearInterval(timer);
    result.textContent = ev.text || "Leere Antwort – siehe Rohantwort.";
    result.classList.toggle("empty", !ev.text);
    $("copyBtn").disabled = !ev.text;
    $("mTime").textContent = seconds(ev.ms);
    $("mTokens").textContent = ev.usage ? `${ev.usage.prompt_tokens} → ${ev.usage.completion_tokens}` : "–";
    $("mFinish").textContent = ev.finish || "–";
    $("raw").textContent = ev.raw || "(leer)";
    $("rawBox").hidden = ev.raw.trim() === ev.text;
    setStatus("Fertig in " + seconds(ev.ms));
  }

  $("stopBtn").addEventListener("click", () => controller && controller.abort());

  $("copyBtn").addEventListener("click", async () => {
    try {
      await navigator.clipboard.writeText(result.textContent);
      $("copyBtn").textContent = "Kopiert";
      setTimeout(() => { $("copyBtn").textContent = "Kopieren"; }, 1500);
    } catch (e) { /* egal */ }
  });

  // ---------- Modell & Parameter ----------
  const PARAMS = ["temperature", "top_p", "top_k", "presence_penalty", "max_tokens"];
  const LABELS = { lts: "LTS", stable: "stabil", experimental: "experimentell" };
  let models = [];
  let server = null;   // Einstellungen, mit denen der Automat läuft
  let effort = null;

  const current = () => models.find((m) => m.id === $("model").value);
  const fmt = (n) => n.toLocaleString("de-DE");

  function markCustom() {
    const sel = $("profile");
    let opt = sel.querySelector('option[value="custom"]');
    if (!opt) { opt = new Option("Eigene Einstellungen", "custom"); sel.append(opt); }
    sel.value = "custom";
    updateChips();
  }

  function renderEffort(list, active, enabled) {
    $("effort").replaceChildren(...(list || []).map((e) => {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.role = "radio";
      btn.textContent = e;
      btn.disabled = !enabled;
      btn.setAttribute("aria-checked", String(e === active));
      btn.addEventListener("click", () => { effort = e; renderEffort(list, e, true); markCustom(); });
      return btn;
    }));
    effort = active;
  }

  // Schalter und Denkstufen so einstellen, wie das Modell es erlaubt.
  function renderReasoning() {
    const m = current();
    const r = (m && m.reasoning) || { mode: "none" };
    const box = $("thinking");
    box.disabled = r.mode === "none" || r.mode === "effort";
    if (r.mode === "effort") box.checked = true;
    if (r.mode === "none") box.checked = false;
    $("thinkingText").textContent = box.checked ? "An" : "Aus";
    $("thinkingHint").textContent = {
      "template-effort": "Lässt sich pro Anfrage abschalten",
      "template-toggle": "Lässt sich pro Anfrage abschalten",
      effort: "Denkt immer – nur die Stufe ist wählbar",
      none: "Dieses Modell hat keinen Denkmodus",
    }[r.mode];
    const efforts = r.efforts || null;
    const wanted = efforts && efforts.includes(effort) ? effort : r.defaultEffort;
    renderEffort(efforts, wanted, !!efforts && box.checked);
    $("effortHint").textContent = efforts
      ? (box.checked ? `Standard des Modells: ${r.defaultEffort}` : "Nur mit Thinking")
      : "Dieses Modell kennt keine Denkstufen";
    updateChips();
  }

  function applyProfile(p) {
    const m = current();
    const r = m.reasoning || {};
    $("thinking").checked = p.thinking ?? r.defaultOn ?? false;
    effort = p.effort || r.defaultEffort || null;
    for (const k of PARAMS) {
      if (k === "max_tokens" && p[k] === undefined) continue; // Max. Tokens bleibt beim Profilwechsel stehen
      $("p-" + k).value = p[k] ?? "";
    }
    const maxOut = Math.min(32768, m.maxOutput || 32768);
    $("p-max_tokens").max = maxOut;
    renderReasoning();
  }

  function selectModel(id) {
    $("model").value = id;
    const m = current();
    const profiles = [...m.profiles];
    if (server && server.model === m.id) profiles.unshift({ ...server, id: "server", label: "Wie der Automat" });
    $("profile").replaceChildren(...profiles.map((p) => new Option(p.label, p.id)));
    $("profile").dataset.profiles = JSON.stringify(profiles);
    applyProfile(profiles[0]);
    const info = [m.name !== m.id && m.id, m.label && (LABELS[m.label] || m.label), m.tokenFactor != null && `Token-Faktor ×${fmt(m.tokenFactor)}`, m.maxOutput && `bis ${fmt(m.maxOutput)} Tokens`];
    $("modelInfo").textContent = info.filter(Boolean).join(" · ") || "\u00a0";
    $("docLink").hidden = !m.docLink;
    if (m.docLink) $("docLink").href = m.docLink;
  }

  function settings() {
    const out = { model: $("model").value, thinking: $("thinking").checked, effort };
    for (const k of PARAMS) out[k] = $("p-" + k).value === "" ? null : Number($("p-" + k).value);
    return out;
  }

  function updateChips() {
    const m = current();
    if (!m) return;
    $("modelChip").textContent = m.id;
    const r = m.reasoning || {};
    $("thinkChip").textContent = "Thinking: " + (r.mode === "none" || !$("thinking").checked ? "aus" : effort || "an");
  }

  $("model").addEventListener("change", () => selectModel($("model").value));
  $("profile").addEventListener("change", () => {
    const p = JSON.parse($("profile").dataset.profiles).find((x) => x.id === $("profile").value);
    if (p) applyProfile(p);
    const custom = $("profile").querySelector('option[value="custom"]');
    if (custom && $("profile").value !== "custom") custom.remove();
  });
  $("thinking").addEventListener("change", () => { renderReasoning(); markCustom(); });
  PARAMS.forEach((k) => $("p-" + k).addEventListener("input", markCustom));

  function setModelControls(on) {
    for (const el of document.querySelectorAll("#modelCard select, #modelCard input")) el.disabled = !on;
    if (on) renderReasoning();
    else $("effort").querySelectorAll("button").forEach((b) => { b.disabled = true; });
  }

  // ---------- Start ----------
  randomPair();
  fetch("api/prompt")
    .then((r) => (r.ok ? r.json() : Promise.reject(new Error("HTTP " + r.status))))
    .then((d) => {
      defaults = d;
      server = d.server;
      $("system").value = d.system;
      updateCount();
      updatePreview();
      if (!d.ready) { setStatus("Kein LLM_API_KEY gesetzt – Testen nicht möglich.", true); return; }
      return fetch("api/models").then((r) => r.json()).then((list) => {
        models = list.models || [];
        if (!models.length) throw new Error(list.error || "keine Modelle");
        $("model").replaceChildren(...models.map((m) => new Option(m.name, m.id)));
        selectModel(models.some((m) => m.id === server.model) ? server.model : models[0].id);
      });
    })
    .catch((e) => setStatus("Server nicht erreichbar: " + e.message, true));
})();

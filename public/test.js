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

  function randomPair() {
    const r = dreher.spin();
    $("a").value = r.sources[0];
    $("b").value = r.sources[1];
    updatePreview();
  }

  function updatePreview() {
    $("userPreview").textContent = defaults.user.replace("{1}", $("a").value).replace("{2}", $("b").value);
  }

  function updateCount() {
    $("charCount").textContent = $("system").value.length.toLocaleString("de-DE");
  }

  $("a").addEventListener("change", updatePreview);
  $("b").addEventListener("change", updatePreview);
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
        body: JSON.stringify({ a: $("a").value, b: $("b").value, system: $("system").value }),
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

  // ---------- Start ----------
  randomPair();
  fetch("api/prompt")
    .then((r) => (r.ok ? r.json() : Promise.reject(new Error("HTTP " + r.status))))
    .then((d) => {
      defaults = d;
      $("system").value = d.system;
      $("modelChip").textContent = d.model;
      $("thinkChip").textContent = "Thinking: " + d.thinking;
      updateCount();
      updatePreview();
      if (!d.ready) setStatus("Kein LLM_API_KEY gesetzt – Testen nicht möglich.", true);
    })
    .catch((e) => setStatus("Server nicht erreichbar: " + e.message, true));
})();

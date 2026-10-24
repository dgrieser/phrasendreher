(function () {
  "use strict";

  const WAITING = [
    "Die Walzen glühen …",
    "Hier wird gerade ein Fass aufgemacht …",
    "Die Phrasen werden gedroschen …",
    "Gleich fällt der Groschen …",
    "Das Rad wird neu erfunden …",
    "Kurz die Kirche ums Dorf tragen …",
  ];

  const $ = (id) => document.getElementById(id);
  const body = document.body;
  const reels = [...document.querySelectorAll(".reel")];
  const strips = reels.map((r) => r.querySelector(".strip"));
  const dreher = Dreher.createDreher(window.REDEWENDUNGEN);
  const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];

  // ---------- Speicher (nur Komfort, darf fehlen) ----------
  const store = {
    get(key, fallback) {
      try { const v = localStorage.getItem("phrasendreher:" + key); return v ? JSON.parse(v) : fallback; }
      catch (e) { return fallback; }
    },
    set(key, value) {
      try { localStorage.setItem("phrasendreher:" + key, JSON.stringify(value)); } catch (e) { /* egal */ }
    },
  };
  let spins = store.get("spins", 0);
  let favorites = store.get("favorites", []);
  let history = store.get("history", []);

  // ---------- Walzen ----------
  const fillers = [[], [], []];
  for (let i = 0; i < 80; i++) {
    const r = dreher.spin();
    if (r) r.reels.forEach((part, k) => part && fillers[k].push(part));
  }

  function makeItem(text) {
    const el = document.createElement("div");
    el.className = "item";
    if (!text) { el.classList.add("empty"); el.textContent = "·"; return el; }
    el.textContent = text;
    if (text.length > 24) el.classList.add("long");
    else if (text.length > 14) el.classList.add("mid");
    return el;
  }

  function setReel(k, text) {
    strips[k].replaceChildren(makeItem(text));
  }

  // Dreht endlos, bis landReel() aufgerufen wird.
  const loops = [];
  function startReel(k) {
    const strip = strips[k];
    const current = strip.lastElementChild ? strip.lastElementChild.textContent : "";
    const loop = Array.from({ length: 10 }, () => pick(fillers[k]));
    // Der Anfang wird hinten wiederholt, damit die Schleife nahtlos ist.
    strip.replaceChildren(...[current, ...loop, current].map(makeItem));
    const h = reels[k].clientHeight;
    strip.classList.add("blur");
    loops[k] = strip.animate(
      [{ transform: "translateY(0)" }, { transform: `translateY(${-(loop.length + 1) * h}px)` }],
      { duration: (loop.length + 1) * (reduceMotion ? 500 : 110 + k * 12), iterations: Infinity }
    );
  }

  // Bremst die Walze ab und lässt sie auf finalText einrasten.
  function landReel(k, finalText, duration) {
    const strip = strips[k];
    if (loops[k]) loops[k].cancel();
    const count = reduceMotion ? 1 : 5 + k * 2;
    const items = [];
    for (let i = 0; i < count; i++) items.push(makeItem(pick(fillers[k])));
    items.push(makeItem(finalText));
    strip.replaceChildren(...items);
    const h = reels[k].clientHeight;
    const anim = strip.animate(
      [{ transform: "translateY(0)" }, { transform: `translateY(${-(items.length - 1) * h}px)` }],
      { duration, easing: "cubic-bezier(.12, .7, .2, 1)", fill: "forwards" }
    );
    setTimeout(() => strip.classList.remove("blur"), duration * 0.55);
    return anim.finished.then(() => {
      anim.cancel();
      strip.classList.remove("blur");
      setReel(k, finalText);
      reels[k].classList.remove("landed");
      void reels[k].offsetWidth;
      reels[k].classList.add("landed");
      sound.settle(k);
      vibrate(10);
    });
  }

  // ---------- Drehen ----------
  let busy = false;
  let current = null;
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));

  // Fragt den Server (LLM). Ohne Server mischt der Browser selbst.
  async function fetchPhrase() {
    try {
      const res = await fetch("api/dreh", { method: "POST", signal: AbortSignal.timeout(60000) });
      if (!res.ok) throw new Error("HTTP " + res.status);
      const data = await res.json();
      if (data && data.text) return data.text;
    } catch (e) { /* Notlösung unten */ }
    return dreher.spin().text;
  }

  async function spin() {
    if (busy) return;
    busy = true;
    body.classList.add("spinning");
    $("actions").classList.add("hidden");
    sound.unlock();
    $("note").textContent = pick(WAITING);
    reels.forEach((_, k) => startReel(k));
    const stopTicks = sound.ticking();
    const [text] = await Promise.all([fetchPhrase(), wait(reduceMotion ? 300 : 1200)]);
    const parts = Dreher.splitInThree(text);
    const base = reduceMotion ? 250 : 1100;
    await Promise.all(parts.map((p, k) => landReel(k, p, base + k * (reduceMotion ? 120 : 380))));
    stopTicks();
    spins++;
    store.set("spins", spins);
    show(text, true);
    busy = false;
    body.classList.remove("spinning");
  }

  function show(text, fresh) {
    current = text;
    $("phrase").textContent = text;
    $("counter").textContent = "Nº " + spins;
    $("note").textContent = " ";
    $("actions").classList.remove("hidden");
    updateFavButton();
    if (fresh) {
      history = [text, ...history.filter((t) => t !== text)].slice(0, 15);
      store.set("history", history);
      renderLists();
      sound.chime();
    }
  }

  // ---------- Hebel ----------
  // Der Knauf folgt frei dem Finger. Kurz vor dem Anschlag löst er aus und schnellt zurück.
  const lever = $("lever");
  const knob = $("leverKnob");
  const arm = $("leverArm");
  const TRIGGER = 0.9;
  let pos = 0;          // 0 = oben, 1 = unten
  let spring = null;

  function geometry() {
    const h = lever.clientHeight;
    const k = knob.offsetHeight;
    return { top: k / 2, bottom: h - k / 2, pivot: h / 2 };
  }

  function renderLever(p) {
    pos = p;
    const g = geometry();
    const y = g.top + p * (g.bottom - g.top);
    // Der Knauf kommt in der Mitte auf uns zu – wie ein echter Hebel, der nach vorn kippt.
    const scale = 1 + 0.22 * Math.sin(Math.max(0, Math.min(1, p)) * Math.PI);
    knob.style.transform = `translateY(${y - knob.offsetHeight / 2}px) scale(${scale})`;
    arm.style.top = Math.min(y, g.pivot) + "px";
    arm.style.height = Math.abs(y - g.pivot) + "px";
  }

  function springBack() {
    if (spring) cancelAnimationFrame(spring);
    let v = 0;
    let last = performance.now();
    const step = (now) => {
      const dt = Math.min(0.032, (now - last) / 1000);
      last = now;
      v += (-260 * pos - 13 * v) * dt;
      const p = pos + v * dt;
      renderLever(p);
      if (Math.abs(p) < 0.001 && Math.abs(v) < 0.01) { renderLever(0); spring = null; return; }
      spring = requestAnimationFrame(step);
    };
    if (reduceMotion) { renderLever(0); return; }
    spring = requestAnimationFrame(step);
  }

  function pullAndSpin() {
    if (busy) return;
    if (spring) cancelAnimationFrame(spring);
    const start = performance.now();
    const from = pos;
    const step = (now) => {
      const t = Math.min(1, (now - start) / 260);
      renderLever(from + (1 - from) * t * t);
      if (t < 1) requestAnimationFrame(step);
      else release();
    };
    requestAnimationFrame(step);
  }

  function release() {
    vibrate(25);
    sound.clack();
    springBack();
    spin();
  }

  let drag = null;
  lever.addEventListener("pointerdown", (e) => {
    if (busy) return;
    if (spring) { cancelAnimationFrame(spring); spring = null; }
    const g = geometry();
    const knobY = g.top + pos * (g.bottom - g.top);
    const rect = lever.getBoundingClientRect();
    const grabbedKnob = Math.abs(e.clientY - rect.top - knobY) < knob.offsetHeight;
    // Den Knauf greift man, wo man ihn anfasst; daneben springt er unter den Finger.
    drag = { offset: grabbedKnob ? e.clientY - rect.top - knobY : 0, y: e.clientY, t: Date.now(), moved: 0, rect, g };
    lever.setPointerCapture(e.pointerId);
    lever.classList.add("dragging");
  });
  lever.addEventListener("pointermove", (e) => {
    if (!drag) return;
    const { rect, g, offset } = drag;
    const p = (e.clientY - rect.top - offset - g.top) / (g.bottom - g.top);
    const clamped = Math.max(0, Math.min(1, p));
    drag.moved = Math.max(drag.moved, Math.abs(e.clientY - drag.y));
    renderLever(clamped);
    if (clamped >= TRIGGER) {
      drag = null;
      lever.classList.remove("dragging");
      renderLever(1);
      release();
    }
  });
  const endDrag = () => {
    if (!drag) return;
    const tapped = drag.moved < 6 && Date.now() - drag.t < 350;
    drag = null;
    lever.classList.remove("dragging");
    if (tapped) pullAndSpin();
    else springBack();
  };
  lever.addEventListener("pointerup", endDrag);
  lever.addEventListener("pointercancel", endDrag);
  lever.addEventListener("keydown", (e) => {
    if ((e.key === "Enter" || e.key === " ") && !busy) { e.preventDefault(); pullAndSpin(); }
  });
  document.addEventListener("keydown", (e) => {
    if (e.key === " " && e.target === body && !busy) { e.preventDefault(); pullAndSpin(); }
  });
  window.addEventListener("resize", () => renderLever(pos));

  // ---------- Teilen & Merken ----------
  $("shareBtn").addEventListener("click", async () => {
    if (!current) return;
    const url = location.origin + location.pathname + "#w=" + encodeURIComponent(current);
    const text = `„${current}“ – frisch verdreht beim Phrasendreher`;
    try {
      if (navigator.share) { await navigator.share({ title: "Phrasendreher", text, url }); return; }
      await navigator.clipboard.writeText(text + "\n" + url);
      toast("In die Zwischenablage kopiert");
    } catch (e) {
      if (e && e.name !== "AbortError") toast("Teilen ging in die Binsen");
    }
  });

  $("favBtn").addEventListener("click", () => {
    if (!current) return;
    const has = favorites.includes(current);
    favorites = has ? favorites.filter((t) => t !== current) : [current, ...favorites];
    store.set("favorites", favorites);
    updateFavButton();
    renderLists();
    if (!has) toast("Gemerkt");
  });

  function updateFavButton() {
    const on = !!current && favorites.includes(current);
    const btn = $("favBtn");
    btn.setAttribute("aria-pressed", String(on));
    btn.textContent = on ? "Gemerkt" : "Merken";
  }

  // ---------- Archiv ----------
  const tabs = [["tabFav", "favPanel"], ["tabHist", "histPanel"]];
  tabs.forEach(([tab]) => $(tab).addEventListener("click", () => {
    tabs.forEach(([t, panel]) => {
      const on = t === tab;
      $(t).setAttribute("aria-selected", String(on));
      $(panel).hidden = !on;
    });
  }));

  function renderLists() {
    $("favCount").textContent = favorites.length ? String(favorites.length) : "";
    $("favEmpty").hidden = favorites.length > 0;
    $("histEmpty").hidden = history.length > 0;
    $("favList").replaceChildren(...favorites.map((t) => listItem(t, "×", "Entfernen", () => {
      favorites = favorites.filter((f) => f !== t);
      store.set("favorites", favorites);
      renderLists();
      updateFavButton();
    })));
    $("historyList").replaceChildren(...history.map((t) => listItem(t, "↑", "Wieder anzeigen", () => {
      if (busy) return;
      Dreher.splitInThree(t).forEach((p, k) => setReel(k, p));
      show(t, false);
      window.scrollTo({ top: 0, behavior: reduceMotion ? "auto" : "smooth" });
    })));
  }

  function listItem(text, icon, label, onClick) {
    const li = document.createElement("li");
    const span = document.createElement("span");
    span.textContent = text;
    const btn = document.createElement("button");
    btn.type = "button";
    btn.textContent = icon;
    btn.setAttribute("aria-label", label);
    btn.addEventListener("click", onClick);
    li.append(span, btn);
    return li;
  }

  function toast(msg) {
    const t = $("toast");
    t.textContent = msg;
    t.classList.add("show");
    clearTimeout(toast.timer);
    toast.timer = setTimeout(() => t.classList.remove("show"), 2000);
  }

  function vibrate(p) { try { navigator.vibrate && navigator.vibrate(p); } catch (e) { /* egal */ } }

  // ---------- Ton (leise und warm) ----------
  const sound = (() => {
    let ctx = null;
    let on = store.get("sound", true);
    const btn = $("soundBtn");
    const render = () => { btn.textContent = on ? "Ton an" : "Ton aus"; btn.setAttribute("aria-pressed", String(on)); };
    render();
    btn.addEventListener("click", () => { on = !on; store.set("sound", on); render(); });

    function tone(freq, dur, vol, when = 0, type = "sine") {
      if (!on || !ctx) return;
      const t = ctx.currentTime + when;
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.type = type;
      o.frequency.setValueAtTime(freq, t);
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(vol, t + 0.008);
      g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      o.connect(g).connect(ctx.destination);
      o.start(t);
      o.stop(t + dur + 0.05);
    }

    return {
      unlock() {
        try {
          if (!ctx) ctx = new (window.AudioContext || window.webkitAudioContext)();
          if (ctx.state === "suspended") ctx.resume();
        } catch (e) { ctx = null; }
      },
      ticking() {
        let stopped = false;
        const tick = () => {
          if (stopped) return;
          tone(1800 + Math.random() * 400, 0.025, 0.012);
          setTimeout(tick, 95);
        };
        tick();
        return () => { stopped = true; };
      },
      clack() { tone(140, 0.12, 0.12, 0, "triangle"); tone(90, 0.18, 0.08, 0.04, "sine"); },
      settle(k) { tone(220 - k * 25, 0.25, 0.08, 0, "triangle"); },
      chime() { [659, 988, 1319].forEach((f, i) => tone(f, 1.2, 0.035, i * 0.07)); },
    };
  })();

  // ---------- Start ----------
  ["Hebel ziehen,", "warten,", "staunen."].forEach((t, k) => setReel(k, t));
  renderLever(0);
  $("counter").textContent = "Nº " + spins;
  $("actions").classList.add("hidden");
  renderLists();
  updateFavButton();

  const shared = new URLSearchParams(location.hash.slice(1)).get("w");
  if (shared) {
    const text = shared.slice(0, 200);
    Dreher.splitInThree(text).forEach((p, k) => setReel(k, p));
    show(text, false);
    $("note").textContent = "Jemand hat dir diese Weisheit geschickt.";
  }
})();

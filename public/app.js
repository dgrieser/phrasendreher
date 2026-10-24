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

  // ---------- Schieberegler ----------
  const slider = $("slider");
  const knob = $("sliderThumb");
  const label = $("sliderLabel");
  const travel = () => slider.clientWidth - knob.offsetWidth - 14;

  function moveKnob(d, max) {
    knob.style.transform = `translateX(${d}px)`;
    label.style.opacity = String(1 - d / max);
  }
  function snapBack(from) {
    knob.animate([{ transform: `translateX(${from}px)` }, { transform: "translateX(0)" }],
      { duration: 520, easing: "cubic-bezier(.3, 1.25, .5, 1)" });
    knob.style.transform = "";
    label.style.opacity = "";
  }
  function glideAndSpin(from, max) {
    knob.animate([{ transform: `translateX(${from}px)` }, { transform: `translateX(${max}px)` }],
      { duration: reduceMotion ? 1 : 240, easing: "ease-in" })
      .finished.then(() => { snapBack(max); spin(); });
  }

  let drag = null;
  slider.addEventListener("pointerdown", (e) => {
    if (busy) return;
    drag = { x: e.clientX, t: Date.now(), d: 0, max: travel() };
    slider.setPointerCapture(e.pointerId);
  });
  slider.addEventListener("pointermove", (e) => {
    if (!drag) return;
    drag.d = Math.max(0, Math.min(drag.max, e.clientX - drag.x));
    moveKnob(drag.d, drag.max);
  });
  slider.addEventListener("pointerup", () => {
    if (!drag) return;
    const { d, max, t } = drag;
    drag = null;
    const tapped = d < 6 && Date.now() - t < 400;
    if (tapped || d > max * 0.7) glideAndSpin(d, max);
    else snapBack(d);
  });
  slider.addEventListener("pointercancel", () => { if (drag) { snapBack(drag.d); drag = null; } });
  slider.addEventListener("keydown", (e) => {
    if ((e.key === "Enter" || e.key === " ") && !busy) { e.preventDefault(); glideAndSpin(0, travel()); }
  });
  document.addEventListener("keydown", (e) => {
    if (e.key === " " && e.target === body && !busy) { e.preventDefault(); glideAndSpin(0, travel()); }
  });

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
      settle(k) { tone(220 - k * 25, 0.25, 0.08, 0, "triangle"); },
      chime() { [659, 988, 1319].forEach((f, i) => tone(f, 1.2, 0.035, i * 0.07)); },
    };
  })();

  // ---------- Start ----------
  ["Schieben,", "warten,", "staunen."].forEach((t, k) => setReel(k, t));
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

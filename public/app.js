(function () {
  "use strict";

  const WAITING = ["Die Walzen glühen …", "Hier wird gerade ein Fass aufgemacht …", "Die Phrasen werden gedroschen …", "Gleich fällt der Groschen …", "Das Rad wird neu erfunden …", "Kurz die Kirche ums Dorf tragen …"];
  const BADGES = ["Volltreffer!", "Gewonnen!", "Frisch verdreht", "Weisheit des Tages", "Bingo!", "Sprichwörtlich!", "Zack, verdreht!", "Ausgezeichnet falsch"];

  const $ = (id) => document.getElementById(id);
  const machine = document.querySelector(".machine");
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
    if (!text) { el.classList.add("empty"); el.textContent = "!"; }
    else {
      el.textContent = text;
      if (text.length > 26) el.classList.add("small");
    }
    return el;
  }

  function setReel(k, text) {
    strips[k].replaceChildren(makeItem(text));
    strips[k].style.transform = "";
  }

  // Dreht endlos, bis land() aufgerufen wird.
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
      { duration: (loop.length + 1) * (reduceMotion ? 400 : 75 + k * 8), iterations: Infinity }
    );
  }

  // Bremst die Walze ab und lässt sie auf finalText einrasten.
  function landReel(k, finalText, duration) {
    const strip = strips[k];
    if (loops[k]) loops[k].cancel();
    const count = reduceMotion ? 1 : 6 + k * 3;
    const items = [];
    for (let i = 0; i < count; i++) items.push(makeItem(pick(fillers[k])));
    items.push(makeItem(finalText));
    strip.replaceChildren(...items);
    const h = reels[k].clientHeight;
    const anim = strip.animate(
      [{ transform: "translateY(0)" }, { transform: `translateY(${-(items.length - 1) * h}px)` }],
      { duration, easing: "cubic-bezier(.15, .75, .3, 1.08)", fill: "forwards" }
    );
    setTimeout(() => strip.classList.remove("blur"), duration * 0.6);
    return anim.finished.then(() => {
      anim.cancel();
      strip.classList.remove("blur");
      setReel(k, finalText);
      reels[k].classList.remove("landed");
      void reels[k].offsetWidth;
      reels[k].classList.add("landed");
      sound.clunk(k);
      vibrate(18);
    });
  }

  // ---------- Drehen ----------
  let busy = false;
  let current = null;
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));

  // Fragt den Server (LLM). Ohne Server – z. B. als reine statische Seite – mischt der Browser selbst.
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
    machine.classList.add("spinning");
    document.querySelector(".lever").classList.add("used");
    sound.unlock();
    $("ticket").style.opacity = ".45";
    $("badge").textContent = "Dreht…";
    $("note").textContent = pick(WAITING);
    reels.forEach((_, k) => startReel(k));
    const stopTicks = sound.ticking();
    const [text] = await Promise.all([fetchPhrase(), wait(reduceMotion ? 300 : 1100)]);
    const parts = Dreher.splitInThree(text);
    const base = reduceMotion ? 250 : 900;
    await Promise.all(parts.map((p, k) => landReel(k, p, base + k * (reduceMotion ? 120 : 450))));
    stopTicks();
    spins++;
    store.set("spins", spins);
    show(text, true);
    busy = false;
    machine.classList.remove("spinning");
  }

  function show(text, fresh) {
    current = { text };
    $("counter").textContent = String(spins).padStart(3, "0");
    $("phrase").textContent = text;
    $("badge").textContent = fresh ? pick(BADGES) : "Geteilte Weisheit";
    $("note").textContent = "";
    const ticket = $("ticket");
    ticket.style.opacity = "";
    ticket.classList.remove("pop");
    void ticket.offsetWidth;
    ticket.classList.add("pop");
    updateFavButton();
    if (fresh) {
      history = [text, ...history.filter((t) => t !== text)].slice(0, 15);
      store.set("history", history);
      renderLists();
      sound.ding();
    }
  }

  // ---------- Hebel ----------
  const lever = $("lever");
  const arm = $("leverArm");
  function leverTravel() { return lever.clientHeight - 44 - 34; }

  function releaseArm(fromY) {
    arm.animate(
      [{ transform: `translateY(${fromY}px)` }, { transform: "translateY(-6px)", offset: 0.7 }, { transform: "translateY(0)" }],
      { duration: 420, easing: "ease-out" }
    );
    arm.style.transform = "";
  }

  function autoPull(then) {
    const t = leverTravel();
    arm.animate([{ transform: "translateY(0)" }, { transform: `translateY(${t}px)` }], { duration: 220, easing: "ease-in" })
      .finished.then(() => { releaseArm(t); then(); });
  }

  dragHandler(lever, {
    axis: "y",
    max: leverTravel,
    move: (d) => { arm.style.transform = `translateY(${d}px)`; },
    end: (d, max, tapped) => {
      if (tapped) { arm.style.transform = ""; return autoPull(spin); }
      releaseArm(d);
      if (d > max * 0.6) spin();
    },
  });

  // ---------- Schieberegler ----------
  const slider = $("slider");
  const thumb = $("sliderThumb");
  function sliderTravel() { return slider.clientWidth - thumb.offsetWidth - 10; }
  function snapThumb(from) {
    thumb.animate([{ transform: `translateX(${from}px)` }, { transform: "translateX(0)" }], { duration: 350, easing: "cubic-bezier(.3, 1.4, .5, 1)" });
    thumb.style.transform = "";
  }
  dragHandler(slider, {
    axis: "x",
    max: sliderTravel,
    move: (d) => { thumb.style.transform = `translateX(${d}px) rotate(${d * 1.5}deg)`; },
    end: (d, max, tapped) => {
      if (tapped) {
        thumb.animate([{ transform: "translateX(0)" }, { transform: `translateX(${max}px) rotate(${max * 1.5}deg)` }], { duration: 260, easing: "ease-in" })
          .finished.then(() => { snapThumb(max); spin(); });
        return;
      }
      snapThumb(d);
      if (d > max * 0.75) spin();
    },
  });

  function dragHandler(el, { axis, max, move, end }) {
    let start = null;
    el.addEventListener("pointerdown", (e) => {
      if (busy) return;
      start = { x: e.clientX, y: e.clientY, t: Date.now(), d: 0, max: max() };
      el.setPointerCapture(e.pointerId);
    });
    el.addEventListener("pointermove", (e) => {
      if (!start) return;
      const raw = axis === "y" ? e.clientY - start.y : e.clientX - start.x;
      start.d = Math.max(0, Math.min(start.max, raw));
      move(start.d);
    });
    const finish = () => {
      if (!start) return;
      const s = start;
      start = null;
      end(s.d, s.max, s.d < 6 && Date.now() - s.t < 400);
    };
    el.addEventListener("pointerup", finish);
    el.addEventListener("pointercancel", () => { if (start) { start.d = 0; start = null; move(0); } });
    el.addEventListener("keydown", (e) => {
      if ((e.key === "Enter" || e.key === " ") && !busy) { e.preventDefault(); end(0, max(), true); }
    });
  }

  document.addEventListener("keydown", (e) => {
    if (e.key === " " && e.target === document.body && !busy) { e.preventDefault(); autoPull(spin); }
  });

  // ---------- Teilen & Merken ----------
  $("shareBtn").addEventListener("click", async () => {
    if (!current) return;
    const url = location.origin + location.pathname + "#w=" + encodeURIComponent(current.text);
    const text = `„${current.text}“ – frisch gedreht beim Phrasendreher 🎰`;
    try {
      if (navigator.share) { await navigator.share({ title: "Phrasendreher", text, url }); return; }
      await navigator.clipboard.writeText(text + "\n" + url);
      toast("In die Zwischenablage gekritzelt ✍️");
    } catch (e) {
      if (e && e.name !== "AbortError") toast("Teilen ging in die Binsen 🙈");
    }
  });

  $("favBtn").addEventListener("click", () => {
    if (!current) return;
    const has = favorites.includes(current.text);
    favorites = has ? favorites.filter((t) => t !== current.text) : [current.text, ...favorites];
    store.set("favorites", favorites);
    updateFavButton();
    renderLists();
    if (!has) toast("Gemerkt! Das hat einen Haken – im besten Sinne ⭐");
  });

  function updateFavButton() {
    const on = !!current && favorites.includes(current.text);
    const btn = $("favBtn");
    btn.disabled = !current;
    btn.setAttribute("aria-pressed", String(on));
    btn.textContent = on ? "★ Gemerkt" : "☆ Merken";
  }

  function renderLists() {
    $("favCount").textContent = `(${favorites.length})`;
    $("favEmpty").hidden = favorites.length > 0;
    $("favList").replaceChildren(...favorites.map((t) => listItem(t, "✕", "Entfernen", () => {
      favorites = favorites.filter((f) => f !== t);
      store.set("favorites", favorites);
      renderLists();
      updateFavButton();
    })));
    $("historyList").replaceChildren(...history.map((t) => listItem(t, "↺", "Nochmal anzeigen", () => {
      show(t, false);
      Dreher.splitInThree(t).forEach((p, k) => setReel(k, p));
      window.scrollTo({ top: 0, behavior: "smooth" });
    })));
  }

  function listItem(text, icon, label, onClick) {
    const li = document.createElement("li");
    const span = document.createElement("span");
    span.textContent = `„${text}“`;
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
    toast.timer = setTimeout(() => t.classList.remove("show"), 2200);
  }

  function vibrate(p) { try { navigator.vibrate && navigator.vibrate(p); } catch (e) { /* egal */ } }

  // ---------- Ton ----------
  const sound = (() => {
    let ctx = null;
    let on = store.get("sound", true);
    const btn = $("soundBtn");
    const render = () => { btn.textContent = on ? "🔊 Ton an" : "🔇 Ton aus"; btn.setAttribute("aria-pressed", String(on)); };
    render();
    btn.addEventListener("click", () => { on = !on; store.set("sound", on); render(); });

    function beep(freq, dur, type = "square", vol = 0.05, when = 0) {
      if (!on || !ctx) return;
      const t = ctx.currentTime + when;
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.type = type;
      o.frequency.setValueAtTime(freq, t);
      g.gain.setValueAtTime(vol, t);
      g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      o.connect(g).connect(ctx.destination);
      o.start(t);
      o.stop(t + dur + 0.02);
    }

    return {
      unlock() {
        try {
          if (!ctx) ctx = new (window.AudioContext || window.webkitAudioContext)();
          if (ctx.state === "suspended") ctx.resume();
        } catch (e) { ctx = null; }
      },
      ticking() {
        let delay = 55;
        let stopped = false;
        const tick = () => {
          if (stopped) return;
          beep(900 + Math.random() * 300, 0.03, "square", 0.025);
          delay = Math.min(delay * 1.06, 180);
          setTimeout(tick, delay);
        };
        tick();
        return () => { stopped = true; };
      },
      clunk(k) { beep(180 - k * 30, 0.12, "triangle", 0.18); },
      ding() { [784, 1047, 1319].forEach((f, i) => beep(f, 0.25, "sine", 0.12, i * 0.09)); },
    };
  })();

  // ---------- Start ----------
  ["Zieh", "den", "Hebel!"].forEach((t, k) => setReel(k, t));
  $("counter").textContent = String(spins).padStart(3, "0");
  renderLists();
  updateFavButton();

  const shared = new URLSearchParams(location.hash.slice(1)).get("w");
  if (shared) {
    const text = shared.slice(0, 200);
    Dreher.splitInThree(text).forEach((p, k) => setReel(k, p));
    show(text, false);
    $("note").textContent = "Jemand hat dir diese Weisheit geschickt. Jetzt selbst drehen!";
  }
})();

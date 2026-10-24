(function () {
  "use strict";

  // Handverlesene Klassiker – fallen selten als Jackpot.
  const KLASSIKER = [
    "Alle Dinge sind drei",
    "Aller Anfang ist Kaffee",
    "Besser spät als gar kein WLAN.",
    "Da muss man die Küche im Dorf lassen",
    "Das ist ein zweischneidiges Pferd",
    "Das ist ja allerunterste Gürtellinie",
    "Das ist nur einen Katzenwurf entfernt",
    "Das ist nur ein ganz schmaler Spagat",
    "Das ist sicher wie die Armen in der Kirche",
    "Das musst Du jetzt nicht aufs Trapez bringen",
    "Das Pferd von hinten aufrollen",
  ];
  const JACKPOT_CHANCE = 1 / 12;
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

  function spinReel(k, finalText, duration) {
    const strip = strips[k];
    const current = strip.lastElementChild ? strip.lastElementChild.textContent : "";
    const count = reduceMotion ? 2 : 14 + k * 5;
    const items = [makeItem(current)];
    for (let i = 0; i < count; i++) items.push(makeItem(pick(fillers[k])));
    items.push(makeItem(finalText));
    strip.replaceChildren(...items);
    const h = reels[k].clientHeight;
    const end = -(items.length - 1) * h;
    strip.classList.add("blur");
    const anim = strip.animate(
      [{ transform: "translateY(0)" }, { transform: `translateY(${end}px)` }],
      { duration, easing: "cubic-bezier(.2, .7, .25, 1.06)", fill: "forwards" }
    );
    setTimeout(() => strip.classList.remove("blur"), duration * 0.7);
    return anim.finished.then(() => {
      anim.cancel();
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

  function nextResult() {
    if (spins > 0 && Math.random() < JACKPOT_CHANCE) {
      const text = pick(KLASSIKER).replace(/\.$/, "");
      return { text, reels: Dreher.splitInThree(text), sources: null, jackpot: true };
    }
    return dreher.spin();
  }

  async function spin() {
    if (busy) return;
    busy = true;
    machine.classList.add("spinning");
    document.querySelector(".lever").classList.add("used");
    sound.unlock();
    const result = nextResult();
    $("ticket").style.opacity = ".45";
    $("badge").textContent = "Dreht…";
    $("badge").classList.remove("jackpot");
    const base = reduceMotion ? 300 : 1200;
    const stopTicks = sound.ticking();
    await Promise.all(result.reels.map((text, k) => spinReel(k, text, base + k * (reduceMotion ? 150 : 520))));
    stopTicks();
    spins++;
    store.set("spins", spins);
    show(result, true);
    busy = false;
    machine.classList.remove("spinning");
  }

  function show(result, fresh) {
    current = result;
    $("counter").textContent = String(spins).padStart(3, "0");
    $("phrase").textContent = result.text;
    const badge = $("badge");
    badge.classList.toggle("jackpot", !!result.jackpot);
    badge.textContent = result.jackpot ? "★ JACKPOT ★ Klassiker" : fresh ? pick(BADGES) : "Geteilte Weisheit";
    const src = $("sources");
    src.replaceChildren();
    if (result.sources) {
      src.append("Gemischt aus „", textSpan(result.sources[0]), "“ + „", textSpan(result.sources[1]), "“");
    } else if (result.jackpot) {
      src.textContent = "Handverlesen aus dem Phrasenschwein-Archiv";
    }
    const ticket = $("ticket");
    ticket.style.opacity = "";
    ticket.classList.remove("pop");
    void ticket.offsetWidth;
    ticket.classList.add("pop");
    updateFavButton();
    if (fresh) {
      history = [result.text, ...history.filter((t) => t !== result.text)].slice(0, 15);
      store.set("history", history);
      renderLists();
      if (result.jackpot) { confetti(); sound.jackpot(); vibrate([60, 40, 60, 40, 120]); machine.classList.add("shake"); setTimeout(() => machine.classList.remove("shake"), 450); }
      else sound.ding();
    }
  }

  function textSpan(text) {
    const s = document.createElement("span");
    s.textContent = text;
    return s;
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
      show({ text: t, reels: Dreher.splitInThree(t), sources: null }, false);
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
      jackpot() { [523, 659, 784, 1047, 784, 1047, 1319, 1568].forEach((f, i) => beep(f, 0.2, "square", 0.06, i * 0.1)); },
    };
  })();

  // ---------- Konfetti ----------
  function confetti() {
    if (reduceMotion) return;
    const canvas = $("confetti");
    const c = canvas.getContext("2d");
    const dpr = window.devicePixelRatio || 1;
    canvas.width = innerWidth * dpr;
    canvas.height = innerHeight * dpr;
    c.scale(dpr, dpr);
    const colors = ["#ffcc33", "#ff3d8b", "#3df5c4", "#fff6e0", "#e5232f"];
    const parts = Array.from({ length: 160 }, () => ({
      x: innerWidth / 2 + (Math.random() - 0.5) * 80,
      y: innerHeight * 0.35,
      vx: (Math.random() - 0.5) * 14,
      vy: -Math.random() * 14 - 4,
      s: 5 + Math.random() * 7,
      r: Math.random() * Math.PI,
      vr: (Math.random() - 0.5) * 0.4,
      col: pick(colors),
    }));
    const startT = performance.now();
    (function frame(now) {
      c.clearRect(0, 0, innerWidth, innerHeight);
      parts.forEach((p) => {
        p.vy += 0.35; p.vx *= 0.99; p.x += p.vx; p.y += p.vy; p.r += p.vr;
        c.save(); c.translate(p.x, p.y); c.rotate(p.r);
        c.fillStyle = p.col; c.fillRect(-p.s / 2, -p.s / 4, p.s, p.s / 2);
        c.restore();
      });
      if (now - startT < 3000) requestAnimationFrame(frame);
      else c.clearRect(0, 0, innerWidth, innerHeight);
    })(startT);
  }

  // ---------- Start ----------
  ["Zieh", "den", "Hebel!"].forEach((t, k) => setReel(k, t));
  $("counter").textContent = String(spins).padStart(3, "0");
  renderLists();
  updateFavButton();

  const shared = new URLSearchParams(location.hash.slice(1)).get("w");
  if (shared) {
    const text = shared.slice(0, 200);
    Dreher.splitInThree(text).forEach((p, k) => setReel(k, p));
    show({ text, reels: Dreher.splitInThree(text), sources: null }, false);
    $("sources").textContent = "Jemand hat dir diese Weisheit geschickt. Jetzt selbst drehen!";
  }
})();

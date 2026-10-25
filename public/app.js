(function () {
  "use strict";

  const $ = (id) => document.getElementById(id);
  const body = document.body;
  const dreher = Dreher.createDreher(window.REDEWENDUNGEN);
  const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const mod = (a, n) => ((a % n) + n) % n;

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

  // ---------- Casino-Lichter im Hintergrund ----------
  (function bokeh() {
    const colors = ["255,207,122", "255,179,71", "255,156,64", "255,226,168", "255,120,60", "160,180,255"];
    const box = $("bokeh");
    for (let i = 0; i < 34; i++) {
      const s = document.createElement("span");
      const size = 24 + Math.random() * 130;
      const c = i % 11 === 0 ? colors[5] : pick(colors.slice(0, 5));
      s.style.cssText = `left:${Math.random() * 100}%;top:${Math.random() * 100}%;width:${size}px;height:${size}px;` +
        `margin:${-size / 2}px 0 0 ${-size / 2}px;opacity:${0.25 + Math.random() * 0.5};` +
        `background:radial-gradient(circle, rgba(${c},.9), rgba(${c},.35) 55%, rgba(${c},0) 72%);` +
        `filter:blur(${2 + Math.random() * 10}px);--d:${4 + Math.random() * 6}s;animation-delay:${-Math.random() * 8}s`;
      box.appendChild(s);
    }
  })();

  // ---------- Walzen: echte Trommeln mit 12 Seiten ----------
  const N = 12;
  const STEP = 360 / N;
  const fillers = [[], [], []];
  for (let i = 0; i < 80; i++) {
    const r = dreher.spin();
    if (r) r.reels.forEach((part, k) => part && fillers[k].push(part));
  }

  // Schriftgröße so wählen, dass der Text auf eine Trommelseite passt (max. zwei Zeilen).
  const measure = $("measure");
  const fitCache = new Map();
  function fitSize(text, width, height, max) {
    const key = `${width}|${height}|${text}`;
    if (fitCache.has(key)) return fitCache.get(key);
    measure.style.width = width + "px";
    measure.textContent = text;
    let lo = 11, hi = Math.floor(max), best = lo;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      measure.style.fontSize = mid + "px";
      if (measure.scrollWidth <= width && measure.scrollHeight <= height) { best = mid; lo = mid + 1; }
      else hi = mid - 1;
    }
    fitCache.set(key, best);
    return best;
  }

  class Drum {
    constructor(reel, k) {
      this.reel = reel;
      this.k = k;
      this.el = reel.querySelector(".drum");
      this.angle = 0;      // Grad; abnehmend = Symbole laufen nach unten
      this.speed = 0;      // Grad pro Sekunde
      this.mode = "idle";
      this.locked = -1;
      this.faces = Array.from({ length: N }, () => {
        const face = document.createElement("div");
        face.className = "face";
        face.innerHTML = '<i class="gem-top"></i><span class="txt"></span><i class="gem-bot"></i>';
        this.el.appendChild(face);
        return { el: face, txt: face.querySelector(".txt"), text: "" };
      });
      this.layout();
      this.faces.forEach((_, i) => this.setFace(i, pick(fillers[k])));
      this.front = this.frontIndex();
    }

    layout() {
      this.H = this.reel.clientHeight;
      this.F = Math.round(this.H * 0.84);
      this.r = this.F / (2 * Math.tan(Math.PI / N));
      this.faces.forEach((f) => { f.el.style.height = this.F + "px"; });
      this.textW = this.reel.clientWidth - 28;
      this.faces.forEach((f, i) => this.setFace(i, f.text));
      this.render();
    }

    setFace(i, text) {
      const f = this.faces[i];
      f.text = text;
      f.el.classList.toggle("blank", !text);
      f.txt.textContent = text || "♦";
      f.txt.style.fontSize = fitSize(text || "♦", this.textW, this.F * 0.6, this.F * 0.42) + "px";
    }

    frontIndex() { return mod(Math.round(-this.angle / STEP), N); }

    // Die Trommel wird selbst projiziert (Zylinder + Perspektive) und mit 2D-Transforms gezeichnet.
    // Das sieht aus wie echtes 3D, ist aber unabhängig von der Tiefensortierung des Browsers.
    project(deg) {
      const a = (deg * Math.PI) / 180;
      const z = this.r * Math.cos(a) - this.r;           // 0 vorn, negativ nach hinten
      const s = PERSPECTIVE / (PERSPECTIVE - z);
      return { y: this.H / 2 - this.r * Math.sin(a) * s, s };
    }

    render() {
      const half = STEP / 2;
      this.faces.forEach((f, i) => {
        const rel = mod(i * STEP + this.angle + 180, 360) - 180;
        const visible = Math.abs(rel) < 90 - half + 8;
        if (f.visible !== visible) { f.visible = visible; f.el.style.visibility = visible ? "" : "hidden"; }
        if (!visible) return;
        const top = this.project(Math.min(89.9, rel + half));
        const bottom = this.project(Math.max(-89.9, rel - half));
        // Volle Breite: eine Trommel wird zu den Rändern hin nur gestaucht, nicht schmaler.
        const sy = Math.max(0.001, (bottom.y - top.y) / this.F);
        f.el.style.transform = `translateY(${top.y}px) scaleY(${sy})`;
      });
      // Senkrechte Bewegungsunschärfe auf der ganzen Trommel – Text, Linien und Rauten.
      const v = Math.abs(this.speed);
      this.el.classList.toggle("blur", v > 520);
      this.el.classList.toggle("blur-soft", v > 160 && v <= 520);
    }

    show(text) {
      this.setFace(this.frontIndex(), text);
    }

    start() {
      this.mode = "spin";
      this.locked = -1;
      this.t0 = performance.now();
      this.startAngle = this.angle;
    }

    // Kommt mit derselben Geschwindigkeit an, mit der sie gedreht hat, und rastet dann ein.
    land(text, duration) {
      return new Promise((resolve) => {
        const c = -this.angle / STEP;
        const target = Math.ceil(c) + N / 2 + N;
        this.locked = mod(target, N);
        this.setFace(this.locked, text);
        this.mode = "land";
        this.landFrom = this.angle;
        this.landTo = -target * STEP;
        this.landDur = duration;
        this.landPow = clamp((Math.abs(this.speed) * duration / 1000) / Math.abs(this.landTo - this.landFrom), 1.2, 4);
        this.t0 = performance.now();
        this.done = resolve;
      });
    }

    tick(now, dt) {
      if (this.mode === "spin") {
        // Kurzer Ruck nach oben, dann Vollgas nach unten
        const t = (now - this.t0) / 1000;
        const vmax = SPEEDS[this.k];
        if (t < 0.12) { this.angle = this.startAngle + 6 * Math.sin((t / 0.12) * Math.PI); this.speed = 0; }
        else { this.speed = -vmax * Math.min(1, (t - 0.12) / 0.35); this.angle += this.speed * dt; }
      } else if (this.mode === "land") {
        const t = clamp((now - this.t0) / this.landDur, 0, 1);
        const e = 1 - Math.pow(1 - t, this.landPow);
        const prev = this.angle;
        this.angle = this.landFrom + (this.landTo - this.landFrom) * e;
        this.speed = dt > 0 ? (this.angle - prev) / dt : 0;
        if (t >= 1) { this.mode = "settle"; this.t0 = now; this.speed = 0; }
      } else if (this.mode === "settle") {
        // Einrasten: kurz übers Ziel hinaus und zurück
        const t = clamp((now - this.t0) / 220, 0, 1);
        this.angle = this.landTo - 4 * Math.sin(t * Math.PI) * (1 - t);
        if (t >= 1) {
          this.angle = this.landTo;
          this.mode = "idle";
          sound.settle(this.k);
          vibrate(12);
          const done = this.done;
          this.done = null;
          if (done) done();
        }
      } else {
        return;
      }
      const f = this.frontIndex();
      if (f !== this.front) {
        this.front = f;
        sound.tick(this.k);
        // Die Seite auf der Rückseite bekommt neuen Text – unsichtbar für den Zuschauer.
        const back = mod(f + N / 2, N);
        if (back !== this.locked && this.mode === "spin") this.setFace(back, pick(fillers[this.k]));
      }
      this.render();
    }
  }

  const PERSPECTIVE = 440;
  const SPEEDS = reduceMotion ? [200, 200, 200] : [820, 900, 760];
  const drums = [...document.querySelectorAll(".reel")].map((reel, k) => new Drum(reel, k));

  let resizeTimer;
  window.addEventListener("resize", () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => { fitCache.clear(); drums.forEach((d) => d.layout()); lever.render(); }, 120);
  });

  // ---------- Drehen ----------
  let busy = false;
  let current = null;
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));

  // Fragt den Server (LLM). Ohne Server – oder bei zu vielen Anfragen – mischt der Browser selbst.
  let throttled = false;
  async function fetchPhrase() {
    throttled = false;
    try {
      const res = await fetch("api/dreh", { method: "POST", signal: AbortSignal.timeout(60000) });
      if (res.status === 429) throttled = true;
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
    drums.forEach((d) => d.start());
    const [text] = await Promise.all([fetchPhrase(), wait(reduceMotion ? 300 : 1400)]);
    const parts = Dreher.splitInThree(text);
    await Promise.all(drums.map((d, k) => wait(k * (reduceMotion ? 80 : 350)).then(() => d.land(parts[k], reduceMotion ? 300 : 1100))));
    spins++;
    store.set("spins", spins);
    show(text, true);
    if (throttled) toast("Kurze Pause – die Walzen mischen selbst");
    busy = false;
    body.classList.remove("spinning");
  }

  function show(text, fresh) {
    current = text;
    $("phrase").textContent = text;
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
  // Der Hebel kippt um eine waagrechte Achse nach vorn und unten. Achse, Manschette und Schrauben drehen sich mit.
  // Er folgt dem Finger mit etwas Trägheit, rastet kurz vor dem Anschlag ein, schwingt durch und federt zurück.
  const lever = (() => {
    const el = $("lever");
    const arm = $("leverArm");
    const ball = $("leverBall");
    const sleeve = $("leverSleeve");
    const axle = $("leverAxle");
    const bolts = [...sleeve.querySelectorAll(".bolt")];
    const machine = document.querySelector(".machine");
    const MAX = 125;         // Grad: Anschlag unten
    const TRIGGER = 112;     // ab hier wird gedreht
    const SLEEVE_R = 15;     // Radius der Manschette (px)
    const AXLE_R = 7;        // Radius der Achse (px)
    let theta = 0;
    let vel = 0;             // Grad pro Sekunde
    let target = 0;
    let mode = "rest";       // rest | drag | spring | auto
    let lastNotch = 0;
    let autoT = 0;
    let drag = null;

    // Stange: echtes CSS-3D. Knauf: dieselbe Perspektive selbst gerechnet, damit er immer vorn liegt.
    const PERSP = 1100;
    function project(th) {
      const W = el.clientWidth;
      const Hl = el.clientHeight;
      const L = arm.offsetHeight;
      const pivot = arm.offsetTop + L;
      const a = (th * Math.PI) / 180;
      const z = L * Math.sin(a);
      const s = PERSP / (PERSP - z);
      const ox = W * 0.1, oy = Hl * 0.5;
      return { x: ox + (W / 2 - ox) * s, y: oy + (pivot - L * Math.cos(a) - oy) * s, s };
    }

    function render() {
      const rad = (theta * Math.PI) / 180;
      el.classList.toggle("forward", theta > 55);
      arm.style.transform = `rotateX(${-theta}deg)`;
      const k = project(theta);
      const half = ball.offsetWidth / 2;
      ball.style.transform = `translate(${k.x - half}px, ${k.y - half}px) scale(${k.s})`;
      ball.style.setProperty("--hl", (28 - 10 * Math.sin(rad)).toFixed(1) + "%");
      // Riffelung von Manschette und Achse rollt mit; Schrauben wandern um die Manschette herum.
      sleeve.style.setProperty("--roll", (SLEEVE_R * rad).toFixed(2) + "px");
      axle.style.setProperty("--roll", (AXLE_R * rad).toFixed(2) + "px");
      bolts.forEach((bolt, i) => {
        const phi = rad + (i * Math.PI) / 2;
        const front = Math.cos(phi);
        bolt.style.transform = `translateY(${(SLEEVE_R * 0.78 * Math.sin(phi)).toFixed(2)}px) scaleY(${Math.max(0.05, front).toFixed(3)})`;
        bolt.style.opacity = clamp(front * 3, 0, 1).toFixed(2);
      });
    }

    function shake() {
      if (reduceMotion) return;
      machine.classList.remove("shake");
      void machine.offsetWidth;
      machine.classList.add("shake");
    }

    function geometry() {
      const rect = el.getBoundingClientRect();
      const L = arm.offsetHeight;
      return { pivot: rect.top + arm.offsetTop + L, L };
    }

    function knobY(th) { return el.getBoundingClientRect().top + project(th).y; }

    function ratchet() {
      const notch = Math.floor(theta / 15);
      if (notch > lastNotch && mode !== "spring") sound.ratchet();
      lastNotch = notch;
    }

    // Eingerastet: Schwung behalten, Walzen starten.
    function fire() {
      mode = "spring";
      vel = Math.max(vel, 260);
      drag = null;
      el.classList.remove("dragging");
      sound.unlock();
      sound.clack();
      vibrate(30);
      shake();
      spin();
    }

    function pull() {
      if (busy || mode === "auto" || mode === "spring") return;
      sound.unlock();
      mode = "auto";
      autoT = 0;
    }

    el.addEventListener("pointerdown", (e) => {
      if (busy || mode === "auto" || mode === "spring") return;
      sound.unlock();
      const g = geometry();
      const y = knobY(theta);
      const nearKnob = Math.abs(e.clientY - y) < 46;
      drag = { g, offset: nearKnob ? e.clientY - y : 0, y0: e.clientY, t0: Date.now(), moved: 0 };
      mode = "drag";
      target = theta;
      el.setPointerCapture(e.pointerId);
      el.classList.add("dragging");
      if (!nearKnob) move(e);
    });

    function move(e) {
      if (!drag) return;
      drag.moved = Math.max(drag.moved, Math.abs(e.clientY - drag.y0));
      const cos = clamp((drag.g.pivot - (e.clientY - drag.offset)) / drag.g.L, Math.cos((MAX * Math.PI) / 180), 1);
      target = (Math.acos(cos) * 180) / Math.PI;
    }
    el.addEventListener("pointermove", move);

    function end() {
      if (!drag) return;
      const tapped = drag.moved < 6 && Date.now() - drag.t0 < 350;
      drag = null;
      el.classList.remove("dragging");
      if (tapped && !busy) { mode = "rest"; pull(); }
      else mode = "spring";
    }
    el.addEventListener("pointerup", end);
    el.addEventListener("pointercancel", end);
    el.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " ") { e.preventDefault(); pull(); }
    });

    function tick(dt) {
      if (mode === "rest") return;
      if (mode === "drag") {
        // Kritisch gedämpfte Feder zum Finger hin – fühlt sich nach Gewicht an, ohne zu wackeln.
        const k = 900, c = 2 * Math.sqrt(k);
        vel += (k * (target - theta) - c * vel) * dt;
        theta += vel * dt;
        if (theta < 0) { theta = 0; vel = Math.max(0, vel); }
        if (theta >= TRIGGER) fire();
      } else if (mode === "auto") {
        autoT += dt;
        const t = clamp(autoT / 0.3, 0, 1);
        const prev = theta;
        theta = TRIGGER * t * t;
        vel = dt > 0 ? (theta - prev) / dt : 0;
        if (t >= 1) fire();
      } else if (mode === "spring") {
        // Feder zieht nach oben; unten und oben prallt er vom Anschlag ab.
        vel += (-150 * theta - 7 * vel) * dt;
        theta += vel * dt;
        if (theta > MAX) {
          theta = MAX - (theta - MAX) * 0.3;
          sound.thud(Math.min(1, vel / 900));
          vel = -vel * 0.3;
          shake();
        }
        if (theta < 0) {
          theta = -theta * 0.25;
          if (vel < -120) { sound.thud(Math.min(1, -vel / 900)); shake(); }
          vel = -vel * 0.35;
        }
        if (theta < 0.15 && Math.abs(vel) < 4) { theta = 0; vel = 0; mode = "rest"; }
      }
      ratchet();
      render();
    }

    render();
    return { tick, pull, render };
  })();

  document.addEventListener("keydown", (e) => {
    if (e.key === " " && e.target === body) { e.preventDefault(); lever.pull(); }
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
      Dreher.splitInThree(t).forEach((p, k) => drums[k].show(p));
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

  // ---------- Ton: Mechanik statt Piepen ----------
  const sound = (() => {
    let ctx = null;
    let noise = null;
    let on = store.get("sound", true);
    let lastTick = 0;
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
      g.gain.exponentialRampToValueAtTime(vol, t + 0.005);
      g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      o.connect(g).connect(ctx.destination);
      o.start(t);
      o.stop(t + dur + 0.05);
    }

    // Kurzes, gefiltertes Rauschen: klingt nach Metall und Holz.
    function click(freq, dur, vol, when = 0) {
      if (!on || !ctx || !noise) return;
      const t = ctx.currentTime + when;
      const src = ctx.createBufferSource();
      src.buffer = noise;
      const f = ctx.createBiquadFilter();
      f.type = "bandpass";
      f.frequency.value = freq;
      f.Q.value = 6;
      const g = ctx.createGain();
      g.gain.setValueAtTime(vol, t);
      g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      src.connect(f).connect(g).connect(ctx.destination);
      src.start(t);
      src.stop(t + dur + 0.02);
    }

    return {
      unlock() {
        try {
          if (!ctx) {
            ctx = new (window.AudioContext || window.webkitAudioContext)();
            noise = ctx.createBuffer(1, ctx.sampleRate * 0.3, ctx.sampleRate);
            const d = noise.getChannelData(0);
            for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
          }
          if (ctx.state === "suspended") ctx.resume();
        } catch (e) { ctx = null; }
      },
      tick(k) {
        const now = performance.now();
        if (now - lastTick < 28) return;
        lastTick = now;
        click(2600 + k * 500, 0.03, 0.05);
      },
      ratchet() { click(1800, 0.04, 0.12); },
      clack() { click(900, 0.12, 0.5); tone(110, 0.2, 0.12, 0, "triangle"); },
      thud(strength) { click(500, 0.08, 0.25 * strength); },
      settle(k) { click(700 - k * 80, 0.1, 0.4); tone(160 - k * 20, 0.18, 0.08, 0, "triangle"); },
      chime() { [784, 988, 1175, 1568].forEach((f, i) => tone(f, 0.9, 0.05, i * 0.09, "triangle")); },
    };
  })();

  // ---------- Start ----------
  let last = performance.now();
  (function frame(now) {
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    drums.forEach((d) => d.tick(now, dt));
    lever.tick(dt);
    requestAnimationFrame(frame);
  })(last);

  ["Hebel", "ziehen", ""].forEach((t, k) => drums[k].show(t));
  $("actions").classList.add("hidden");
  renderLists();
  updateFavButton();

  const shared = new URLSearchParams(location.hash.slice(1)).get("w");
  if (shared) {
    const text = shared.slice(0, 200);
    Dreher.splitInThree(text).forEach((p, k) => drums[k].show(p));
    show(text, false);
    toast("Eine geschenkte Weisheit");
  }
})();

// Ladebildschirm: Glühbirnen als echte Fortschrittsanzeige und eine Fallblattanzeige, auf der bekannte
// Redewendungen zu Lade-Weisheiten verdreht werden. Läuft direkt nach dem Ladebildschirm im HTML, vor allem anderen.
// Fortschritt melden: Loader.progress(0…1). Fertig: Loader.done(onStart) – alle Birnen blinken, die Tafel sagt
// „Automat bereit“, darunter erscheint „Starten“. Der Druck darauf spielt einen stillen Ton (das schaltet den Ton
// für die ganze Seite frei, auch auf Telefonen), blendet den Bildschirm aus und ruft onStart.
// Gescheitert: Loader.fail(). Ohne Automat: Loader.dismiss().
(function () {
  "use strict";

  const root = document.getElementById("loader");
  const rows = [...root.querySelectorAll(".loader-bulbs")].map((row) => [...row.children]);
  const board = root.querySelector(".flap-board");
  const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  // ---------- Fortschritt: die Birnen füllen sich von links, die nächste blinkt ----------
  let shown = 0;
  function progress(p) {
    shown = Math.max(shown, Math.min(1, p));
    const n = rows[0].length;
    const lit = Math.floor(shown * n + 1e-6);
    for (const row of rows) {
      row.forEach((bulb, i) => {
        bulb.classList.toggle("on", i < lit);
        bulb.classList.toggle("next", i === lit);
      });
    }
  }

  // ---------- Fallblattanzeige ----------
  const COLS = 18;
  const LINES = 2;
  // Bekannte Redewendung → verdrehte Lade-Weisheit
  const PAIRS = [
    ["Gut Ding will Weile haben", "Gut Ding will Walze haben"],
    ["Wer zuletzt lacht, lacht am besten", "Wer zuletzt lädt, lädt am besten"],
    ["Alle guten Dinge sind drei", "Alle guten Walzen sind drei"],
    ["Ende gut, alles gut", "Hebel gut, alles gut"],
    ["Kommt Zeit, kommt Rat", "Kommt Zeit, kommt Rad"],
    ["Die Zeit heilt alle Wunden", "Die Zeit ölt alle Walzen"],
    ["Abwarten und Tee trinken", "Abwarten und Walzen ölen"],
    ["Aller Anfang ist schwer", "Aller Anfang lädt schwer"],
  ];
  const DRUM = " ABCDEFGHIJKLMNOPQRSTUVWXYZÄÖÜ.,!?–";

  const cells = [];
  for (let i = 0; i < COLS * LINES; i++) {
    const cell = document.createElement("span");
    cell.className = "flap";
    cell.textContent = " ";
    board.appendChild(cell);
    cells.push({ el: cell, ch: " ", timer: 0 });
  }

  // Text auf zwei Zeilen à 18 Zeichen verteilen (an Wortgrenzen, möglichst ausgewogen), zentriert
  function layout(text) {
    const words = text.toUpperCase().split(/\s+/);
    let best = null;
    for (let cut = 1; cut <= words.length; cut++) {
      const a = words.slice(0, cut).join(" "), b = words.slice(cut).join(" ");
      if (a.length > COLS || b.length > COLS) continue;
      const score = Math.abs(a.length - b.length);
      if (!best || score < best.score) best = { lines: [a, b], score };
    }
    const lines = best ? best.lines : [text.toUpperCase().slice(0, COLS), ""];
    return lines.map((l) => {
      const pad = Math.floor((COLS - l.length) / 2);
      return (" ".repeat(pad) + l).padEnd(COLS, " ");
    }).join("");
  }

  // Ein Blatt fällt: kurz zusammenklappen, neues Zeichen zeigen
  function setChar(cell, ch) {
    cell.ch = ch;
    cell.el.textContent = ch;
    if (reduceMotion) return;
    cell.el.classList.remove("flip");
    void cell.el.offsetWidth;
    cell.el.classList.add("flip");
  }

  // Wie eine echte Fallblattanzeige: geänderte Felder blättern ein paar Zeichen der Trommel durch bis zum Ziel
  function show(text) {
    const target = layout(text);
    cells.forEach((cell, i) => {
      clearTimeout(cell.timer);
      const ch = target[i];
      if (cell.ch === ch) return;
      if (reduceMotion) { setChar(cell, ch); return; }
      const steps = 2 + Math.floor(Math.random() * 4);
      let k = 0;
      const delay = (i % COLS) * 18 + Math.random() * 60;
      const flip = () => {
        k++;
        setChar(cell, k >= steps ? ch : DRUM[Math.floor(Math.random() * DRUM.length)]);
        if (k < steps) cell.timer = setTimeout(flip, 55);
      };
      cell.timer = setTimeout(flip, delay);
    });
  }

  // Ablauf: Original einblättern, stehen lassen, zur Verdrehung umblättern, stehen lassen, nächstes Paar
  let pairIndex = Math.floor(Math.random() * PAIRS.length);
  let cycle = 0;
  function nextPair() {
    const [plain, twisted] = PAIRS[pairIndex];
    pairIndex = (pairIndex + 1) % PAIRS.length;
    show(plain);
    cycle = setTimeout(() => {
      show(twisted);
      cycle = setTimeout(nextPair, 2600);
    }, 1700);
  }

  // ---------- Fertig ----------
  let finished = false;
  const startBtn = document.getElementById("startBtn");
  function done(onStart) {
    if (finished) return;
    finished = true;
    clearTimeout(cycle);
    progress(1);
    show("Automat bereit");
    root.classList.add("complete");          // alle Birnen blinken gemeinsam
    document.getElementById("loaderNote").textContent = "Der Automat ist bereit.";
    startBtn.hidden = false;
    startBtn.focus({ preventScroll: true });
    startBtn.addEventListener("click", () => {
      window.Phrasendreher?.unlockSound?.();  // stiller Ton in dieser Geste: ab jetzt klingt alles sofort
      startBtn.disabled = true;
      root.classList.add("done");
      if (onStart) onStart();
    }, { once: true });
  }

  // Kommt der Automat gar nicht (z. B. Skript lädt nicht): Bescheid sagen, statt „Bitte Hebel ziehen“ ins Leere
  function fail() {
    if (finished) return;
    finished = true;
    clearTimeout(cycle);
    root.classList.add("failed");
    show("Automat klemmt – bitte neu laden");
  }

  // Ohne Automat (kein WebGL): still ausblenden, die Seite zeigt ihren eigenen Hinweis
  function dismiss() {
    finished = true;
    clearTimeout(cycle);
    root.classList.add("done");
  }

  progress(0.1);                             // Ladebildschirm steht
  if (document.fonts) document.fonts.ready.then(() => progress(0.35));
  nextPair();
  window.Loader = { progress, done, fail, dismiss };
})();

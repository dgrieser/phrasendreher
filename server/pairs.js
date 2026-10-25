// Wählt die beiden Redewendungen, die das LLM verdreht.
//
// Die erste kommt aus einem gemischten Stapel: jede Redewendung ist einmal dran, bevor neu gemischt wird.
// Die zweite ist ein Partner, der zur ersten passt – aus einer von vier Quellen:
//   meaning  ähnliche Bedeutung   (server/data/partners.json, per LLM + Embeddings)
//   image    ähnliches Bild/Wort  (server/data/partners.json, per Embeddings)
//   sound    ähnlicher Klang      (hier berechnet: Kölner Phonetik und Reime)
//   grammar  grammatisch kombinierbar (Mischmotor in public/dreher.js)
"use strict";

const fs = require("fs");
const path = require("path");

const DATA = path.join(__dirname, "data", "partners.json");
const DEFAULT_WEIGHTS = { meaning: 50, image: 25, sound: 10, grammar: 15 };
const SOURCE_LABELS = { meaning: "Bedeutung", image: "Bild", sound: "Klang", grammar: "Grammatik", random: "Zufall" };
const RECENT = 300;

// ---------- Klang ----------
const STOP = new Set(("aber alle alles als also auch auf aus bei beim bin bis da dann das dass dein dem den der des die dich dir doch "
  + "dort du ein eine einem einen einer eines einmal er es etwas für gar geht hat hin ich ihm ihn ihr im in ins ist jede jemand "
  + "jemandem jemanden kann kein keine keinen man mal mehr mein mich mir mit nach nicht noch nur oder ohne schon sein seine "
  + "seinen sich sie sind so über um und uns unter vom von vor war was weg wenn wer wie wird wo zu zum zur zwei").split(" "));

// Kölner Phonetik: gleicher Code = ähnlich klingende Konsonanten (Schnippchen ≈ Schnäppchen).
function koelner(word) {
  const w = word.toLowerCase().replace(/ä/g, "a").replace(/ö/g, "o").replace(/ü/g, "u").replace(/ß/g, "s").replace(/[^a-z]/g, "");
  let code = "";
  for (let i = 0; i < w.length; i++) {
    const c = w[i], prev = w[i - 1] || "", next = w[i + 1] || "";
    let d;
    if ("aeijouy".includes(c)) d = "0";
    else if (c === "h") d = "";
    else if (c === "b") d = "1";
    else if (c === "p") d = next === "h" ? "3" : "1";
    else if (c === "d" || c === "t") d = "csz".includes(next) ? "8" : "2";
    else if ("fvw".includes(c)) d = "3";
    else if ("gkq".includes(c)) d = "4";
    else if (c === "c") {
      if (i === 0) d = "ahkloqrux".includes(next) ? "4" : "8";
      else d = "sz".includes(prev) || !"ahkoqux".includes(next) ? "8" : "4";
    } else if (c === "x") d = "ckq".includes(prev) ? "8" : "48";
    else if (c === "l") d = "5";
    else if (c === "m" || c === "n") d = "6";
    else if (c === "r") d = "7";
    else if (c === "s" || c === "z") d = "8";
    else d = "";
    code += d;
  }
  code = code.replace(/(\d)\1+/g, "$1");
  return code[0] + code.slice(1).replace(/0/g, "");
}

// Reim: ab dem letzten betonten Vokal, Endungen wie -e/-en/-er zählen nicht (Rede ↔ Schwede, Sinn ↔ Finn).
function rhyme(word) {
  const w = word.toLowerCase().replace(/(e|en|er|el|es|ern|eln|chen)$/, "");
  const m = w.match(/[aeiouäöüy]+[^aeiouäöüy]*$/);
  return m && m[0].length >= 2 ? m[0] : null;
}

function soundIndex(list) {
  const words = new Map(); // Redewendung → Schlüsselwörter
  const byCode = new Map(), byRhyme = new Map();
  const add = (map, key, entry) => { if (!map.has(key)) map.set(key, []); map.get(key).push(entry); };
  for (const phrase of list) {
    const keys = phrase.split(/[\s,–-]+/).map((w) => w.replace(/[^A-Za-zÄÖÜäöüß]/g, ""))
      .filter((w) => w.length >= 4 && !STOP.has(w.toLowerCase()));
    words.set(phrase, keys);
    for (const w of keys) {
      add(byCode, koelner(w), { phrase, word: w.toLowerCase() });
      const r = rhyme(w);
      if (r) add(byRhyme, r, { phrase, word: w.toLowerCase() });
    }
  }
  return function soundPartners(phrase) {
    const out = new Set();
    for (const w of words.get(phrase) || []) {
      const lw = w.toLowerCase();
      const r = rhyme(w);
      // Nur seltene Klänge – „-ung“ reimt sich auf alles und ist kein Witz.
      const sameCode = byCode.get(koelner(w)) || [];
      const sameRhyme = (r && byRhyme.get(r)) || [];
      if (sameCode.length <= 40) {
        for (const e of sameCode) if (e.word !== lw) out.add(e.phrase);            // Schnippchen ≈ Schnäppchen
      }
      if (sameRhyme.length <= 40) {
        for (const e of sameRhyme) if (e.word !== lw && e.word[0] !== lw[0]) out.add(e.phrase); // Sinn ↔ Finn
      }
    }
    out.delete(phrase);
    return [...out];
  };
}

// ---------- Auswahl ----------
function parseWeights(spec) {
  const weights = { ...DEFAULT_WEIGHTS };
  for (const part of String(spec || "").split(",")) {
    const [k, v] = part.split(":").map((s) => s.trim());
    if (k in weights && v !== undefined && Number.isFinite(Number(v))) weights[k] = Math.max(0, Number(v));
  }
  return weights;
}

function loadPartners(list) {
  let data = null;
  try { data = JSON.parse(fs.readFileSync(DATA, "utf8")); } catch (e) { /* fehlt – dann eben ohne */ }
  const entries = (data && data.entries) || {};
  const missing = list.filter((p) => !entries[p]).length;
  return { entries, missing };
}

function createPicker(list, dreher, { weights = DEFAULT_WEIGHTS, rnd = Math.random } = {}) {
  const known = new Set(list);
  const { entries, missing } = loadPartners(list);
  const sound = soundIndex(list);
  const pick = (arr) => arr[Math.floor(rnd() * arr.length)];

  let deck = [];
  const recent = [];
  const recentSet = new Set();
  const remember = (key) => {
    recent.push(key);
    recentSet.add(key);
    if (recent.length > RECENT) recentSet.delete(recent.shift());
  };

  function draw() {
    if (!deck.length) {
      deck = list.slice();
      for (let i = deck.length - 1; i > 0; i--) {
        const j = Math.floor(rnd() * (i + 1));
        [deck[i], deck[j]] = [deck[j], deck[i]];
      }
    }
    return deck.pop();
  }

  function candidates(a) {
    const e = entries[a] || {};
    const clean = (arr) => (arr || []).filter((b) => b !== a && known.has(b) && !recentSet.has(a + "\u0000" + b) && !recentSet.has(b + "\u0000" + a));
    return {
      meaning: clean(e.similar),
      image: clean(e.image),
      sound: clean(sound(a)),
      grammar: clean(dreher.partners(a)),
    };
  }

  // Quelle nach Gewicht wählen – nur unter denen, die für diese Redewendung überhaupt Partner haben.
  function choose(a) {
    const cands = candidates(a);
    const usable = Object.keys(weights).filter((k) => weights[k] > 0 && cands[k].length);
    if (!usable.length) return { source: "random", b: pick(list.filter((p) => p !== a)) };
    const total = usable.reduce((s, k) => s + weights[k], 0);
    let r = rnd() * total;
    const source = usable.find((k) => (r -= weights[k]) < 0) || usable[usable.length - 1];
    return { source, b: pick(cands[source]) };
  }

  function next() {
    const a = draw();
    const { source, b } = choose(a);
    remember(a + "\u0000" + b);
    // Reihenfolge würfeln, damit die Stapel-Redewendung nicht immer vorn steht.
    const [first, second] = rnd() < 0.5 ? [a, b] : [b, a];
    return { a: first, b: second, source, label: SOURCE_LABELS[source] };
  }

  return { next, candidates, missing, weights };
}

module.exports = { createPicker, parseWeights, koelner, rhyme, SOURCE_LABELS, DEFAULT_WEIGHTS };

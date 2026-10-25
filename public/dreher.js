// Der Mischmotor: verdreht Redewendungen, indem er Substantive austauscht
// oder zwei Redewendungen an einer gemeinsamen Stelle zusammenklebt.
(function (root) {
  "use strict";

  // Wörter, vor denen ein Substantiv grammatisch "gleich" eingebettet ist.
  const DETERMINERS = new Set([
    "der", "die", "das", "den", "dem", "des",
    "ein", "eine", "einen", "einem", "eines", "einer",
    "kein", "keine", "keinen", "keinem", "keiner",
    "sein", "seine", "seinen", "seinem", "seiner", "mein", "meine", "meinen", "dein", "deine",
    "im", "ins", "am", "ans", "aufs", "vom", "zum", "zur", "beim", "übers", "unterm", "vors", "fürs",
  ]);

  // Gelenkwörter, an denen sich zwei Redewendungen zusammenkleben lassen.
  const JOINTS = new Set([
    "in", "im", "ins", "auf", "aufs", "unter", "über", "übers", "vom", "von", "zum", "zur",
    "wie", "mit", "aus", "an", "am", "ans", "durch", "hinter", "vor", "nach", "um", "bei", "beim",
    "und", "oder", "ist", "sind", "als", "für", "gegen", "zwischen", "ohne",
  ]);

  const NOT_NOUNS = new Set(["Ich", "Du", "Sie", "Es", "Er", "Wir", "Ihr", "Dich", "Mir", "Dir"]);

  const strip = (w) => w.replace(/[.,!?;:„“"']/g, "");
  const trailing = (w) => (w.match(/[.,!?;:]+$/) || [""])[0];
  const isCap = (w) => /^[A-ZÄÖÜ]/.test(w);
  const pick = (arr, rnd) => arr[Math.floor(rnd() * arr.length)];

  function analyse(phrase) {
    const words = phrase.trim().split(/\s+/);
    const nouns = [];
    words.forEach((w, i) => {
      const bare = strip(w);
      if (i === 0 || !isCap(bare) || NOT_NOUNS.has(bare) || bare.length < 2) return;
      let key = "";
      const prev = strip(words[i - 1]).toLowerCase();
      if (DETERMINERS.has(prev)) key = prev;
      else if (i >= 2 && /^[a-zäöüß]/.test(words[i - 1]) && DETERMINERS.has(strip(words[i - 2]).toLowerCase())) {
        key = strip(words[i - 2]).toLowerCase(); // Artikel + Adjektiv + Substantiv
      }
      nouns.push({ index: i, word: bare, key });
    });
    const joints = [];
    words.forEach((w, i) => {
      if (i > 0 && i < words.length - 1 && JOINTS.has(strip(w).toLowerCase())) joints.push(i);
    });
    return { phrase, words, nouns, joints };
  }

  function createDreher(phrases, rnd = Math.random) {
    const list = phrases.map(analyse);
    const nounsByKey = new Map();
    const jointsByWord = new Map();
    list.forEach((p) => {
      p.nouns.forEach((n) => {
        if (!n.key) return;
        if (!nounsByKey.has(n.key)) nounsByKey.set(n.key, []);
        nounsByKey.get(n.key).push({ p, n });
      });
      p.joints.forEach((i) => {
        const k = p.words[i].toLowerCase();
        if (!jointsByWord.has(k)) jointsByWord.set(k, []);
        jointsByWord.get(k).push({ p, i });
      });
    });
    const originals = new Set(phrases.map((s) => s.toLowerCase()));
    const capFirst = (s) => s.charAt(0).toUpperCase() + s.slice(1);

    // Variante 1: Substantiv aus einer anderen Redewendung einsetzen.
    function swap() {
      const a = pick(list, rnd);
      const candidates = a.nouns.filter((n) => n.key && nounsByKey.get(n.key).length > 1);
      if (!candidates.length) return null;
      const n = pick(candidates, rnd);
      const donors = nounsByKey.get(n.key).filter((d) => d.p !== a && d.n.word !== n.word);
      if (!donors.length) return null;
      const d = pick(donors, rnd);
      const before = a.words.slice(0, n.index).join(" ");
      const noun = d.n.word + trailing(a.words[n.index]);
      const after = a.words.slice(n.index + 1).join(" ");
      return { reels: [before, noun, after], sources: [a.phrase, d.p.phrase], kind: "swap" };
    }

    // Variante 2: Anfang der einen + Ende der anderen Redewendung.
    function splice() {
      const a = pick(list, rnd);
      if (!a.joints.length) return null;
      const i = pick(a.joints, rnd);
      const key = a.words[i].toLowerCase();
      const partners = jointsByWord.get(key).filter((b) => b.p !== a);
      if (!partners.length) return null;
      const b = pick(partners, rnd);
      const head = a.words.slice(0, i).join(" ");
      const tail = b.p.words.slice(b.i + 1);
      // Folgt in beiden derselbe Artikel, wandert er mit aufs Gelenk.
      let joint = a.words[i];
      let rest = tail;
      if (tail.length > 1 && a.words[i + 1] && strip(a.words[i + 1]).toLowerCase() === strip(tail[0]).toLowerCase() &&
          DETERMINERS.has(strip(tail[0]).toLowerCase())) {
        joint += " " + a.words[i + 1];
        rest = tail.slice(1);
      }
      const ownRest = a.words.slice(i + 1 + (joint.includes(" ") ? 1 : 0));
      // Nicht zu viel abschneiden – sonst fehlt am Ende das Verb.
      if (!rest.length || rest.length < Math.min(2, ownRest.length)) return null;
      // Ende identisch mit A? Dann ist nichts verdreht.
      if (rest.join(" ").toLowerCase() === ownRest.join(" ").toLowerCase()) return null;
      return { reels: [head, joint, rest.join(" ")], sources: [a.phrase, b.p.phrase], kind: "splice" };
    }

    function spin() {
      for (let tries = 0; tries < 200; tries++) {
        const r = rnd() < 0.5 ? swap() : splice();
        if (!r) continue;
        r.reels[0] = capFirst(r.reels[0]);
        const text = r.reels.filter(Boolean).join(" ");
        if (originals.has(text.toLowerCase())) continue;
        if (text.split(" ").length < 3) continue;
        r.text = text;
        return r;
      }
      return null;
    }

    // Alle Redewendungen, mit denen sich diese grammatisch verbinden lässt:
    // gleicher Artikel vor einem anderen Substantiv oder ein gemeinsames Gelenkwort.
    const byPhrase = new Map(list.map((p) => [p.phrase, p]));
    function partners(phrase) {
      const a = byPhrase.get(phrase);
      if (!a) return [];
      const out = new Set();
      a.nouns.forEach((n) => {
        if (!n.key) return;
        nounsByKey.get(n.key).forEach((d) => { if (d.p !== a && d.n.word !== n.word) out.add(d.p.phrase); });
      });
      a.joints.forEach((i) => {
        (jointsByWord.get(a.words[i].toLowerCase()) || []).forEach((b) => { if (b.p !== a) out.add(b.p.phrase); });
      });
      return [...out];
    }

    return { spin, partners };
  }

  // Zerlegt einen fertigen Satz in drei Walzen-Stücke.
  function splitInThree(text) {
    const w = text.split(/\s+/);
    if (w.length < 3) return [w[0] || "", w[1] || "", ""];
    const a = Math.max(1, Math.round(w.length / 3));
    const b = Math.max(a + 1, Math.round((2 * w.length) / 3));
    return [w.slice(0, a).join(" "), w.slice(a, b).join(" "), w.slice(b).join(" ")];
  }

  const api = { createDreher, splitInThree, analyse };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.Dreher = api;
})(typeof window !== "undefined" ? window : globalThis);

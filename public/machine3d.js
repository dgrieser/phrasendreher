// Der Automat: in Blender gebaut und mit Cycles fotorealistisch gerendert (blender/), im Browser mit three.js
// zusammengesetzt. Alles Feststehende – Gehäuse, Messing, Glas, Schatten – ist ein vorab berechnetes Bild. Live
// gezeichnet wird nur, was sich bewegt, und zwar mit genau der Kamera des Renders, damit alles passgenau sitzt:
//   – die drei Walzen mit ihren Texten, beleuchtet mit dem gerenderten Licht (auf einer weißen Walze) samt
//     der Spiegelung der Glasscheibe,
//   – der Hebel (glTF aus Blender), gespiegelt in einer Rundum-Aufnahme vom Hebel aus, mit Schatten auf der Wand,
//   – die Glühbirnen: das gerenderte Leuchten aller Birnen wird pro Birne ein- und ausgeblendet.
// Zum Start fliegt die Kamera in einem vorab gerenderten Video (intro.mp4) von schräg oben rechts zur Frontalansicht;
// dessen letztes Bild ist die Spielansicht, dort wird auf den Live-Automaten überblendet.
// app.js steuert Walzen und Hebel; dieses Modul zeichnet nur. Ohne WebGL gibt es nur einen Hinweis.
import * as THREE from "three";
import { GLTFLoader } from "./vendor/GLTFLoader.js";
import { RGBELoader } from "./vendor/RGBELoader.js";

const BASE = "automat/";
const machine = document.querySelector(".machine");
const leverEl = document.getElementById("lever");
const app = window.Phrasendreher;
const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

const N = 12;                       // Seiten pro Walze (wie in app.js)
const STEP = (Math.PI * 2) / N;
const LEVER_MAX = 125;              // Grad, wie MAX in app.js
const MAX_BULBS = 40;
const SLAB = '"Rokkitt", "Rockwell", Georgia, serif';

// ---------- Laden ----------
// Jede Datei rückt die Ladeanzeige ein Stück weiter (von 0,6 bis 0,85).
async function loadAll() {
  const scene = await fetch(BASE + "szene.json").then((r) => { if (!r.ok) throw new Error(r.status); return r.json(); });
  const withIntro = scene.intro && !reduceMotion;
  const files = withIntro ? 6 : 5;
  let done = 0;
  const tick = (x) => { done++; window.Loader?.progress(0.6 + 0.25 * (done / files)); return x; };
  const tex = (name) => new THREE.TextureLoader().loadAsync(BASE + name).then(tick);
  // Auch die Geräusche (app.js) sollen beim ersten Zug schon da sein – aber höchstens 5 s darauf warten
  const sounds = Promise.race([window.Phrasendreher?.soundsReady, new Promise((r) => setTimeout(r, 5000))]);
  const [plate, glow, reelLight, env, gltf, intro] = await Promise.all([
    tex("automat.webp"),
    tex("gluehen.webp"),
    tex("walzen.webp"),
    new RGBELoader().loadAsync(BASE + "umgebung.hdr").then(tick),
    new GLTFLoader().loadAsync(BASE + "hebel.glb").then(tick),
    withIntro ? loadVideo(scene.intro.dateien).then(tick, () => tick(null)) : null,
    sounds,
  ]);
  return { scene, plate, glow, reelLight, env, gltf, intro };
}

// Das Intro als Blob laden (so braucht der Server keine Range-Anfragen, die Safari für Videos sonst verlangt) und
// warten, bis das erste Bild dekodiert ist. Klappt etwas nicht, startet der Automat eben ohne Intro.
async function loadVideo(files) {
  const video = document.createElement("video");
  const type = Object.keys(files).find((t) => video.canPlayType(t));
  if (!type) throw new Error("kein passendes Videoformat");
  const blob = await fetch(BASE + files[type]).then((r) => { if (!r.ok) throw new Error(r.status); return r.blob(); });
  video.muted = true;
  video.playsInline = true;
  video.setAttribute("playsinline", "");
  video.preload = "auto";
  video.setAttribute("aria-hidden", "true");
  video.style.cssText = "position:absolute;width:1px;height:1px;opacity:0;pointer-events:none";
  document.body.appendChild(video);
  video.src = URL.createObjectURL(blob);
  await new Promise((resolve, reject) => {
    video.addEventListener("loadeddata", resolve, { once: true });
    video.addEventListener("error", reject, { once: true });
    setTimeout(() => reject(new Error("Intro lädt nicht")), 8000);
  });
  return video;
}

function init(A) {
  if (!app || !app.drums) return null;
  const S = A.scene;
  const IW = S.bild.w, IH = S.bild.h;
  machine.style.aspectRatio = `${IW} / ${IH}`;

  const canvas = document.createElement("canvas");
  canvas.className = "machine3d";
  canvas.setAttribute("aria-hidden", "true");
  machine.appendChild(canvas);
  let renderer;
  try {
    renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true, premultipliedAlpha: true });
  } catch (e) {
    canvas.remove();
    return null;
  }
  renderer.autoClear = false;
  renderer.setClearColor(0x000000, 0);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.AgXToneMapping;   // wie die Ansicht „AgX“ in Blender
  renderer.toneMappingExposure = 1;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.VSMShadowMap;   // weich gefilterte Schatten
  renderer.shadowMap.autoUpdate = false;          // nur neu, wenn sich der Hebel bewegt
  const dpr = () => Math.min(window.devicePixelRatio || 1, 2.5);

  // Kamera genau wie im Render: Lage und Projektion direkt aus Blender (Welt mit z nach oben)
  const camera = new THREE.PerspectiveCamera();
  camera.matrixAutoUpdate = false;
  camera.matrix.fromArray(S.kamera.matrixWorld);
  camera.projectionMatrix.fromArray(S.kamera.projection);
  camera.projectionMatrixInverse.copy(camera.projectionMatrix).invert();
  camera.updateMatrixWorld(true);

  // Die gerenderten Bilder sind fertige Bildschirmfarben (AgX, sRGB) – sie gehen ohne Umrechnung durch.
  for (const t of [A.plate, A.glow, A.reelLight]) {
    t.colorSpace = THREE.NoColorSpace;
    t.anisotropy = 4;
    t.generateMipmaps = true;
    t.minFilter = THREE.LinearMipmapLinearFilter;
  }
  A.reelLight.generateMipmaps = false;
  A.reelLight.minFilter = THREE.LinearFilter;

  const [cx0, cy0, cx1, cy1] = S.walzen.ausschnitt;   // Fensterausschnitt in Bildpixeln (y nach unten)
  const crop = new THREE.Vector4(cx0 / IW, 1 - cy1 / IH, cx1 / IW, 1 - cy0 / IH);
  const resolution = new THREE.Vector2(1, 1);

  // ---------- Walzen ----------
  // Jede Walze ist ein echter Zylinder aus zwölf gebogenen Seiten mit je eigener kleiner Textur –
  // so muss beim Drehen nur die Seite neu gezeichnet werden, die gerade hinten neuen Text bekommt.
  // Licht und Glasspiegelung kommen aus dem Render (walzen.webp), Bewegungsunschärfe macht der Shader.
  const reelScene = new THREE.Scene();
  const reels = [];
  let faceGeo = null;
  const R = S.walzen.radius, RW = S.walzen.breite, RH = S.walzen.hoehe;
  const ARC = R * STEP;
  const reelMaterial = (map, blur, center) => new THREE.ShaderMaterial({
    uniforms: { map: { value: map }, uBlur: blur, uLight: { value: A.reelLight }, uCrop: { value: crop },
      uRes: { value: resolution }, uCenter: { value: center }, uEdge: { value: Math.asin(RH / 2 / R) } },
    // vAngle: wie weit sich die Walze an dieser Stelle vom Betrachter wegdreht (0 = Mitte des Fensters)
    vertexShader: `uniform vec3 uCenter; varying vec2 vUv; varying float vAngle;
      void main() {
        vUv = uv;
        vec4 w = modelMatrix * vec4(position, 1.0);
        vec3 d = w.xyz - uCenter;
        vAngle = atan(d.z, -d.y);
        gl_Position = projectionMatrix * viewMatrix * w;
      }`,
    fragmentShader: `uniform sampler2D map, uLight; uniform float uBlur, uEdge; uniform vec4 uCrop; uniform vec2 uRes;
      varying vec2 vUv; varying float vAngle;
      void main() {
        vec2 s = gl_FragCoord.xy / uRes;
        vec2 c = (s - uCrop.xy) / (uCrop.zw - uCrop.xy);
        if (c.x < 0.0 || c.y < 0.0 || c.x > 1.0 || c.y > 1.0) discard;
        vec3 col = vec3(0.0);
        for (int i = 0; i < 12; i++) {
          float o = (float(i) / 11.0 - 0.5) * uBlur;
          col += texture2D(map, vec2(vUv.x, clamp(vUv.y + o, 0.0, 1.0))).rgb;
        }
        col /= 12.0;
        c.y = clamp(c.y, 0.002, 0.998);
        vec3 light = texture2D(uLight, vec2(c.x, 0.5 + c.y * 0.5)).rgb;   // obere Bildhälfte: Licht
        vec3 refl = texture2D(uLight, vec2(c.x, c.y * 0.5)).rgb;          // untere: Spiegelung im Glas
        // Zum oberen und unteren Rand hin dreht sich die Walze weg und liegt im Schatten des Fensterschachts
        float e = abs(vAngle) / uEdge;
        float shade = 1.0 - 0.42 * smoothstep(0.45, 1.08, e) - 0.06 * e;
        gl_FragColor = vec4(col * light * 1.12 * shade + refl, 1.0);
      }`,
  });

  // Zylinderstück für eine Seite: Achse entlang x, Mitte bei Winkel 0 (zum Betrachter, also −y)
  function faceGeometry() {
    const seg = 10;
    const pos = [], uv = [], idx = [];
    for (let j = 0; j <= seg; j++) {
      const v = j / seg;
      const a = (v - 0.5) * STEP;
      for (const u of [0, 1]) {
        pos.push((u - 0.5) * RW, -R * Math.cos(a), R * Math.sin(a));
        uv.push(u, v);
      }
    }
    for (let j = 0; j < seg; j++) {
      const a = j * 2;
      idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute("uv", new THREE.Float32BufferAttribute(uv, 2));
    g.setIndex(idx);
    return g;
  }

  // Pixel pro Meter auf der Walzenvorderseite (CSS-Pixel) – bestimmt die Texturgröße und die Schrift
  const tmp = new THREE.Vector3();
  function project(p) {
    tmp.copy(p).project(camera);
    const c = canvas.getBoundingClientRect();
    return { x: c.left + ((tmp.x + 1) / 2) * c.width, y: c.top + ((1 - tmp.y) / 2) * c.height };
  }
  function cssPerMeter() {
    const m = S.walzen.mitten[1];
    const a = project(new THREE.Vector3(-RW / 2, m[1] - R, m[2]));
    const b = project(new THREE.Vector3(RW / 2, m[1] - R, m[2]));
    return Math.hypot(b.x - a.x, b.y - a.y) / RW;
  }

  function buildReels() {
    reels.forEach((r) => r.faces.forEach((f) => { f.tex.dispose(); f.mesh.material.dispose(); }));
    reelScene.clear();
    reels.length = 0;
    faceGeo = faceGeo || faceGeometry();
    const ppm = cssPerMeter();
    const Sx = dpr();
    S.walzen.mitten.forEach((m, k) => {
      const drum = new THREE.Group();
      drum.position.set(m[0], m[1], m[2]);
      reelScene.add(drum);
      const blur = { value: 0 };
      const w = RW * ppm, H = RH * ppm;
      const faces = [];
      for (let i = 0; i < N; i++) {
        const c = document.createElement("canvas");
        c.width = Math.max(16, Math.round(w * Sx));
        c.height = Math.max(8, Math.round(ARC * ppm * Sx));
        const tex = new THREE.CanvasTexture(c);
        tex.colorSpace = THREE.NoColorSpace;
        tex.anisotropy = 4;
        const mesh = new THREE.Mesh(faceGeo, reelMaterial(tex, blur, drum.position));
        mesh.rotation.x = -i * STEP;                      // Seite i liegt bei Winkel i·STEP (nach oben positiv)
        drum.add(mesh);
        faces.push({ mesh, canvas: c, tex, text: null });
      }
      reels.push({ drum, faces, blur, w, H, S: Sx, arc: ARC * ppm });
      app.drums[k].faces.forEach((f, i) => face(k, i, f.text));
    });
    syncReels();
  }

  // Zeichnet eine Walzenseite: Papier, rote Doppellinien mit Rauten, Text (oder rote Raute, wenn leer)
  function face(k, i, text) {
    const reel = reels[k];
    if (!reel) return;
    const f = reel.faces[i];
    f.text = text;
    const c = f.canvas, ctx = c.getContext("2d");
    const W = c.width, Hc = c.height, Sx = reel.S;
    const u = reel.H / 112;                            // Maßstab: alte Walzenhöhe 112 px
    const g = ctx.createLinearGradient(0, 0, W, 0);
    g.addColorStop(0, "#e2d0a6");
    g.addColorStop(0.1, "#f3e6c8");
    g.addColorStop(0.5, "#f8eed8");
    g.addColorStop(0.9, "#f3e6c8");
    g.addColorStop(1, "#e2d0a6");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, Hc);
    // Papierstruktur: feine Fasern und Flecken
    ctx.fillStyle = "rgba(115,75,35,.06)";
    for (let n = 0; n < (W * Hc) / 220; n++) ctx.fillRect(Math.random() * W, Math.random() * Hc, Sx, Sx);
    ctx.fillStyle = "rgba(255,255,255,.08)";
    for (let n = 0; n < (W * Hc) / 600; n++) ctx.fillRect(Math.random() * W, Math.random() * Hc, Sx, Sx);

    // Linien und Rauten
    ctx.fillStyle = "#b3261e";
    const lw = 1.5 * Sx * u;
    for (const y of [Hc * 0.09, Hc * 0.91 - 5 * Sx * u]) {
      ctx.fillRect(W * 0.09, y, W * 0.82, lw);
      ctx.fillRect(W * 0.09, y + 5 * Sx * u - lw, W * 0.82, lw);
      diamond(ctx, W / 2, y + 2.5 * Sx * u, 4.5 * Sx * u, "#b3261e", 3 * Sx * u);
    }

    // Text
    const F = reel.H * 0.84;
    if (text) {
      const fit = fitText(ctx, text.toUpperCase(), (reel.w - 28 * u) * Sx, F * 0.6 * Sx, F * 0.42 * Sx, 10 * Sx * u);
      ctx.fillStyle = "#1e130d";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.font = `800 ${fit.size}px ${SLAB}`;
      const lh = fit.size * 0.95;
      fit.lines.forEach((line, n) => ctx.fillText(line, W / 2, Hc / 2 + (n - (fit.lines.length - 1) / 2) * lh + fit.size * 0.04));
    } else {
      diamond(ctx, W / 2, Hc / 2, F * 0.17 * Sx, "#b3261e", 0);
    }
    f.tex.needsUpdate = true;
    invalidate();
  }

  function diamond(ctx, x, y, r, color, ring) {
    if (ring) {
      ctx.fillStyle = "#f6ebd1";
      ctx.beginPath();
      ctx.moveTo(x, y - r - ring); ctx.lineTo(x + r + ring, y); ctx.lineTo(x, y + r + ring); ctx.lineTo(x - r - ring, y);
      ctx.fill();
    }
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.moveTo(x, y - r); ctx.lineTo(x + r, y); ctx.lineTo(x, y + r); ctx.lineTo(x - r, y);
    ctx.fill();
  }

  // Größte Schrift, bei der der Text in höchstens drei ausgewogenen Zeilen passt
  function fitText(ctx, text, maxW, maxH, maxSize, minSize) {
    const words = text.split(/\s+/).filter(Boolean);
    let best = null;
    for (let size = Math.floor(maxSize); size >= minSize; size--) {
      ctx.font = `800 ${size}px ${SLAB}`;
      const space = ctx.measureText(" ").width;
      const widths = words.map((w) => ctx.measureText(w).width);
      const lineW = (a, b) => widths.slice(a, b).reduce((s, x) => s + x, 0) + (b - a - 1) * space;
      for (let lines = 1; lines <= Math.min(3, words.length); lines++) {
        if (lines * size * 0.95 > maxH) break;
        const split = balance(words.length, lines, lineW);
        if (split.max <= maxW) {
          return { size, lines: split.cuts.map(([a, b]) => words.slice(a, b).join(" ")) };
        }
      }
      best = { size, lines: [words.join(" ")] };
    }
    return best || { size: minSize, lines: [text] };
  }
  function balance(n, lines, lineW) {
    if (lines === 1) return { max: lineW(0, n), cuts: [[0, n]] };
    let best = { max: Infinity, cuts: [] };
    const rec = (start, left, cuts, max) => {
      if (left === 1) {
        const m = Math.max(max, lineW(start, n));
        if (m < best.max) best = { max: m, cuts: [...cuts, [start, n]] };
        return;
      }
      for (let e = start + 1; e <= n - left + 1; e++) rec(e, left - 1, [...cuts, [start, e]], Math.max(max, lineW(start, e)));
    };
    rec(0, lines, [], 0);
    return best;
  }

  function syncReels() {
    reels.forEach((reel, k) => {
      const d = app.drums[k];
      const a = (d.angle * Math.PI) / 180;
      reel.drum.rotation.x = -a;
      // Nur Seiten in der Nähe des Fensters zeichnen
      reel.faces.forEach((f, i) => {
        const rel = Math.abs(((i * STEP + a) % (Math.PI * 2) + Math.PI * 3) % (Math.PI * 2) - Math.PI);
        f.mesh.visible = rel < Math.PI / 2.4;
      });
      // Unschärfe in Pixeln entlang des Umfangs, umgerechnet auf die Seitenhöhe
      const px = Math.min(16, Math.abs(d.speed) * 0.014) * (reel.H / 112);
      reel.blur.value = px < 0.6 ? 0 : px / reel.arc;
    });
  }

  // ---------- Gehäuse und Glühbirnen ----------
  // Ein Rechteck über die ganze Leinwand: das gerenderte Gehäuse (vormultipliziert, die Walzen scheinen durch
  // die Löcher) plus das Leuchten. Jede Birne bekommt ihr Leuchten über eine weiche Zuordnung jedes Pixels zu
  // den nächsten Birnen – so glüht auch das Licht auf Holz und Messing nur um die Birnen, die gerade an sind.
  const bulbs = [];        // { row, i, seq, on, level }
  const rows = S.birnen;
  let seq = 0;
  const bulbData = [];
  [rows[0] || [], (rows[1] || []).slice().reverse(), rows[2] || []].forEach((row, r) => row.forEach((b, i) => {
    // Lauflicht-Reihenfolge: Bogen nach rechts, untere Kronenreihe zurück nach links, dann der Sockel nach rechts
    const sigma = Math.max(b.r * 2.4, 6);
    bulbData.push(new THREE.Vector3(b.x / IW, 1 - b.y / IH, 1 / (sigma / IH) ** 2));
    bulbs.push({ row: r, i: r === 1 ? row.length - 1 - i : i, seq: seq++, on: false, level: 0 });
  }));
  while (bulbData.length < MAX_BULBS) bulbData.push(new THREE.Vector3(-10, -10, 1));
  const levels = new Float32Array(MAX_BULBS);
  const plateMat = new THREE.ShaderMaterial({
    uniforms: { uPlate: { value: A.plate }, uGlow: { value: A.glow }, uBulbs: { value: bulbData },
      uLevel: { value: levels }, uAspect: { value: IW / IH }, uCount: { value: bulbs.length } },
    vertexShader: `varying vec2 vUv; void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }`,
    fragmentShader: `#define MAXB ${MAX_BULBS}
      uniform sampler2D uPlate, uGlow; uniform vec3 uBulbs[MAXB]; uniform float uLevel[MAXB];
      uniform float uAspect; uniform int uCount;
      varying vec2 vUv;
      void main() {
        vec4 p = texture2D(uPlate, vUv);
        vec3 glow = texture2D(uGlow, vUv).rgb;
        // Gewicht jeder Birne: nah dran zählt nur sie, weiter weg mischt sich das Licht aller Birnen
        float wsum = 0.0, won = 0.0;
        for (int i = 0; i < MAXB; i++) {
          if (i >= uCount) break;
          vec2 d = (vUv - uBulbs[i].xy) * vec2(uAspect, 1.0);
          float t = 1.0 + dot(d, d) * uBulbs[i].z;
          float w = 1.0 / (t * t);
          wsum += w;
          won += w * uLevel[i];
        }
        gl_FragColor = vec4(p.rgb * p.a + glow * (won / wsum), p.a);
      }`,
    blending: THREE.CustomBlending,
    blendSrc: THREE.OneFactor,
    blendDst: THREE.OneMinusSrcAlphaFactor,
    depthTest: false,
    depthWrite: false,
  });
  const plateScene = new THREE.Scene();
  const plateQuad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), plateMat);
  plateQuad.frustumCulled = false;
  plateScene.add(plateQuad);
  const flatCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);

  // Lichtmuster je Zustand: alle Muster sind gestuft wie echte Lauflichter.
  //   idle  – ruhiges Lauflicht, jede dritte Birne (wie der Ladebildschirm)
  //   spin  – schnelle Lichterkette, die rundherum läuft
  //   win   – alle Birnen blinken gemeinsam
  //   after – abwechselnd jede zweite Birne, danach zurück zu idle
  // Glühfäden brauchen einen Moment: die Birnen glimmen an und klingen nach, statt hart zu schalten.
  const PATTERNS = {
    idle: { step: 400, on: (b, n) => (b.i + n) % 3 === 0 },
    spin: { step: 70, on: (b, n) => (((b.seq - n) % 6) + 6) % 6 < 2 },
    win: { step: 120, on: (b, n) => n % 2 === 0, next: "after", duration: 1600 },
    after: { step: 260, on: (b, n) => (b.i + n) % 2 === 0, next: "idle", duration: 6000 },
  };
  let lightState = "idle";
  let lightSince = performance.now();
  let lightTimer = 0;
  let fading = false;

  function applyLights() {
    const p = PATTERNS[lightState];
    const n = Math.floor((performance.now() - lightSince) / p.step);
    let changed = false;
    for (const b of bulbs) {
      const on = reduceMotion ? true : p.on(b, n);
      if (b.on !== on) { b.on = on; changed = true; }
    }
    if (changed) startFade();
  }

  let lastFade = 0;
  function startFade() {
    if (fading) return;
    fading = true;
    lastFade = performance.now();
    invalidate();
  }
  // Glühen nachführen; true, solange sich noch etwas ändert
  function stepFade(now) {
    const dt = Math.min(0.1, Math.max(0, (now - lastFade) / 1000));
    lastFade = now;
    let moving = false;
    bulbs.forEach((b, k) => {
      const target = b.on ? 1 : 0;
      const tau = reduceMotion ? 0 : b.on ? 0.035 : 0.09;    // an schneller als aus
      b.level = tau ? target + (b.level - target) * Math.exp(-dt / tau) : target;
      if (Math.abs(b.level - target) < 0.004) b.level = target;
      else moving = true;
      levels[k] = b.level;
    });
    return moving;
  }

  function tickLights() {
    clearTimeout(lightTimer);
    const p = PATTERNS[lightState];
    if (p.next && performance.now() - lightSince >= p.duration) {
      lightState = p.next;
      lightSince = performance.now();
    }
    applyLights();
    if (!reduceMotion) lightTimer = setTimeout(tickLights, PATTERNS[lightState].step);
  }

  function lights(state) {
    if (!PATTERNS[state]) return;
    lightState = state;
    lightSince = performance.now();
    tickLights();
  }

  // ---------- Hebel ----------
  // Aus Blender: „Hebel“ dreht um die Achse (x), darin „Schwinge“ für das seitliche Nachschwingen (um y).
  // Gespiegelt wird die Rundum-Aufnahme vom Hebel aus; ein Spotlicht wie die Softbox im Render wirft den Schatten.
  const leverScene = new THREE.Scene();
  const pmrem = new THREE.PMREMGenerator(renderer);
  A.env.mapping = THREE.EquirectangularReflectionMapping;
  leverScene.environment = pmrem.fromEquirectangular(A.env).texture;
  A.env.dispose();
  pmrem.dispose();
  const root = A.gltf.scene;
  leverScene.add(root);
  const pivot = root.getObjectByName("Hebel");
  const sway = root.getObjectByName("Schwinge");
  let ball = null;
  const chrome = new THREE.MeshPhysicalMaterial({ color: 0xf4f4f6, metalness: 1, roughness: 0.06, envMapIntensity: 1.35 });
  const chromeSatin = new THREE.MeshPhysicalMaterial({ color: 0xe9e9ec, metalness: 1, roughness: 0.22 });
  const red = new THREE.MeshPhysicalMaterial({
    color: 0x8a0a06, roughness: 0.3, metalness: 0, clearcoat: 1, clearcoatRoughness: 0.025,
    sheen: 0.25, sheenColor: new THREE.Color(0xff6a50), sheenRoughness: 0.4, envMapIntensity: 1.1,
  });
  const shadowMat = new THREE.ShadowMaterial({ opacity: 0.38, depthWrite: false });
  root.traverse((o) => {
    if (!o.isMesh) return;
    const name = o.name.replace(/_/g, " ");   // GLTFLoader ersetzt Leerzeichen in Namen
    if (name.startsWith("Schatten")) {
      o.material = shadowMat;
      o.receiveShadow = true;
      o.renderOrder = -1;
      return;
    }
    o.castShadow = true;
    if (name.startsWith("Hebel Knauf")) { o.material = red; ball = o; }
    else if (name.startsWith("Hebel Schelle")) o.material = chromeSatin;
    else o.material = chrome;
  });
  // Schattenwerfer: die Aufhellung von rechts aus dem Render (das Holz ist damit schon beleuchtet – hier zählt
  // nur der weiche Schatten auf der Seitenwand, das übrige Licht auf dem Hebel kommt aus dem Rundumbild)
  const key = new THREE.DirectionalLight(new THREE.Color().fromArray(S.licht.farbe), 0.6);
  const dir = new THREE.Vector3().fromArray(S.licht.richtung).normalize();
  const P = new THREE.Vector3().fromArray(S.hebel.drehpunkt);
  key.position.copy(P).addScaledVector(dir, -1.5);
  key.target.position.copy(P);
  key.castShadow = true;
  key.shadow.mapSize.set(512, 512);
  Object.assign(key.shadow.camera, { left: -0.45, right: 0.45, top: 0.45, bottom: -0.45, near: 0.5, far: 3 });
  key.shadow.bias = -0.0005;
  key.shadow.radius = 14;
  key.shadow.blurSamples = 16;
  leverScene.add(key, key.target);

  // ---------- Aufbau und Größe ----------
  function layout() {
    const c = canvas.getBoundingClientRect();
    if (!c.width || !c.height) return;
    renderer.setPixelRatio(dpr());
    renderer.setSize(c.width, c.height, false);
    const size = renderer.getDrawingBufferSize(new THREE.Vector2());
    resolution.copy(size);
    buildReels();
    placeLeverArea();
    buildKnobTable();
    invalidate();
  }

  // Grifffläche des Hebels: alles, was der Hebel in irgendeiner Stellung überstreicht, plus etwas Rand
  function placeLeverArea() {
    const m = machine.getBoundingClientRect();
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    const keep = pivot.rotation.x;
    for (let th = 0; th <= LEVER_MAX; th += 5) {
      pivot.rotation.x = THREE.MathUtils.degToRad(th);
      root.updateMatrixWorld(true);
      for (const o of [ball, sway]) {
        const p = project(o.getWorldPosition(tmp.clone()));
        x0 = Math.min(x0, p.x); x1 = Math.max(x1, p.x); y0 = Math.min(y0, p.y); y1 = Math.max(y1, p.y);
      }
    }
    pivot.rotation.x = keep;
    root.updateMatrixWorld(true);
    const pad = 30;
    Object.assign(leverEl.style, {
      left: `${x0 - pad - m.left}px`, top: `${y0 - pad - m.top}px`,
      width: `${x1 - x0 + 2 * pad}px`, height: `${y1 - y0 + 2 * pad}px`, right: "auto", bottom: "auto",
    });
  }

  // ---------- Intro ----------
  // Video mit links der Farbe (mit Alpha vormultipliziert) und rechts dem Alpha als Grau. Es läuft einmal, sobald
  // „Starten“ gedrückt ist; sein letztes Bild ist genau die Spielansicht, dort wird auf den Live-Automaten
  // überblendet. Solange es läuft, ist der Hebel gesperrt (body.intro).
  const INTRO_START = 250;         // ms nach dem Druck auf „Starten“: der Ladebildschirm blendet gerade aus
  const INTRO_FADE = 350;          // ms Überblendung am Ende
  let intro = null;
  if (A.intro) {
    const video = A.intro;
    const tex = new THREE.VideoTexture(video);
    tex.colorSpace = THREE.NoColorSpace;
    tex.minFilter = THREE.LinearFilter;
    tex.generateMipmaps = false;
    const mat = new THREE.ShaderMaterial({
      uniforms: { uVideo: { value: tex }, uOpacity: { value: 1 }, uTexel: { value: 0.5 / S.intro.breite } },
      vertexShader: `varying vec2 vUv; void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }`,
      fragmentShader: `uniform sampler2D uVideo; uniform float uOpacity, uTexel; varying vec2 vUv;
        void main() {
          float x = clamp(vUv.x * 0.5, uTexel, 0.5 - uTexel);     // nicht über die Naht zwischen den Hälften lesen
          vec3 c = texture2D(uVideo, vec2(x, vUv.y)).rgb;
          float a = texture2D(uVideo, vec2(x + 0.5, vUv.y)).r;
          gl_FragColor = vec4(c, a) * uOpacity;
        }`,
      blending: THREE.CustomBlending,
      blendSrc: THREE.OneFactor,
      blendDst: THREE.OneMinusSrcAlphaFactor,
      depthTest: false,
      depthWrite: false,
    });
    const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), mat);
    quad.frustumCulled = false;
    const scene = new THREE.Scene();
    scene.add(quad);
    intro = { video, tex, mat, scene, fadeFrom: 0 };
    document.body.classList.add("intro");
    video.addEventListener("ended", endIntro, { once: true });
  }

  function startIntro() {
    if (!intro) return;
    intro.video.play().then(() => invalidate(), endIntro);   // Autoplay verweigert: gleich der Live-Automat
    setTimeout(endIntro, (S.intro.bilder / S.intro.fps + 3) * 1000);   // falls das Video hängen bleibt
  }

  // Ende des Flugs: das Lauflicht übernimmt genau dort, wo es im Video stand, dann wird überblendet
  function endIntro() {
    if (!intro || intro.fadeFrom) return;
    const ran = (S.intro.bilder - 1) / S.intro.fps * 1000;
    lightState = "idle";
    lightSince = performance.now() - ran;
    tickLights();
    bulbs.forEach((b, k) => { b.level = b.on ? 1 : 0; levels[k] = b.level; });
    intro.fadeFrom = performance.now();
    document.body.classList.remove("intro");
    invalidate();
  }

  function drawIntro(now) {
    if (!intro.fadeFrom) {
      renderer.clear();
      renderer.render(intro.scene, flatCam);
      if (!intro.video.paused) invalidate();
      return true;
    }
    const k = 1 - (now - intro.fadeFrom) / INTRO_FADE;
    if (k <= 0) {
      intro.tex.dispose();
      intro.mat.dispose();
      URL.revokeObjectURL(intro.video.src);
      intro.video.remove();
      intro = null;
      return false;
    }
    intro.mat.uniforms.uOpacity.value = k;
    renderer.render(intro.scene, flatCam);
    invalidate();
    return false;
  }

  // ---------- Zeichnen bei Bedarf ----------
  let theta = 0;
  let swayDeg = 0;
  let shadowAt = null;
  let queued = false;
  function invalidate() {
    if (queued) return;
    queued = true;
    requestAnimationFrame(draw);
  }
  function draw(now) {
    queued = false;
    if (intro && !intro.fadeFrom) {
      drawIntro(now);
      ready();
      return;
    }
    if (fading && !stepFade(now)) fading = false;
    syncReels();
    pivot.rotation.x = THREE.MathUtils.degToRad(theta);
    sway.rotation.y = THREE.MathUtils.degToRad(swayDeg);
    if (shadowAt !== theta + "/" + swayDeg) {
      shadowAt = theta + "/" + swayDeg;
      renderer.shadowMap.needsUpdate = true;
    }
    renderer.clear();
    renderer.render(reelScene, camera);
    renderer.render(plateScene, flatCam);
    renderer.render(leverScene, camera);
    if (intro) drawIntro(now);          // Überblendung vom letzten Videobild
    if (fading) invalidate();
    ready();
  }

  function ready() {
    if (canvas.classList.contains("ready")) return;
    canvas.classList.add("ready");      // erst sichtbar, wenn ein vollständiges Bild steht
    // Erst wenn „Starten“ gedrückt ist (Ton freigeschaltet), fliegt die Kamera los
    const start = () => setTimeout(startIntro, INTRO_START);
    if (window.Loader) window.Loader.done(start);
    else start();
  }

  function lever(th, sw = 0) {
    theta = th;
    swayDeg = sw;
    invalidate();
  }

  // Bildschirmposition des Knaufs – damit app.js weiß, wo man ihn anfassen kann.
  function knobClient(th = theta) {
    pivot.rotation.x = THREE.MathUtils.degToRad(th);
    root.updateMatrixWorld(true);
    const p = project(ball.getWorldPosition(new THREE.Vector3()));
    pivot.rotation.x = THREE.MathUtils.degToRad(theta);
    root.updateMatrixWorld(true);
    return p;
  }

  // Umkehrung: welcher Hebelwinkel bringt den Knauf auf diese Bildschirmhöhe? (Tabelle je Grad)
  let knobTable = [];
  function buildKnobTable() {
    const top = canvas.getBoundingClientRect().top;
    knobTable = [];
    for (let th = 0; th <= LEVER_MAX; th++) knobTable.push(knobClient(th).y - top);
  }
  function angleAt(clientY) {
    const y = clientY - canvas.getBoundingClientRect().top;
    if (y <= knobTable[0]) return 0;
    for (let th = 1; th < knobTable.length; th++) {
      if (knobTable[th] >= y) {
        const a = knobTable[th - 1], b = knobTable[th];
        return th - 1 + (b > a ? (y - a) / (b - a) : 0);
      }
    }
    return LEVER_MAX;
  }

  layout();
  if (!intro) tickLights();
  let resizeTimer;
  new ResizeObserver(() => { clearTimeout(resizeTimer); resizeTimer = setTimeout(layout, 60); }).observe(machine);
  // Falls die Schriften beim Aufbau noch nicht da waren: neu beschriften, sobald sie geladen sind
  if (document.fonts) document.fonts.ready.then(layout);
  return { invalidate, face, lever, knobClient, angleAt, lights };
}

window.Loader?.progress(0.6);   // three.js ist geladen, dieses Modul läuft

// Erst bauen, wenn die Schriften für die Walzen geladen sind (höchstens 2,5 s warten) –
// so erscheint der Automat gleich fertig beschriftet.
const fontsReady = document.fonts
  ? Promise.race([
    document.fonts.load(`800 32px ${SLAB}`),
    new Promise((r) => setTimeout(r, 2500)),
  ]).catch(() => null)
  : Promise.resolve();

function noWebGL(err) {
  if (err) console.warn("3D-Automat nicht verfügbar:", err);
  // Ohne WebGL gibt es keinen Automaten, nur einen Hinweis
  machine.querySelectorAll("canvas").forEach((c) => c.remove());
  machine.hidden = true;
  const note = document.createElement("p");
  note.className = "no-webgl";
  note.textContent = "Dieser Automat braucht WebGL – dein Browser hat es gerade ausgeschaltet.";
  machine.after(note);
  window.Loader?.dismiss();
}

Promise.all([loadAll(), fontsReady]).then(([assets]) => {
  let api = null;
  try {
    api = init(assets);
  } catch (err) {
    return noWebGL(err);
  }
  if (api) window.Machine3D = api;
  else noWebGL();
}, (err) => {
  // Bilder oder Modell nicht ladbar: app.js zeigt nach einer Weile den Fehler im Ladebildschirm
  console.warn("Automat konnte nicht geladen werden:", err);
});

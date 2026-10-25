// Der ganze Automat als 3D-Modell (Three.js): Gehäuse aus Holz mit Messingrahmen, Namensschild,
// Sichtfenster mit drei echten Walzen hinter Glas, Sockel mit Zierleiste und der Hebel an der Seitenwand.
// Die Maße kommen aus dem (unsichtbaren) HTML-Gerüst – so passt sich das Modell an jede Bildschirmbreite an.
// app.js steuert Walzen und Hebel; dieses Modul zeichnet nur. Ohne WebGL bleibt der HTML-Automat sichtbar.
import * as THREE from "three";
import { RoomEnvironment } from "./vendor/RoomEnvironment.js";

const machine = document.querySelector(".machine");
const leverEl = document.getElementById("lever");
const app = window.Phrasendreher;

const N = 12;                       // Seiten pro Walze (wie in app.js)
const STEP = (Math.PI * 2) / N;
const DEPTH = 40;                   // Tiefe des Gehäuses (px)
const REEL_FRONT = -5;              // Vorderkante der Walzen hinter dem Glas
const SLAB = '"Rokkitt", "Rockwell", Georgia, serif';

function init() {
  if (!app || !app.drums) return null;
  const canvas = document.createElement("canvas");
  canvas.className = "machine3d";
  canvas.setAttribute("aria-hidden", "true");
  machine.appendChild(canvas);

  let renderer;
  try {
    renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true, powerPreference: "low-power" });
  } catch (e) {
    canvas.remove();
    return null;
  }
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;
  const dpr = () => Math.min(window.devicePixelRatio || 1, 2);

  const scene = new THREE.Scene();
  const pmrem = new THREE.PMREMGenerator(renderer);
  scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
  const sun = new THREE.DirectionalLight(0xfff1d6, 2.2);
  sun.position.set(-1, 2, 2.5);
  scene.add(sun, new THREE.AmbientLight(0x402010, 0.6));

  // ---------- Materialien ----------
  const brass = new THREE.MeshStandardMaterial({ color: 0xd8ab4f, metalness: 1, roughness: 0.27 });
  const brassDark = new THREE.MeshStandardMaterial({ color: 0x9c6c24, metalness: 1, roughness: 0.4 });
  const red = new THREE.MeshPhysicalMaterial({ color: 0x9a1810, roughness: 0.22, metalness: 0, clearcoat: 1, clearcoatRoughness: 0.06 });
  const woodTex = new THREE.CanvasTexture(woodCanvas());
  woodTex.colorSpace = THREE.SRGBColorSpace;
  woodTex.wrapS = woodTex.wrapT = THREE.RepeatWrapping;
  woodTex.repeat.set(1 / 512, 1 / 512);       // UV der Vorderseiten = Pixelkoordinaten
  woodTex.anisotropy = 4;
  const wood = new THREE.MeshPhysicalMaterial({ map: woodTex, color: 0x9c7c70, roughness: 0.5, envMapIntensity: 0.55, clearcoat: 0.6, clearcoatRoughness: 0.2 });
  const dark = new THREE.MeshBasicMaterial({ color: 0x140804 });

  // ---------- Gruppen ----------
  const cabinet = new THREE.Group();   // statisch, wird bei Größenänderung neu gebaut
  const reelsGroup = new THREE.Group();
  const yaw = new THREE.Group();       // Hebel, leicht von rechts gesehen
  const arm = new THREE.Group();       // dreht sich um die Hebelachse
  yaw.add(arm);
  scene.add(cabinet, reelsGroup, yaw);

  function clear(group) {
    group.traverse((o) => {
      if (o.geometry) o.geometry.dispose();
      if (o.userData.ownMaterial) { if (o.material.map) o.material.map.dispose(); o.material.dispose(); }
    });
    group.clear();
  }

  // ---------- Formen (Rechtecke in HTML-Koordinaten, y nach unten → Welt: y nach oben) ----------
  function roundRect(path, { x, y, w, h }, r) {
    const tl = Array.isArray(r) ? r : [r, r, r, r];   // oben links, oben rechts, unten rechts, unten links
    path.moveTo(x + tl[0], -y);
    path.lineTo(x + w - tl[1], -y);
    path.quadraticCurveTo(x + w, -y, x + w, -y - tl[1]);
    path.lineTo(x + w, -y - h + tl[2]);
    path.quadraticCurveTo(x + w, -y - h, x + w - tl[2], -y - h);
    path.lineTo(x + tl[3], -y - h);
    path.quadraticCurveTo(x, -y - h, x, -y - h + tl[3]);
    path.lineTo(x, -y - tl[0]);
    path.quadraticCurveTo(x, -y, x + tl[0], -y);
    return path;
  }
  // Krone: oben ein Ellipsenbogen über die ganze Breite, unten kleine Rundungen
  function arch(path, { x, y, w, h }, ry, rb) {
    path.moveTo(x, -y - ry);
    path.absellipse(x + w / 2, -y - ry, w / 2, ry, Math.PI, 0, true);
    path.lineTo(x + w, -y - h + rb);
    path.quadraticCurveTo(x + w, -y - h, x + w - rb, -y - h);
    path.lineTo(x + rb, -y - h);
    path.quadraticCurveTo(x, -y - h, x, -y - h + rb);
    path.lineTo(x, -y - ry);
    return path;
  }
  const inset = (r, d) => ({ x: r.x + d, y: r.y + d, w: r.w - 2 * d, h: r.h - 2 * d });

  // Extrudiert eine Form zwischen z = back und z = front, mit abgerundeter Kante.
  function slab(shape, front, back, material, bevel = 0) {
    const geo = new THREE.ExtrudeGeometry(shape, {
      depth: Math.max(0.1, front - back - 2 * bevel),
      bevelEnabled: bevel > 0,
      bevelThickness: bevel,
      bevelSize: bevel,
      bevelOffset: -bevel,
      bevelSegments: 3,
      curveSegments: 24,
    });
    const mesh = new THREE.Mesh(geo, material);
    mesh.position.z = back + bevel;
    cabinet.add(mesh);
    return mesh;
  }

  // Waagrechte Messingstange zwischen zwei x-Werten
  function rod(x0, x1, yc, z, r) {
    const m = new THREE.Mesh(new THREE.CylinderGeometry(r, r, x1 - x0, 20).rotateZ(Math.PI / 2), brass);
    m.position.set((x0 + x1) / 2, -yc, z);
    cabinet.add(m);
  }

  // ---------- Gehäuse ----------
  function buildCabinet(R) {
    clear(cabinet);

    // Schatten unter dem Automaten
    const sh = shadowTexture();
    const shadow = new THREE.Mesh(new THREE.PlaneGeometry(R.cabinet.w * 1.5, R.cabinet.h * 1.25),
      new THREE.MeshBasicMaterial({ map: sh, transparent: true, depthWrite: false }));
    shadow.userData.ownMaterial = true;
    shadow.position.set(R.cabinet.x + R.cabinet.w / 2, -(R.cabinet.y + R.cabinet.h / 2 + 26), -DEPTH - 2);
    cabinet.add(shadow);

    // Krone: Messingrand, Holz, feine Zierlinie
    const ry = Math.min(64, R.crown.h * 0.7);
    const crownOuter = arch(new THREE.Shape(), R.crown, ry, 8);
    const crownWood = arch(new THREE.Shape(), R.crownWood, ry - 4, 6);
    crownOuter.holes.push(arch(new THREE.Path(), R.crownWood, ry - 4, 6));
    slab(crownOuter, 2, -DEPTH, brass, 1.5);
    slab(crownWood, 0, -DEPTH + 1, wood);
    const lineOuter = arch(new THREE.Shape(), inset(R.crownWood, 3), ry - 7, 4);
    lineOuter.holes.push(arch(new THREE.Path(), inset(R.crownWood, 5), ry - 9, 3));
    slab(lineOuter, 0.8, -1, brass);

    // Namensschild mit geprägter Schrift
    slab(roundRect(new THREE.Shape(), R.plate, 6), 6, -1, brass, 1.6);
    const label = new THREE.Mesh(new THREE.PlaneGeometry(R.plate.w, R.plate.h),
      new THREE.MeshStandardMaterial({ map: plateTexture(R.plate), transparent: true, metalness: 0.4, roughness: 0.55 }));
    label.userData.ownMaterial = true;
    label.position.set(R.plate.x + R.plate.w / 2, -(R.plate.y + R.plate.h / 2), 6.05);
    cabinet.add(label);
    for (const b of R.bars) rod(b.x, b.x + b.w, b.y + b.h / 2, 2, 2.2);

    // Mittelteil: Messingrand, Holz mit Ausschnitt, Lünette um das Fenster
    const bodyOuter = roundRect(new THREE.Shape(), R.body, 6);
    bodyOuter.holes.push(roundRect(new THREE.Path(), R.bodyWood, 4));
    slab(bodyOuter, 2, -DEPTH, brass, 1.5);
    const bodyWood = roundRect(new THREE.Shape(), R.bodyWood, 4);
    bodyWood.holes.push(roundRect(new THREE.Path(), R.bezel, 12));
    slab(bodyWood, 0, -DEPTH + 1, wood);
    const bezel = roundRect(new THREE.Shape(), R.bezel, 12);
    bezel.holes.push(roundRect(new THREE.Path(), R.window, 6));
    slab(bezel, 7, -DEPTH, brass, 2.5);

    // Dunkler Grund hinter den Walzen (in den Lücken zwischen ihnen sichtbar)
    const back = new THREE.Mesh(new THREE.PlaneGeometry(R.window.w, R.window.h), dark);
    back.position.set(R.window.x + R.window.w / 2, -(R.window.y + R.window.h / 2), -16);
    cabinet.add(back);

    // Glasscheibe mit Spiegelung
    const glass = new THREE.Mesh(new THREE.ShapeGeometry(roundRect(new THREE.Shape(), R.window, 6)),
      new THREE.MeshBasicMaterial({ map: glassTexture(), transparent: true, depthWrite: false }));
    glass.userData.ownMaterial = true;
    const uv = glass.geometry.attributes.uv;
    for (let i = 0; i < uv.count; i++) uv.setXY(i, (uv.getX(i) - R.window.x) / R.window.w, (uv.getY(i) + R.window.y + R.window.h) / R.window.h);
    glass.position.z = -1;
    glass.renderOrder = 2;
    cabinet.add(glass);

    // Sockel mit Zierleiste: Nieten, Stangen, Raute
    const baseOuter = roundRect(new THREE.Shape(), R.base, [6, 6, 12, 12]);
    baseOuter.holes.push(roundRect(new THREE.Path(), R.baseWood, [4, 4, 10, 10]));
    slab(baseOuter, 2, -DEPTH, brass, 1.5);
    slab(roundRect(new THREE.Shape(), R.baseWood, [4, 4, 10, 10]), 0, -DEPTH + 1, wood);
    for (const r of R.rivets) {
      const m = new THREE.Mesh(new THREE.SphereGeometry(r.w / 2, 24, 12, 0, Math.PI * 2, 0, Math.PI / 2).rotateX(Math.PI / 2), brass);
      m.scale.z = 0.6;
      m.position.set(r.x + r.w / 2, -(r.y + r.h / 2), 0);
      cabinet.add(m);
    }
    for (const r of R.rods) rod(r.x, r.x + r.w, r.y + r.h / 2, 2, 2.2);
    if (R.gem) {
      const s = R.gem.w;
      const gem = slab(roundRect(new THREE.Shape(), { x: -s / 2, y: -s / 2, w: s, h: s }, 3), 5, -1, brass, 2);
      gem.position.x = R.gem.x + s / 2;
      gem.position.y = -(R.gem.y + R.gem.h / 2);
      gem.rotation.z = Math.PI / 4;
    }
  }

  // ---------- Walzen ----------
  // Jede Walze ist ein echter Zylinder aus zwölf gebogenen Seiten mit je eigener kleiner Textur –
  // so muss beim Drehen nur die Seite neu gezeichnet werden, die gerade hinten neuen Text bekommt.
  // Bewegungsunschärfe macht der Shader: er mittelt die Textur entlang der Drehrichtung.
  const reels = [];

  function blurMaterial(uniform) {
    const mat = new THREE.MeshBasicMaterial({ toneMapped: false });
    mat.onBeforeCompile = (shader) => {
      shader.uniforms.uBlur = uniform;
      shader.fragmentShader = "uniform float uBlur;\n" + shader.fragmentShader.replace(
        "#include <map_fragment>",
        `#ifdef USE_MAP
          vec4 sampledDiffuseColor = vec4(0.0);
          for (int i = 0; i < 12; i++) {
            float o = (float(i) / 11.0 - 0.5) * uBlur;
            sampledDiffuseColor += texture2D(map, vec2(vMapUv.x, clamp(vMapUv.y + o, 0.0, 1.0)));
          }
          diffuseColor *= sampledDiffuseColor / 12.0;
        #endif`);
    };
    mat.customProgramCacheKey = () => "reel-blur";
    return mat;
  }

  function buildReels(R) {
    clear(reelsGroup);
    reels.length = 0;
    R.reels.forEach((rect, k) => {
      const H = rect.h;
      const F = H * 0.84;                                 // Seitenhöhe wie im HTML-Automaten
      const r = F / (2 * Math.tan(Math.PI / N));
      const arc = r * STEP;
      const drum = new THREE.Group();
      drum.position.set(rect.x + rect.w / 2, -(rect.y + H / 2), REEL_FRONT - r);
      reelsGroup.add(drum);
      const geo = faceGeometry(rect.w, r);
      const blur = { value: 0 };
      const S = dpr();
      const faces = [];
      for (let i = 0; i < N; i++) {
        const c = document.createElement("canvas");
        c.width = Math.round(rect.w * S);
        c.height = Math.round(arc * S);
        const tex = new THREE.CanvasTexture(c);
        tex.colorSpace = THREE.SRGBColorSpace;
        tex.anisotropy = 4;
        const mat = blurMaterial(blur);
        mat.map = tex;
        const mesh = new THREE.Mesh(geo, mat);
        mesh.userData.ownMaterial = true;
        mesh.rotation.x = -i * STEP;                      // Seite i liegt bei Winkel i·STEP (nach oben positiv)
        drum.add(mesh);
        faces.push({ mesh, canvas: c, tex, text: null });
      }
      // Schatten oben und unten, wo sich die Walze vom Glas wegdreht
      const shade = new THREE.Mesh(new THREE.PlaneGeometry(rect.w, H),
        new THREE.MeshBasicMaterial({ map: shadeTexture(), transparent: true, depthWrite: false }));
      shade.userData.ownMaterial = true;
      shade.position.set(rect.x + rect.w / 2, -(rect.y + H / 2), REEL_FRONT + 0.5);
      shade.renderOrder = 1;
      reelsGroup.add(shade);
      reels.push({ drum, faces, blur, w: rect.w, arc, S, H, r });
      // Dunkle Stege über und unter der Walze verdecken die Nachbarwalzen, die sich dort nach hinten wegdrehen
      const top = k === 0 ? R.window.y : R.reels[k - 1].y + R.reels[k - 1].h;
      const bottom = k === R.reels.length - 1 ? R.window.y + R.window.h : R.reels[k + 1].y;
      for (const [y0, y1] of [[top, rect.y], [rect.y + H, bottom]]) {
        if (y1 - y0 <= 0) continue;
        const bar = new THREE.Mesh(new THREE.PlaneGeometry(rect.w, y1 - y0), dark);
        bar.position.set(rect.x + rect.w / 2, -(y0 + y1) / 2, REEL_FRONT + 1);
        reelsGroup.add(bar);
      }
      app.drums[k].faces.forEach((f, i) => face(k, i, f.text));
    });
    syncReels();
  }

  // Zylinderstück für eine Seite: Achse entlang x, Mitte bei Winkel 0 (zum Betrachter)
  function faceGeometry(w, r) {
    const seg = 10;
    const pos = [], uv = [], idx = [];
    for (let j = 0; j <= seg; j++) {
      const v = j / seg;
      const a = (v - 0.5) * STEP;
      for (const u of [0, 1]) {
        pos.push((u - 0.5) * w, r * Math.sin(a), r * Math.cos(a));
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
    g.computeVertexNormals();
    return g;
  }

  // Zeichnet eine Walzenseite: Papier, rote Doppellinien mit Rauten, Text (oder rote Raute, wenn leer)
  function face(k, i, text) {
    const reel = reels[k];
    if (!reel) return;
    const f = reel.faces[i];
    f.text = text;
    const c = f.canvas, ctx = c.getContext("2d");
    const W = c.width, Hc = c.height, S = reel.S;
    const g = ctx.createLinearGradient(0, 0, W, 0);
    g.addColorStop(0, "#d6c296");
    g.addColorStop(0.12, "#f3e6c8");
    g.addColorStop(0.5, "#f8eed6");
    g.addColorStop(0.88, "#f3e6c8");
    g.addColorStop(1, "#d6c296");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, Hc);
    ctx.fillStyle = "rgba(115,75,35,.07)";
    for (let n = 0; n < (W * Hc) / 260; n++) ctx.fillRect(Math.random() * W, Math.random() * Hc, S, S);

    // Linien und Rauten
    ctx.fillStyle = "#b3261e";
    const lw = 1.5 * S;
    for (const y of [Hc * 0.09, Hc * 0.91 - 5 * S]) {
      ctx.fillRect(W * 0.09, y, W * 0.82, lw);
      ctx.fillRect(W * 0.09, y + 5 * S - lw, W * 0.82, lw);
      diamond(ctx, W / 2, y + 2.5 * S, 4.5 * S, "#b3261e", 3 * S);
    }

    // Text
    const F = reel.H * 0.84;
    if (text) {
      const fit = fitText(ctx, text.toUpperCase(), (reel.w - 28) * S, F * 0.6 * S, F * 0.42 * S, 11 * S);
      ctx.fillStyle = "#1e130d";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.font = `800 ${fit.size}px ${SLAB}`;
      const lh = fit.size * 0.95;
      fit.lines.forEach((line, n) => ctx.fillText(line, W / 2, Hc / 2 + (n - (fit.lines.length - 1) / 2) * lh + fit.size * 0.04));
    } else {
      diamond(ctx, W / 2, Hc / 2, F * 0.17 * S, "#b3261e", 0);
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
      const px = Math.min(16, Math.abs(d.speed) * 0.014);
      reel.blur.value = px < 0.6 ? 0 : px / reel.arc;
    });
  }

  // ---------- Hebel ----------
  const lv = { L: 0, ball: null };
  function buildLever(L, axleStart) {
    clear(yaw);
    yaw.add(arm);
    clear(arm);
    // Achse aus der Seitenwand bis durch das Rad, mit Lagerring und Mutter
    const alongX = (geo) => geo.rotateZ(Math.PI / 2);
    const axleLen = 16 - axleStart;
    const axle = new THREE.Mesh(alongX(new THREE.CylinderGeometry(6, 6, axleLen, 32)), brass);
    axle.position.x = axleStart + axleLen / 2;
    const bearing = new THREE.Mesh(alongX(new THREE.CylinderGeometry(11, 11, 6, 40)), brassDark);
    bearing.position.x = axleStart + 3;
    const nut = new THREE.Mesh(alongX(new THREE.CylinderGeometry(8, 8, 7, 6)), brassDark);
    nut.position.x = 17;
    yaw.add(axle, bearing, nut);

    // Rad mit gerundeter Kante, Schrauben und Deckel auf der Außenseite – dreht sich mit dem Hebel
    const profile = [[0, -6], [16, -6], [19, -4.5], [20, 0], [19, 4.5], [16, 6], [0, 6]].map(([r, x]) => new THREE.Vector2(r, x));
    arm.add(new THREE.Mesh(new THREE.LatheGeometry(profile, 56).rotateZ(-Math.PI / 2), brass));
    for (let i = 0; i < 5; i++) {
      const a = (i / 5) * Math.PI * 2;
      const bolt = new THREE.Mesh(alongX(new THREE.CylinderGeometry(2.3, 2.3, 2.4, 6)), brassDark);
      bolt.position.set(6.6, Math.cos(a) * 12.5, Math.sin(a) * 12.5);
      arm.add(bolt);
    }
    const cap = new THREE.Mesh(new THREE.SphereGeometry(5.5, 24, 12, 0, Math.PI * 2, 0, Math.PI / 2).rotateZ(-Math.PI / 2), brass);
    cap.position.x = 6;
    arm.add(cap);

    // Klemme am Radkranz, Stange, Manschette unter dem Knauf, Knauf
    const clamp = new THREE.Mesh(new THREE.CylinderGeometry(7.5, 8.5, 16, 32), brassDark);
    clamp.position.y = 24;
    const stickLen = L - 30;
    const stick = new THREE.Mesh(new THREE.CylinderGeometry(4.6, 5.2, stickLen, 32), brass);
    stick.position.y = 30 + stickLen / 2;
    const collar = new THREE.Mesh(new THREE.LatheGeometry(
      [[0, 0], [7, 0], [8.5, 2], [8.5, 14], [6.5, 18], [0, 18]].map(([r, y]) => new THREE.Vector2(r, y)), 40), brass);
    collar.position.y = L - 44;
    const ball = new THREE.Mesh(new THREE.SphereGeometry(27, 48, 32), red);
    ball.position.y = L;
    arm.add(clamp, stick, collar, ball);
    lv.ball = ball;
  }

  // ---------- Kamera und Aufbau ----------
  const camera = new THREE.PerspectiveCamera(22, 1, 1, 5000);

  function rects() {
    const c = canvas.getBoundingClientRect();
    const rel = (el) => {
      const r = el.getBoundingClientRect();
      return { x: r.left - c.left, y: r.top - c.top, w: r.width, h: r.height };
    };
    const q = (s) => machine.querySelector(s);
    const all = (s) => [...machine.querySelectorAll(s)].map(rel);
    return {
      canvas: c,
      cabinet: rel(q(".cabinet")),
      crown: rel(q(".crown")), crownWood: rel(q(".crown-wood")), plate: rel(q(".plate")), bars: all(".crown .bar"),
      body: rel(q(".body")), bodyWood: rel(q(".body-wood")), bezel: rel(q(".bezel")), window: rel(q(".window")),
      reels: all(".reel"),
      base: rel(q(".base")), baseWood: rel(q(".base-wood")),
      rivets: all(".rivet"), rods: all(".rail .rod"), gem: all(".rail .gem")[0],
      lever: rel(leverEl),
    };
  }

  function layout() {
    const R = rects();
    const { width: w, height: h } = R.canvas;
    if (!w || !h) return;
    renderer.setPixelRatio(dpr());
    renderer.setSize(w, h, false);
    // Welt: x nach rechts, y nach oben, 1 Einheit = 1 CSS-Pixel in der Ebene z = 0
    const dist = h / (2 * Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)));
    camera.aspect = w / h;
    camera.position.set(w / 2, -h / 2, dist);
    camera.lookAt(w / 2, -h / 2, 0);
    camera.near = Math.max(1, dist - 600);
    camera.far = dist + 600;
    camera.updateProjectionMatrix();

    buildCabinet(R);
    buildReels(R);
    // Hebel: Drehpunkt bei 55 % der Hebelspalte, Arm 38 % ihrer Höhe – wie im HTML-Hebel
    const px = R.lever.x + R.lever.w / 2;
    const py = R.lever.y + R.lever.h * 0.55;
    lv.L = R.lever.h * 0.38;
    yaw.position.set(px, -py, 0);
    yaw.rotation.y = THREE.MathUtils.degToRad(-6);
    buildLever(lv.L, R.cabinet.x + R.cabinet.w - px - 4);
    invalidate();
  }

  // ---------- Zeichnen bei Bedarf ----------
  let theta = 0;
  let queued = false;
  function invalidate() {
    if (queued) return;
    queued = true;
    requestAnimationFrame(() => {
      queued = false;
      syncReels();
      arm.rotation.x = THREE.MathUtils.degToRad(theta);
      renderer.render(scene, camera);
    });
  }

  function lever(th) {
    theta = th;
    invalidate();
  }

  // Bildschirmposition des Knaufs – damit app.js weiß, wo man ihn anfassen kann.
  const tmp = new THREE.Vector3();
  function knobClient(th = theta) {
    arm.rotation.x = THREE.MathUtils.degToRad(th);
    scene.updateMatrixWorld(true);
    lv.ball.getWorldPosition(tmp).project(camera);
    arm.rotation.x = THREE.MathUtils.degToRad(theta);
    const c = canvas.getBoundingClientRect();
    return { x: c.left + ((tmp.x + 1) / 2) * c.width, y: c.top + ((1 - tmp.y) / 2) * c.height };
  }

  layout();
  let resizeTimer;
  new ResizeObserver(() => { clearTimeout(resizeTimer); resizeTimer = setTimeout(layout, 60); }).observe(machine);
  // Sobald die Schriften geladen sind, Schild und Walzen neu beschriften
  if (document.fonts) document.fonts.ready.then(layout);
  machine.classList.add("webgl");
  leverEl.classList.add("webgl");
  return { invalidate, face, lever, knobClient };
}

// ---------- Texturen ----------
function woodCanvas() {
  const s = 512;
  const c = document.createElement("canvas");
  c.width = c.height = s;
  const ctx = c.getContext("2d");
  const g = ctx.createLinearGradient(0, 0, s, s * 0.18);
  [["#4a120a", 0], ["#7b2415", 0.22], ["#5a170d", 0.45], ["#852b19", 0.68], ["#4c130a", 1]].forEach(([col, p]) => g.addColorStop(p, col));
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, s, s);
  // Maserung: wellige, waagrechte Fasern, an den Rändern nahtlos
  let seed = 7;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  for (let n = 0; n < 340; n++) {
    const y0 = rnd() * s;
    const amp = 1 + rnd() * 7;
    const k = 1 + Math.floor(rnd() * 3);
    const ph = rnd() * Math.PI * 2;
    const light = rnd() < 0.3;
    ctx.strokeStyle = light ? `rgba(255,190,140,${0.02 + rnd() * 0.04})` : `rgba(20,4,1,${0.05 + rnd() * 0.14})`;
    ctx.lineWidth = 0.6 + rnd() * 2.4;
    for (const off of [-s, 0, s]) {
      ctx.beginPath();
      for (let x = 0; x <= s; x += 8) {
        const y = y0 + off + amp * Math.sin((x / s) * Math.PI * 2 * k + ph) + 2 * Math.sin((x / s) * Math.PI * 2 * (k + 3) + ph * 2);
        x === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
      }
      ctx.stroke();
    }
  }
  return c;
}

function shadowTexture() {
  const c = document.createElement("canvas");
  c.width = 128;
  c.height = 256;
  const ctx = c.getContext("2d");
  ctx.shadowColor = "rgba(0,0,0,.75)";
  ctx.shadowBlur = 22;
  ctx.shadowOffsetX = 1000;
  ctx.fillRect(-1000 + 22, 30, 128 - 44, 256 - 52);
  return new THREE.CanvasTexture(c);
}

function glassTexture() {
  const c = document.createElement("canvas");
  c.width = c.height = 256;
  const ctx = c.getContext("2d");
  const g = ctx.createLinearGradient(0, 0, 256 * 0.34, 256);
  g.addColorStop(0, "rgba(255,255,255,.2)");
  g.addColorStop(0.26, "rgba(255,255,255,.04)");
  g.addColorStop(0.27, "rgba(255,255,255,0)");
  g.addColorStop(0.7, "rgba(255,255,255,0)");
  g.addColorStop(1, "rgba(255,230,190,.07)");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 256, 256);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

function shadeTexture() {
  const c = document.createElement("canvas");
  c.width = 64;
  c.height = 128;
  const ctx = c.getContext("2d");
  const v = ctx.createLinearGradient(0, 0, 0, 128);
  [[0, 0.92], [0.2, 0.25], [0.38, 0], [0.62, 0], [0.8, 0.3], [1, 0.95]].forEach(([p, a]) => v.addColorStop(p, `rgba(25,8,2,${a})`));
  ctx.fillStyle = v;
  ctx.fillRect(0, 0, 64, 128);
  for (const [x0, x1] of [[0, 6], [64, 58]]) {
    const h = ctx.createLinearGradient(x0, 0, x1, 0);
    h.addColorStop(0, "rgba(25,8,2,.6)");
    h.addColorStop(1, "rgba(25,8,2,0)");
    ctx.fillStyle = h;
    ctx.fillRect(Math.min(x0, x1), 0, 6, 128);
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

function plateTexture(r) {
  const S = Math.min(window.devicePixelRatio || 1, 2) * 2;
  const c = document.createElement("canvas");
  c.width = Math.round(r.w * S);
  c.height = Math.round(r.h * S);
  const ctx = c.getContext("2d");
  const plate = document.querySelector(".plate");
  const cs = getComputedStyle(plate);
  const size = parseFloat(cs.fontSize) * S;
  const spacing = size * 0.14;
  const text = plate.textContent.trim().toUpperCase();
  ctx.font = `900 ${size}px ${SLAB}`;
  ctx.textBaseline = "middle";
  const widths = [...text].map((ch) => ctx.measureText(ch).width);
  const total = widths.reduce((a, b) => a + b, 0) + spacing * (text.length - 1);
  const draw = (dy, color) => {
    ctx.fillStyle = color;
    let x = (c.width - total) / 2;
    [...text].forEach((ch, i) => { ctx.fillText(ch, x, c.height / 2 + size * 0.06 + dy); x += widths[i] + spacing; });
  };
  draw(S, "rgba(255,244,205,.7)");
  draw(-S * 0.6, "rgba(0,0,0,.25)");
  draw(0, "#3a2208");
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

try {
  const api = init();
  if (api) window.Machine3D = api;
} catch (err) {
  document.querySelector(".machine").classList.remove("webgl");
  console.warn("3D-Automat nicht verfügbar, nutze HTML-Automat:", err);
}

// Der Hebel als echtes 3D-Modell (Three.js): Achse aus der Seitenwand, Rad mit Schrauben, Klemme,
// Stange, Manschette und Knauf. Alles, was sich bewegt, hängt an einer Gruppe, die sich um die Achse
// dreht – Rad und Hebel bleiben dadurch zwangsläufig synchron.
// app.js steuert den Winkel; dieses Modul zeichnet nur. Ohne WebGL bleibt der CSS-Hebel sichtbar.
import * as THREE from "three";
import { RoomEnvironment } from "./vendor/RoomEnvironment.js";

const lever = document.getElementById("lever");
const machine = document.querySelector(".machine");

function init() {
  const canvas = document.createElement("canvas");
  canvas.className = "lever3d";
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

  // ---------- Modell (Einheiten = CSS-Pixel, Drehpunkt im Ursprung) ----------
  const yaw = new THREE.Group();   // leicht von rechts gesehen, damit die Außenseite des Rads sichtbar ist
  const arm = new THREE.Group();   // dreht sich um die Achse (lokale x-Achse)
  yaw.add(arm);
  scene.add(yaw);

  const alongX = (geo) => geo.rotateZ(Math.PI / 2);
  const parts = {};

  function build(L, axleStart) {
    // Bei Größenänderung neu bauen: alte Teile entfernen
    for (const c of [...yaw.children]) if (c !== arm) { yaw.remove(c); c.geometry.dispose(); }
    for (const c of [...arm.children]) { arm.remove(c); c.geometry.dispose(); }

    // Achse: aus der Seitenwand bis durch das Rad, mit Lagerring und Mutter
    const axleLen = 16 - axleStart;
    const axle = new THREE.Mesh(alongX(new THREE.CylinderGeometry(6, 6, axleLen, 32)), brass);
    axle.position.x = axleStart + axleLen / 2;
    const bearing = new THREE.Mesh(alongX(new THREE.CylinderGeometry(11, 11, 6, 40)), brassDark);
    bearing.position.x = axleStart + 3;
    const nut = new THREE.Mesh(alongX(new THREE.CylinderGeometry(8, 8, 7, 6)), brassDark);
    nut.position.x = 17;
    yaw.add(axle, bearing, nut);

    // Rad mit gerundeter Kante (Drehprofil), Schrauben und Deckel auf der Außenseite
    const profile = [
      [0, -6], [16, -6], [19, -4.5], [20, 0], [19, 4.5], [16, 6], [0, 6],
    ].map(([r, x]) => new THREE.Vector2(r, x));
    const wheel = new THREE.Mesh(new THREE.LatheGeometry(profile, 56).rotateZ(-Math.PI / 2), brass);
    arm.add(wheel);
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
    parts.ball = ball;
  }

  // ---------- Kamera und Größe ----------
  const camera = new THREE.PerspectiveCamera(20, 1, 1, 5000);
  const geo = { w: 0, h: 0, pivot: null, L: 0 };

  function layout() {
    const c = canvas.getBoundingClientRect();
    const l = lever.getBoundingClientRect();
    if (!c.width || !c.height) return;
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.setSize(c.width, c.height, false);
    geo.w = c.width;
    geo.h = c.height;
    // Drehpunkt und Länge wie beim CSS-Hebel: 55 % der Höhe, Arm 38 %, mittig in der Hebelspalte
    const px = l.left + l.width / 2 - c.left;
    const py = l.top + l.height * 0.55 - c.top;
    geo.L = l.height * 0.38;
    // Welt: x nach rechts, y nach oben, 1 Einheit = 1 CSS-Pixel in der Ebene z = 0
    const dist = c.height / (2 * Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)));
    camera.aspect = c.width / c.height;
    camera.position.set(c.width / 2, -c.height / 2, dist);
    camera.lookAt(c.width / 2, -c.height / 2, 0);
    camera.near = Math.max(1, dist - 400);
    camera.far = dist + 400;
    camera.updateProjectionMatrix();
    yaw.position.set(px, -py, 0);
    yaw.rotation.y = THREE.MathUtils.degToRad(-6);
    // Die Achse beginnt an der Seitenwand des Gehäuses.
    const wall = machine.querySelector(".cabinet").getBoundingClientRect().right - c.left;
    build(geo.L, wall - px - 4);
  }

  let theta = 0;
  function render(th = theta) {
    theta = th;
    arm.rotation.x = THREE.MathUtils.degToRad(th);
    renderer.render(scene, camera);
  }

  // Bildschirmposition des Knaufs – damit app.js weiß, wo man ihn anfassen kann.
  const tmp = new THREE.Vector3();
  function knobClient(th = theta) {
    arm.rotation.x = THREE.MathUtils.degToRad(th);
    scene.updateMatrixWorld(true);
    parts.ball.getWorldPosition(tmp).project(camera);
    arm.rotation.x = THREE.MathUtils.degToRad(theta);
    const c = canvas.getBoundingClientRect();
    return { x: c.left + (tmp.x + 1) / 2 * c.width, y: c.top + (1 - tmp.y) / 2 * c.height };
  }

  layout();
  render(0);
  new ResizeObserver(() => { layout(); render(); }).observe(machine);
  lever.classList.add("webgl");
  return { render, knobClient };
}

try {
  const api = init();
  if (api) window.Lever3D = api;
} catch (err) {
  console.warn("3D-Hebel nicht verfügbar, nutze CSS-Hebel:", err);
}

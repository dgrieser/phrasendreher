# Rendert den Automaten mit Cycles und legt alles, was der Browser braucht, nach public/automat/:
#
#   automat.webp   das Gehäuse, Birnen aus, mit Löchern (Alpha 0), wo die Walzen sichtbar sind
#   gluehen.webp   was die Birnen beitragen, wenn alle leuchten (Glühen, Licht auf Holz und Messing, Überstrahlung)
#   walzen.webp    Ausschnitt um das Fenster: oben das Licht auf einer weißen Walze, unten die Spiegelung der Scheibe
#   umgebung.hdr   Rundumbild vom Hebel aus (für Spiegelungen auf Chrom und Knauf, three.js-Equirect-Konvention)
#   hebel.glb      der bewegliche Hebel (glTF, Blender-Koordinaten: z oben)
#   szene.json     Kamera, Walzen, Birnenpositionen, Hebel, Licht
#
# Aufruf (bpy und pillow im selben Python):
#   python blender/render.py              # endgültig, 1200 px breit
#   python blender/render.py --quick      # schnelle Vorschau mit wenigen Samples
import json
import math
import os
import sys
import time

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import automat as A  # noqa: E402
import bpy  # noqa: E402
import numpy as np  # noqa: E402
from mathutils import Matrix, Vector  # noqa: E402
from PIL import Image, ImageDraw, ImageFilter  # noqa: E402

QUICK = "--quick" in sys.argv
OUT = os.path.join(os.path.dirname(HERE), "public", "automat")
TMP = os.path.join(A.BUILD, "render")
RES = int(os.environ.get("RES", 600 if QUICK else 1200))
SAMPLES = int(os.environ.get("SAMPLES", 24 if QUICK else 320))
LEVER_MAX = 125        # Grad, wie MAX in app.js


def log(*a):
    print("[render]", *a, flush=True)


# ---------- Bildausschnitt ----------
def lever_points():
    """Punkte des Hebels in allen Stellungen (Knauf, Stange) – der Bildausschnitt muss sie alle fassen."""
    P = A.LEVER_PIVOT
    rod_x = A.W / 2 + A.LEVER_OUT
    pts = []
    for deg in range(0, LEVER_MAX + 1, 5):
        R = Matrix.Rotation(math.radians(deg), 4, "X")
        for h, r in [(A.LEVER_L, A.KNOB_R * 1.15), (A.LEVER_L * 0.5, 0.012)]:
            c = P + R @ Vector((rod_x - P.x, 0, h))
            for d in [(1, 0, 0), (-1, 0, 0), (0, 1, 0), (0, -1, 0), (0, 0, 1), (0, 0, -1)]:
                pts.append(c + Vector(d) * r)
    return pts


def frame_camera(cam, objs, margin=0.035):
    """Richtet die Kamera auf die Mitte aller Punkte aus und wählt Brennweite und Seitenverhältnis so, dass Gehäuse,
    Hebel (in jeder Stellung) und Schatten mit etwas Rand ins Bild passen."""
    pts = []
    for o in objs:
        pts += [o.matrix_world @ Vector(c) for c in o.bound_box]
    pts += lever_points()
    # Kontaktschatten vor und neben dem Sockel
    for x in (-A.BASE_W / 2 - 0.04, A.BASE_W / 2 + 0.06):
        for y in (-0.08, A.D):
            pts.append(Vector((x, y, 0)))
    for _ in range(4):
        inv = cam.matrix_world.inverted()
        t = [(c.x / -c.z, c.y / -c.z) for c in (inv @ p for p in pts)]
        tx0, tx1 = min(p[0] for p in t), max(p[0] for p in t)
        ty0, ty1 = min(p[1] for p in t), max(p[1] for p in t)
        # auf die Mitte drehen
        mid = cam.matrix_world.to_3x3() @ Vector(((tx0 + tx1) / 2, (ty0 + ty1) / 2, -1))
        cam.rotation_euler = mid.to_track_quat("-Z", "Y").to_euler()
        bpy.context.view_layer.update()
    w, h = (tx1 - tx0) * (1 + 2 * margin), (ty1 - ty0) * (1 + 2 * margin)
    cam.data.sensor_fit = "VERTICAL"
    cam.data.lens = cam.data.sensor_height / h
    sc = bpy.context.scene
    sc.render.resolution_x = RES
    sc.render.resolution_y = int(round(RES * h / w / 2)) * 2
    sc.render.resolution_percentage = 100
    log("Bild", sc.render.resolution_x, "x", sc.render.resolution_y, "Brennweite %.1f mm" % cam.data.lens)


def to_px(p):
    """Weltpunkt → Pixel im gerenderten Bild (x nach rechts, y nach unten)."""
    from bpy_extras.object_utils import world_to_camera_view
    sc = bpy.context.scene
    v = world_to_camera_view(sc, sc.camera, Vector(p))
    return v.x * sc.render.resolution_x, (1 - v.y) * sc.render.resolution_y


# ---------- Rendern ----------
def render(name, samples, border=None, transparent=True):
    sc = bpy.context.scene
    sc.cycles.samples = samples
    sc.cycles.use_adaptive_sampling = True
    sc.cycles.adaptive_threshold = 0.008
    sc.cycles.use_denoising = True
    sc.cycles.denoiser = "OPENIMAGEDENOISE"
    sc.cycles.seed = 7
    sc.cycles.max_bounces = 14
    sc.cycles.glossy_bounces = 8
    sc.cycles.transmission_bounces = 12
    sc.cycles.transparent_max_bounces = 16
    sc.cycles.sample_clamp_indirect = 12
    sc.cycles.blur_glossy = 0.5
    sc.render.film_transparent = transparent
    sc.render.use_border = border is not None
    sc.render.use_crop_to_border = border is not None
    if border:
        x0, y0, x1, y1 = border   # Pixel, y nach unten
        W, H = sc.render.resolution_x, sc.render.resolution_y
        sc.render.border_min_x, sc.render.border_max_x = x0 / W, x1 / W
        sc.render.border_min_y, sc.render.border_max_y = 1 - y1 / H, 1 - y0 / H
    s = sc.render.image_settings
    s.file_format = "PNG"
    s.color_mode = "RGBA"
    s.color_depth = "8"
    s.compression = 15
    path = os.path.join(TMP, name + ".png")
    sc.render.filepath = path
    t = time.time()
    bpy.ops.render.render(write_still=True)
    log(name, "%.0f s" % (time.time() - t))
    return np.asarray(Image.open(path).convert("RGBA")).astype(np.float32) / 255


def premul(img):
    return img[..., :3] * img[..., 3:4]


def blur(a, sigma):
    """Gauß-Näherung: dreimal Kastenfilter (über kumulierte Summen) je Achse."""
    r = max(1, int(round((math.sqrt(4 * sigma * sigma + 1) - 1) / 2)))
    for axis in (0, 1):
        for _ in range(3):
            pad = [(0, 0)] * a.ndim
            pad[axis] = (r + 1, r)
            c = np.cumsum(np.pad(a, pad, mode="edge"), axis=axis, dtype=np.float64)
            n = a.shape[axis]
            a = ((np.take(c, range(2 * r + 1, 2 * r + 1 + n), axis=axis) - np.take(c, range(0, n), axis=axis))
                 / (2 * r + 1)).astype(np.float32)
    return a


def save_webp(arr, name, quality=90, alpha=True):
    a = np.clip(arr * 255 + 0.5, 0, 255).astype(np.uint8)
    im = Image.fromarray(a, "RGBA" if alpha else "RGB")
    path = os.path.join(OUT, name)
    im.save(path, "WEBP", quality=quality, method=6, exact=True, alpha_quality=100)
    log(name, "%d KB" % (os.path.getsize(path) // 1024))


# ---------- Umgebung für den Hebel ----------
def environment(S, center):
    """Rundumbild vom Hebel aus, für three.js umsortiert: dort ist u = atan2(z, x), v = asin(y) – unsere Welt hat aber
    z oben. Wir legen daher die Blender-Richtung w so ins Bild, dass three.js sie mit dem Weltvektor direkt findet."""
    sc = bpy.context.scene
    cam = sc.camera
    keep = (cam.matrix_world.copy(), cam.data.type, sc.render.resolution_x, sc.render.resolution_y)
    keep_clip = cam.data.clip_start
    cam.data.clip_start = 0.001          # die Seitenwand ist nur wenige Zentimeter entfernt
    cam.data.type = "PANO"
    cam.data.panorama_type = "EQUIRECTANGULAR"
    cam.matrix_world = Matrix.Translation(center) @ Matrix.Rotation(math.pi / 2, 4, "X")
    sc.render.resolution_x, sc.render.resolution_y = (1024, 512) if not QUICK else (256, 128)
    sc.render.use_border = False
    sc.cycles.samples = 48 if QUICK else 256
    sc.render.film_transparent = False
    # Softboxen und Spiegelkarte sollen auf Chrom und Knauf als Glanzlichter erscheinen – im Rundumbild sichtbar
    shown = [o for o in S["lights"].values() if not o.visible_camera or o.type == "LIGHT"]
    for o in shown:
        o.visible_camera = True
    s = sc.render.image_settings
    s.file_format = "OPEN_EXR"
    s.color_depth = "32"
    s.color_mode = "RGB"
    path = os.path.join(TMP, "umgebung.exr")
    sc.render.filepath = path
    t = time.time()
    bpy.ops.render.render(write_still=True)
    log("Umgebung %.0f s" % (time.time() - t))
    img = bpy.data.images.load(path)
    w, h = img.size
    src = np.array(img.pixels[:], dtype=np.float32).reshape(h, w, 4)[..., :3]   # Zeile 0 = unten
    bpy.data.images.remove(img)
    # Zielbild (three.js): Richtung e aus (u, v); Weltvektor = e (Blender-Koordinaten unverändert)
    W2, H2 = 512, 256
    u = (np.arange(W2) + 0.5) / W2
    v = (np.arange(H2) + 0.5) / H2          # 0 = unten (flipY in three.js)
    uu, vv = np.meshgrid(u, v)
    lon = (uu - 0.5) * 2 * np.pi
    lat = (vv - 0.5) * np.pi
    ex, ey, ez = np.cos(lat) * np.cos(lon), np.sin(lat), np.cos(lat) * np.sin(lon)
    # Blender-Panorama (Kamera um x um 90° gedreht): u = 0.5 + atan2(w.x, w.y)/2π, v = 0.5 + asin(w.z)/π
    wx, wy, wz = ex, ey, ez
    ub = 0.5 + np.arctan2(wx, wy) / (2 * np.pi)
    vb = 0.5 + np.arcsin(np.clip(wz, -1, 1)) / np.pi
    xs = np.clip(ub * w - 0.5, 0, w - 1)
    ys = np.clip(vb * h - 0.5, 0, h - 1)
    x0, y0 = np.floor(xs).astype(int), np.floor(ys).astype(int)
    x1, y1 = (x0 + 1) % w, np.minimum(y0 + 1, h - 1)
    fx, fy = (xs - x0)[..., None], (ys - y0)[..., None]
    out = (src[y0, x0] * (1 - fx) * (1 - fy) + src[y0, x1] * fx * (1 - fy) + src[y1, x0] * (1 - fx) * fy
           + src[y1, x1] * fx * fy)
    im = bpy.data.images.new("umgebung", W2, H2, float_buffer=True)
    px = np.concatenate([out, np.ones((H2, W2, 1), np.float32)], axis=2)
    im.pixels.foreach_set(px.astype(np.float32).ravel())
    im.filepath_raw = os.path.join(OUT, "umgebung.hdr")
    im.file_format = "HDR"
    im.save()
    log("umgebung.hdr %d KB" % (os.path.getsize(im.filepath_raw) // 1024))
    cam.matrix_world, cam.data.type, cam.data.clip_start = keep[0], keep[1], keep_clip
    S["lights"]["card"].visible_camera = False
    sc.render.resolution_x, sc.render.resolution_y = keep[2], keep[3]


# ---------- Hebel als glTF ----------
def export_lever(S):
    """Exportiert den beweglichen Hebel: Knoten „Hebel“ dreht um die Achse (x), darin „Schwinge“ für das seitliche
    Nachschwingen der Stange (um y). Dazu eine unsichtbare Fläche auf der Seitenwand, die den Schatten fängt."""
    P = A.LEVER_PIVOT
    rod_x = A.W / 2 + A.LEVER_OUT
    pivot = bpy.data.objects.new("Hebel", None)
    pivot.location = P
    A.link(pivot)
    sway = bpy.data.objects.new("Schwinge", None)
    A.link(sway)
    sway.parent = pivot
    sway.location = (rod_x - P.x, 0, 0.006)
    bpy.context.view_layer.update()
    for o in S["lever"]:
        mw = o.matrix_world.copy()
        o.parent = pivot if o.name.startswith("Hebel Nabe") else sway
        o.matrix_world = mw
    wall = A.box("Schattenwand", A.W / 2, A.W / 2 + 0.0005, 0.0, A.D, A.BODY_Z[0], A.BODY_Z[1], None)
    plate = A.box("Schattenplatte", A.W / 2 + 0.0045, A.W / 2 + 0.005, P.y - 0.055, P.y + 0.055, P.z - 0.085,
                  P.z + 0.085, None)
    bpy.ops.object.select_all(action="DESELECT")
    for o in [pivot, sway, *S["lever"], wall, plate]:
        o.hide_render = False
        o.select_set(True)
    path = os.path.join(OUT, "hebel.glb")
    bpy.ops.export_scene.gltf(filepath=path, use_selection=True, export_yup=False, export_apply=True,
                              export_materials="EXPORT", export_normals=True, export_texcoords=False,
                              export_cameras=False, export_lights=False, export_animations=False)
    log("hebel.glb %d KB" % (os.path.getsize(path) // 1024))


def main():
    os.makedirs(OUT, exist_ok=True)
    os.makedirs(TMP, exist_ok=True)
    S = A.build_scene()
    sc = bpy.context.scene
    cam = sc.camera
    M = S["materials"]
    for o in S["lever"]:
        o.hide_render = True
    bpy.context.view_layer.update()
    frame_camera(cam, [o for o in sc.objects if o.type == "MESH" and o.visible_get() and o.visible_camera
                       and o not in S["lever"] and o is not S["floor"] and o.location.z > -5])
    bpy.context.view_layer.update()
    W, H = sc.render.resolution_x, sc.render.resolution_y

    def bulbs(on):
        M["bulb"].node_tree.nodes["Leuchten"].outputs[0].default_value = 1.0 if on else 0.0

    # Ausschnitt ums Fenster (Pixel) – großzügig, damit auch die Lünette drin ist
    win = [Vector((x, A.GLASS_Y, z)) for x in (-A.WIN_W / 2 - 0.004, A.WIN_W / 2 + 0.004)
           for z in (A.WIN_ZC - A.WIN_H / 2 - 0.004, A.WIN_ZC + A.WIN_H / 2 + 0.004)]
    wp = [to_px(p) for p in win]
    crop = [int(min(p[0] for p in wp)) - 4, int(min(p[1] for p in wp)) - 4,
            int(max(p[0] for p in wp)) + 5, int(max(p[1] for p in wp)) + 5]
    crop = [max(0, crop[0]), max(0, crop[1]), min(W, crop[2]), min(H, crop[3])]

    # 1) Gehäuse, Birnen aus  2) Birnen an – jeweils ohne Glas, Walzen als Loch
    S["glass"].hide_render = True
    bulbs(False)
    plate = render("aus", SAMPLES)
    bulbs(True)
    lit = render("an", SAMPLES)
    bulbs(False)
    # 3) Licht auf den Walzen: weiße Walzen, ohne Glas  4) Spiegelung der Scheibe: schwarze Walzen, mit Glas
    for r in S["reels"]:
        r.data.materials[0] = M["reel_white"]
    shade = render("walzen_licht", max(16, SAMPLES // 2), crop)
    black = A.principled("Walze schwarz", **{"Base Color": (0, 0, 0, 1), "Roughness": 1.0, "Specular IOR Level": 0.0})
    for r in S["reels"]:
        r.data.materials[0] = black
    S["glass"].hide_render = False
    glass = render("walzen_glas", max(16, SAMPLES // 2), crop)
    for r in S["reels"]:
        r.data.materials[0] = M["holdout"]

    # ---- Bilder fürs Web ----
    save_webp(plate, "automat.webp", 88)
    lit_p = premul(lit)
    glow = np.clip(lit_p - premul(plate), 0, None)
    # Überstrahlung wie bei einer Kamera: weich und weit, aus den Birnen selbst (wo sich beim Einschalten viel
    # ändert), in deren warmer Farbe – nicht aus den übrigen Glanzlichtern
    change = glow.max(axis=2, keepdims=True)
    core = lit_p * np.clip((change - 0.25) / 0.35, 0, 1)
    bloom = 0.45 * blur(core, RES / 260) + 0.30 * blur(core, RES / 80) + 0.18 * blur(core, RES / 28)
    save_webp(np.clip(glow + bloom, 0, 1), "gluehen.webp", 85, alpha=False)
    cx0, cy0, cx1, cy1 = crop
    base = premul(plate)[cy0:cy1, cx0:cx1]
    # Glas: Spiegelung = Bild mit Glas minus Bild ohne (nur innerhalb der Scheibe)
    mask = Image.new("L", (cx1 - cx0, cy1 - cy0), 0)
    gl = A.rounded_rect(-A.WIN_W / 2 - 0.003, A.WIN_ZC - A.WIN_H / 2 - 0.003, A.WIN_W / 2 + 0.003,
                        A.WIN_ZC + A.WIN_H / 2 + 0.003, 0.012)
    ImageDraw.Draw(mask).polygon([(px - cx0, py - cy0) for px, py in (to_px((x, A.GLASS_Y, z)) for x, z in gl)], fill=255)
    mask = np.asarray(mask.filter(ImageFilter.GaussianBlur(0.7))).astype(np.float32)[..., None] / 255
    refl = np.clip(premul(glass) - base, 0, None) * mask
    light = premul(shade)
    stack = np.concatenate([light, refl], axis=0)
    save_webp(stack, "walzen.webp", 90, alpha=False)

    # ---- Szene für three.js ----
    deps = bpy.context.evaluated_depsgraph_get()
    proj = cam.calc_matrix_camera(deps, x=W, y=H)
    col = lambda m: [m[r][c] for c in range(4) for r in range(4)]   # three.js erwartet spaltenweise
    rows = [S["crown_bulbs"][0], S["crown_bulbs"][1], S["base_bulbs"]]
    bulb_px = []
    for row in rows:
        out = []
        for g in row:
            c = g.matrix_world @ Vector((0, -0.016, 0))
            x, y = to_px(c)
            e = to_px(c + Vector((0.0095, 0, 0)))
            out.append({"x": round(x, 2), "y": round(y, 2), "r": round(abs(e[0] - x), 2)})
        bulb_px.append(out)
    fill = S["lights"]["fill"]
    data = {
        "bild": {"w": W, "h": H},
        "kamera": {"matrixWorld": col(cam.matrix_world), "projection": col(proj),
                   "near": cam.data.clip_start, "far": cam.data.clip_end},
        "walzen": {"mitten": [list(c) for c in A.reel_centers()], "radius": A.REEL_R, "breite": A.REEL_W,
                   "hoehe": A.REEL_H, "seiten": A.N, "ausschnitt": crop},
        "birnen": bulb_px,
        "hebel": {"drehpunkt": list(A.LEVER_PIVOT), "laenge": A.LEVER_L, "knauf": A.KNOB_R,
                  "stange": A.W / 2 + A.LEVER_OUT},
        # Aufhellung von rechts: beleuchtet die Seitenwand und wirft den (weichen) Schatten des Hebels darauf
        "licht": {"position": list(fill.location), "richtung": list(fill.matrix_world.to_3x3() @ Vector((0, 0, -1))),
                  "farbe": list(fill.data.color)},
    }
    with open(os.path.join(OUT, "szene.json"), "w") as f:
        json.dump(data, f, indent=1)
    log("szene.json")

    environment(S, Vector((A.W / 2 + A.LEVER_OUT, A.LEVER_PIVOT.y, A.LEVER_PIVOT.z + 0.16)))
    export_lever(S)
    os.makedirs(A.BUILD, exist_ok=True)
    bpy.ops.wm.save_as_mainfile(filepath=os.path.join(A.BUILD, "automat.blend"))


if __name__ == "__main__":
    main()

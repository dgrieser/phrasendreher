# Der Phrasendreher als Blender-Modell: baut die ganze Szene aus Code auf (Gehäuse, Krone, Glühbirnen,
# Sichtfenster, Sockel, Hebel, Licht, Kamera). Wird von render.py benutzt, läuft aber auch für sich:
#
#   python blender/automat.py            # baut die Szene und speichert blender/build/automat.blend
#
# Braucht Blender als Python-Modul (pip install bpy) oder blender -b -P blender/automat.py.
# Maßeinheit Meter. x nach rechts, y nach hinten (die Front zeigt nach −y), z nach oben, Boden bei z = 0.
import math
import os
import random
import urllib.request

import bpy  # noqa: I001 – bpy zuerst, sonst fehlen bmesh und mathutils
import bmesh
from mathutils import Matrix, Vector

HERE = os.path.dirname(os.path.abspath(__file__))
ASSETS = os.path.join(HERE, "assets")
BUILD = os.path.join(HERE, "build")

# Fremdmaterial: alles CC0 (Poly Haven) bzw. OFL (Rokkitt) – wird beim ersten Lauf geladen, nicht eingecheckt.
DOWNLOADS = {
    **{f"{t}_{m}_2k.jpg": f"https://dl.polyhaven.org/file/ph-assets/Textures/jpg/2k/{t}/{t}_{m}_2k.jpg"
       for t in ("natural_walnut_veneer", "lacquered_cherry_wood") for m in ("diff", "rough", "nor_gl")},
    "billiard_hall_2k.hdr": "https://dl.polyhaven.org/file/ph-assets/HDRIs/hdr/2k/billiard_hall_2k.hdr",
    "rokkitt_black.ttf": "https://fonts.gstatic.com/s/rokkitt/v39/qFdb35qfgYFjGy5hukqqhw5XeRgdi1pbcJDL.ttf",
}


def asset(name):
    path = os.path.join(ASSETS, name)
    if not os.path.exists(path):
        os.makedirs(ASSETS, exist_ok=True)
        print("lade", name)
        urllib.request.urlretrieve(DOWNLOADS[name], path)
    return path


# ---------- Maße ----------
W = 0.44            # Breite des Gehäuses
D = 0.34            # Tiefe des Gehäuses
BASE_W, BASE_D = 0.48, 0.38
FEET = 0.022        # Höhe der Füße
BASE_Z = (FEET, 0.112)
BODY_Z = (0.112, 0.600)
CROWN_Z = (0.600, 0.790)
CROWN_ARCH = 0.085  # Höhe des Bogens oben auf der Krone

REEL_H = 0.132      # sichtbare Höhe einer Walze (wie .reel im alten HTML-Gerüst, im Verhältnis)
REEL_W = 0.352
REEL_GAP = 0.008
N = 12              # Seiten pro Walze (wie in app.js)
FACE = REEL_H * 0.84
REEL_R = FACE / (2 * math.tan(math.pi / N))
WIN_PAD = 0.006
WIN_W = REEL_W + 0.008
WIN_H = 3 * REEL_H + 2 * REEL_GAP + 2 * WIN_PAD
WIN_ZC = (BODY_Z[0] + BODY_Z[1]) / 2 + 0.004
BEZEL = 0.024       # Breite der Lünette um das Fenster
GLASS_Y = -0.010    # Glasscheibe
REEL_FRONT = 0.006  # Vorderkante der Walzen

LEVER_PIVOT = Vector((W / 2 + 0.046, D * 0.42, 0.372))
LEVER_L = 0.300     # Drehpunkt bis Mitte Knauf
KNOB_R = 0.031
LEVER_OUT = 0.050   # Abstand der Stange von der Seitenwand


def reel_centers():
    top = WIN_ZC + WIN_H / 2 - WIN_PAD - REEL_H / 2
    return [Vector((0, REEL_FRONT + REEL_R, top - k * (REEL_H + REEL_GAP))) for k in range(3)]


# ---------- Hilfen ----------
def link(obj, coll=None):
    (coll or bpy.context.scene.collection).objects.link(obj)
    return obj


def shade_smooth(obj, angle=35):
    if obj.type != "MESH":
        return
    for p in obj.data.polygons:
        p.use_smooth = True
    try:
        obj.data.set_sharp_from_angle(angle=math.radians(angle))
    except AttributeError:
        pass


def mesh_obj(name, bm, mat=None, smooth=35):
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me)
    bm.free()
    obj = bpy.data.objects.new(name, me)
    link(obj)
    if mat:
        obj.data.materials.append(mat)
    if smooth:
        shade_smooth(obj, smooth)
    return obj


def bevel(obj, width, segments=3, angle=40):
    m = obj.modifiers.new("Fase", "BEVEL")
    m.width = width
    m.segments = segments
    m.limit_method = "ANGLE"
    m.angle_limit = math.radians(angle)
    m.harden_normals = False
    m.miter_outer = "MITER_ARC"
    return m


def box(name, x0, x1, y0, y1, z0, z1, mat, bev=0.0, seg=3):
    bm = bmesh.new()
    bmesh.ops.create_cube(bm, size=1)
    bmesh.ops.scale(bm, vec=(x1 - x0, y1 - y0, z1 - z0), verts=bm.verts)
    bmesh.ops.translate(bm, vec=((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2), verts=bm.verts)
    obj = mesh_obj(name, bm, mat)
    if bev:
        bevel(obj, bev, seg)
    return obj


def rounded_rect(x0, z0, x1, z1, r, seg=8):
    """Umriss eines abgerundeten Rechtecks in der xz-Ebene, gegen den Uhrzeigersinn. r: Zahl oder 4 Radien
    (unten links, unten rechts, oben rechts, oben links)."""
    rs = r if isinstance(r, (list, tuple)) else [r] * 4
    pts = []
    corners = [(x0 + rs[0], z0 + rs[0], math.pi, rs[0]), (x1 - rs[1], z0 + rs[1], 1.5 * math.pi, rs[1]),
               (x1 - rs[2], z1 - rs[2], 0, rs[2]), (x0 + rs[3], z1 - rs[3], 0.5 * math.pi, rs[3])]
    for cx, cz, a0, rr in corners:
        if rr <= 0:
            pts.append((cx, cz))
            continue
        for i in range(seg + 1):
            a = a0 + (i / seg) * (math.pi / 2)
            pts.append((cx + rr * math.cos(a), cz + rr * math.sin(a)))
    return pts


def arch_outline(x0, z0, x1, z1, arch, rb=0.008, seg=48):
    """Krone: unten gerade mit kleinen Rundungen, oben ein flacher Bogen (Ellipsenstück) über die ganze Breite."""
    pts = []
    for cx, cz, a0 in [(x0 + rb, z0 + rb, math.pi), (x1 - rb, z0 + rb, 1.5 * math.pi)]:
        for i in range(7):
            a = a0 + (i / 6) * (math.pi / 2)
            pts.append((cx + rb * math.cos(a), cz + rb * math.sin(a)))
    zs = z1 - arch          # Bogen beginnt hier
    cx = (x0 + x1) / 2
    for i in range(seg + 1):
        t = i / seg
        a = t * math.pi       # 0 = rechts, π = links
        pts.append((cx + (x1 - x0) / 2 * math.cos(a), zs + arch * math.sin(a)))
    return pts


def offset_outline(pts, d):
    """Verschiebt einen geschlossenen Umriss (gegen den Uhrzeigersinn) um d nach innen (d > 0) bzw. außen."""
    out = []
    n = len(pts)
    for i in range(n):
        p0, p1, p2 = Vector(pts[i - 1]), Vector(pts[i]), Vector(pts[(i + 1) % n])
        e0 = (p1 - p0).normalized() if (p1 - p0).length > 1e-9 else Vector((1, 0))
        e1 = (p2 - p1).normalized() if (p2 - p1).length > 1e-9 else e0
        n0, n1 = Vector((-e0.y, e0.x)), Vector((-e1.y, e1.x))
        nm = (n0 + n1)
        nm = nm.normalized() if nm.length > 1e-6 else n0
        cos = max(0.35, nm.dot(n0))
        q = p1 + nm * (d / cos)
        out.append((q.x, q.y))
    return out


def plate_solid(name, outline, y0, y1, mat, holes=(), bev=0.0, bev_seg=4):
    """Platte aus einem Umriss in der xz-Ebene (mit Löchern), von y0 (vorn) bis y1 (hinten), abgerundete Kanten.
    Gebaut als 2D-Kurve – Blender füllt Löcher selbst und rundet die Kanten über bevel_depth."""
    cu = bpy.data.curves.new(name, "CURVE")
    cu.dimensions = "2D"
    cu.fill_mode = "BOTH"
    cu.resolution_u = 1
    for poly in [outline, *holes]:
        sp = cu.splines.new("POLY")
        sp.points.add(len(poly) - 1)
        for i, (x, z) in enumerate(poly):
            sp.points[i].co = (x, z, 0, 1)
        sp.use_cyclic_u = True
    t = (y1 - y0)
    b = min(bev, t / 2 - 1e-5)
    cu.extrude = max(1e-5, t / 2 - b)
    cu.bevel_depth = b
    cu.bevel_resolution = bev_seg
    cu.offset = -b if b else 0
    obj = bpy.data.objects.new(name, cu)
    obj.rotation_euler = (math.pi / 2, 0, 0)
    obj.location = (0, (y0 + y1) / 2, 0)
    link(obj)
    if mat:
        cu.materials.append(mat)
    # in ein Netz wandeln (für UVs, Modifikatoren, glTF)
    deps = bpy.context.evaluated_depsgraph_get()
    me = bpy.data.meshes.new_from_object(obj.evaluated_get(deps))
    mo = bpy.data.objects.new(name, me)
    mo.matrix_world = obj.matrix_world
    link(mo)
    bpy.data.objects.remove(obj)
    bpy.data.curves.remove(cu)
    for p in me.polygons:
        p.use_smooth = True
    try:
        me.set_sharp_from_angle(angle=math.radians(50))
    except AttributeError:
        pass
    return mo


def tube_along(name, pts, radius, mat, closed=False, res=8):
    """Rundstab (Zierleiste) entlang einer Punktfolge."""
    cu = bpy.data.curves.new(name, "CURVE")
    cu.dimensions = "3D"
    cu.bevel_depth = radius
    cu.bevel_resolution = res
    cu.use_fill_caps = True
    sp = cu.splines.new("POLY")
    sp.points.add(len(pts) - 1)
    for i, p in enumerate(pts):
        sp.points[i].co = (*p, 1)
    sp.use_cyclic_u = closed
    obj = link(bpy.data.objects.new(name, cu))
    if mat:
        cu.materials.append(mat)
    deps = bpy.context.evaluated_depsgraph_get()
    me = bpy.data.meshes.new_from_object(obj.evaluated_get(deps))
    mo = link(bpy.data.objects.new(name, me))
    bpy.data.objects.remove(obj)
    for p in me.polygons:
        p.use_smooth = True
    return mo


def lathe(name, profile, segments=48, mat=None, axis="Y"):
    """Drehkörper aus Profilpunkten (r, h). Achse "Y": nach −y (zum Betrachter), "X": nach +x, sonst z."""
    bm = bmesh.new()
    rings = []
    for r, h in profile:
        ring = []
        for i in range(segments):
            a = (i / segments) * math.tau
            if axis == "Y":
                co = (r * math.cos(a), -h, r * math.sin(a))
            elif axis == "X":
                co = (h, r * math.cos(a), r * math.sin(a))
            else:
                co = (r * math.cos(a), r * math.sin(a), h)
            ring.append(bm.verts.new(co))
        rings.append(ring)
    for j in range(len(rings) - 1):
        for i in range(segments):
            a, b = rings[j][i], rings[j][(i + 1) % segments]
            c, d = rings[j + 1][(i + 1) % segments], rings[j + 1][i]
            if a.co == d.co and b.co == c.co:
                continue
            try:
                bm.faces.new((a, b, c, d))
            except ValueError:
                pass
    bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=1e-7)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    return mesh_obj(name, bm, mat, smooth=60)


def instance(src, name, loc, rot=(0, 0, 0)):
    o = bpy.data.objects.new(name, src.data)
    o.location = loc
    o.rotation_euler = rot
    for m in src.modifiers:
        nm = o.modifiers.new(m.name, m.type)
        for attr in ("width", "segments", "limit_method", "angle_limit", "miter_outer"):
            if hasattr(m, attr):
                setattr(nm, attr, getattr(m, attr))
    return link(o)


# ---------- Materialien ----------
def node_mat(name):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    nt = m.node_tree
    bsdf = nt.nodes.get("Principled BSDF")
    return m, nt, bsdf


def principled(name, **inputs):
    m, nt, bsdf = node_mat(name)
    for k, v in inputs.items():
        bsdf.inputs[k].default_value = v
    return m


def noise(nt, scale, detail=6, rough=0.55, coord=None, dim="3D"):
    n = nt.nodes.new("ShaderNodeTexNoise")
    n.noise_dimensions = dim
    n.inputs["Scale"].default_value = scale
    n.inputs["Detail"].default_value = detail
    n.inputs["Roughness"].default_value = rough
    if coord is not None:
        nt.links.new(coord, n.inputs["Vector"])
    return n


def ramp(nt, src, stops):
    r = nt.nodes.new("ShaderNodeValToRGB")
    els = r.color_ramp.elements
    els[0].position, els[0].color = stops[0][0], stops[0][1]
    els[1].position, els[1].color = stops[-1][0], stops[-1][1]
    for pos, col in stops[1:-1]:
        e = els.new(pos)
        e.color = col
    nt.links.new(src, r.inputs["Fac"])
    return r


def mix_rgb(nt, a, b, fac=1.0, blend="MIX"):
    """Farbmischung. Der Mix-Knoten hat mehrere Eingänge namens A/B (je Datentyp) – daher über die Kennung."""
    n = nt.nodes.new("ShaderNodeMix")
    n.data_type = "RGBA"
    n.blend_type = blend
    for sock, v in ((n.inputs[0], fac), (n.inputs[6], a), (n.inputs[7], b)):   # Factor, A_Color, B_Color
        if isinstance(v, bpy.types.NodeSocket):
            nt.links.new(v, sock)
        else:
            sock.default_value = v if not isinstance(v, (tuple, list)) or len(v) == 4 else (*v, 1)
    return n.outputs[2]   # Result_Color


def metal(name, color, rough=0.16, rough_var=0.10, grime=0.55, scratch=True, aniso=0.0):
    """Poliertes Metall (Messing, Chrom): leicht fleckige Rauheit, feine Kratzer, Patina in Ecken und Fugen."""
    m, nt, bsdf = node_mat(name)
    bsdf.inputs["Metallic"].default_value = 1.0
    tc = nt.nodes.new("ShaderNodeTexCoord")
    obj_co = tc.outputs["Object"]
    # Rauheit: großflächige Flecken (Fingerabdrücke, Politur) + feine Kratzer
    n1 = noise(nt, 18, 8, 0.6, obj_co)
    rough_out = ramp(nt, n1.outputs["Fac"], [(0.35, (rough - rough_var * 0.5,) * 3 + (1,)),
                                             (0.68, (rough + rough_var,) * 3 + (1,))]).outputs["Color"]
    if scratch:
        # Kratzer: langgezogenes Rauschen in schräger Richtung
        mp = nt.nodes.new("ShaderNodeMapping")
        mp.inputs["Scale"].default_value = (1.0, 1.0, 60.0)
        mp.inputs["Rotation"].default_value = (0.3, 0.9, 0.2)
        nt.links.new(obj_co, mp.inputs["Vector"])
        n2 = noise(nt, 140, 2, 0.5, mp.outputs["Vector"])
        r2 = ramp(nt, n2.outputs["Fac"], [(0.70, (0, 0, 0, 1)), (0.76, (1, 1, 1, 1))])
        rough_out = mix_rgb(nt, rough_out, r2.outputs["Color"], 0.10, "ADD")
    # Patina: in Fugen und Ecken dunkler und matter (Umgebungsverdeckung)
    ao = nt.nodes.new("ShaderNodeAmbientOcclusion")
    ao.inputs["Distance"].default_value = 0.012
    ao.samples = 8
    pat = ramp(nt, ao.outputs["AO"], [(0.25, (0, 0, 0, 1)), (0.95, (1, 1, 1, 1))]).outputs["Color"]
    dark = (color[0] * grime * 0.75, color[1] * grime * 0.7, color[2] * grime * 0.55, 1)
    nt.links.new(mix_rgb(nt, dark, (*color[:3], 1), pat), bsdf.inputs["Base Color"])
    nt.links.new(mix_rgb(nt, (min(1, rough + 0.25),) * 3 + (1,), rough_out, pat), bsdf.inputs["Roughness"])
    if aniso:
        bsdf.inputs["Anisotropic"].default_value = aniso
    # Hauch von Mikrobeulen
    bump = nt.nodes.new("ShaderNodeBump")
    bump.inputs["Strength"].default_value = 0.04
    bump.inputs["Distance"].default_value = 0.0002
    n3 = noise(nt, 900, 3, 0.5, obj_co)
    nt.links.new(n3.outputs["Fac"], bump.inputs["Height"])
    nt.links.new(bump.outputs["Normal"], bsdf.inputs["Normal"])
    return m


def wood_material(name, tex="natural_walnut_veneer", tint=(0.50, 0.17, 0.10), gamma=1.5, scale=1.6, rot=0.0,
                  rough_range=(0.32, 0.6), lacquer=1.0):
    """Furnier unter Klarlack (Poly-Haven-Texturen, zu Mahagoni getönt) mit Glanzlackschicht."""
    m, nt, bsdf = node_mat(name)
    tc = nt.nodes.new("ShaderNodeTexCoord")
    mp = nt.nodes.new("ShaderNodeMapping")
    mp.inputs["Scale"].default_value = (scale, scale, scale)
    mp.inputs["Rotation"].default_value = (0, rot, 0)
    nt.links.new(tc.outputs["Object"], mp.inputs["Vector"])

    def img(kind, color=False):
        t = nt.nodes.new("ShaderNodeTexImage")
        t.image = bpy.data.images.load(asset(f"{tex}_{kind}_2k.jpg"), check_existing=True)
        t.image.colorspace_settings.name = "sRGB" if color else "Non-Color"
        t.projection = "BOX"
        t.projection_blend = 0.25
        nt.links.new(mp.outputs["Vector"], t.inputs["Vector"])
        return t
    diff = img("diff", True)
    rough = img("rough")
    nor = img("nor_gl")
    # Tönung zu Mahagoni: abdunkeln, mehr Rot, Kontrast der Maserung etwas verstärken
    gam = nt.nodes.new("ShaderNodeGamma")
    gam.inputs["Gamma"].default_value = gamma
    nt.links.new(diff.outputs["Color"], gam.inputs["Color"])
    tinted = mix_rgb(nt, gam.outputs["Color"], (*tint, 1), 1.0, "MULTIPLY")
    # Kanten und Ecken leicht abgegriffen/dunkler
    ao = nt.nodes.new("ShaderNodeAmbientOcclusion")
    ao.inputs["Distance"].default_value = 0.02
    ao.samples = 8
    aor = ramp(nt, ao.outputs["AO"], [(0.2, (0.55, 0.5, 0.48, 1)), (0.9, (1, 1, 1, 1))])
    nt.links.new(mix_rgb(nt, tinted, aor.outputs["Color"], 1.0, "MULTIPLY"), bsdf.inputs["Base Color"])
    rr = nt.nodes.new("ShaderNodeMapRange")
    rr.inputs["To Min"].default_value = rough_range[0]
    rr.inputs["To Max"].default_value = rough_range[1]
    nt.links.new(rough.outputs["Color"], rr.inputs["Value"])
    nt.links.new(rr.outputs["Result"], bsdf.inputs["Roughness"])
    nm = nt.nodes.new("ShaderNodeNormalMap")
    nm.inputs["Strength"].default_value = 0.6
    nt.links.new(nor.outputs["Color"], nm.inputs["Color"])
    nt.links.new(nm.outputs["Normal"], bsdf.inputs["Normal"])
    # Klarlack: glatt, mit ganz leichter Orangenhaut
    bsdf.inputs["Coat Weight"].default_value = lacquer
    bsdf.inputs["Coat Roughness"].default_value = 0.035
    bsdf.inputs["Coat IOR"].default_value = 1.52
    bsdf.inputs["Coat Tint"].default_value = (1.0, 0.93, 0.85, 1)
    cb = nt.nodes.new("ShaderNodeBump")
    cb.inputs["Strength"].default_value = 0.08
    cb.inputs["Distance"].default_value = 0.0003
    on = noise(nt, 260, 2, 0.4, tc.outputs["Object"])
    nt.links.new(on.outputs["Fac"], cb.inputs["Height"])
    nt.links.new(cb.outputs["Normal"], bsdf.inputs["Coat Normal"])
    return m


def bulb_material(name):
    """Opalglas-Birne in Bernstein: aus = dunkles, honigfarbenes Glas, an = warm glühend (in der Mitte heller).
    Die Stärke steht im Wertknoten „Leuchten“ – render.py schaltet darüber."""
    m, nt, bsdf = node_mat(name)
    bsdf.inputs["Base Color"].default_value = (0.26, 0.10, 0.022, 1)
    bsdf.inputs["Roughness"].default_value = 0.06
    bsdf.inputs["Transmission Weight"].default_value = 0.0
    bsdf.inputs["Subsurface Weight"].default_value = 0.35
    bsdf.inputs["Subsurface Radius"].default_value = (0.004, 0.0015, 0.0005)
    bsdf.inputs["Subsurface Scale"].default_value = 0.5
    bsdf.inputs["Coat Weight"].default_value = 1.0
    bsdf.inputs["Coat Roughness"].default_value = 0.02
    # Leuchten: in der Mitte heller (Glühfaden durch Opalglas)
    lw = nt.nodes.new("ShaderNodeLayerWeight")
    lw.inputs["Blend"].default_value = 0.45
    fr = ramp(nt, lw.outputs["Facing"], [(0.0, (1.0, 0.80, 0.46, 1)), (0.55, (1.0, 0.48, 0.10, 1)), (1.0, (0.7, 0.18, 0.02, 1))])
    val = nt.nodes.new("ShaderNodeValue")
    val.name = val.label = "Leuchten"
    val.outputs[0].default_value = 1.0
    strength = nt.nodes.new("ShaderNodeMath")
    strength.operation = "MULTIPLY"
    strength.inputs[1].default_value = 16.0
    nt.links.new(val.outputs[0], strength.inputs[0])
    nt.links.new(fr.outputs["Color"], bsdf.inputs["Emission Color"])
    nt.links.new(strength.outputs[0], bsdf.inputs["Emission Strength"])
    return m


def glass_material(name):
    """Scheibe vor den Walzen: dünnes Glas als Mischung aus Durchsicht und Fresnel-Spiegelung. So bleibt
    der Holdout dahinter (die Walzen) sichtbar, und das Glas trägt nur seine Spiegelung bei."""
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    nt = m.node_tree
    nt.nodes.clear()
    out = nt.nodes.new("ShaderNodeOutputMaterial")
    tr = nt.nodes.new("ShaderNodeBsdfTransparent")
    tr.inputs["Color"].default_value = (0.97, 0.98, 0.96, 1)
    gl = nt.nodes.new("ShaderNodeBsdfGlossy")
    gl.inputs["Roughness"].default_value = 0.0
    fr = nt.nodes.new("ShaderNodeFresnel")
    fr.inputs["IOR"].default_value = 1.52
    # Staub und Schlieren: Rauheit und Spiegelstärke leicht ungleichmäßig
    tc = nt.nodes.new("ShaderNodeTexCoord")
    n = noise(nt, 40, 6, 0.6, tc.outputs["Object"])
    sm = ramp(nt, n.outputs["Fac"], [(0.4, (0.0, 0, 0, 1)), (0.7, (0.035, 0, 0, 1))])
    nt.links.new(sm.outputs["Color"], gl.inputs["Roughness"])
    boost = nt.nodes.new("ShaderNodeMath")
    boost.operation = "MULTIPLY"
    boost.inputs[1].default_value = 1.6
    nt.links.new(fr.outputs["Fac"], boost.inputs[0])
    mix = nt.nodes.new("ShaderNodeMixShader")
    nt.links.new(boost.outputs[0], mix.inputs["Fac"])
    nt.links.new(tr.outputs[0], mix.inputs[1])
    nt.links.new(gl.outputs[0], mix.inputs[2])
    nt.links.new(mix.outputs[0], out.inputs["Surface"])
    return m


def gem_material(name):
    m, nt, bsdf = node_mat(name)
    bsdf.inputs["Base Color"].default_value = (0.95, 0.04, 0.05, 1)
    bsdf.inputs["Transmission Weight"].default_value = 1.0
    bsdf.inputs["IOR"].default_value = 1.76
    bsdf.inputs["Roughness"].default_value = 0.0
    if "Dispersion" in bsdf.inputs:
        bsdf.inputs["Dispersion"].default_value = 0.4
    vol = nt.nodes.new("ShaderNodeVolumeAbsorption")
    vol.inputs["Color"].default_value = (0.9, 0.05, 0.06, 1)
    vol.inputs["Density"].default_value = 60
    nt.links.new(vol.outputs[0], nt.nodes["Material Output"].inputs["Volume"])
    return m


def holdout_material(name):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    nt = m.node_tree
    nt.nodes.clear()
    out = nt.nodes.new("ShaderNodeOutputMaterial")
    h = nt.nodes.new("ShaderNodeHoldout")
    nt.links.new(h.outputs[0], out.inputs["Surface"])
    return m


def materials():
    M = {}
    M["brass"] = metal("Messing", (0.93, 0.70, 0.34), rough=0.14, rough_var=0.10)
    M["brass_satin"] = metal("Messing satiniert", (0.86, 0.62, 0.30), rough=0.32, rough_var=0.12)
    M["brass_dark"] = metal("Messing dunkel", (0.56, 0.36, 0.14), rough=0.30, rough_var=0.12, grime=0.45)
    M["chrome"] = metal("Chrom", (0.93, 0.93, 0.94), rough=0.05, rough_var=0.04, grime=0.6)
    M["steel_dark"] = metal("Stahl brüniert", (0.10, 0.09, 0.085), rough=0.35, rough_var=0.1, scratch=False)
    # Front: gemasertes Wurzelfurnier; Seiten: dunkles, schlichtes Kirschholz – wie bei Möbeln üblich
    M["wood"] = wood_material("Mahagoni Front", "natural_walnut_veneer", tint=(0.55, 0.17, 0.09), gamma=1.6, scale=2.2)
    M["wood_side"] = wood_material("Mahagoni Seite", "lacquered_cherry_wood", tint=(2.6, 1.7, 1.5), gamma=1.0,
                                   scale=1.4, rot=math.pi / 2, rough_range=(0.25, 0.5))
    M["enamel"] = principled("Emaille rot", **{"Base Color": (0.30, 0.012, 0.010, 1), "Roughness": 0.3,
                                               "Coat Weight": 1.0, "Coat Roughness": 0.03})
    M["black"] = principled("Schwarzlack", **{"Base Color": (0.012, 0.010, 0.009, 1), "Roughness": 0.45})
    M["interior"] = principled("Innenraum", **{"Base Color": (0.02, 0.012, 0.008, 1), "Roughness": 0.8})
    M["felt"] = principled("Filz", **{"Base Color": (0.035, 0.02, 0.014, 1), "Roughness": 1.0, "Sheen Weight": 0.6})
    M["bulb"] = bulb_material("Glühbirne")
    M["glass"] = glass_material("Glas")
    M["gem"] = gem_material("Rubin")
    M["mirror"] = principled("Spiegelfolie", **{"Base Color": (0.95, 0.95, 0.95, 1), "Metallic": 1.0, "Roughness": 0.12})
    M["holdout"] = holdout_material("Walze (Holdout)")
    M["reel_white"] = principled("Walze weiß", **{"Base Color": (0.8, 0.8, 0.8, 1), "Roughness": 0.55,
                                                  "Specular IOR Level": 0.3})
    M["shadow"] = principled("Boden", **{"Base Color": (0.2, 0.2, 0.2, 1), "Roughness": 0.9})
    M["red_ball"] = principled("Knauf rot", **{"Base Color": (0.42, 0.012, 0.01, 1), "Roughness": 0.18,
                                               "Coat Weight": 1.0, "Coat Roughness": 0.02, "Subsurface Weight": 0.15,
                                               "Subsurface Radius": (0.02, 0.003, 0.002)})
    return M


# ---------- Bauteile ----------
def screw(name, loc, normal, r, mat, slot_mat):
    """Linsenkopfschraube mit Schlitz; normal: Blickrichtung des Kopfes (Vector)."""
    head = lathe(name, [(0, 0.0), (r, 0.0), (r * 0.98, r * 0.25), (r * 0.82, r * 0.5), (r * 0.5, r * 0.66), (0, r * 0.7)],
                 24, mat, axis="Y")
    slot = box(name + " Schlitz", -r * 0.95, r * 0.95, -r * 0.75, -r * 0.2, -r * 0.12, r * 0.12, slot_mat)
    slot.parent = head
    q = Vector((0, -1, 0)).rotation_difference(normal)
    spin = random.uniform(0, math.pi)          # Schlitze stehen kreuz und quer (fester Startwert in build)
    head.matrix_world = Matrix.Translation(loc) @ q.to_matrix().to_4x4() @ Matrix.Rotation(spin, 4, "Y")
    return head


def bulb_parts(M):
    """Vorlagen für alle Glühbirnen: Chromfassung und Birne (Kugel nach vorn, −y), außer Sicht geparkt."""
    socket = lathe("Fassung", [(0, 0), (0.0125, 0), (0.0125, 0.0015), (0.0112, 0.0030), (0.0088, 0.0036),
                               (0.0078, 0.0068), (0.0062, 0.0072), (0.0062, 0.0080)], 40, M["chrome"])
    glass = lathe("Birne", [(0.0, 0.0050), (0.0050, 0.0052), (0.0062, 0.0075), (0.0090, 0.0115),
                            (0.0098, 0.0150), (0.0094, 0.0185), (0.0078, 0.0218), (0.0050, 0.0238),
                            (0.0, 0.0245)], 40, M["bulb"])
    socket.location = glass.location = (0, 0, -10)
    return socket, glass


def bulb(name, loc, parts):
    """Eine Glühbirne in Fassung an loc; gibt die Birne zurück."""
    instance(parts[0], name + " Fassung", loc)
    return instance(parts[1], name, loc)


def gem_mesh(name, r, depth, mat):
    """Brillantschliff: Tafel, Krone, Rundiste, Pavillon (nach −y zum Betrachter)."""
    bm = bmesh.new()
    n = 16
    table = [bm.verts.new((0.55 * r * math.cos(a), -depth * 0.62, 0.55 * r * math.sin(a)))
             for a in [i / 8 * math.tau + math.pi / 8 for i in range(8)]]
    crown = [bm.verts.new((0.82 * r * math.cos(a), -depth * 0.45, 0.82 * r * math.sin(a)))
             for a in [i / n * math.tau for i in range(n)]]
    gird = [bm.verts.new((r * math.cos(a), -depth * 0.32, r * math.sin(a))) for a in [i / n * math.tau for i in range(n)]]
    gird2 = [bm.verts.new((r * math.cos(a), -depth * 0.26, r * math.sin(a))) for a in [i / n * math.tau for i in range(n)]]
    tip = bm.verts.new((0, depth * 0.45, 0))
    bm.faces.new(table)
    for i in range(8):
        a, b = table[i], table[(i + 1) % 8]
        c0, c1, c2 = crown[2 * i], crown[(2 * i + 1) % n], crown[(2 * i + 2) % n]
        bm.faces.new((a, c1, b))
        bm.faces.new((a, c0, c1))
        bm.faces.new((b, c1, c2))
    for i in range(n):
        bm.faces.new((crown[i], gird[i], gird[(i + 1) % n], crown[(i + 1) % n]))
        bm.faces.new((gird[i], gird2[i], gird2[(i + 1) % n], gird[(i + 1) % n]))
        bm.faces.new((gird2[i], tip, gird2[(i + 1) % n]))
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    return mesh_obj(name, bm, mat, smooth=0)


def reel_arc(name, center, mat, half_angle=math.radians(38), seg=24):
    """Sichtbarer Teil einer Walze: Zylinderstück um die x-Achse, Mitte zum Betrachter."""
    bm = bmesh.new()
    rows = []
    for j in range(seg + 1):
        a = -half_angle + (j / seg) * 2 * half_angle
        y = center.y - REEL_R * math.cos(a)
        z = center.z + REEL_R * math.sin(a)
        rows.append([bm.verts.new((x, y, z)) for x in (-REEL_W / 2, REEL_W / 2)])
    for j in range(seg):
        bm.faces.new((rows[j][0], rows[j][1], rows[j + 1][1], rows[j + 1][0]))
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    for f in bm.faces:
        if f.normal.y > 0:
            f.normal_flip()
    return mesh_obj(name, bm, mat, smooth=80)


def build(M):
    """Baut alles. Gibt die Teile zurück, die render.py braucht."""
    S = {"reels": [], "lever": []}
    x0, x1 = -W / 2, W / 2
    random.seed(4)

    # ----- Boden (fängt nur den Schatten) -----
    floor = box("Boden", -2, 2, -2, 2, -0.01, 0, M["shadow"])
    floor.is_shadow_catcher = True
    S["floor"] = floor

    # ----- Sockel -----
    bz0, bz1 = BASE_Z
    by0, by1 = -(BASE_W - W) / 2 - 0.004, D + 0.02
    plate_solid("Sockel", rounded_rect(-BASE_W / 2, bz0, BASE_W / 2, bz1, 0.006), by0, by1, M["wood"], bev=0.007)
    # Profilleiste oben auf dem Sockel (Messing, halbrund) und Abschluss unten
    for z, r in [(bz1 - 0.003, 0.0045), (bz0 + 0.004, 0.004)]:
        hw = BASE_W / 2 + 0.001
        tube_along("Sockelleiste", [(-hw, by0 - 0.001, z), (hw, by0 - 0.001, z), (hw, by1 - 0.01, z),
                                    (-hw, by1 - 0.01, z)], r, M["brass"], closed=True)
    # Füße: gedrechselte Messingkugeln
    foot_src = lathe("Fuß", [(0, 0), (0.014, 0.0005), (0.019, 0.006), (0.020, 0.011), (0.016, 0.017), (0.012, 0.0205),
                             (0.012, FEET), (0, FEET)], 40, M["brass_dark"], axis="Z")
    foot_src.location = (-BASE_W / 2 + 0.035, by0 + 0.035, 0)
    for fx, fy in [(BASE_W / 2 - 0.035, by0 + 0.035), (-BASE_W / 2 + 0.035, by1 - 0.035), (BASE_W / 2 - 0.035, by1 - 0.035)]:
        instance(foot_src, "Fuß", (fx, fy, 0))
    # Zierleiste vorn: Messingband mit Nieten, acht Glühbirnen und dem Rubin in der Mitte
    rail_z = (bz0 + bz1) / 2
    rail_y = by0
    plate_solid("Zierleiste", rounded_rect(-0.205, rail_z - 0.025, 0.205, rail_z + 0.025, 0.012),
                       rail_y - 0.007, rail_y + 0.001, M["brass"], bev=0.0028)
    plate_solid("Zierleiste Rille", rounded_rect(-0.197, rail_z - 0.018, 0.197, rail_z + 0.018, 0.008),
                         rail_y - 0.0085, rail_y - 0.0065, M["brass_dark"], bev=0.0007)
    S["base_bulbs"] = []
    parts = bulb_parts(M)
    xs = [-0.165, -0.13, -0.095, -0.06, 0.06, 0.095, 0.13, 0.165]
    for i, x in enumerate(xs):
        loc = Vector((x, rail_y - 0.0085, rail_z))
        S["base_bulbs"].append(bulb(f"Birne Sockel {i}", loc, parts))
    for x in (-0.188, 0.188):
        lathe("Niete", [(0, 0), (0.0068, 0), (0.0064, 0.0016), (0.0048, 0.0034), (0, 0.0042)], 28, M["brass"]).location = (x, rail_y - 0.0085, rail_z)
    # Rubin in Messingfassung mit Spiegelfolie dahinter
    gz = rail_z
    lathe("Rubin Fassung", [(0, 0), (0.0205, 0), (0.0205, 0.0025), (0.0185, 0.0055), (0.0158, 0.0068), (0.0150, 0.0040),
                            (0, 0.0040)], 48, M["brass"]).location = (0, rail_y - 0.0085, gz)
    gem = gem_mesh("Rubin", 0.0152, 0.012, M["gem"])
    gem.location = (0, rail_y - 0.0085 - 0.008, gz)
    gem.rotation_euler = (0, math.radians(11.25), 0)
    back = lathe("Rubin Spiegel", [(0, 0), (0.016, 0), (0, 0.0001)], 32, M["mirror"])
    back.location = (0, rail_y - 0.0085 - 0.0038, gz)

    # ----- Gehäuse (Mittelteil) -----
    z0, z1 = BODY_Z
    # Kasten: Seiten, Deckel, Rückwand aus Holz; vorn offen
    t = 0.014
    box("Seite links", x0, x0 + t, 0.0, D, z0, z1, M["wood_side"], bev=0.004)
    side_r = box("Seite rechts", x1 - t, x1, 0.0, D, z0, z1, M["wood_side"], bev=0.004)
    box("Rückwand", x0, x1, D - t, D, z0, z1, M["wood"], bev=0.003)
    box("Innenraum", x0 + t, x1 - t, 0.02, D - t, z0, z1, M["interior"]).hide_render = True
    # Front: Holzplatte mit Fensterausschnitt, Messingrahmen, Lünette
    win = (-WIN_W / 2, WIN_ZC - WIN_H / 2, WIN_W / 2, WIN_ZC + WIN_H / 2)
    bez = (win[0] - BEZEL, win[1] - BEZEL, win[2] + BEZEL, win[3] + BEZEL)
    front_out = rounded_rect(x0, z0, x1, z1, 0.004)
    front_in = rounded_rect(x0 + 0.010, z0 + 0.010, x1 - 0.010, z1 - 0.010, 0.006)
    plate_solid("Front Rahmen", front_out, -0.010, 0.012, M["brass"], holes=[list(reversed(front_in))], bev=0.004)
    plate_solid("Front Holz", front_in, -0.004, 0.012, M["wood"],
                holes=[list(reversed(rounded_rect(*bez, 0.024)))], bev=0.0015)
    # Lünette: dreifach gestuft – äußerer Wulst, Kehle, innerer Chromrand
    plate_solid("Lünette", rounded_rect(*bez, 0.026), -0.020, 0.0, M["brass"],
                holes=[list(reversed(rounded_rect(win[0] - 0.008, win[1] - 0.008, win[2] + 0.008, win[3] + 0.008, 0.016)))],
                bev=0.0075, bev_seg=6)
    plate_solid("Lünette innen", rounded_rect(win[0] - 0.009, win[1] - 0.009, win[2] + 0.009, win[3] + 0.009, 0.017),
                -0.016, -0.004, M["chrome"], holes=[list(reversed(rounded_rect(*win, 0.010)))], bev=0.003)
    # Fensterschacht: dunkle Wände bis zu den Walzen
    plate_solid("Schacht", rounded_rect(win[0] - 0.004, win[1] - 0.004, win[2] + 0.004, win[3] + 0.004, 0.012),
                -0.004, 0.13, M["interior"], holes=[list(reversed(rounded_rect(*win, 0.010)))])
    # Glasscheibe
    glass_obj = plate_solid("Glas", rounded_rect(win[0] - 0.003, win[1] - 0.003, win[2] + 0.003, win[3] + 0.003, 0.012),
                            GLASS_Y - 0.0015, GLASS_Y + 0.0015, M["glass"])
    S["glass"] = glass_obj
    # Walzen (im Bild nur Holdout – gezeichnet werden sie live im Browser) und die Stege dazwischen
    centers = reel_centers()
    for k, c in enumerate(centers):
        S["reels"].append(reel_arc(f"Walze {k}", c, M["holdout"]))
    for k in range(4):
        if k == 0:
            zc = centers[0].z + REEL_H / 2 + WIN_PAD / 2 + 0.002
            h = WIN_PAD + 0.004
        elif k == 3:
            zc = centers[2].z - REEL_H / 2 - WIN_PAD / 2 - 0.002
            h = WIN_PAD + 0.004
        else:
            zc = (centers[k - 1].z + centers[k].z) / 2
            h = REEL_GAP
        box(f"Steg {k}", win[0] - 0.004, win[2] + 0.004, REEL_FRONT - 0.004, REEL_FRONT + 0.03,
                  zc - h / 2, zc + h / 2, M["black"], bev=0.0012)
    # Gewinnlinie: kleine Messingpfeile links und rechts jeder Walze
    for k, c in enumerate(centers):
        for side in (-1, 1):
            bm = bmesh.new()
            xa = side * (WIN_W / 2 + 0.0005)
            pts = [(xa, c.z + 0.0075), (xa - side * 0.011, c.z), (xa, c.z - 0.0075)]
            vs = [bm.verts.new((px, GLASS_Y - 0.0035, pz)) for px, pz in pts]
            vb = [bm.verts.new((px, GLASS_Y - 0.0005, pz)) for px, pz in pts]
            bm.faces.new(vs)
            bm.faces.new(list(reversed(vb)))
            for i in range(3):
                bm.faces.new((vs[i], vs[(i + 1) % 3], vb[(i + 1) % 3], vb[i]))
            bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
            o = mesh_obj("Gewinnpfeil", bm, M["brass"], smooth=0)
            bevel(o, 0.0006, 2)
    # Schrauben in den Ecken des Rahmens
    for sx in (x0 + 0.0052, x1 - 0.0052):
        for sz in (z0 + 0.012, z1 - 0.012):
            screw("Schraube", Vector((sx, -0.0108, sz)), Vector((0, -1, 0)), 0.0026, M["brass_dark"], M["black"])
    for sx in (bez[0] + 0.012, bez[2] - 0.012):
        for sz in (bez[1] + 0.012, bez[3] - 0.012):
            screw("Schraube Lünette", Vector((sx, -0.0205, sz)), Vector((0, -1, 0)), 0.0028, M["chrome"], M["black"])

    # ----- Krone -----
    c0, c1 = CROWN_Z
    cd0, cd1 = 0.004, D - 0.02
    arch = arch_outline(x0, c0, x1, c1, CROWN_ARCH, rb=0.004)
    plate_solid("Krone", arch, cd0, cd1, M["wood"], bev=0.006)
    # Messing-Zierwulst entlang des Bogens vorn, und eine feine Linie innen
    edge = offset_outline(arch, 0.0005)
    tube_along("Kronenwulst", [(x, cd0 - 0.002, z) for x, z in edge], 0.0058, M["brass"], closed=True)
    inner = offset_outline(arch, 0.021)
    tube_along("Kronenlinie", [(x, cd0 - 0.0005, z) for x, z in inner], 0.0018, M["brass"], closed=True)
    # Bogen oben: Birnenreihe entlang des Bogens, darunter das Namensschild, darunter eine gerade Reihe
    S["crown_bulbs"] = [[], []]
    cx, zs = 0.0, c1 - CROWN_ARCH
    ra, rz = W / 2 - 0.044, CROWN_ARCH - 0.040
    n_top = 11
    for i in range(n_top):
        a = math.pi - (i + 0.5) / n_top * math.pi * 0.86 - math.pi * 0.07
        loc = Vector((cx + ra * math.cos(a), cd0 - 0.0005, zs - 0.002 + rz * math.sin(a) + 0.008))
        S["crown_bulbs"][0].append(bulb(f"Birne Krone oben {i}", loc, parts))
    n_bot = 9
    for i in range(n_bot):
        x = -0.152 + i * (0.304 / (n_bot - 1))
        S["crown_bulbs"][1].append(bulb(f"Birne Krone unten {i}", Vector((x, cd0 - 0.0005, c0 + 0.026)), parts))
    # Namensschild: Messingrahmen, rote Emaille, erhabene Messingbuchstaben
    pz = c0 + 0.078
    pw, ph = 0.35, 0.060
    plate_solid("Schild Rahmen", rounded_rect(-pw / 2, pz - ph / 2, pw / 2, pz + ph / 2, 0.010), cd0 - 0.008, cd0 + 0.001,
                M["brass"], bev=0.003)
    plate_solid("Schild Emaille", rounded_rect(-pw / 2 + 0.006, pz - ph / 2 + 0.006, pw / 2 - 0.006, pz + ph / 2 - 0.006, 0.006),
                cd0 - 0.0092, cd0 - 0.007, M["enamel"], bev=0.0006)
    # Perlstab innen am Rahmen
    pearl_src = lathe("Perle", [(0, 0), (0.00125, 0.0002), (0.0014, 0.0010), (0.0008, 0.0018), (0, 0.0020)], 12, M["brass"])
    pearl_src.location = (0, 0, -10)
    perim = rounded_rect(-pw / 2 + 0.0085, pz - ph / 2 + 0.0085, pw / 2 - 0.0085, pz + ph / 2 - 0.0085, 0.004, seg=4)
    # gleichmäßig verteilte Perlen
    total = sum((Vector(perim[i]) - Vector(perim[i - 1])).length for i in range(len(perim)))
    count = int(total / 0.0042)
    step = total / count
    acc, pos = 0.0, 0.0
    segs = [(Vector(perim[i - 1]), Vector(perim[i])) for i in range(len(perim))]
    k = 0
    for a, b in segs:
        L = (b - a).length
        while pos <= acc + L and k < count:
            p = a + (b - a) * ((pos - acc) / L if L else 0)
            instance(pearl_src, "Perle", (p.x, cd0 - 0.0092, p.y))
            pos += step
            k += 1
        acc += L
    font = bpy.data.fonts.load(asset("rokkitt_black.ttf"), check_existing=True)
    tcu = bpy.data.curves.new("Schriftzug", "FONT")
    tcu.body = "PHRASENDREHER"
    tcu.font = font
    tcu.size = 0.0355
    tcu.space_character = 1.06
    tcu.align_x = "CENTER"
    tcu.align_y = "CENTER"
    tcu.extrude = 0.0011
    tcu.bevel_depth = 0.0006
    tcu.bevel_resolution = 3
    tobj = link(bpy.data.objects.new("Schriftzug", tcu))
    tobj.rotation_euler = (math.pi / 2, 0, 0)
    tobj.location = (0, cd0 - 0.0105, pz - 0.0005)
    tcu.materials.append(M["brass"])
    # Schrauben am Schild
    for sx in (-pw / 2 + 0.0055, pw / 2 - 0.0055):
        screw("Schraube Schild", Vector((sx, cd0 - 0.0082, pz)), Vector((0, -1, 0)), 0.0021, M["brass_dark"], M["black"])

    # ----- Hebel: Lagergehäuse an der Seitenwand (fest) -----
    P = LEVER_PIVOT
    wall = x1
    def on_wall(obj, y):
        """plate_solid baut in der xz-Ebene mit Front nach −y; um z gedreht zeigt die Front nach +x (aus der Wand)."""
        obj.matrix_world = Matrix.Translation((wall, y, 0)) @ Matrix.Rotation(math.pi / 2, 4, "Z") @ obj.matrix_world
        return obj
    on_wall(plate_solid("Hebelplatte", rounded_rect(-0.055, P.z - 0.085, 0.055, P.z + 0.085, 0.022), -0.005, 0.0,
                        M["brass"], bev=0.0018), P.y)
    housing = lathe("Lagergehäuse", [(0, 0), (0.046, 0), (0.046, 0.003), (0.043, 0.007), (0.040, 0.016), (0.034, 0.022),
                                     (0.024, 0.026), (0.019, 0.027), (0.019, 0.030)], 64, M["brass"], axis="X")
    housing.location = (wall + 0.004, P.y, P.z)
    # Rippen auf dem Gehäuse
    for i in range(12):
        a = i / 12 * math.tau
        rib = box("Rippe", 0, 0.012, -0.0018, 0.0018, 0.020, 0.040, M["brass"], bev=0.0012)
        rib.matrix_world = Matrix.Translation((wall + 0.008, P.y, P.z)) @ Matrix.Rotation(a, 4, "X")
    for i in range(4):
        a = math.radians(45 + 90 * i)
        loc = Vector((wall + 0.0042, P.y + 0.072 * math.cos(a) * 0.65, P.z + 0.105 * math.sin(a) * 0.7))
        screw("Schraube Hebel", loc, Vector((1, 0, 0)), 0.0032, M["brass_dark"], M["black"])

    # ----- Seitenwand: Münzeinwurf oben, Schlossblech unten -----
    cy, cz = D * 0.62, z1 - 0.085
    on_wall(plate_solid("Münzeinwurf", rounded_rect(-0.030, cz - 0.042, 0.030, cz + 0.042, 0.014), -0.006, 0.0,
                        M["chrome"], bev=0.0022, bev_seg=5), cy)
    on_wall(plate_solid("Münzeinwurf Wulst", rounded_rect(-0.012, cz - 0.026, 0.012, cz + 0.026, 0.008), -0.0095, -0.004,
                        M["chrome"], bev=0.002), cy)
    on_wall(plate_solid("Münzschlitz", rounded_rect(-0.0028, cz - 0.019, 0.0028, cz + 0.019, 0.0026), -0.0098, -0.0092,
                        M["black"]), cy)
    for dz in (-0.034, 0.034):
        screw("Schraube Einwurf", Vector((wall + 0.0062, cy, cz + dz)), Vector((1, 0, 0)), 0.0022, M["chrome"], M["black"])
    ly, lz = D * 0.62, z0 + 0.075
    on_wall(plate_solid("Schlossblech", rounded_rect(-0.017, lz - 0.026, 0.017, lz + 0.026, 0.016), -0.004, 0.0,
                        M["brass"], bev=0.0016), ly)
    key = lathe("Schlüsselloch", [(0, 0), (0.0032, 0), (0.0032, 0.0012), (0, 0.0012)], 24, M["black"], axis="X")
    key.location = (wall + 0.0035, ly, lz + 0.004)
    on_wall(plate_solid("Schlüsselloch Bart", [(-0.0014, lz - 0.007), (0.0014, lz - 0.007), (0.0012, lz + 0.003),
                                                (-0.0012, lz + 0.003)], -0.0047, -0.0040, M["black"]), ly)

    # ----- Hebel: beweglicher Teil (wird als glTF exportiert und im Browser bewegt) -----
    arm = []
    hub_x0, hub_x1 = wall + 0.030, wall + LEVER_OUT + 0.012
    hub = lathe("Hebel Nabe", [(0, 0), (0.016, 0), (0.017, 0.002), (0.017, hub_x1 - hub_x0 - 0.004),
                               (0.0145, hub_x1 - hub_x0), (0, hub_x1 - hub_x0)], 48, M["chrome"], axis="X")
    hub.location = (hub_x0, P.y, P.z)
    arm.append(hub)
    rod_x = wall + LEVER_OUT
    clamp = lathe("Hebel Schelle", [(0, 0), (0.0125, 0), (0.0125, 0.004), (0.0105, 0.026), (0.0085, 0.030), (0.0072, 0.034),
                                    (0, 0.034)], 40, M["chrome"], axis="Z")
    clamp.location = (rod_x, P.y, P.z + 0.006)
    arm.append(clamp)
    rod_len = LEVER_L - KNOB_R - 0.025
    rod = lathe("Hebel Stange", [(0, 0), (0.0068, 0), (0.0062, rod_len * 0.5), (0.0056, rod_len), (0, rod_len)], 40,
                M["chrome"], axis="Z")
    rod.location = (rod_x, P.y, P.z + 0.030)
    arm.append(rod)
    collar = lathe("Hebel Manschette", [(0, 0), (0.0075, 0), (0.0105, 0.004), (0.0110, 0.012), (0.0130, 0.016), (0.0135, 0.019),
                                        (0.0110, 0.021), (0, 0.021)], 40, M["chrome"], axis="Z")
    collar.location = (rod_x, P.y, P.z + LEVER_L - KNOB_R - 0.017)
    arm.append(collar)
    bm = bmesh.new()
    bmesh.ops.create_uvsphere(bm, u_segments=64, v_segments=40, radius=KNOB_R)
    ball = mesh_obj("Hebel Knauf", bm, M["red_ball"], smooth=180)
    ball.location = (rod_x, P.y, P.z + LEVER_L)
    arm.append(ball)
    S["lever"] = arm
    S["side_wall"] = side_r
    return S


# ---------- Licht, Welt, Kamera ----------
def world_and_lights():
    sc = bpy.context.scene
    world = bpy.data.worlds.new("Billardsaal")
    world.use_nodes = True
    nt = world.node_tree
    bg = nt.nodes["Background"]
    env = nt.nodes.new("ShaderNodeTexEnvironment")
    env.image = bpy.data.images.load(asset("billiard_hall_2k.hdr"), check_existing=True)
    mp = nt.nodes.new("ShaderNodeMapping")
    mp.inputs["Rotation"].default_value = (0, 0, math.radians(200))
    tc = nt.nodes.new("ShaderNodeTexCoord")
    nt.links.new(tc.outputs["Generated"], mp.inputs["Vector"])
    nt.links.new(mp.outputs["Vector"], env.inputs["Vector"])
    nt.links.new(env.outputs["Color"], bg.inputs["Color"])
    bg.inputs["Strength"].default_value = 0.35
    sc.world = world

    def area(name, loc, target, size, energy, color, shape="RECTANGLE", size_y=None):
        l = bpy.data.lights.new(name, "AREA")
        l.shape = shape
        l.size = size
        l.size_y = size_y or size
        l.energy = energy
        l.color = color
        o = link(bpy.data.objects.new(name, l))
        o.location = loc
        d = Vector(target) - Vector(loc)
        o.rotation_euler = d.to_track_quat("-Z", "Y").to_euler()
        return o
    L = {}
    # Hauptlicht: große Softbox oben links vorn – lange, weiche Glanzverläufe auf Messing und Lack
    L["key"] = area("Hauptlicht", (-0.9, -1.1, 1.45), (0.0, 0.15, 0.42), 0.9, 22, (1.0, 0.9, 0.78), size_y=0.6)
    # Aufhellung rechts, flach
    L["fill"] = area("Aufhellung", (1.3, -0.9, 0.55), (0.1, 0.1, 0.4), 0.8, 3, (1.0, 0.82, 0.66))
    # Streiflicht von hinten rechts: zeichnet die Kante der Seitenwand und den Hebel
    L["rim"] = area("Kante", (0.9, 0.9, 1.1), (0.15, 0.1, 0.45), 0.35, 14, (1.0, 0.86, 0.7), size_y=1.0)
    # schmale Lichtleiste von oben für den Glanz auf dem Kronenbogen
    L["top"] = area("Oberlicht", (0.0, -0.45, 1.5), (0.0, 0.1, 0.7), 1.2, 6, (1.0, 0.92, 0.8), size_y=0.15)
    # Spiegelkarte: lange, schmale Leuchtfläche links vorn mit weich auslaufenden Rändern, die nur in Spiegelungen
    # auftaucht (Glas, Lack, Messing) – so liegt ein sanfter, schräger Lichtstreif auf der Scheibe wie bei Produktfotos.
    bm = bmesh.new()
    bmesh.ops.create_grid(bm, x_segments=1, y_segments=1, size=0.5)
    card = mesh_obj("Spiegelkarte", bm, None, smooth=0)
    card.scale = (0.16, 0.62, 1)
    card.location = (-0.78, -1.95, 0.28)
    card.rotation_euler = (Vector((-0.06, -0.01, 0.47)) - card.location).to_track_quat("Z", "Y").to_euler()
    card.rotation_euler.rotate_axis("Z", math.radians(-28))
    m = bpy.data.materials.new("Spiegelkarte")
    m.use_nodes = True
    nt = m.node_tree
    nt.nodes.clear()
    out = nt.nodes.new("ShaderNodeOutputMaterial")
    tc = nt.nodes.new("ShaderNodeTexCoord")
    sep = nt.nodes.new("ShaderNodeSeparateXYZ")
    nt.links.new(tc.outputs["Generated"], sep.inputs[0])
    # Querprofil weich (Gauß-ähnlich), längs zu den Enden hin auslaufend
    def bell(src, width):
        d = nt.nodes.new("ShaderNodeMath"); d.operation = "SUBTRACT"; d.inputs[1].default_value = 0.5
        nt.links.new(src, d.inputs[0])
        q = nt.nodes.new("ShaderNodeMath"); q.operation = "MULTIPLY"
        nt.links.new(d.outputs[0], q.inputs[0]); nt.links.new(d.outputs[0], q.inputs[1])
        k = nt.nodes.new("ShaderNodeMath"); k.operation = "MULTIPLY"; k.inputs[1].default_value = -1 / (2 * width ** 2)
        nt.links.new(q.outputs[0], k.inputs[0])
        e = nt.nodes.new("ShaderNodeMath"); e.operation = "EXPONENT"
        nt.links.new(k.outputs[0], e.inputs[0])
        return e.outputs[0]
    prof = nt.nodes.new("ShaderNodeMath"); prof.operation = "MULTIPLY"
    nt.links.new(bell(sep.outputs[0], 0.12), prof.inputs[0])
    nt.links.new(bell(sep.outputs[1], 0.3), prof.inputs[1])
    em = nt.nodes.new("ShaderNodeEmission")
    em.inputs["Color"].default_value = (1.0, 0.93, 0.84, 1)
    st = nt.nodes.new("ShaderNodeMath"); st.operation = "MULTIPLY"; st.inputs[1].default_value = 1.5
    nt.links.new(prof.outputs[0], st.inputs[0])
    nt.links.new(st.outputs[0], em.inputs["Strength"])
    nt.links.new(em.outputs[0], out.inputs["Surface"])
    card.data.materials.append(m)
    card.visible_camera = False
    card.visible_diffuse = False
    card.visible_transmission = False
    card.visible_volume_scatter = False
    card.visible_shadow = False
    L["card"] = card
    return L


def camera():
    sc = bpy.context.scene
    cd = bpy.data.cameras.new("Kamera")
    cd.lens = 85
    cd.sensor_fit = "VERTICAL"
    cd.sensor_height = 24
    cam = link(bpy.data.objects.new("Kamera", cd))
    target = Vector((0.045, 0.1, 0.405))
    yaw, pitch, dist = math.radians(17), math.radians(7), 2.95
    cam.location = target + Vector((math.sin(yaw) * math.cos(pitch), -math.cos(yaw) * math.cos(pitch), math.sin(pitch))) * dist
    cam.rotation_euler = (target - cam.location).to_track_quat("-Z", "Y").to_euler()
    sc.camera = cam
    return cam


def reset():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    sc = bpy.context.scene
    sc.unit_settings.system = "METRIC"
    sc.render.engine = "CYCLES"
    sc.cycles.device = "CPU"
    sc.render.film_transparent = True
    sc.view_settings.view_transform = "AgX"
    return sc


def build_scene():
    reset()
    M = materials()
    S = build(M)
    S["lights"] = world_and_lights()
    S["camera"] = camera()
    S["materials"] = M
    return S


if __name__ == "__main__":
    build_scene()
    os.makedirs(BUILD, exist_ok=True)
    bpy.ops.wm.save_as_mainfile(filepath=os.path.join(BUILD, "automat.blend"))
    print("gespeichert:", os.path.join(BUILD, "automat.blend"))

"""TRAÇO V1 — Fusion 360 build script.

Run in the already open Robo Desenhista design with Fusion's text command:
Python.RunScript "/Users/flaviospinelli/Documents/ChatGPT/Robo Desenhista/cad/FUSION_BUILD.py"
Fusion API uses centimetres internally; all public dimensions below are millimetres.
"""

import os
import math
import traceback

import adsk.core
import adsk.fusion


OUT = "/Users/flaviospinelli/Documents/ChatGPT/Robo Desenhista/cad"
LOG = os.path.join(OUT, "fusion_build.log")


def mm(value):
    return value / 10.0


def pt(x, y, z=0):
    return adsk.core.Point3D.create(mm(x), mm(y), mm(z))


def val(value):
    return adsk.core.ValueInput.createByReal(mm(value))


def add_component(root, name, transform=None):
    occurrence = root.occurrences.addNewComponent(transform or adsk.core.Matrix3D.create())
    occurrence.component.name = name
    return occurrence


def pose_matrix(origin, direction=(1, 0), face_y=0):
    """Place a flat-printed part in the XZ arm plane for the assembly view."""
    dx, dz = direction
    length = math.hypot(dx, dz)
    dx, dz = dx / length, dz / length
    transform = adsk.core.Matrix3D.create()
    success = transform.setWithCoordinateSystem(
        pt(origin[0], face_y, origin[1]),
        adsk.core.Vector3D.create(dx, 0, dz),
        adsk.core.Vector3D.create(-dz, 0, dx),
        adsk.core.Vector3D.create(0, -1, 0),
    )
    if not success:
        raise RuntimeError("Invalid assembly transform")
    return transform


def xyz_matrix(position):
    transform = adsk.core.Matrix3D.create()
    transform.translation = adsk.core.Vector3D.create(
        mm(position[0]), mm(position[1]), mm(position[2]))
    return transform


def flat_part(component, name, outline, thickness, holes=(), slots=()):
    """Extrude a closed outline with circular through holes, printable flat."""
    sketch = component.sketches.add(component.xYConstructionPlane)
    sketch.name = name + " | perfil de impressão"
    lines = sketch.sketchCurves.sketchLines
    for i, p in enumerate(outline):
        q = outline[(i + 1) % len(outline)]
        lines.addByTwoPoints(pt(*p), pt(*q))
    for x, y, diameter in holes:
        sketch.sketchCurves.sketchCircles.addByCenterRadius(pt(x, y), mm(diameter / 2))
    for x1, y1, x2, y2, width in slots:
        sketch.addCenterToCenterSlot(pt(x1, y1), pt(x2, y2), val(width))
    profiles = sketch.profiles
    if profiles.count == 0:
        raise RuntimeError("No closed profile for " + name)
    profile = max((profiles.item(i) for i in range(profiles.count)),
                  key=lambda p: p.areaProperties().area)
    feature = component.features.extrudeFeatures.addSimple(
        profile, val(thickness), adsk.fusion.FeatureOperations.NewBodyFeatureOperation
    )
    body = feature.bodies.item(0)
    body.name = name
    return body


def add_joined_prism(component, name, outline, height):
    sketch = component.sketches.add(component.xYConstructionPlane)
    sketch.name = name
    lines = sketch.sketchCurves.sketchLines
    for i, p in enumerate(outline):
        q = outline[(i + 1) % len(outline)]
        lines.addByTwoPoints(pt(*p), pt(*q))
    profile = max((sketch.profiles.item(i) for i in range(sketch.profiles.count)),
                  key=lambda p: p.areaProperties().area)
    component.features.extrudeFeatures.addSimple(
        profile, val(height), adsk.fusion.FeatureOperations.JoinFeatureOperation)


def cross_hole_y(component, x, z, diameter, depth):
    sketch = component.sketches.add(component.xZConstructionPlane)
    center = sketch.modelToSketchSpace(pt(x, 0, z))
    sketch.sketchCurves.sketchCircles.addByCenterRadius(center, mm(diameter / 2))
    component.features.extrudeFeatures.addSimple(
        sketch.profiles.item(0), val(depth),
        adsk.fusion.FeatureOperations.CutFeatureOperation)


def rectangle(cx, cy, length, width):
    return [(cx-length/2, cy-width/2), (cx+length/2, cy-width/2),
            (cx+length/2, cy+width/2), (cx-length/2, cy+width/2)]


def disk(radius, sides=48):
    return [(radius*math.cos(2*math.pi*i/sides),
             radius*math.sin(2*math.pi*i/sides)) for i in range(sides)]


def hub_holes(cx=0, cy=0):
    # Pololu 2693: six M3 holes, 19.05 mm bolt circle.
    return [(cx+9.525*math.cos(math.pi*i/3),
             cy+9.525*math.sin(math.pi*i/3), 3.4) for i in range(6)]


def part(root, name, filename, outline, thickness, holes=(), placement=None,
         position=None, slots=()):
    transform = pose_matrix(*placement) if placement else (
        xyz_matrix(position) if position else None)
    occurrence = add_component(root, "TRACO V1 " + name, transform)
    flat_part(occurrence.component, name, outline, thickness, holes, slots)
    return occurrence, filename


def export_parts(design, parts):
    manager = design.exportManager
    stl_dir = os.path.join(OUT, "stl")
    os.makedirs(stl_dir, exist_ok=True)
    for occurrence, filename in parts:
        path = os.path.join(stl_dir, filename)
        options = manager.createSTLExportOptions(occurrence.component, path)
        options.meshRefinement = adsk.fusion.MeshRefinementSettings.MeshRefinementHigh
        if not manager.execute(options):
            raise RuntimeError("Falha STL: " + filename)
    expected = {filename for _, filename in parts}
    for filename in os.listdir(stl_dir):
        if filename.lower().endswith('.stl') and filename not in expected:
            os.remove(os.path.join(stl_dir, filename))


def add_all(root):
    parts = []
    def add(*args, **kwargs):
        item = part(root, *args, **kwargs)
        parts.append(item)
        return item[0]

    # Compact 148 mm central base with a low motor tab extending to the left.
    # The four M6 holes anchor it to the event counter.
    base_outline = [(-120,-40), (-74,-40), (-74,-74), (74,-74),
                    (74,74), (-74,74), (-74,40), (-120,40)]
    add("01 base compacta", "01_base_compacta.stl",
        base_outline, 10,
        [(0, 0, 8.5)] + [(x, y, 6.4) for x in (-60, 60) for y in (-60, 60)] +
        [(x, y, 5.2) for x in (-28, 28) for y in (-28, 28)] +
        [(-75, y, 5.2) for y in (-30, 30)])

    # Central 8 mm bearing stack. Two 608-2RS bearings go in separate 8 mm
    # carriers; physical shaft and axial thrust washer are purchased hardware.
    add("02 mancal inferior", "02_mancal_608_inferior.stl",
        rectangle(0, 0, 76, 76), 9,
        [(0, 0, 22.15)] + [(x, y, 5.2) for x in (-28, 28) for y in (-28, 28)],
        position=(0, 0, 10))
    add("02a retentor mancal inferior", "02a_retentor_mancal_inferior.stl",
        rectangle(0, 0, 76, 76), 3,
        [(0, 0, 8.5)] + [(x, y, 5.2) for x in (-28, 28) for y in (-28, 28)],
        position=(0, 0, 19))
    add("03a retentor mancal superior", "03a_retentor_mancal_superior.stl",
        rectangle(0, 0, 76, 76), 3,
        [(0, 0, 8.5)] + [(x, y, 5.2) for x in (-28, 28) for y in (-28, 28)],
        position=(0, 0, 47))
    add("03 mancal superior", "03_mancal_608_superior.stl",
        rectangle(0, 0, 76, 76), 9,
        [(0, 0, 22.15)] + [(x, y, 5.2) for x in (-28, 28) for y in (-28, 28)],
        position=(0, 0, 50))
    for i, (x, y) in enumerate(((28, 28), (28, -28), (-28, 28), (-28, -28))):
        add("04 coluna espaçadora %d" % (i+1),
            "04_coluna_espacadora_%d.stl" % (i+1),
            disk(7, 24), 25, [(0, 0, 5.2)], position=(x, y, 22))

    add("05 plataforma giratoria", "05_plataforma_giratoria.stl",
        disk(58), 12,
        [(0, 0, 8.15)] + hub_holes() +
        [(x, y, 5.2) for x in (-37, 37) for y in (-22, 22)],
        position=(0, 0, 80))

    # Tower cheek geometry. Its 22.15 mm bore carries a 608 bearing around
    # an 8 mm steel shoulder shaft; two cheeks are spaced by metal standoffs.
    tower = [(-50, -64), (48, -64), (48, -30), (34, 26),
             (17, 55), (-27, 55), (-48, 24)]
    for side in ("direita", "esquerda"):
        add("06 torre " + side, "06_torre_" + side + ".stl", tower, 9,
            [(0, 18, 22.15), (-37, -43, 5.2), (37, -43, 5.2),
             (-36, -16, 4.2), (36, -16, 4.2),
             (-26, -31, 5.2), (-26, 19, 5.2), (0, -12, 5.2)],
            ((0, 144), (1, 0), 34 if side == "direita" else -25))

    # NEMA 17 mounts use the 31 x 31 mm standard hole square; the 23 mm
    # central opening clears the pilot and motor shaft.
    motor_holes = [(x, y, 3.4) for x in (-15.5, 15.5) for y in (-15.5, 15.5)]
    motor_holes += [(0, 0, 23)]
    mounts = {
        "base": (rectangle(0, 0, 70, 70), [(-5,y,5,y,5.2) for y in (-30,30)]),
        "ombro": (rectangle(0, 0, 82, 68), [(30,y,40,y,5.2) for y in (-25,25)]),
        "cotovelo": (rectangle(0, 0, 82, 68),
                     [(x-5,0,x+5,0,5.2) for x in (-25,25)]),
    }
    motor_positions = {"base": None,
                       "ombro": ((-61, 138), (1, 0), -44),
                       "cotovelo": ((36, 210), (120, 160), -46)}
    for number, suffix in ((7, "base"), (8, "ombro"), (9, "cotovelo")):
        outline, attachment_slots = mounts[suffix]
        add("%02d suporte motor %s" % (number, suffix),
            "%02d_suporte_motor_%s.stl" % (number, suffix),
            outline, 8, motor_holes, slots=attachment_slots,
            placement=motor_positions[suffix],
            position=(-75, 0, 10) if suffix == "base" else None)

    # Both moving links are 200 mm centre-to-centre. The teardrop outer
    # profile keeps the material near each pin and removes some midspan mass.
    upper = [(-23, -20), (18, -20), (102, -13), (182, -18),
             (223, -18), (223, 18), (182, 18), (102, 13),
             (18, 20), (-23, 20)]
    fore = [(-22, -17), (18, -17), (100, -11), (181, -16),
            (222, -16), (222, 16), (181, 16), (100, 11),
            (18, 17), (-22, 17)]
    # In the displayed pose the shoulder is (0, 162) and the elbow
    # is (120, 322); the wrist is (300, 234.822). Segment lengths are 200 mm.
    shoulder = (0, 162)
    elbow = (120, 322)
    wrist = (300, 234.822)
    for side in ("direita", "esquerda"):
        add("10 braco superior " + side,
            "10_braco_superior_" + side + ".stl", upper, 8,
            [(0, 0, 8.25), (200, 0, 22.15),
             (35, 0, 5.2), (85, 0, 5.2), (165, 0, 5.2)] + hub_holes(),
            (shoulder, (120, 160), 25 if side == "direita" else -17))
        add("11 antebraco " + side,
            "11_antebraco_" + side + ".stl", fore, 8,
            [(0, 0, 8.25), (200, 0, 22.15),
             (35, 0, 5.2), (165, 0, 5.2)] + hub_holes(),
            (elbow, (180, -87.178), 15 if side == "direita" else -7))

    # Two passive rods form two parallelograms, keeping the pen upright.
    rod = [(-13, -7), (213, -7), (213, 7), (-13, 7)]
    add("12 haste paralela superior", "12_haste_paralela_superior.stl",
        rod, 7, [(0, 0, 5.3), (200, 0, 5.3)],
        ((0, 192), (120, 160), 72))
    add("13 haste paralela inferior", "13_haste_paralela_inferior.stl",
        rod, 7, [(0, 0, 5.3), (200, 0, 5.3)],
        ((120, 352), (180, -87.178), 84))
    add("14 ancora fixa haste", "14_ancora_fixa_haste.stl",
        rectangle(0, 0, 26, 90), 8,
        [(0, 0, 8.3), (0, 30, 5.3), (0, -30, 5.3)],
        (shoulder, (1, 0), 58))
    add("15 balancim cotovelo", "15_balancim_cotovelo.stl",
        rectangle(0, 15, 36, 70), 8,
        [(0, 0, 22.15), (0, 30, 5.3)],
        (elbow, (1, 0), 58))
    add("16 cabeca vertical", "16_cabeca_vertical.stl",
        [(-17,-65), (17,-65), (17,51), (-17,51)], 10,
        [(0, 0, 8.3), (0, 30, 5.3)] +
        [(x, y, 4.3) for x in (-12, 12) for y in (-50, -20)] + hub_holes(),
        (wrist, (1, 0), 58))

    # Pen sleeve is a separate split clamp; the user can replace it without
    # dismantling the arm. Clearance suits a 10 mm pen and a silicone insert.
    pen_sleeve = add("17 porta caneta 10mm", "17_porta_caneta_10mm.stl",
                     disk(15, 48), 80, [(0, 0, 10.8)],
                     position=(300, 78, wrist[1]-85))
    add_joined_prism(pen_sleeve.component, "aba de fixacao da caneta",
                     rectangle(0, -15, 32, 10), 80)
    for x in (-12, 12):
        for z in (35, 65):
            cross_hole_y(pen_sleeve.component, x, z, 4.3, 25)

    # Removable cosmetic side skins: black structural links remain visible.
    upper_skin = [(-16,-23),(35,-24),(155,-19),(213,-22),
                  (213,22),(155,19),(35,24),(-16,23)]
    add("18 carenagem superior direita", "18_carenagem_superior_direita.stl",
        upper_skin, 3, [(12, 0, 4.2), (188, 0, 4.2)],
        (shoulder, (120, 160), 42))
    add("20 carenagem base", "20_carenagem_base.stl",
        disk(70), 4, [(0, 0, 32)], position=(0, 0, 76))

    shoulder_guard = [(-18,-18), (20,-18), (65,-39), (88,-39),
                      (88,39), (65,39), (20,18), (-18,18)]
    add("21 tampa correia ombro", "21_tampa_correia_ombro.stl",
        shoulder_guard, 3,
        [(-5, 0, 4.2), (77, -29, 4.2), (77, 29, 4.2)],
        ((-61, 138), (61, 24), -46))
    elbow_guard = [(-18,-18), (22,-20), (135,-38), (164,-38),
                   (164,38), (135,38), (22,20), (-18,18)]
    add("22 tampa correia cotovelo", "22_tampa_correia_cotovelo.stl",
        elbow_guard, 3,
        [(-5, 0, 4.2), (150, -28, 4.2), (150, 28, 4.2)],
        ((36, 210), (84, 112), -46))

    # Reference solids show the purchased motor and pulley envelopes. They
    # are visible in the Fusion assembly but deliberately omitted from STL.
    def reference(name, outline, thickness, holes=(), placement=None,
                  position=None):
        transform = pose_matrix(*placement) if placement else (
            xyz_matrix(position) if position else None)
        occ = add_component(root, "TRACO V1 REF " + name, transform)
        flat_part(occ.component, name, outline, thickness, holes)
    reference("motor base 17HS4401", rectangle(0,0,42,42), 40,
              position=(-75,0,18))
    reference("eixo motor base 5mm", disk(2.5,24), 24,
              position=(-75,0,58))
    reference("motor ombro 17HS4401", rectangle(0,0,42,42), 40,
              placement=((-61,138),(1,0),-52))
    reference("eixo motor ombro 5mm", disk(2.5,24), 24,
              placement=((-61,138),(1,0),-28))
    reference("motor cotovelo 17HS4401", rectangle(0,0,42,42), 40,
              placement=((36,210),(120,160),-54))
    reference("eixo motor cotovelo 5mm", disk(2.5,24), 24,
              placement=((36,210),(120,160),-30))
    reference("polia J1 100T envelope", disk(32,48), 8,
              [(0,0,8.2)], position=(0,0,61))
    reference("polia J2 100T envelope", disk(32,48), 8,
              [(0,0,8.2)], placement=(shoulder,(1,0),-36))
    reference("polia J3 100T envelope", disk(32,48), 8,
              [(0,0,8.2)], placement=(elbow,(1,0),-34))

    return parts


def run(context):
    try:
        app = adsk.core.Application.get()
        design = adsk.fusion.Design.cast(app.activeProduct)
        if not design:
            raise RuntimeError("Abra o projeto Robo Desenhista no ambiente Design")
        root = design.rootComponent
        # Only remove parts this script previously added, never user geometry.
        for i in range(root.occurrences.count-1, -1, -1):
            occurrence = root.occurrences.item(i)
            if occurrence.component.name.startswith("TRACO V1"):
                occurrence.deleteMe()
        parts = add_all(root)
        export_parts(design, parts)
        with open(LOG, "w") as file:
            file.write("OK: Fusion created %d printable components and STLs\n" % len(parts))
        app.activeViewport.fit()
    except:
        with open(LOG, "w") as file:
            file.write(traceback.format_exc())


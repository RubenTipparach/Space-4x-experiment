#!/usr/bin/env python3
"""Render per-yaw camera-space NORMAL MAPS that match the lit y### ship sprites.

The existing client sprites (client/public/sprites/<id>_y###.png) are the lit albedo.
This renders, at the SAME camera as `blender_clean.frame(objs, yaw)`, a normal map per
yaw so a Pixi shader can light each sprite per-pixel from the star direction.

Normal encoding: VectorTransform(Geometry.Normal, world->camera) * 0.5 + 0.5, emitted
with the Raw view transform so PNG bytes are the literal camera-space normal. Decode in
the shader as n = (r, b, g)*2 - 1 (channel swap validated against the Three.js proof).

Run:  ANGLES=24 SAMPLES=64 RES=512 python3 scripts/concept/blender_normal.py [id ...]
      ANGLES=1  -> single hero frame (<id>_albedo.png + <id>_n.png) for de-risk tests
Out:  client/public/sprites/nm/<id>_y###_n.png   (per-yaw normal maps)
"""
import bpy, os, sys, math
from mathutils import Vector

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import blender_clean as bc  # noqa: E402  (defines builders + helpers, no render on import)

OUT = os.path.join(HERE, "..", "..", "client", "public", "sprites", "nm")
os.makedirs(OUT, exist_ok=True)

ANGLES = int(os.environ.get("ANGLES", "24"))
IDS = [a for a in sys.argv[1:] if not a.startswith("-")] or list(bc.BUILDERS)


def normal_material():
    m = bpy.data.materials.new("nrm"); m.use_nodes = True
    nt = m.node_tree; nt.nodes.clear()
    geo = nt.nodes.new("ShaderNodeNewGeometry")
    vt = nt.nodes.new("ShaderNodeVectorTransform")
    vt.vector_type = "NORMAL"; vt.convert_from = "WORLD"; vt.convert_to = "CAMERA"
    nt.links.new(geo.outputs["Normal"], vt.inputs[0])
    mad = nt.nodes.new("ShaderNodeVectorMath"); mad.operation = "MULTIPLY_ADD"
    mad.inputs[1].default_value = (0.5, 0.5, 0.5); mad.inputs[2].default_value = (0.5, 0.5, 0.5)
    nt.links.new(vt.outputs["Vector"], mad.inputs[0])
    em = nt.nodes.new("ShaderNodeEmission"); nt.links.new(mad.outputs["Vector"], em.inputs["Color"])
    out = nt.nodes.new("ShaderNodeOutputMaterial"); nt.links.new(em.outputs["Emission"], out.inputs["Surface"])
    return m


def render_set(fid):
    bc.reset(); bc.setup_world()
    objs = bc.BUILDERS[fid]()
    bc.add_lights()
    sc = bpy.context.scene

    if ANGLES <= 1:
        # de-risk: hero albedo (lit) + normal at a single 3/4 frame
        bc.frame(objs, 0)
        sc.view_settings.view_transform = "Standard"
        bc.render(os.path.join(OUT, f"{fid}_albedo.png"))
        bpy.context.view_layer.material_override = normal_material()
        sc.view_settings.view_transform = "Raw"; sc.view_settings.look = "None"
        bc.render(os.path.join(OUT, f"{fid}_n.png"))
        print("rendered hero albedo + normal:", fid)
        return

    # per-yaw normal maps only (albedo = existing lit y### sprites)
    bpy.context.view_layer.material_override = normal_material()
    sc.view_settings.view_transform = "Raw"; sc.view_settings.look = "None"
    step = 360 // ANGLES
    for k in range(ANGLES):
        yaw = k * step
        bc.frame(objs, yaw)
        bc.render(os.path.join(OUT, f"{fid}_y{yaw:03d}_n.png"))
    print("rendered", ANGLES, "normal frames:", fid)


for fid in IDS:
    if fid in bc.BUILDERS:
        render_set(fid)
print("done")

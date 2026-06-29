#!/usr/bin/env python3
"""Proof: render a ship's ALBEDO + camera-space NORMAL MAP at an isometric angle.

The normal map encodes camera-space normals (R=right, G=up, B=toward-camera) via a
material override that emits Vector Transform(Normal, world->camera)*0.5+0.5, rendered
with the Raw view transform so the bytes are the literal encoded values. A Pixi shader
then lights the sprite per-pixel from the star direction.

Run: python3 scripts/concept/blender_normal.py [faction-id]
Out: client/public/sprites/nm/<id>_albedo.png and <id>_n.png
"""
import bpy, os, sys, math
from mathutils import Vector

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import blender_clean as bc  # noqa: E402  (defines builders + helpers, no render on import)

OUT = os.path.join(HERE, "..", "..", "client", "public", "sprites", "nm")
os.makedirs(OUT, exist_ok=True)

ISO = Vector((0.0, -0.85, 1.0))   # more isometric tilt than the 3/4 hero view
FID = (sys.argv[1] if len(sys.argv) > 1 else "consortium-galactica")


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


# ---- albedo ----
bc.reset(); bc.setup_world()
objs = bc.BUILDERS[FID]()
bc.add_lights()
bc._cam(objs, ISO, "Y")
sc = bpy.context.scene
sc.view_settings.view_transform = "Filmic" if "Filmic" in [v.name for v in sc.view_settings.bl_rna.properties["view_transform"].enum_items] else "Standard"
bc.render(os.path.join(OUT, f"{FID}_albedo.png"))
print("rendered albedo")

# ---- normal map (same framing) ----
bpy.context.view_layer.material_override = normal_material()
sc.view_settings.view_transform = "Raw"   # write literal encoded values, no tonemap
sc.view_settings.look = "None"
bc.render(os.path.join(OUT, f"{FID}_n.png"))
print("rendered normal map")
print("done")

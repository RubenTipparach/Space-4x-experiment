#!/usr/bin/env python3
"""Export each procedural ship to a glTF binary (.glb) for real-time 3D rendering.

Ships are no longer baked to sprites — we ship the actual model and let Three.js light
it live from the star. Materials (Principled BSDF + Emission) and the Bevel modifiers
are baked into the mesh on export.

Run:  python3 scripts/concept/export_glb.py [faction-id ...]
Out:  client/public/models/<id>.glb
"""
import bpy, os, sys, addon_utils

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import blender_clean as bc  # noqa: E402

OUT = os.path.join(HERE, "..", "..", "client", "public", "models")
os.makedirs(OUT, exist_ok=True)

try:
    addon_utils.enable("io_scene_gltf2", default_set=True, persistent=True)
except Exception as e:
    print("addon enable note:", e)

IDS = [a for a in sys.argv[1:] if not a.startswith("-")] or list(bc.BUILDERS)

for fid in IDS:
    if fid not in bc.BUILDERS:
        continue
    bc.reset()
    bc.BUILDERS[fid]()                      # meshes + materials + bevel modifiers
    path = os.path.join(OUT, f"{fid}.glb")
    bpy.ops.export_scene.gltf(
        filepath=path,
        export_format="GLB",
        use_selection=False,
        export_apply=True,                 # apply modifiers (bevels) into the mesh
        export_yup=True,                   # Blender Z-up -> glTF Y-up
        export_materials="EXPORT",
    )
    print("exported", path)
print("done")

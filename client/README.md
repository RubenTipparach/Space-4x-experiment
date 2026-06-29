# Stellar Frontier — Client (vertical slice)

Client-only PixiJS vertical slice of the solar-system view. No backend yet — all
state is in-browser.

## Run

```bash
cd client
npm install
npm run dev      # http://localhost:5173
# or: npm run build && npm run preview
```

> Needs a real browser/GPU. PixiJS v8 uses WebGL (default) or WebGPU (`?r=webgpu`).
> Headless software-GL (CI sandboxes) can fail to initialize the renderer; run it in
> a normal browser.

## What's in the slice

- **Solar system:** a central star with **15 planets** on animated orbits. Bigger
  planets are **gas giants**, each exposing **5 atmosphere mining nodes** (the
  Lagrange spots). Several planets have **moons** (also mineable).
- **Resource tags** per body: animals, plant biomes, underwater biomes, rare
  minerals, tourist attractions, plus mineable ore / crystal / gas. Hover any body to
  see its tags.
- **Fleet of 8 ships** (one per faction, using the 24-angle Blender sprites) in the
  **bottom-middle toolbar**. Click a ship to select it.
  - Click a **planet / moon / gas node** → the ship flies there and **mines** that
    body's resource.
  - Click **empty space** → move the ship there.
  - **Recall** (bottom-right) → send the selected ship back to HQ.
- **Mining loop:** a ship fills its cargo, hauls it to **HQ**, deposits (HQ stores
  update, top-left), then returns to keep mining until recalled.
- Pan by dragging empty space; zoom with the mouse wheel.

## Source

- `src/data.ts` — system layout, planets/moons/nodes, resource tags, the 8-ship fleet.
- `src/main.ts` — Pixi scene, orbits, ship movement/mining, HUD wiring.
- `public/sprites/` — 24-angle ship sprites rendered by `scripts/concept/blender_clean.py`.

This is the first slice; networking, persistence, and colonization/revenue come later
per `docs/`.

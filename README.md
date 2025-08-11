# AnArch – Lightweight 3D Modeling Playground

A single‑page Three.js scene for drawing boxes (in feet), importing models, editing with transform gizmos, grouping, visibility toggles, and exporting to OBJ. Includes optional WebXR AR viewing.

## Features
- Create: drag on grid to draw a box with adjustable height
- Edit: select single/multiple, move or rotate, snap to floor, group
- Import: load .glb/.gltf/.obj, place on ground
- Visibility: per‑object show/hide and inline rename
- Export: OBJ of only user-created/imported objects
- AR: WebXR immersive‑ar (with polyfill attempt on iOS)
- Touch: automatic gesture mapping (Edit: one‑finger orbit; Create/Import: one‑finger draw/place; pinch zoom/pan)
- Version badge: shows the live version from `version.json` in the bottom‑right

## Run
Use any static server. If you have Live Server in VS Code:

```powershell
# Right‑click index.html > Open with Live Server
# or on port from .vscode/settings.json (5501)
```

Or with Python (optional):

```powershell
python -m http.server 8000
```

Then open http://localhost:8000/ (adjust port as needed).

## Tips
- Orbit: two fingers on touch; middle mouse to orbit, hold Shift for pan
- Multi‑select: Ctrl/Cmd/Shift click in viewport or list
- Delete: Delete/Backspace removes all selected
- ESC while drawing cancels the preview
- Tap empty area (touch, Edit) to clear selection

## Notes
- Units: 1 Three.js unit equals 1 foot. Grid is 20×20 ft.
- Export excludes helpers/lights/gizmos.
- Tested with Three r155 via ESM CDN imports.

## Versioning (lightweight)
The app displays a small version badge sourced from `version.json`:

```json
{
	"version": "0.1.0",
	"date": "2025-08-11",
	"notes": "Initial version badge and touch auto-detect"
}
```

How to update:
- Bump the `version` and `date` fields in `version.json` when you deploy
- Optional: add a brief note for what changed

The file is fetched with `cache: 'no-store'` to avoid stale values when hosted statically.


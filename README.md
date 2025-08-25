# AnArch – Lightweight 3D Modeling Playground
[https://lecartier.github.io/Sketcher/](https://lecartier.github.io/Sketcher/)

A single‑page Three.js scene for drawing boxes (in feet), importing models, editing with transform gizmos, grouping, visibility toggles, and exporting to OBJ. Includes optional WebXR AR viewing.

## Features
- Create: drag on grid to draw a box with adjustable height
- Edit: select single/multiple, move or rotate, snap to floor, group
- Import: load .glb/.gltf/.obj, place on ground
- Visibility: per‑object show/hide and inline rename
- Export: OBJ of only user-created/imported objects
- AR: WebXR immersive‑ar (with polyfill attempt on iOS)
- Localization: language selector (English, Spanish) with easy extension

### 2D Sketch (new)
Open `sketch2d.html` for a flat 2D canvas with Pen/Line/Rect/Ellipse/Text, stroke/fill color, thickness, pan/zoom, Undo/Redo, and PNG/PDF export. Shift to constrain lines/rects; Esc to cancel a shape.

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
- Change language via the dropdown at the top left

## Notes
- Units: 1 Three.js unit equals 1 foot. Grid is 20×20 ft.
- Export excludes helpers/lights/gizmos.
- Tested with Three r155 via ESM CDN imports.

### Add a new language
Edit `js/i18n.js` and add a new top‑level key (e.g., `fr`) in `dictionaries`. Then add an `<option>` in the `#langSelect` in `index.html` and include the new code in `initLocale([...])` if desired.

## License

MIT — see `LICENSE` for details.


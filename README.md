# Sketcher / AnArch

Lightweight browser-based spatial sketching + conceptual modeling environment merging a real‑time 3D scene (Three.js) with a precision 2D drafting canvas. Designed for rapid early‑stage spatial layout, AR review, export, and iterative collaboration.

---
## Core Pillars
| Pillar | Summary |
| ------ | ------- |
| 3D Modeling Core | Box primitives + imported assets, transforms, grouping, visibility, snapping |
| 2D Drafting Layer | High‑DPI canvas: polyline, arcs, bezier, offset/fillet/chamfer, erase (object/pixel), dimensioning |
| Underlay & Scale | PDF & DXF import with architectural scale parsing + overlay persistence |
| AR / XR Review | WebXR AR (with polyfill fallback) + immersive HUD + first‑person navigation |
| Collaboration (WIP) | Channel/broadcast scaffolding (see `collab.js`) for future real‑time sync |
| Export Pipelines | OBJ (3D), PNG/PDF (2D), IFC (early mapping) |
| Persistence | Local/session storage, content library (Supabase/IndexedDB abstraction) |
| Performance & Quality | Adaptive pixel ratio, quality toggles, geometry simplification, import optimization |

---
## High-Level Feature Matrix
| Domain | Capabilities |
| ------ | ------------ |
| 3D Scene | Grid, orbit/pan, box creation (drag footprint + set height), transform gizmos, grouping, visibility toggle, rename, snapping alignment (WIP) |
| Assets | GLB/GLTF/OBJ import, object library loader (`obj-library.js`), material assignment (AR aware) |
| 2D Drafting | Pen, line, rect, ellipse, polygon/reg polygon/star, arcs (3‑pt & center), quadratic bezier, round‑rect, measure, dimension, smart shape interpretation, offset, fillet, chamfer, erase (object/pixel mask), lasso snip & temp snip editing |
| Underlay | PDF page import & scaling, DXF minimal entities (LINE/LWPOLYLINE/CIRCLE) -> live geometry, persistence with downscaled preview image |
| Navigation | First‑person (keyboard/mouse), VR/AR HUD overlays, XR draw (prototype) |
| Export | 3D OBJ, 2D PNG/PDF (`export-2d.js`), IFC skeleton (`ifc-export.js`) |
| Persistence | Local/session autosave, thumbnail generation, gallery (“Columbarium”), broadcast syncing between tabs/windows |
| AR / XR | Material adaptation (`ar-materials.js`), AR editing (`ar-edit.js`), HUD (`xr-hud.js`), VR drawing (`vr-draw.js`) |
| Performance | Import optimization (`optimize-import.js`), simplification, adaptive DPR, quality controls (`fp-quality.js`) |
| Room Semantics | Room system & manager, designation UI, scan integration (stubs) |
| Collaboration (Future) | Placeholder scaffolding for multi-user state & presence in `collab.js` |

---
## Repository Layout (Key Paths)
```
js/
	app/                3D application orchestrator
		app.js            Main 3D runtime (banner documented)
		services/         Cross-cutting domain + infra modules
			room-system.js  Core spatial/room data model & topology
			room-manager.js Lifecycle/control layer above room-system
			room-designation-ui.js  UI for labeling / classification
			room-scan.js    (Stub) future ingestion from scans
			ifc-export.js   IFC export mapping
			obj-library.js  Object catalog & on-demand load
			ar-edit.js / ar-materials.js  AR interaction & material adaptation
			xr-hud.js       Immersive overlay UI elements
			first-person.js + fp-quality.js  Navigation + perf tuning
			texture-utils.js  Texture loading/processing helpers
			optimize-import.js  Import mesh optimization
			mass-creation.js  Batch/parametric placement experiments
			blocking-stacking.js + blocking-ui.js  Spatial constraint UI logic
			collab.js       Collaboration scaffolding (future real-time)
			community-api.js / supabase-sources.js Remote storage & feeds
			excel-parser.js  Data extraction for bulk ops
			vr-draw.js      Experimental XR line drawing
		features/         Focused geometry / primitive helpers
			primitives.js   3D primitive creation utilities
			alignment-tile.js  Grid alignment experiments
	app2d/              2D drafting subsystem
		app2d.js          Full canvas engine (banner documented)
		features/         2D geometry + selection + export + erase
			geometry-2d.js
			selection-2d.js
			erase-2d.js
			export-2d.js
			smart-draw.js
assets/               HDR env + OBJ test assets + textures
css/                  Global styling & UI
index.html            3D entry
sketch2d.html         2D entry
columbarium.html      Saved sketch/gallery view
community.html        Community / shared scenes (future)
```

---
## Architectural Overview
### Dual-Plane Editing
The project intentionally separates concerns:
- 3D (`app.js`): Scene graph orchestration, object transforms, lighting, overlays, AR session entry, export.
- 2D (`app2d.js`): High‑frequency pointer drawing optimized around a single high‑DPI canvas with layered composition (underlay → grid → objects → erase mask → overlays/selection).
A BroadcastChannel keeps 2D changes visible in 3D (as an overlay or for future projection).

### Room Semantics
`room-system.js` maintains an internal model of rooms (likely polygonal bounds) with adjacency, area computation, and future export hooks. `room-manager.js` coordinates creation, destruction, UI designation, and potential IFC mapping.

### Import & Underlay Flow
PDF and DXF imports flow through a unified modal that normalizes scale (feet per inch) and persists an underlay snapshot (downscaled PNG) for session continuity. DXF parsing is purposefully narrow—only essential entity types for early conceptual tracing.

### Modify & Precision Tools (2D)
Offset, fillet, chamfer, and dimension tools run on polylines with temporary previews and HUD numeric entry (plus join type cycling for offsets). Pixel erase uses a composited alpha mask separate from object removal for reversible visual refinement and performance.

### Snip & Temp Edit
Snip lasso extracts a subset for 3D or isolated editing. Temp Snip Edit mode suppresses autosave/broadcast until explicitly finished/canceled, preventing state races with the primary sketch.

### AR / XR Integration
AR layers adjust material properties for physically‑based consistency, switch interaction metaphors, and provide a HUD channel distinct from desktop UI. Experimental VR draw features demonstrate extensibility.

### Export Pipelines
- OBJ: Mesh extraction of user objects only.
- IFC: Early, modular mapping layer (not production‑complete) for future BIM pipeline integration.
- 2D: PNG/PDF at device pixel scaling; dimension text + vector paths preserved in on‑canvas render before rasterization.

### Performance Strategies
- Adaptive device pixel ratio (clamped) for crisp yet efficient 2D.
- Debounced autosave (200ms) + masked erase operations.
- Import mesh optimization pipeline for heavy assets.
- Optional geometry simplification & first-person quality reductions.

---
## Development Workflow
### Prerequisites
- Modern browser supporting ES Modules & WebXR (Chrome, Edge, Firefox for basic features; AR best in Chromium).
- PowerShell (for version bump hook on Windows) or adjust script for bash.

---
## Code Conventions
- Section banners with enumerated indices in large files for navigation.
- World units: feet (1 Three.js unit = 1 ft). 2D canvas uses feet mapped to screen via `view.pxPerFt`.
- Avoid overly chatty comments—focus on invariants, intent, and side‑effects.
- Use feature modules (`js/app2d/features/*` and `js/app/features/*`) to isolate algorithms from orchestration.

### Suggested Banner Pattern
```
// ============================================================================
// [NN] TITLE
// One‑line scope + nuances.
// ----------------------------------------------------------------------------
```

---
## Extending the System
| Area | How to Extend |
| ---- | ------------- |
| Add 2D Tool | Implement preview + commit flow; integrate into `setTool()` mapping + keyboard shortcut if needed |
| New Import Type | Follow unified modal API (scale, preview) and map entities -> internal objects |
| Additional Export | Create service module; expose async function; wire button & status feedback |
| AR Feature | Extend `ar-edit.js` or HUD; ensure graceful fallback when no XR session |
| Room Logic | Add geometry helpers inside `room-system.js`; document invariants (e.g., non‑self‑intersecting polygons) |
| Collaboration | Flesh out `collab.js`: define message schema, diff/patch strategy, presence model |

---
## Testing & Validation (Lightweight)
No formal test harness yet; recommended manual passes:
- 2D offset/fillet/chamfer on open & closed polylines
- PDF + DXF import scaling accuracy (compare known dimension)
- Undo/redo after mixed edit + erase operations
- Snip → temp edit → finish/cancel state integrity
- OBJ export then re-import for geometry fidelity
- AR session entry/exit on supported device (materials & lighting) 

---
## Known Limitations / Roadmap
- Collaboration real-time sync is placeholder only.
- IFC export incomplete (property sets, multi-storey not covered).
- DXF parser minimal; ignores layers, arcs, splines.
- No persistent multi-user conflict resolution yet.
- Limited mobile UI optimization outside core interactions.

---
## License
Proprietary — see `LICENSE`. Third-party libraries retain their original licenses (Three.js, loaders, pdf.js, etc.).

---
## Credits / Acknowledgements
- Three.js ecosystem + example loaders (GLTF, DRACO, KTX2, IFC)
- pdf.js project (Mozilla) for PDF rendering
- Community inspiration for lightweight BIM & spatial sketch tooling

---
*Version:* 4.1.1  ·  *Date:* 2025-09-16



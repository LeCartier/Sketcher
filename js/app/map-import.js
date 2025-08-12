// Full Map Import module: Leaflet UI, Nominatim search, Esri imagery stitching, Open-Elevation topography

const FEET_PER_METER = 3.280839895;
const TILE_SIZE = 256;
const ESRI_URL = 'https://services.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}';

async function ensureLeafletLoaded() {
	if (window.L) return window.L;
	await new Promise((resolve, reject) => {
		const link = document.createElement('link');
		link.rel = 'stylesheet';
		link.href = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css';
		link.onload = resolve; link.onerror = reject; document.head.appendChild(link);
	});
	await new Promise((resolve, reject) => {
		const script = document.createElement('script');
		script.src = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js';
		script.onload = resolve; script.onerror = reject; document.head.appendChild(script);
	});
	return window.L;
}

function haversineMeters(lat1, lon1, lat2, lon2) {
	const toRad = (d) => d * Math.PI / 180;
	const R = 6371000;
	const dLat = toRad(lat2 - lat1);
	const dLon = toRad(lon2 - lon1);
	const a = Math.sin(dLat/2)**2 + Math.cos(toRad(lat1))*Math.cos(toRad(lat2))*Math.sin(dLon/2)**2;
	return 2 * R * Math.asin(Math.sqrt(a));
}

function latLonToTileXY(lat, lon, z) {
	const x = Math.floor((lon + 180) / 360 * Math.pow(2, z));
	const y = Math.floor((1 - Math.log(Math.tan(lat * Math.PI/180) + 1 / Math.cos(lat * Math.PI/180)) / Math.PI) / 2 * Math.pow(2, z));
	return { x, y };
}

function getTileRangeForBounds(bounds, z) {
	const sw = bounds.getSouthWest();
	const ne = bounds.getNorthEast();
	const tMin = latLonToTileXY(ne.lat, sw.lng, z); // top-left
	const tMax = latLonToTileXY(sw.lat, ne.lng, z); // bottom-right
	const minX = Math.min(tMin.x, tMax.x), maxX = Math.max(tMin.x, tMax.x);
	const minY = Math.min(tMin.y, tMax.y), maxY = Math.max(tMin.y, tMax.y);
	return { minX, maxX, minY, maxY };
}

async function loadImage(url) {
	return new Promise((resolve, reject) => {
		const img = new Image();
		img.crossOrigin = 'anonymous';
		img.onload = () => resolve(img);
		img.onerror = (e) => reject(e);
		img.src = url;
	});
}

async function stitchEsriImageryToCanvas(bounds, targetMaxTiles = 64) {
	// Choose a zoom level that limits total tile count, but gives decent detail
	let z = 16; // start high and reduce if needed
	let range, tilesX, tilesY, total;
	do {
		range = getTileRangeForBounds(bounds, z);
		tilesX = (range.maxX - range.minX + 1);
		tilesY = (range.maxY - range.minY + 1);
		total = tilesX * tilesY;
		if (total > targetMaxTiles) z--;
	} while (total > targetMaxTiles && z > 0);

	const canvas = document.createElement('canvas');
	canvas.width = tilesX * TILE_SIZE;
	canvas.height = tilesY * TILE_SIZE;
	const ctx = canvas.getContext('2d');

	const promises = [];
	for (let ty = range.minY; ty <= range.maxY; ty++) {
		for (let tx = range.minX; tx <= range.maxX; tx++) {
			const url = ESRI_URL.replace('{z}', String(z)).replace('{y}', String(ty)).replace('{x}', String(tx));
			const px = (tx - range.minX) * TILE_SIZE;
			const py = (ty - range.minY) * TILE_SIZE;
			promises.push(
				loadImage(url).then(img => { ctx.drawImage(img, px, py, TILE_SIZE, TILE_SIZE); }).catch(()=>{/* skip missing tile */})
			);
		}
	}
	await Promise.all(promises);
	return { canvas, zoom: z };
}

async function fetchElevationsGrid(bounds, cols, rows) {
	const sw = bounds.getSouthWest();
	const ne = bounds.getNorthEast();
	const lats = []; const lons = [];
	for (let j = 0; j < rows; j++) {
		const t = rows === 1 ? 0.5 : j / (rows - 1);
		lats.push(sw.lat + t * (ne.lat - sw.lat));
	}
	for (let i = 0; i < cols; i++) {
		const s = cols === 1 ? 0.5 : i / (cols - 1);
		lons.push(sw.lng + s * (ne.lng - sw.lng));
	}
	// Build list of locations in row-major order
	const locations = [];
	for (let j = 0; j < rows; j++) {
		for (let i = 0; i < cols; i++) {
			locations.push({ latitude: lats[j], longitude: lons[i] });
		}
	}
	// Batch POST to open-elevation (limit to 100 per request to be safe)
	const elevations = new Array(locations.length).fill(0);
	const batchSize = 100;
	for (let start = 0; start < locations.length; start += batchSize) {
		const slice = locations.slice(start, start + batchSize);
		const resp = await fetch('https://api.open-elevation.com/api/v1/lookup', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ locations: slice })
		});
		if (!resp.ok) throw new Error('Elevation service error');
		const json = await resp.json();
		const results = json.results || [];
		for (let k = 0; k < results.length; k++) {
			elevations[start + k] = results[k].elevation; // meters
		}
	}
	return { elevations, cols, rows };
}

function computeFeetSizeFromBounds(bounds) {
	const sw = bounds.getSouthWest();
	const ne = bounds.getNorthEast();
	const centerLat = (sw.lat + ne.lat) / 2;
	const widthM = haversineMeters(centerLat, sw.lng, centerLat, ne.lng);
	const depthM = haversineMeters(sw.lat, (sw.lng + ne.lng) / 2, ne.lat, (sw.lng + ne.lng) / 2);
	return { widthFt: widthM * FEET_PER_METER, depthFt: depthM * FEET_PER_METER };
}

function meshFromBoundsFlat(THREE, bounds, textureCanvas, fallbackMaterial) {
	const { widthFt, depthFt } = computeFeetSizeFromBounds(bounds);
	const geo = new THREE.PlaneGeometry(widthFt, depthFt, 1, 1);
	geo.rotateX(-Math.PI / 2);
	let mat;
		if (textureCanvas) {
			const tex = new THREE.CanvasTexture(textureCanvas);
			if (THREE.SRGBColorSpace) tex.colorSpace = THREE.SRGBColorSpace; else if (tex.encoding !== undefined && THREE.sRGBEncoding) tex.encoding = THREE.sRGBEncoding;
		tex.anisotropy = 8;
		mat = new THREE.MeshBasicMaterial({ map: tex });
	} else {
		mat = fallbackMaterial?.clone ? fallbackMaterial.clone() : new THREE.MeshNormalMaterial({ side: THREE.DoubleSide });
	}
	const mesh = new THREE.Mesh(geo, mat);
	mesh.name = 'Imported Flat Area';
	return mesh;
}

function meshFromBoundsTopo(THREE, bounds, elevGrid, fallbackMaterial, textureCanvas) {
	const { cols, rows, elevations } = elevGrid;
	const { widthFt, depthFt } = computeFeetSizeFromBounds(bounds);
	const geo = new THREE.PlaneGeometry(widthFt, depthFt, cols - 1, rows - 1);
	geo.rotateX(-Math.PI / 2);
	// Convert and center elevations
	const feetElev = elevations.map(m => m * FEET_PER_METER);
	const mean = feetElev.reduce((a, b) => a + b, 0) / feetElev.length;
	const pos = geo.attributes.position;
	let idx = 0;
	for (let j = 0; j < rows; j++) {
		for (let i = 0; i < cols; i++) {
			const y = feetElev[idx++] - mean; // center around y=0
			const vi = j * cols + i;
			pos.setY(vi, y);
		}
	}
	pos.needsUpdate = true;
	geo.computeVertexNormals();
	let mat;
		if (textureCanvas) {
			const tex = new THREE.CanvasTexture(textureCanvas);
			if (THREE.SRGBColorSpace) tex.colorSpace = THREE.SRGBColorSpace; else if (tex.encoding !== undefined && THREE.sRGBEncoding) tex.encoding = THREE.sRGBEncoding;
		tex.anisotropy = 8;
		mat = new THREE.MeshStandardMaterial({ map: tex, metalness: 0, roughness: 1 });
	} else {
		mat = fallbackMaterial?.clone ? fallbackMaterial.clone() : new THREE.MeshStandardMaterial({ color: 0x88aa88, metalness: 0, roughness: 1 });
	}
	const mesh = new THREE.Mesh(geo, mat);
	mesh.name = 'Imported Topography';
	return mesh;
}

export function setupMapImport({ THREE, renderer, fallbackMaterial, addObjectToScene, elements }) {
	const el = elements || {};
	const backdrop = el.backdrop;
	const container = el.container;
	const importBtn = el.importBtn;
	const closeBtn = el.closeBtn;
	const drawToggleBtn = el.drawToggleBtn;
	const useFlatBtn = el.useFlatBtn;
	const useTopoBtn = el.useTopoBtn;
	const searchBtn = el.searchBtn;
	const searchInput = el.searchInput;

	let map = null;
	let drawnRect = null;
	let drawing = false; let startLatLng = null;

	async function open() {
		if (backdrop) backdrop.style.display = 'flex';
		const L = await ensureLeafletLoaded();
		if (!map) {
			map = L.map(container, { zoomControl: true, attributionControl: true });
			L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
				maxZoom: 19,
				attribution: '&copy; OpenStreetMap contributors'
			}).addTo(map);
			map.setView([37.8, -96], 4);

			// Drawing handlers (mouse and touch)
			map.on('mousedown', (e) => {
				if (drawToggleBtn.getAttribute('aria-pressed') !== 'true') return;
				drawing = true; startLatLng = e.latlng;
				if (drawnRect) { drawnRect.remove(); drawnRect = null; }
				map.getContainer().classList.add('crosshair');
			});
			map.on('mousemove', (e) => {
				if (!drawing || !startLatLng) return;
				const b = L.latLngBounds(startLatLng, e.latlng);
				if (!drawnRect) drawnRect = L.rectangle(b, { color: '#0078ff', weight: 1, fillOpacity: 0.05 }).addTo(map);
				else drawnRect.setBounds(b);
			});
			// Touch support for region drawing
			map.getContainer().addEventListener('touchstart', function(ev) {
				if (drawToggleBtn.getAttribute('aria-pressed') !== 'true') return;
				if (ev.touches.length !== 1) return;
				const touch = ev.touches[0];
				const rect = map.getContainer().getBoundingClientRect();
				const point = map.mouseEventToContainerPoint({ clientX: touch.clientX, clientY: touch.clientY });
				const latlng = map.containerPointToLatLng(point);
				drawing = true; startLatLng = latlng;
				if (drawnRect) { drawnRect.remove(); drawnRect = null; }
				map.getContainer().classList.add('crosshair');
			}, { passive: false });
			map.getContainer().addEventListener('touchmove', function(ev) {
				if (!drawing || !startLatLng) return;
				if (ev.touches.length !== 1) return;
				const touch = ev.touches[0];
				const point = map.mouseEventToContainerPoint({ clientX: touch.clientX, clientY: touch.clientY });
				const latlng = map.containerPointToLatLng(point);
				const b = L.latLngBounds(startLatLng, latlng);
				if (!drawnRect) drawnRect = L.rectangle(b, { color: '#0078ff', weight: 1, fillOpacity: 0.05 }).addTo(map);
				else drawnRect.setBounds(b);
			}, { passive: false });
			const stopDraw = () => { drawing = false; startLatLng = null; map.getContainer().classList.remove('crosshair'); };
			map.on('mouseup', stopDraw);
			map.on('mouseout', stopDraw);
			map.getContainer().addEventListener('touchend', stopDraw, { passive: false });
		}
	}
	function close() { if (backdrop) backdrop.style.display = 'none'; }

	async function doSearch() {
		const q = (searchInput && searchInput.value || '').trim();
		if (!q) return;
		try {
			const resp = await fetch(`https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(q)}&limit=1`, {
				headers: { 'Accept': 'application/json' }
			});
			if (!resp.ok) throw new Error('Search failed');
			const arr = await resp.json();
			if (arr && arr.length) {
				const r = arr[0];
				const lat = parseFloat(r.lat), lon = parseFloat(r.lon);
				map.setView([lat, lon], 12);
				if (r.boundingbox) {
					const [south, north, west, east] = r.boundingbox.map(parseFloat);
					const L = window.L;
					const bb = L.latLngBounds([south, west], [north, east]);
					map.fitBounds(bb);
				}
			} else {
				alert('No results');
			}
		} catch (e) {
			alert('Search error');
			console.error(e);
		}
	}

	function getSelectedBounds() {
		if (drawnRect) return drawnRect.getBounds();
		return map.getBounds();
	}

	async function importFlat() {
		const bounds = getSelectedBounds();
		try {
			const { canvas } = await stitchEsriImageryToCanvas(bounds);
			const mesh = meshFromBoundsFlat(THREE, bounds, canvas, fallbackMaterial);
			addObjectToScene(mesh, { select: true });
			close();
		} catch (e) {
			console.warn('Imagery fetch failed, using fallback material', e);
			const mesh = meshFromBoundsFlat(THREE, bounds, null, fallbackMaterial);
			addObjectToScene(mesh, { select: true });
			close();
		}
	}

	async function importTopo() {
		const bounds = getSelectedBounds();
		try {
			// Choose grid density by area size
			const { widthFt, depthFt } = computeFeetSizeFromBounds(bounds);
			const maxDim = Math.max(widthFt, depthFt);
			const target = maxDim > 20000 ? 32 : 64; // fewer samples for huge areas
			const cols = target, rows = target;
			const grid = await fetchElevationsGrid(bounds, cols, rows);
			let canvas = null;
			try {
				const stitched = await stitchEsriImageryToCanvas(bounds);
				canvas = stitched.canvas;
			} catch (e) { /* ignore imagery failure */ }
			const mesh = meshFromBoundsTopo(THREE, bounds, grid, fallbackMaterial, canvas);
			addObjectToScene(mesh, { select: true });
			close();
		} catch (e) {
			alert('Topography import failed. Try a smaller area.');
			console.error(e);
		}
	}

	// Wire UI
	if (importBtn) importBtn.addEventListener('click', open);
	if (closeBtn) closeBtn.addEventListener('click', close);
	if (drawToggleBtn) drawToggleBtn.addEventListener('click', () => {
		const p = drawToggleBtn.getAttribute('aria-pressed') === 'true';
		drawToggleBtn.setAttribute('aria-pressed', String(!p));
	});
	if (searchBtn) searchBtn.addEventListener('click', doSearch);
	if (searchInput) searchInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') doSearch(); });
	if (useFlatBtn) useFlatBtn.addEventListener('click', importFlat);
	if (useTopoBtn) useTopoBtn.addEventListener('click', importTopo);

	return { open, close };
}

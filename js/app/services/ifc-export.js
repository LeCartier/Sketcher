// IFC Exporter (IFC4) – tessellated geometry using IfcTriangulatedFaceSet
// Public API: exportIFC(THREE, rootOrObjects, opts) -> Blob

export function exportIFC(THREE, input, opts = {}){
  const options = {
    projectName: opts.projectName || 'Sketcher Project',
    author: opts.author || 'Sketcher',
    org: opts.org || 'Sketcher',
    storeyElevation: Number.isFinite(opts.storeyElevation) ? opts.storeyElevation : 0,
    classify: opts.classify || defaultClassifier,
  };

  const writer = new IfcWriter();
  const now = new Date();
  const ownerHistory = writer.ownerHistory(options.author, options.org, now);
  const ctx = writer.contexts();
  const units = writer.units();
  const proj = writer.project(options.projectName, ownerHistory, ctx.context, units);
  const site = writer.site(ownerHistory);
  const bldg = writer.building(ownerHistory);
  const storey = writer.storey(ownerHistory, options.storeyElevation);
  writer.aggregateProject(proj, site, bldg, storey);

  // Collect meshes from input
  const meshes = collectMeshes(THREE, input);
  const tmp = new THREE.Matrix4();
  const pos = new THREE.Vector3(); const quat = new THREE.Quaternion(); const scl = new THREE.Vector3();

  for (const m of meshes){
    if (!m.geometry) continue;
    const geom = ensureIndexed(m.geometry);
    // Bake world transform so placement can be identity
    m.updateWorldMatrix(true, false);
    tmp.copy(m.matrixWorld);
    tmp.decompose(pos, quat, scl);
    // Compute world-space bounding box dims (meters) for classification hints
    const box = new THREE.Box3(); try { box.setFromObject(m); } catch {}
    const dims = box.isEmpty() ? { x:0,y:0,z:0 } : { x:(box.max.x-box.min.x)*0.3048, y:(box.max.y-box.min.y)*0.3048, z:(box.max.z-box.min.z)*0.3048 };
    const verts = getWorldVertices(THREE, geom, m.matrixWorld);
    const faces = getTriangleIndices(geom);
    const cls = options.classify(m, { dims });
    const name = m.name || cls;
    writer.addMeshElement({ name, cls, verts, faces, ownerHistory, parentStorey: storey });
  }

  const step = writer.toSTEP();
  return new Blob([step], { type: 'application/x-step' });
}

function collectMeshes(THREE, input){
  const list = [];
  const add = (o)=>{ if (o && o.isMesh && o.geometry) list.push(o); if (o && o.children) o.children.forEach(add); };
  if (Array.isArray(input)) input.forEach(add); else add(input);
  // Filter helpers
  return list.filter(m=>{
    const n=(m.name||'').toLowerCase();
    if (n.startsWith('__')) return false;
    return true;
  });
}

function ensureIndexed(geometry){
  if (geometry.index) return geometry;
  // Clone and index if necessary
  try {
    const three = (geometry.attributes && geometry.attributes.position && geometry.attributes.position.itemSize===3) ? geometry : geometry.clone();
    // Simple indexer: let three compute it via toNonIndexed -> toIndexed path
    const g2 = three.toNonIndexed ? three.toNonIndexed() : three;
    return g2.toIndexed ? g2.toIndexed() : g2;
  } catch { return geometry; }
}

function getWorldVertices(THREE, geometry, matrixWorld){
  const arr = geometry.attributes.position.array;
  const v = new THREE.Vector3();
  const out = [];
  for (let i=0;i<arr.length;i+=3){
    v.set(arr[i], arr[i+1], arr[i+2]).applyMatrix4(matrixWorld);
    // IFC units are meters typically; our units are feet -> convert to meters
    out.push(v.x*0.3048, v.y*0.3048, v.z*0.3048);
  }
  return out;
}

function getTriangleIndices(geometry){
  const idx = geometry.index ? geometry.index.array : null;
  if (!idx){
    const n = geometry.attributes.position.array.length/3;
    const a = []; for (let i=0;i<n;i++) a.push(i);
    return a;
  }
  return Array.from(idx);
}

function defaultClassifier(obj, info={}){
  const n = (obj.name||'').toLowerCase();
  if (n.includes('wall')) return 'IfcWall';
  if (n.includes('floor')||n.includes('slab')) return 'IfcSlab';
  if (n.includes('column')) return 'IfcColumn';
  if (n.includes('beam')) return 'IfcBeam';
  if (n.includes('roof')) return 'IfcRoof';
  if (n.includes('ramp')) return 'IfcRamp';
  if (n.includes('stair')) return 'IfcStair';
  // Heuristics by shape if no keyword
  try {
    const d = info.dims || {x:0,y:0,z:0};
    const X = Math.max(d.x, 1e-6), Y = Math.max(d.y, 1e-6), Z = Math.max(d.z, 1e-6);
    const planMax = Math.max(X, Z), planMin = Math.min(X, Z);
    // Very thin in Y compared to plan => floor/slab
    if (Y < planMax * 0.15 && planMax > 0.3) return 'IfcSlab';
    // Very thin in plan compared to height => wall/column depending on aspect
    const minPlanToHeight = (planMin / Y);
    if (minPlanToHeight < 0.2 && Y > 1.0) {
      // Slender in both plan axes -> column; else wall
      const slenderBoth = (X/Y < 0.2) && (Z/Y < 0.2);
      return slenderBoth ? 'IfcColumn' : 'IfcWall';
    }
  } catch {}
  return 'IfcBuildingElementProxy';
}

// --- Minimal IFC STEP writer ---
class IfcWriter{
  constructor(){ this.entities=[]; this._id=1; this.refs=new Map(); this.relAggregates=[]; this.relContained=[]; }
  nextId(){ return this._id++; }
  add(e){ const id=this.nextId(); this.entities.push({ id, e }); return id; }
  guid(){
    // Generate 22-char IFC GUID from UUID v4
    const u = (crypto.randomUUID ? crypto.randomUUID() : ([1e7]+-1e3+-4e3+-8e3+-1e11).replace(/[018]/g,c=>(c^crypto.getRandomValues(new Uint8Array(1))[0]&15>>c/4).toString(16)));
    return toIfcGuid(u);
  }
  personAndOrg(author, org){
    const p = this.add(`IFCPERSON($,$,'${escapeStr(author)}',$,$,$,$,$)`);
    const o = this.add(`IFCORGANIZATION($,'${escapeStr(org)}',$,$,$)`);
    const po = this.add(`IFCPERSONANDORGANIZATION(#${p},#${o},$)`);
    return { p, o, po };
  }
  ownerHistory(author, org, date){
    const { po } = this.personAndOrg(author, org);
    const app = this.add(`IFCAPPLICATION(#${this.add(`IFCORGANIZATION($,'${escapeStr(org)}',$,$,$)`)} ,'1.0','Sketcher','SKETCHER')`);
    const t = Math.floor(date.getTime()/1000);
    const ow = this.add(`IFCOWNERHISTORY(#${po},#${app},$,.ADDED.,$, $, ${t}, $)`);
    return ow;
  }
  contexts(){
    const ctxModel = this.add(`IFCGEOMETRICREPRESENTATIONCONTEXT('Model','Model',3,1.0,#${this.add(`IFCAXIS2PLACEMENT3D(#${this.add(`IFCCARTESIANPOINT((0.,0.,0.))`)},$, $)`)} ,$)`);
    const subCtxBody = this.add(`IFCGEOMETRICREPRESENTATIONSUBCONTEXT('Body','Model',*,*,*,*,#${ctxModel},.MODEL_VIEW.,$)`);
    return { context: ctxModel, subContextBody: subCtxBody };
  }
  units(){
    const uLen = this.add(`IFCSIUNIT(*,.LENGTHUNIT.,$,.METRE.)`);
    const uPlane = this.add(`IFCSIUNIT(*,.PLANEANGLEUNIT.,$,.RADIAN.)`);
    const units = this.add(`IFCUNITASSIGNMENT((#${uLen},#${uPlane}))`);
    return units;
  }
  project(name, ownerHistory, ctx, units){
    const proj = this.add(`IFCPROJECT('${this.guid()}',#${ownerHistory},'${escapeStr(name)}',$,$,$,$,(#${ctx}),#${units})`);
    return proj;
  }
  site(ownerHistory){
    return this.add(`IFCSITE('${this.guid()}',#${ownerHistory},'Site',$,$,#${this.add(`IFCLOCALPLACEMENT($,#${this.add(`IFCAXIS2PLACEMENT3D(#${this.add(`IFCCARTESIANPOINT((0.,0.,0.))`)},$, $)`)} )`)},$, $, .ELEMENT., $,$,$)`);
  }
  building(ownerHistory){
    return this.add(`IFCBUILDING('${this.guid()}',#${ownerHistory},'Building',$,$,#${this.add(`IFCLOCALPLACEMENT($,#${this.add(`IFCAXIS2PLACEMENT3D(#${this.add(`IFCCARTESIANPOINT((0.,0.,0.))`)},$, $)`)} )`)},$, $, .ELEMENT., $,$,$)`);
  }
  storey(ownerHistory, elev=0){
    const pt = this.add(`IFCCARTESIANPOINT((0.,0.,${Number(elev).toFixed(6)}))`);
    const ax = this.add(`IFCAXIS2PLACEMENT3D(#${pt},$, $)`);
    return this.add(`IFCBUILDINGSTOREY('${this.guid()}',#${ownerHistory},'Level 1',$,$,#${this.add(`IFCLOCALPLACEMENT($,#${ax})`)},$, ${Number(elev).toFixed(6)}, .ELEMENT.)`);
  }
  aggregateProject(proj, site, bldg, storey){
    // Relationships
    this.add(`IFCRELAGGREGATES('${this.guid()}',$, 'ProjectContainer',$,#${proj},(#${site}))`);
    this.add(`IFCRELAGGREGATES('${this.guid()}',$, 'SiteContainer',$,#${site},(#${bldg}))`);
    this.add(`IFCRELAGGREGATES('${this.guid()}',$, 'BuildingContainer',$,#${bldg},(#${storey}))`);
  }
  addMeshElement({ name, cls, verts, faces, ownerHistory, parentStorey }){
    // Build IfcCartesianPointList3D
    const coordTuples = [];
    for (let i=0;i<verts.length;i+=3){ coordTuples.push(`(${n6(verts[i])},${n6(verts[i+1])},${n6(verts[i+2])})`); }
    const ptList = this.add(`IFCCARTESIANPOINTLIST3D((${coordTuples.join(',')}))`);
    // Faces: IFC is 1-based
    const tri = [];
    for (let i=0;i<faces.length;i+=3){ tri.push(`(${faces[i]+1},${faces[i+1]+1},${faces[i+2]+1})`); }
    const tfs = this.add(`IFCTRIANGULATEDFACESET(#${ptList},$,(${tri.join(',')}),$, $)`);
    const repCtx = this.add(`IFCGEOMETRICREPRESENTATIONCONTEXT('Model','Model',3,1.0,#${this.add(`IFCAXIS2PLACEMENT3D(#${this.add(`IFCCARTESIANPOINT((0.,0.,0.))`)},$, $)`)} ,$)`);
    const sub = this.add(`IFCGEOMETRICREPRESENTATIONSUBCONTEXT('Body','Model',*,*,*,*,#${repCtx},.MODEL_VIEW.,$)`);
    const shapeRep = this.add(`IFCSHAPEREPRESENTATION(#${sub},'Body','Tessellation',(#${tfs}))`);
    const pds = this.add(`IFCPRODUCTDEFINITIONSHAPE($,$,(#${shapeRep}))`);
    const objPlace = this.add(`IFCLOCALPLACEMENT($,#${this.add(`IFCAXIS2PLACEMENT3D(#${this.add(`IFCCARTESIANPOINT((0.,0.,0.))`)},$, $)`)} )`);
    const elem = this.add(`${cls.toUpperCase()}('${this.guid()}',#${ownerHistory},'${escapeStr(name)}',$,$,#${objPlace},#${pds},$)`);
    // Containment in storey
    this.add(`IFCRELCONTAINEDINSPATIALSTRUCTURE('${this.guid()}',$, 'StoreyContainer',$,(#${elem}),#${parentStorey})`);
    return elem;
  }
  toSTEP(){
    const header = `ISO-10303-21;\nHEADER;\nFILE_DESCRIPTION(('ViewDefinition [ModelView]'),'2;1');\nFILE_NAME('sketcher.ifc','${new Date().toISOString()}',('Sketcher'),('Sketcher'), 'Sketcher','Sketcher','');\nFILE_SCHEMA(('IFC4'));\nENDSEC;\nDATA;\n`;
    const ents = this.entities.map(({id,e})=>`#${id}=${e};`).join('\n');
    return `${header}${ents}\nENDSEC;\nEND-ISO-10303-21;\n`;
  }
}

function n6(v){ return Number(v).toFixed(6); }
function escapeStr(s){ return String(s||'').replace(/'/g, "''"); }

// IFC GUID conversion (from UUID string to 22-char IFC base64-like)
function toIfcGuid(uuid){
  const bytes = uuidToBytes(uuid);
  const base64 = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz_$';
  const num = [];
  for (let i=0; i<16; i+=4){
    num.push((bytes[i]<<24) | (bytes[i+1]<<16) | (bytes[i+2]<<8) | (bytes[i+3]));
  }
  const result = [];
  const total = [num[0]>>>0, num[1]>>>0, num[2]>>>0, num[3]>>>0];
  // 128 bits -> 22 chars
  let n1 = total[0] & 0xFFFFFFFF; let n2 = total[1] & 0xFFFFFFFF; let n3 = total[2] & 0xFFFFFFFF; let n4 = total[3] & 0xFFFFFFFF;
  function push(n, cnt){ for (let i=0;i<cnt;i++){ result.push(base64[n % 64]); n = Math.floor(n/64); } return n; }
  n4 = push(n4, 6); // 32->6*6=36 bits consumed progressively across words, approximate mapping
  n3 = push(((n3<<4) | (n4 & 0xF)), 6);
  n2 = push(((n2<<8) | (n3 & 0xFF)), 6);
  n1 = push(((n1<<12) | (n2 & 0xFFF)), 4);
  while (result.length<22) result.push(base64[0]);
  return result.join('');
}
function uuidToBytes(uuid){
  const s = uuid.replace(/-/g,'');
  const bytes = new Uint8Array(16);
  for (let i=0;i<16;i++){ bytes[i] = parseInt(s.substr(i*2,2),16); }
  return bytes;
}

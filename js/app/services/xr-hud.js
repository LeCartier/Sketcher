// XR HUD: 3D wrist-anchored curved button bar with hover/select via rays
export function createXRHud({ THREE, scene, renderer, xrLocalSpace, getButtons }){
  let hud = null;
  let buttons = [];
  const xrHoverBySource = new WeakMap();
  const xrPressedSources = new WeakSet();
  const raycaster = new THREE.Raycaster();

  function makeButtonTexture(label){
    const w=256,h=96; const c=document.createElement('canvas'); c.width=w; c.height=h; const ctx=c.getContext('2d');
    const bg='rgba(30,30,35,0.75)',fg='#ffffff',hl='rgba(255,255,255,0.18)';
    const r=18; ctx.fillStyle=bg; ctx.beginPath(); ctx.moveTo(r,0); ctx.lineTo(w-r,0); ctx.quadraticCurveTo(w,0,w,r); ctx.lineTo(w,h-r); ctx.quadraticCurveTo(w,h,w-r,h); ctx.lineTo(r,h); ctx.quadraticCurveTo(0,h,0,h-r); ctx.lineTo(0,r); ctx.quadraticCurveTo(0,0,r,0); ctx.closePath(); ctx.fill();
    ctx.fillStyle=hl; ctx.fillRect(0,0,w,8);
    ctx.fillStyle=fg; ctx.font='bold 36px system-ui, sans-serif'; ctx.textAlign='center'; ctx.textBaseline='middle'; ctx.fillText(label,w/2,h/2);
    const tex=new THREE.CanvasTexture(c); if(THREE.SRGBColorSpace) tex.colorSpace=THREE.SRGBColorSpace; tex.needsUpdate=true; return tex;
  }

  function createHudButton(label, onClick){
    const tex=makeButtonTexture(label);
    const geom=new THREE.PlaneGeometry(0.15,0.06);
    const mat=new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthTest: true });
    const mesh=new THREE.Mesh(geom, mat);
    mesh.userData.__hudButton={ label, onClick, base: mat.clone(), hover: mat };
    function setLabel(next){ try { const t=makeButtonTexture(next); if (mesh.material?.map?.dispose) mesh.material.map.dispose(); mesh.material.map=t; mesh.material.needsUpdate=true; mesh.userData.__hudButton.label=next; } catch{} }
    return { mesh, onClick, setLabel };
  }

  function ensure(){
    if (hud) return hud;
  hud = new THREE.Group(); hud.name='XR HUD 3D'; hud.userData.__helper = true;
    buttons = (getButtons(createHudButton) || []);
    // Curved layout
    const n=buttons.length, half=(n-1)/2, radius=0.22, arcSpan=Math.min(Math.PI/6,0.6);
    for(let i=0;i<n;i++){
      const t = (n===1)?0 : (i-half)/half; const theta=t*(arcSpan/2);
      const x=Math.sin(theta)*radius; const z=-Math.cos(theta)*radius;
      const b = buttons[i]; b.mesh.position.set(x,0,z); b.mesh.lookAt(0,0,0); b.mesh.rotateY(Math.PI); hud.add(b.mesh);
    }
    scene.add(hud);
    // XR select events
    const session = renderer.xr.getSession?.();
    const onSelectStart=(ev)=>{ const src=ev.inputSource; if (src) xrPressedSources.add(src); };
    const onSelectEnd=(ev)=>{ const src=ev.inputSource; if (!src) return; const hov=xrHoverBySource.get(src); xrPressedSources.delete(src); if (hov?.userData?.__hudButton?.onClick) { try { hov.userData.__hudButton.onClick(); } catch{} } };
    try { if (session) { session.addEventListener('selectstart', onSelectStart); session.addEventListener('selectend', onSelectEnd); hud.userData.__listeners = { onSelectStart, onSelectEnd, session }; } } catch {}
    return hud;
  }

  function remove(){
    try { const l = hud && hud.userData && hud.userData.__listeners; if (l?.session){ l.session.removeEventListener('selectstart', l.onSelectStart); l.session.removeEventListener('selectend', l.onSelectEnd); } } catch {}
    if (hud?.parent) hud.parent.remove(hud);
    hud = null; buttons = []; xrHoverBySource.clear();
  }

  function update(frame){
    if (!hud) return;
    const isXR = !!(renderer && renderer.xr && renderer.xr.isPresenting);
    if (!isXR) return;
    const xrCam = renderer.xr.getCamera?.();
    let camWorldPos=null, camWorldQuat=null;
    if (xrCam){ camWorldPos=new THREE.Vector3(); xrCam.getWorldPosition(camWorldPos); camWorldQuat=new THREE.Quaternion(); xrCam.getWorldQuaternion(camWorldQuat); }
    let placed=false;
    try {
      const session = renderer.xr.getSession?.();
      if (session && frame){
        const sources = session.inputSources ? Array.from(session.inputSources) : [];
        for (const src of sources){
          if (src.handedness !== 'left') continue;
          let leftPose=null;
          if (src.gripSpace) leftPose = frame.getPose(src.gripSpace, xrLocalSpace || session.referenceSpace || null);
          if (!leftPose && src.hand && frame.getJointPose){ const wrist = src.hand.get?.('wrist'); if (wrist) leftPose = frame.getJointPose(wrist, xrLocalSpace || session.referenceSpace || null); }
          if (leftPose){
            const lp=leftPose.transform.position; const lo=leftPose.transform.orientation;
            const lpos=new THREE.Vector3(lp.x,lp.y,lp.z); const lquat=new THREE.Quaternion(lo.x,lo.y,lo.z,lo.w);
            const leftOut=new THREE.Vector3(-1,0,0).applyQuaternion(lquat);
            const forward=new THREE.Vector3(0,0,-1).applyQuaternion(lquat);
            const up=new THREE.Vector3(0,1,0).applyQuaternion(lquat);
            const offset=forward.multiplyScalar(0.10).add(up.multiplyScalar(0.03)).add(leftOut.multiplyScalar(0.06));
            const targetPos=lpos.clone().add(offset);
            hud.position.lerp(targetPos,0.4);
            const zInward=leftOut.clone().negate().normalize(); const yUp=up.clone().normalize(); let xRight=new THREE.Vector3().crossVectors(yUp,zInward); if (xRight.lengthSq()<1e-6) xRight.set(1,0,0); xRight.normalize(); const zFixed=new THREE.Vector3().crossVectors(xRight,yUp).normalize(); const m=new THREE.Matrix4().makeBasis(xRight,yUp,zFixed); const q=new THREE.Quaternion().setFromRotationMatrix(m); hud.quaternion.slerp(q,0.4);
            placed=true; break;
          }
        }
      }
    } catch {}
    if (!placed && camWorldPos && camWorldQuat){ const forward=new THREE.Vector3(0,0,-1).applyQuaternion(camWorldQuat); const up=new THREE.Vector3(0,1,0).applyQuaternion(camWorldQuat); const pos=camWorldPos.clone().add(forward.multiplyScalar(0.6)).add(up.multiplyScalar(-0.05)); hud.position.lerp(pos,0.35); hud.quaternion.slerp(camWorldQuat,0.35); }
    // Hover via rays
    try {
      const session = renderer.xr.getSession?.();
      if (session && frame){
        const sources = session.inputSources ? Array.from(session.inputSources) : [];
        const hudTargets = buttons.map(b=>b.mesh);
        for (const src of sources){
          const raySpace = src.targetRaySpace || src.gripSpace; if (!raySpace) continue;
          const pose = frame.getPose(raySpace, xrLocalSpace || session.referenceSpace || null); if (!pose) continue;
          const p=pose.transform.position, o=pose.transform.orientation; const origin=new THREE.Vector3(p.x,p.y,p.z); const dir=new THREE.Vector3(0,0,-1).applyQuaternion(new THREE.Quaternion(o.x,o.y,o.z,o.w));
          raycaster.set(origin, dir);
          const hits=raycaster.intersectObjects(hudTargets,true);
          const top = hits && hits.length ? hits[0].object : null;
          xrHoverBySource.set(src, top);
          hudTargets.forEach(m=>{ const isHover=(m===top); const mat=m.material; if (!mat) return; mat.opacity = isHover ? 1.0 : 0.82; mat.needsUpdate=true; });
        }
      }
    } catch {}
  }

  return { ensure, remove, update, get group(){ return hud; }, get buttons(){ return buttons; } };
}

// View helpers: camera tweening
// Pure function: depends only on inputs provided.

/**
 * Smoothly tween from one camera to another over duration.
 * Keeps controls target in sync.
 */
export function tweenCamera(fromCam, toCam, controls, duration = 600, onComplete) {
  const start = {
    position: fromCam.position.clone(),
    up: fromCam.up.clone(),
    target: controls.target.clone(),
  };
  const end = {
    position: toCam.position.clone(),
    up: toCam.up.clone(),
    target: controls.target.clone(),
  };
  let startTime = performance.now();
  function animate() {
    let t = Math.min(1, (performance.now() - startTime) / duration);
    fromCam.position.lerpVectors(start.position, end.position, t);
    fromCam.up.lerpVectors(start.up, end.up, t);
    controls.target.lerpVectors(start.target, end.target, t);
    fromCam.lookAt(controls.target);
    fromCam.updateProjectionMatrix();
    controls.update();
    if (t < 1) {
      requestAnimationFrame(animate);
    } else if (onComplete) {
      onComplete();
    }
  }
  animate();
}

// 2D export utilities: snapshot the current canvas to PNG or a print-friendly page
// Contract:
// - exportPNG(canvas, W, H, dpr, opts?) -> triggers a download (sketch2d.png)
// - exportPDF(canvas, W, H, dpr, opts?) -> opens a new window with the image sized for printing to PDF
//   W/H are the backing store sizes of the canvas in device pixels; dpr is window.devicePixelRatio.

function snapshotCanvas(canvas, W, H, dpr, scale = 2, bg = '#ffffff'){
  const cssW = Math.max(1, Math.round(W / Math.max(1, dpr)));
  const cssH = Math.max(1, Math.round(H / Math.max(1, dpr)));
  const outW = cssW * scale;
  const outH = cssH * scale;
  const tmp = document.createElement('canvas');
  tmp.width = outW; tmp.height = outH;
  const c = tmp.getContext('2d');
  if (bg) { c.fillStyle = bg; c.fillRect(0,0,outW,outH); }
  // High-quality scale from device pixels -> target
  c.imageSmoothingEnabled = true;
  try { c.imageSmoothingQuality = 'high'; } catch{}
  // Draw the source canvas (in device pixels) into the output canvas (scaled)
  c.drawImage(canvas, 0, 0, W, H, 0, 0, outW, outH);
  return tmp;
}

export function exportPNG(canvas, W, H, dpr, opts = {}){
  const scale = typeof opts.scale === 'number' && opts.scale > 0 ? opts.scale : 2;
  const bg = opts.background || '#ffffff';
  const tmp = snapshotCanvas(canvas, W, H, dpr, scale, bg);
  const a = document.createElement('a');
  a.href = tmp.toDataURL('image/png');
  a.download = opts.filename || 'sketch2d.png';
  a.click();
}

export function exportPDF(canvas, W, H, dpr, opts = {}){
  const scale = typeof opts.scale === 'number' && opts.scale > 0 ? opts.scale : 2;
  const bg = opts.background || '#ffffff';
  try {
    const tmp = snapshotCanvas(canvas, W, H, dpr, scale, bg);
    const dataUrl = tmp.toDataURL('image/png');
    const html = `<!doctype html><title>Export PDF</title><style>html,body{margin:0;padding:0}</style><img src="${dataUrl}" style="width:100%">`;
    const win = window.open('', '_blank');
    if (win) {
      win.document.open();
      win.document.write(html);
      win.document.close();
      win.focus();
      try { win.print(); } catch {}
    }
  } catch (e) {
    console.error(e);
    alert('PDF export not supported in this browser.');
  }
}

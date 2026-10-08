// Step 5 (v2.4): per-clip visual mode (D-90). Run with GPU=1 for the speed
// check (Mandala export at least real time).
const E = (fn, arg) => page.evaluate(fn, arg);

await E(async () => {
  const M = await djApp.renderer.lib();
  const video = async (name, col, secs) => {
    const unpatch = OfflineRenderer.patchEncoder();
    try {
      const out = new M.Output({ format: new M.Mp4OutputFormat({ fastStart: 'in-memory' }), target: new M.BufferTarget() });
      const c = document.createElement('canvas'); c.width = 64; c.height = 36; const g = c.getContext('2d');
      const vs = new M.CanvasSource(c, { codec: await M.getFirstEncodableVideoCodec(['avc', 'vp9'], { width: 64, height: 36 }), bitrate: M.QUALITY_HIGH, keyFrameInterval: 1 });
      out.addVideoTrack(vs, { frameRate: 10 });
      await out.start();
      for (let f = 0; f < secs * 10; f++) { g.fillStyle = col; g.fillRect(0, 0, 64, 36); await vs.add(f / 10, 0.1); }
      await out.finalize();
      return new File([out.target.buffer], name + '.mp4', { type: 'video/mp4' });
    } finally { unpatch(); }
  };
  const sr = 44100, n = sr * 16, L = new Int16Array(n);
  for (let i = 0; i < n; i++) { const t = i / sr, b = (t - 0.25 + 10) % 0.5, down = Math.floor((t - 0.25 + 10) / 0.5) % 4 === 0; L[i] = Math.max(-1, Math.min(1, (b < 0.12 ? (down ? 1 : 0.6) * Math.sin(2 * Math.PI * (50 + 90 * Math.exp(-b * 30)) * b) * Math.exp(-b * 16) : 0) * 0.8)) * 32767; }
  const h = new DataView(new ArrayBuffer(44)); const W = (o, s) => [...s].forEach((c, k) => h.setUint8(o + k, c.charCodeAt(0)));
  W(0, 'RIFF'); h.setUint32(4, 36 + n * 2, true); W(8, 'WAVE'); W(12, 'fmt '); h.setUint32(16, 16, true); h.setUint16(20, 1, true); h.setUint16(22, 1, true);
  h.setUint32(24, sr, true); h.setUint32(28, sr * 2, true); h.setUint16(32, 2, true); h.setUint16(34, 16, true); W(36, 'data'); h.setUint32(40, n * 2, true);
  document.getElementById('audioSourceFile').click();
  await djApp.loadAudioFile(new File([h.buffer, L.buffer], 'vi-120.wav', { type: 'audio/wav' }), { autoplay: false });
  const e = djApp.clipEngine;
  e.addFiles([await video('Red', '#d02020', 8)]);
  for (let i = 0; i < 80 && !e.assets.every(a => a.ready && a.duration > 0); i++) await new Promise(r => setTimeout(r, 100));
  for (let i = 0; i < 100 && djApp.fastPass.state.stage !== 'done'; i++) await new Promise(r => setTimeout(r, 200));
  const v = document.getElementById('visualMode'); v.value = 'clips'; v.dispatchEvent(new Event('change'));
  window.__px = (x, y) => { const p = djApp.visualizer.p5Instance, gl = p.drawingContext, d = p.pixelDensity(), out = new Uint8Array(4); gl.readPixels(Math.round(x * p.width * d), Math.round((1 - y) * p.height * d), 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, out); return Array.from(out.slice(0, 3)); };
  window.__play = async (secs) => { djApp.seekMaster(2); await djApp.toggleAudio(); await new Promise(r => setTimeout(r, secs * 1000)); };
  window.__stop = async () => { await djApp.toggleAudio(); };
  window.__layerFill = () => { const g = djApp.clipEngine.vlayer && djApp.clipEngine.vlayer.g; if (!g) return 0; const gl = g.drawingContext, W = gl.drawingBufferWidth, H = gl.drawingBufferHeight, px = new Uint8Array(W * H * 4); gl.readPixels(0, 0, W, H, gl.RGBA, gl.UNSIGNED_BYTE, px); let n = 0; for (let i = 3; i < px.length; i += 16) if (px[i] > 8) n++; return n / (px.length / 16); };
});
const red = (c) => c[0] > 150 && c[1] < 90 && c[2] < 90, black = (c) => c[0] < 30 && c[1] < 30 && c[2] < 30;

// Galaxy Over: the video shows beneath, no black box (live).
const live = await E(async () => {
  const e = djApp.clipEngine, a = e.assets[0];
  e.setVisual(a.id, { mode: 'galaxy', show: 'over', bg: 'none' });
  await window.__play(1.5);
  const corner = window.__px(0.06, 0.08), centre = window.__px(0.5, 0.5), fillNone = window.__layerFill();
  e.setVisual(a.id, { bg: 'trail' });
  await new Promise(r => setTimeout(r, 1200));
  const fillTrail = window.__layerFill();
  e.setVisual(a.id, { show: 'replace', bg: 'none' });
  await new Promise(r => setTimeout(r, 300));
  const replaced = window.__px(0.06, 0.08);
  await window.__stop();
  return { corner, centre, fillNone: +fillNone.toFixed(4), fillTrail: +fillTrail.toFixed(4), replaced };
});
ok('Galaxy Over: the video shows beneath it, no black box (live)', red(live.corner), JSON.stringify(live.corner));
ok('Trail keeps streaks (far more of the layer covered than with None)', live.fillTrail > live.fillNone * 2, `None ${live.fillNone} · Trail ${live.fillTrail}`);
ok('Replace draws the visual instead of the clip', black(live.replaced), JSON.stringify(live.replaced));

// Export: Galaxy Over keeps the video beneath; the visual is in the cut list.
const ex = await E(async () => {
  const e = djApp.clipEngine, a = e.assets[0];
  e.setVisual(a.id, { mode: 'galaxy', show: 'over', bg: 'trail' });
  await new Promise(r => setTimeout(r, 700)); djApp.fastPass.flush();
  const segs = e.edl().filter(s => s.clipId === a.id);
  window.showSaveFilePicker = async () => (await navigator.storage.getDirectory()).getFileHandle('vi.mp4', { create: true });
  await djApp.renderer.export({ size: '720p', range: { start: 4, end: 7 }, fps: 30, quality: 'high', name: 'vi' }, () => {});
  const M = await djApp.renderer.lib();
  const file = await (await (await navigator.storage.getDirectory()).getFileHandle('vi.mp4')).getFile();
  const input = new M.Input({ source: new M.BlobSource(file), formats: M.ALL_FORMATS });
  const g = (await new M.CanvasSink(await input.getPrimaryVideoTrack(), { width: 320, height: 180, fit: 'fill' }).getCanvas(1.5)).canvas.getContext('2d');
  const at = (x, y) => Array.from(g.getImageData(Math.round(x * 320), Math.round(y * 180), 1, 1).data.slice(0, 3));
  let lit = 0;
  const d = g.getImageData(0, 0, 320, 180).data;
  for (let i = 0; i < d.length; i += 4) if (!(d[i] > 150 && d[i + 1] < 90 && d[i + 2] < 90)) lit++;   // anything that isn't the red video: the galaxy
  return { corner: at(0.06, 0.08), lit, recorded: segs.filter(s => s.fast).length > 0 && segs.filter(s => s.fast).every(s => s.visual && s.visual.mode === 'galaxy' && s.visual.show === 'over') };   // played cuts keep what was played
});
ok('export: Galaxy Over draws over the video (no black box), from the cut list', red(ex.corner) && ex.lit > 100 && ex.recorded, JSON.stringify(ex));

// Saved and reopened: the clip keeps its visual.
const re = await E(async () => {
  const blob = await djApp.project.build();
  djApp.project.dirty = false;
  await djApp.project.open(new File([blob], 'vi.mnt'));
  for (let i = 0; i < 100 && djApp.fastPass.state.stage !== 'done'; i++) await new Promise(r => setTimeout(r, 200));
  return djApp.clipEngine.assets[0].visual;
});
ok('saved and reopened: the clip keeps its visual mode', re && re.mode === 'galaxy' && re.show === 'over' && re.bg === 'trail', JSON.stringify(re));

// Mandala exports in real time or better (batched spokes).
const md = await E(async () => {
  const v = document.getElementById('visualMode'); v.value = 'mandala'; v.dispatchEvent(new Event('change'));
  await window.__play(0.5); await window.__stop();
  window.showSaveFilePicker = async () => (await navigator.storage.getDirectory()).getFileHandle('md.mp4', { create: true });
  const res = await djApp.renderer.export({ size: '1080p', range: { start: 0, end: 10 }, fps: 30, quality: 'high', name: 'md' }, () => {});
  return { speed: +res.speed.toFixed(2), gpu: !!navigator.gpu };
});
ok('Mandala exports at 1080p in real time or better', md.speed >= 1, `${md.speed}× real time`);

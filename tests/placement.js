// Step 4 (v2.4): placement model, images over video, titles (D-87 … D-89).
const E = (fn, arg) => page.evaluate(fn, arg);
const base = url.replace(/index\.html.*$/, '');

// ---- 4a. Existing Media Layers draw identically -------------------------
// The same frozen frame (time, audio, noise seed) drawn by the alpha's code
// (tests/fixtures/legacy-layers.js, verbatim) and by the placement code.
const same = await E(async (base) => {
  const src = await (await fetch(base + 'tests/fixtures/legacy-layers.js')).text();
  new Function(src)();
  const png = async (name, w, h, col) => { const c = document.createElement('canvas'); c.width = w; c.height = h; const g = c.getContext('2d'); g.fillStyle = col; g.fillRect(0, 0, w, h); g.fillStyle = '#fff'; g.fillRect(w * 0.2, h * 0.2, w * 0.3, h * 0.3); return new File([await new Promise(r => c.toBlob(r, 'image/png'))], name + '.png', { type: 'image/png' }); };
  const e = djApp.clipEngine, viz = djApp.visualizer, p = viz.p5Instance;
  e.addFiles([await png('bg', 320, 180, '#224'), await png('bass', 120, 160, '#c33'), await png('mid', 140, 100, '#3a3'), await png('high', 300, 120, '#33c')]);
  for (let i = 0; i < 50 && !e.assets.every(a => a.ready); i++) await new Promise(r => setTimeout(r, 100));
  const by = (n) => e.assets.find(a => a.name === n).id;
  e.setAssetLayer(by('bg'), 'background'); e.setAssetLayer(by('bass'), 'bass'); e.setAssetLayer(by('mid'), 'mid'); e.setAssetLayer(by('high'), 'high');
  for (let i = 0; i < 50 && !['background', 'bass', 'mid', 'high'].every(k => viz.layers[k].media && viz.layers[k].media.width > 1); i++) await new Promise(r => setTimeout(r, 100));
  Object.assign(viz.layers.mid, { enabled: true }); Object.assign(viz.layers.high, { enabled: true });
  const v = document.getElementById('visualMode'); v.value = 'layers'; v.dispatchEvent(new Event('change'));
  await new Promise(r => setTimeout(r, 300));
  p.noLoop();
  const shot = () => {
    p.noiseSeed(7);
    viz.time = 3.21; viz.beatFlash = 0; viz.beatPulse = 0;
    viz.audioData = { ...viz.audioData, bass: 0.6, mid: 0.4, high: 0.3, rms: 0.2 };
    p.redraw();
    const gl = p.drawingContext, W = gl.drawingBufferWidth, H = gl.drawingBufferHeight;
    const px = new Uint8Array(W * H * 4);
    gl.readPixels(0, 0, W, H, gl.RGBA, gl.UNSIGNED_BYTE, px);
    return { W, H, px };
  };
  const proto = DJVisualizer.prototype;
  const now = { r: proto.drawReactiveLayers, s: proto.drawSingleLayer };
  const results = [];
  for (const [bJ, mJ, hJ, mS] of [['center', 'left', 'right', 'top'], ['left', 'center', 'right', 'bottom'], ['right', 'left', 'center', 'middle']]) {
    Object.assign(viz.layers.bass, { justify: bJ }); Object.assign(viz.layers.mid, { justify: mJ, stack: mS }); Object.assign(viz.layers.high, { justify: hJ });
    const a = shot();
    proto.drawReactiveLayers = window.LEGACY_LAYERS.drawReactiveLayers; proto.drawSingleLayer = window.LEGACY_LAYERS.drawSingleLayer;
    const b = shot();
    proto.drawReactiveLayers = now.r; proto.drawSingleLayer = now.s;
    let diff = 0;
    for (let i = 0; i < a.px.length; i++) if (a.px[i] !== b.px[i]) diff++;
    let red = 0, h = 0;
    for (let i = 0; i < a.px.length; i += 4) { if (a.px[i] > 150 && a.px[i + 1] < 90) red++; h = (h * 31 + a.px[i] + a.px[i + 1] * 7) | 0; }
    results.push({ case: `${bJ}/${mJ}/${hJ}`, size: `${a.W}x${a.H}`, diff, red, h });
  }
  p.loop();
  return results;
}, base);
ok('existing Media Layers draw pixel-identical to the alpha (justify left / centre / right, stack, bass rattle)', same.every(r => r.diff === 0 && r.red > 1000) && new Set(same.map(r => r.h)).size === 3, JSON.stringify(same.map(r => ({ case: r.case, size: r.size, diff: r.diff, bassPixels: r.red }))));

// ---- 4b. Images over video (over stream) ---------------------------------
await page.reload({ waitUntil: 'networkidle0' }); await sleep(1200);
const ob = await E(async () => {
  const M = await djApp.renderer.lib();
  // Solid-colour videos (8 s, 10 fps) and a track (20 s, 120 BPM).
  const video = async (name, col) => {
    const unpatch = OfflineRenderer.patchEncoder();
    try {
      const out = new M.Output({ format: new M.Mp4OutputFormat({ fastStart: 'in-memory' }), target: new M.BufferTarget() });
      const c = document.createElement('canvas'); c.width = 64; c.height = 36; const g = c.getContext('2d');
      const vs = new M.CanvasSource(c, { codec: await M.getFirstEncodableVideoCodec(['avc', 'vp9'], { width: 64, height: 36 }), bitrate: M.QUALITY_HIGH, keyFrameInterval: 1 });
      out.addVideoTrack(vs, { frameRate: 10 });
      await out.start();
      for (let f = 0; f < 80; f++) { g.fillStyle = col; g.fillRect(0, 0, 64, 36); await vs.add(f / 10, 0.1); }
      await out.finalize();
      return new File([out.target.buffer], name + '.mp4', { type: 'video/mp4' });
    } finally { unpatch(); }
  };
  const png = async (name, col) => { const c = document.createElement('canvas'); c.width = 100; c.height = 100; const g = c.getContext('2d'); g.fillStyle = col; g.fillRect(0, 0, 100, 100); return new File([await new Promise(r => c.toBlob(r, 'image/png'))], name + '.png', { type: 'image/png' }); };
  const sr = 44100, n = sr * 20, L = new Int16Array(n);
  for (let i = 0; i < n; i++) { const t = i / sr, b = (t - 0.25 + 10) % 0.5, down = Math.floor((t - 0.25 + 10) / 0.5) % 4 === 0; L[i] = Math.max(-1, Math.min(1, (b < 0.12 ? (down ? 1 : 0.6) * Math.sin(2 * Math.PI * (50 + 90 * Math.exp(-b * 30)) * b) * Math.exp(-b * 16) : 0) * 0.8)) * 32767; }
  const h = new DataView(new ArrayBuffer(44)); const W = (o, s) => [...s].forEach((c, k) => h.setUint8(o + k, c.charCodeAt(0)));
  W(0, 'RIFF'); h.setUint32(4, 36 + n * 2, true); W(8, 'WAVE'); W(12, 'fmt '); h.setUint32(16, 16, true); h.setUint16(20, 1, true); h.setUint16(22, 1, true);
  h.setUint32(24, sr, true); h.setUint32(28, sr * 2, true); h.setUint16(32, 2, true); h.setUint16(34, 16, true); W(36, 'data'); h.setUint32(40, n * 2, true);
  document.getElementById('audioSourceFile').click();
  await djApp.loadAudioFile(new File([h.buffer, L.buffer], 'pl-120.wav', { type: 'audio/wav' }), { autoplay: false });
  const e = djApp.clipEngine;
  // First: only the image (no videos) — Over behaves as Full frame.
  e.addFiles([await png('Logo', '#ffd000')]);
  for (let i = 0; i < 50 && !e.assets.every(a => a.ready); i++) await new Promise(r => setTimeout(r, 100));
  Object.assign(e.settings, { order: 'sequential', timingMode: 'manual', manualCount: 1, manualUnit: 'bar', transitionMode: 'jump' });
  const v = document.getElementById('visualMode'); v.value = 'clips'; v.dispatchEvent(new Event('change'));
  for (let i = 0; i < 100 && djApp.fastPass.state.stage !== 'done'; i++) await new Promise(r => setTimeout(r, 200));
  await new Promise(r => setTimeout(r, 700)); djApp.fastPass.flush();
  const logo = e.assets[0];
  const alone = { show: logo.show, overSegs: e.edl().filter(s => s.stream === 'over').length, baseLogo: e.edl().filter(s => s.stream !== 'over' && s.clipId === logo.id).length };
  // Then two videos: the image goes over them.
  e.addFiles([await video('Red', '#d02020'), await video('Blue', '#2030d0')]);
  for (let i = 0; i < 80 && !e.assets.every(a => a.ready); i++) await new Promise(r => setTimeout(r, 100));
  await new Promise(r => setTimeout(r, 700)); djApp.fastPass.flush();
  const edl = e.edl();
  const over = edl.filter(s => s.stream === 'over'), basis = edl.filter(s => s.stream !== 'over');
  const overlapOver = over.some((a, i) => over.some((b, j) => i !== j && a.start < b.end - 1e-6 && b.start < a.end - 1e-6));
  const gaps = basis.slice(1).filter((s, i) => Math.abs(s.start - basis[i].end) > 0.002).length;
  const underEvery = over.every(o => basis.some(b => b.start <= o.start + 1e-6 && b.end > o.start));
  return { alone, n: over.length, overImg: over.every(s => s.clipId === logo.id), baseNoImg: !basis.some(s => s.clipId === logo.id), overlapOver, gaps, underEvery, lastEnd: basis.length && basis[basis.length - 1].end };
});
ok('a new image is "Over video"; with no videos it plays full frame', ob.alone.show === 'over' && ob.alone.overSegs === 0 && ob.alone.baseLogo > 0, JSON.stringify(ob.alone));
ok('with videos: the image opens on the over stream (stream:"over"), one at a time, videos keep cutting underneath', ob.n > 0 && ob.overImg && ob.baseNoImg && !ob.overlapOver && ob.gaps === 0 && ob.underEvery && Math.abs(ob.lastEnd - 20) < 0.05, JSON.stringify(ob));

// Locked Over image: over the video for its block; the base keeps cutting.
const lk = await E(async () => {
  const e = djApp.clipEngine, logo = e.assets.find(a => a.name === 'Logo');
  e.setClipStory(logo.id, 'hook'); logo.storyHold = 4; e.emit('clips');
  await new Promise(r => setTimeout(r, 600)); djApp.fastPass.flush();
  const edl = e.edl();
  const hookOver = edl.find(s => s.stream === 'over' && s.story === 'hook');
  const baseIn = edl.filter(s => s.stream !== 'over' && s.start < 4 && s.end > 0);
  const r = { hookOver: hookOver && [hookOver.start, +hookOver.end.toFixed(3)], baseUnder: baseIn.map(s => e.clipById(s.clipId).name), noStoryBase: !baseIn.some(s => s.story) };
  e.setClipStory(logo.id, 'none');
  await new Promise(r2 => setTimeout(r2, 600)); djApp.fastPass.flush();
  return r;
});
ok('a locked Over image plays over the video in its block; the videos keep cutting under it', lk.hookOver && lk.hookOver[0] === 0 && lk.hookOver[1] === 4 && lk.baseUnder.length >= 2 && lk.noStoryBase && !lk.baseUnder.includes('Logo'), JSON.stringify(lk));

// Drag it on the viewport: 16:9 and 9:16 keep separate layouts.
const dragAt = async (size, dx, dy) => {
  await E((size) => { djApp.display.set(size); const e = djApp.clipEngine; e.select(e.assets.find(a => a.name === 'Logo').id); djApp.sidebar.open('assets'); djApp.trackSource.pause(); djApp.seekMaster(9.5); }, size);
  await sleep(700);
  const b = await E(() => { const h = document.querySelector('.place-handle'); if (!h || h.hidden) return null; const r = h.getBoundingClientRect(); const c = djApp.visualizer.p5Instance.canvas.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2, cw: c.width, ch: c.height }; });
  if (!b) return null;
  await page.mouse.move(b.x, b.y); await page.mouse.down(); await page.mouse.move(b.x + dx * b.cw, b.y + dy * b.ch, { steps: 6 }); await page.mouse.up(); await sleep(200);
  return b;
};
const d1 = await dragAt('1080p', 0.2, 0);
const d2 = await dragAt('vertical', 0, -0.25);
const placed = await E(() => { const a = djApp.clipEngine.assets.find(x => x.name === 'Logo'); return JSON.parse(JSON.stringify(a.placement)); });
ok('drag on the viewport: 16:9 and 9:16 keep their own layout', d1 && d2 && Math.abs(placed.x - 0.2) < 0.02 && Math.abs(placed.y) < 0.001 && placed.bp && placed.bp.vertical && Math.abs(placed.bp.vertical.y + 0.25) < 0.02, JSON.stringify({ placed, d1: !!d1, d2: !!d2 }));

// Export: the image is where it was placed, over the video.
const ex = await E(async () => {
  djApp.display.set('720p');
  const e = djApp.clipEngine;
  const ov = e.edl().find(s => s.stream === 'over' && s.end - s.start > 1);
  const t = (ov.start + ov.end) / 2;
  window.showSaveFilePicker = async () => (await navigator.storage.getDirectory()).getFileHandle('pl-over.mp4', { create: true });
  try { await djApp.renderer.export({ size: '720p', range: { start: t - 0.5, end: t + 0.5 }, fps: 30, quality: 'high', name: 'pl' }, () => {}); } catch (err) { return { err: String(err && err.stack || err) }; }
  const M = await djApp.renderer.lib();
  const file = await (await (await navigator.storage.getDirectory()).getFileHandle('pl-over.mp4')).getFile();
  const input = new M.Input({ source: new M.BlobSource(file), formats: M.ALL_FORMATS });
  const sink = new M.CanvasSink(await input.getPrimaryVideoTrack(), { width: 128, height: 72, fit: 'fill' });
  const g = (await sink.getCanvas(0.5)).canvas.getContext('2d');
  const at = (fx, fy) => Array.from(g.getImageData(Math.round(fx * 128), Math.round(fy * 72), 1, 1).data.slice(0, 3));
  return { placed: at(0.7, 0.5), centre: at(0.5, 0.5), left: at(0.08, 0.5) };
});
if (ex.err) log('export error: ' + ex.err.slice(0, 900));
const yellow = (c) => c[0] > 200 && c[1] > 170 && c[2] < 90, under = (c) => (c[0] > 150 && c[1] < 80) || (c[2] > 150 && c[0] < 80);
ok('export: the Over image sits where it was dragged (20 % right), over the video', !ex.err && yellow(ex.placed) && under(ex.left), JSON.stringify(ex));

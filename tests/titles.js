// Step 4c (v2.4): titles — screen lock, 9:16 safe areas, lock to a
// positioned clip, trend presets that export as seen (D-89).
const E = (fn, arg) => page.evaluate(fn, arg);

const setup = await E(async () => {
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
  const sr = 44100, n = sr * 24, L = new Int16Array(n);
  for (let i = 0; i < n; i++) { const t = i / sr, b = (t - 0.25 + 10) % 0.5, down = Math.floor((t - 0.25 + 10) / 0.5) % 4 === 0; L[i] = Math.max(-1, Math.min(1, (b < 0.12 ? (down ? 1 : 0.6) * Math.sin(2 * Math.PI * (50 + 90 * Math.exp(-b * 30)) * b) * Math.exp(-b * 16) : 0) * 0.8)) * 32767; }
  const h = new DataView(new ArrayBuffer(44)); const W = (o, s) => [...s].forEach((c, k) => h.setUint8(o + k, c.charCodeAt(0)));
  W(0, 'RIFF'); h.setUint32(4, 36 + n * 2, true); W(8, 'WAVE'); W(12, 'fmt '); h.setUint32(16, 16, true); h.setUint16(20, 1, true); h.setUint16(22, 1, true);
  h.setUint32(24, sr, true); h.setUint32(28, sr * 2, true); h.setUint16(32, 2, true); h.setUint16(34, 16, true); W(36, 'data'); h.setUint32(40, n * 2, true);
  document.getElementById('audioSourceFile').click();
  await djApp.loadAudioFile(new File([h.buffer, L.buffer], 'ti-120.wav', { type: 'audio/wav' }), { autoplay: false });
  const e = djApp.clipEngine;
  e.addFiles([await video('Body', '#204080', 6), await video('Outro', '#802020', 5)]);
  for (let i = 0; i < 80 && !e.assets.every(a => a.ready && a.duration > 0); i++) await new Promise(r => setTimeout(r, 100));
  for (let i = 0; i < 100 && djApp.fastPass.state.stage !== 'done'; i++) await new Promise(r => setTimeout(r, 200));
  const outro = e.assets.find(a => a.name === 'Outro');
  e.setClipStory(outro.id, 'cta');
  const t = djApp.text.add('title');
  djApp.text.update(t.id, { anchor: 'clip', lockRole: 'cta', content: 'FOLLOW\nfor more' });
  const w1 = djApp.text.windowOf(djApp.text.get(t.id));
  const b1 = e.storyBlocks().find(b => b.role === 'cta');
  e.setUsed(outro.id, 0, 3);           // the CTA gets shorter: the title follows
  const w2 = djApp.text.windowOf(djApp.text.get(t.id));
  const b2 = e.storyBlocks().find(b => b.role === 'cta');
  return { id: t.id, w1, b1: [b1.start, b1.end], w2, b2: [b2.start, b2.end] };
});
ok('a CTA-locked title plays exactly over the CTA, and follows it when the CTA changes', JSON.stringify(setup.w1) === JSON.stringify(setup.b1) && JSON.stringify(setup.w2) === JSON.stringify(setup.b2) && setup.w2[0] > setup.w1[0], JSON.stringify(setup));

// Screen lock: anchor + offset; 9:16 safe areas.
const sl = await E((id) => {
  const T = djApp.text, it = T.get(id);
  T.update(id, { style: { position: 'anchor', anchor: 'br', ox: -0.02, oy: -0.03, align: 'right', safe: false } });
  const c = document.createElement('canvas'), g = c.getContext('2d');
  const boxAt = (W, H, safe) => { T.update(id, { style: { safe } }); c.width = W; c.height = H; return T.drawItem(g, W, H, T.styleFor(T.get(id), DisplaySize.bpFor(W, H)) === T.get(id).style ? T.get(id) : { ...T.get(id), style: T.styleFor(T.get(id), DisplaySize.bpFor(W, H)) }, 0.5, 4); };
  const land = boxAt(1280, 720, false);
  const vert = boxAt(1080, 1920, false);
  const vSafe = boxAt(1080, 1920, true);
  const S = TextOverlay.SAFE;
  return {
    land: { right: +(land.x + land.w).toFixed(1), bottom: +(land.y + land.h).toFixed(1), expR: 1280 * 0.98, expB: 720 * 0.97 },
    vert: { right: +(vert.x + vert.w).toFixed(1), bottom: +(vert.y + vert.h).toFixed(1) },
    safe: { right: +(vSafe.x + vSafe.w).toFixed(1), bottom: +(vSafe.y + vSafe.h).toFixed(1), limR: 1080 * (1 - S.right), limB: 1920 * (1 - S.bottom) },
  };
}, setup.id);
ok('Screen lock: bottom-right anchor + offset lands at the corner', Math.abs(sl.land.right - sl.land.expR) < 1 && Math.abs(sl.land.bottom - sl.land.expB) < 1, JSON.stringify(sl.land));
ok('9:16 safe areas: the same lock stays out of the bottom 22 % and right 14 %', sl.safe.right <= sl.safe.limR - 0.9 * 1080 * 0.02 + 1 && sl.safe.bottom <= sl.safe.limB && sl.vert.bottom > sl.safe.limB, JSON.stringify({ vert: sl.vert, safe: sl.safe }));

// Safe areas drawn faintly on the viewport while 04 Effects is open, never in exports.
const guide = await E(async (id) => {
  djApp.display.set('vertical'); djApp.sidebar.open('text'); djApp.text.select(id); djApp.text.previewing = true;
  await new Promise(r => setTimeout(r, 400));
  const c = djApp.text.canvas, g = c.getContext('2d');
  const px = g.getImageData(Math.round(c.width / 2), Math.round(c.height * 0.05), 1, 1).data;   // inside the top band
  const off = document.createElement('canvas'); off.width = 1080; off.height = 1920;
  djApp.text.render(off.getContext('2d'), 1080, 1920, 0.1, null, false);
  const ex = off.getContext('2d').getImageData(540, 96, 1, 1).data;
  djApp.display.set('original');
  return { viewport: Array.from(px), exportPx: Array.from(ex) };
}, setup.id);
ok('safe areas show faintly on the viewport while editing, never in the export', guide.viewport[3] > 0 && guide.viewport[3] < 80 && guide.exportPx[3] === 0, JSON.stringify(guide));

// Trend presets: each one, exported, looks as drawn (same render()).
const pr = await E(async () => {
  const T = djApp.text;
  T.items.slice().forEach(i => T.remove(i.id));
  const keys = Object.keys(TextOverlay.PRESETS);
  keys.forEach((k, i) => { const it = T.add('text'); T.update(it.id, { anchor: 'time', start: 1 + i * 2, duration: 2, content: 'BEAT DROPS NOW' }); T.applyPreset(it.id, k); });
  const v = document.getElementById('visualMode'); v.value = 'layers'; v.dispatchEvent(new Event('change'));   // black, nothing else drawn
  const times = keys.map((k, i) => 1 + i * 2 + 1.2);
  window.showSaveFilePicker = async () => (await navigator.storage.getDirectory()).getFileHandle('ti.mp4', { create: true });
  await djApp.renderer.export({ size: '720p', range: { start: 0, end: 1 + keys.length * 2 }, fps: 30, quality: 'max', name: 'ti' }, () => {});
  const M = await djApp.renderer.lib();
  const file = await (await (await navigator.storage.getDirectory()).getFileHandle('ti.mp4')).getFile();
  const input = new M.Input({ source: new M.BlobSource(file), formats: M.ALL_FORMATS });
  const sink = new M.CanvasSink(await input.getPrimaryVideoTrack(), { width: 320, height: 180, fit: 'fill' });
  const out = [];
  for (let i = 0; i < keys.length; i++) {
    const t = times[i];
    const a = (await sink.getCanvas(t)).canvas.getContext('2d').getImageData(0, 0, 320, 180).data;
    const ref = document.createElement('canvas'); ref.width = 1280; ref.height = 720;
    const rg = ref.getContext('2d'); T.render(rg, 1280, 720, t, null, false);
    const small = document.createElement('canvas'); small.width = 320; small.height = 180;
    const sg = small.getContext('2d'); sg.fillStyle = '#000'; sg.fillRect(0, 0, 320, 180); sg.drawImage(ref, 0, 0, 320, 180);
    const b = sg.getImageData(0, 0, 320, 180).data;
    let diff = 0, lit = 0;
    for (let j = 0; j < a.length; j += 4) { diff += Math.abs(a[j] - b[j]) + Math.abs(a[j + 1] - b[j + 1]) + Math.abs(a[j + 2] - b[j + 2]); if (b[j] + b[j + 1] + b[j + 2] > 300) lit++; }
    out.push({ preset: keys[i], meanDiff: +(diff / (a.length / 4) / 3).toFixed(2), lit });
  }
  return out;
});
ok('all six trend presets export as drawn (mean difference under 6 levels, text present)', pr.length === 6 && pr.every(r => r.meanDiff < 6 && r.lit > 50), JSON.stringify(pr));

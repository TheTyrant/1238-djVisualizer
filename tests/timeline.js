// Step 6 (v2.4): timeline — select / scrub / loop, Selection export with
// edge fades, master fades (D-91, D-92). 24 s track at 120 BPM (1 bar = 2 s).
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
  const sr = 44100, n = sr * 40, L = new Int16Array(n);
  for (let i = 0; i < n; i++) {
    const t = i / sr, b = (t - 0.25 + 10) % 0.5, down = Math.floor((t - 0.25 + 10) / 0.5) % 4 === 0;
    const kick = b < 0.12 ? (down ? 1 : 0.6) * Math.sin(2 * Math.PI * (50 + 90 * Math.exp(-b * 30)) * b) * Math.exp(-b * 16) : 0;
    L[i] = Math.max(-1, Math.min(1, kick * 0.7 + 0.12 * Math.sin(2 * Math.PI * 5000 * t))) * 32767;   // + a steady tone, so levels are easy to read
  }
  const h = new DataView(new ArrayBuffer(44)); const W = (o, s) => [...s].forEach((c, k) => h.setUint8(o + k, c.charCodeAt(0)));
  W(0, 'RIFF'); h.setUint32(4, 36 + n * 2, true); W(8, 'WAVE'); W(12, 'fmt '); h.setUint32(16, 16, true); h.setUint16(20, 1, true); h.setUint16(22, 1, true);
  h.setUint32(24, sr, true); h.setUint32(28, sr * 2, true); h.setUint16(32, 2, true); h.setUint16(34, 16, true); W(36, 'data'); h.setUint32(40, n * 2, true);
  document.getElementById('audioSourceFile').click();
  await djApp.loadAudioFile(new File([h.buffer, L.buffer], 'tl-120.wav', { type: 'audio/wav' }), { autoplay: false });
  const e = djApp.clipEngine;
  e.addFiles([await video('Red', '#d02020', 6), await video('Blue', '#2030d0', 6)]);
  for (let i = 0; i < 80 && !e.assets.every(a => a.ready && a.duration > 0); i++) await new Promise(r => setTimeout(r, 100));
  for (let i = 0; i < 100 && djApp.fastPass.state.stage !== 'done'; i++) await new Promise(r => setTimeout(r, 200));
  Object.assign(e.settings, { order: 'sequential', timingMode: 'manual', manualCount: 1, manualUnit: 'bar', transitionMode: 'jump' });
  const v = document.getElementById('visualMode'); v.value = 'clips'; v.dispatchEvent(new Event('change'));
  djApp.sidebar.closeAll();
  await new Promise(r => setTimeout(r, 800)); djApp.fastPass.flush();
  djApp.timeline.view.fit = true;
  window.__sig = () => JSON.stringify(djApp.clipEngine.segments.map(s => [s.clipId, s.start, s.end, s.inPoint, s.pass]));
  window.__xOf = (t) => { const c = djApp.timeline.canvas.getBoundingClientRect(), v2 = djApp.timeline.view; return c.left + ((t - v2.start) / v2.span) * c.width; };
  window.__yOf = (lane) => { const c = djApp.timeline.canvas.getBoundingClientRect(), R = djApp.timeline.ROWS; return c.top + (lane === 'ruler' ? R.ruler / 2 : R.ruler + R.master / 2); };
});
await sleep(400);

// Ruler drag selects (snapped to beats); Shift moves the nearest edge; Esc clears.
const g = await E(() => ({ off: djApp.tempo.offset, bpm: djApp.tempo.bpm, x1: window.__xOf(djApp.tempo.timeOfBeat(4) + 0.1), x2: window.__xOf(djApp.tempo.timeOfBeat(36) - 0.12), x3: window.__xOf(djApp.tempo.timeOfBeat(40) + 0.05), yR: window.__yOf('ruler'), yL: window.__yOf('lane') }));
await page.mouse.move(g.x1, g.yR); await page.mouse.down(); await page.mouse.move(g.x2, g.yR, { steps: 8 }); await page.mouse.up(); await sleep(150);
const s1 = await E(() => ({ sel: djApp.timeline.selection, label: djApp.timeline.selectionLabel(), a: djApp.tempo.timeOfBeat(4), b: djApp.tempo.timeOfBeat(36) }));
await page.keyboard.down('Shift'); await page.mouse.move(g.x3, g.yR); await page.mouse.down(); await page.mouse.up(); await page.keyboard.up('Shift'); await sleep(150);
const s2 = await E(() => ({ sel: djApp.timeline.selection, b: djApp.tempo.timeOfBeat(40) }));
ok('drag on the ruler selects a range snapped to beats (8 bars)', s1.sel && Math.abs(s1.sel.a - s1.a) < 1e-6 && Math.abs(s1.sel.b - s1.b) < 1e-6 && /8 bars/.test(s1.label), JSON.stringify(s1));
ok('Shift moves the nearest edge of the selection', s2.sel && Math.abs(s2.sel.b - s2.b) < 1e-6 && Math.abs(s2.sel.a - s1.a) < 1e-6, JSON.stringify(s2));
await page.keyboard.press('Escape'); await sleep(100);
const s3 = await E(() => djApp.timeline.selection);
ok('Esc clears the selection', s3 === null);

// Scrubbing (dragging on the lanes) never changes the cut list.
const before = await E(() => window.__sig());
await page.mouse.move(await E(() => window.__xOf(3)), g.yL); await page.mouse.down();
for (const t of [5, 9.3, 14.1, 2.2, 18.7, 11.05]) await page.mouse.move(await E((tt) => window.__xOf(tt), t), g.yL, { steps: 4 });
await page.mouse.up(); await sleep(300);
const sc = await E(() => ({ sig: window.__sig(), t: djApp.masterTime(), pending: djApp.clipEngine.pendingSeek }));
ok('scrubbing moves the playhead and never changes the cut list', sc.sig === before && Math.abs(sc.t - 11.05) < 0.15, `playhead ${sc.t.toFixed(2)} s, cut list ${sc.sig === before ? 'unchanged' : 'CHANGED'}`);

// L loops the selection while playing.
const lp = await E(async () => {
  const T = djApp.timeline, gr = djApp.tempo;
  T.setSelection({ a: gr.timeOfBeat(8), b: gr.timeOfBeat(12) });          // 1 bar
  document.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyL', key: 'l', bubbles: true }));
  djApp.seekMaster(T.selection.a); await djApp.toggleAudio();
  let lo = Infinity, hi = -Infinity;
  for (let i = 0; i < 40; i++) { await new Promise(r => setTimeout(r, 100)); const t = djApp.masterTime(); lo = Math.min(lo, t); hi = Math.max(hi, t); }
  await djApp.toggleAudio();
  const r = { looping: T.looping, a: T.selection.a, b: T.selection.b, lo, hi };
  document.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyL', key: 'l', bubbles: true }));
  return r;
});
ok('L loops the selection (4 s of play stay inside a 2 s selection)', lp.looping && lp.lo >= lp.a - 0.05 && lp.hi <= lp.b + 0.25, JSON.stringify(lp));

// Master fades: on the music bus after the analyser (live) and in the mixdown.
const mf = await E(async () => {
  djApp.setMasterFade('in', { on: true, shape: 'smooth', len: 1, unit: 'bars' });
  djApp.setMasterFade('out', { on: true, shape: 'linear', len: 2, unit: 's' });
  const dur = djApp.trackSource.duration;
  const lv = [0, 1, 2, 10, dur - 1, dur].map(t => +djApp.masterFadeLevel(t).toFixed(3));
  djApp.seekMaster(0.5); djApp.applyMusicLevel();
  await new Promise(r => setTimeout(r, 300));
  const bus = +djApp.trackSource.musicGain.gain.value.toFixed(3);
  const analyserFirst = !!djApp.audioProcessor.analyserNode;   // the analyser stays fed from the source, before musicGain
  return { lv, bus, analyserFirst };
});
ok('master fades: Smooth 1-bar in, Linear 2 s out, levels as drawn', JSON.stringify(mf.lv) === JSON.stringify([0, 0.5, 1, 1, 0.5, 0]) && mf.bus < 0.4, JSON.stringify(mf));

// Export an 8-bar Selection with edge fades: exactly 8 bars, 1-bar fades, motion.
const ex = await E(async () => {
  djApp.setMasterFade('in', { on: false }); djApp.setMasterFade('out', { on: false });
  djApp.masterFade.in.len = 1; djApp.masterFade.in.unit = 'bars'; djApp.masterFade.out.len = 1; djApp.masterFade.out.unit = 'bars';
  const T = djApp.timeline, gr = djApp.tempo;
  T.setSelection({ a: gr.timeOfBeat(16), b: gr.timeOfBeat(48) });          // 8 bars, never played
  djApp.sidebar.open('output');
  await new Promise(r => setTimeout(r, 300));
  const P = djApp.exportPanel;
  P.refresh();
  P.el.range.value = 'selection'; P.el.range.dispatchEvent(new Event('change'));
  P.el.size.value = '720p'; P.el.fps.value = '30';
  const edgeShown = !P.el.edgeRow.hidden;
  P.el.edge.checked = true;
  window.showSaveFilePicker = async () => (await navigator.storage.getDirectory()).getFileHandle('tl-sel.mp4', { create: true });
  await P.run();
  const M = await djApp.renderer.lib();
  const file = await (await (await navigator.storage.getDirectory()).getFileHandle('tl-sel.mp4')).getFile();
  const input = new M.Input({ source: new M.BlobSource(file), formats: M.ALL_FORMATS });
  const dur = await input.computeDuration();
  const at = await input.getPrimaryAudioTrack();
  const asink = new M.AudioBufferSink(at);
  const rms = async (a, b) => { let s = 0, n = 0; for await (const { buffer } of asink.buffers(a, b)) { const d = buffer.getChannelData(0), sr = buffer.sampleRate, t0 = buffer.duration; for (let i = 0; i < d.length; i++) { s += d[i] * d[i]; n++; } } return n ? Math.sqrt(s / n) : 0; };
  const sink = new M.CanvasSink(await input.getPrimaryVideoTrack(), { width: 32, height: 18, fit: 'fill' });
  const col = async (t) => Array.from((await sink.getCanvas(t)).canvas.getContext('2d').getImageData(16, 9, 1, 1).data.slice(0, 3));
  return {
    edgeShown, dur: +dur.toFixed(3), want: +(gr.timeOfBeat(48) - gr.timeOfBeat(16)).toFixed(3),
    first: +(await rms(0, 0.15)).toFixed(4), oneBar: +(await rms(2.0, 2.4)).toFixed(4), mid: +(await rms(7, 9)).toFixed(4), last: +(await rms(15.85, 16)).toFixed(4),
    frames: [await col(1), await col(3), await col(5)],
  };
});
const coloured = (c) => (c[0] > 150 && c[1] < 90) || (c[2] > 150 && c[0] < 90);
ok('Export Range "Selection" with an edge-fades option', ex.edgeShown);
ok('an 8-bar selection exports exactly 8 bars (16 s at 120 BPM)', Math.abs(ex.dur - ex.want) < 0.05 && Math.abs(ex.want - 16) < 1e-6, `${ex.dur} s for ${ex.want} s`);
ok('1-bar edge fades: silent at the edges, full from one bar in', ex.first < ex.mid * 0.15 && ex.last < ex.mid * 0.2 && ex.oneBar > ex.mid * 0.7, JSON.stringify({ first: ex.first, oneBar: ex.oneBar, mid: ex.mid, last: ex.last }));
ok('a never-played selection exports with motion (cuts every bar)', ex.frames.every(coloured) && JSON.stringify(ex.frames[0]) !== JSON.stringify(ex.frames[1]), JSON.stringify(ex.frames));

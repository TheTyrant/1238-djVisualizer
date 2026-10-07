// Step 1 (v2.4): fast pass + fixed tempo grid (D-80, D-81).
// Self-contained: the track (30 s, 120 BPM kick + hats) and three coloured
// image clips are made in the page; nothing is played unless a check says so.
// Beat 1 of each bar is the loudest kick, so bar 1 starts at 0.25 s.
const E = (fn, arg) => page.evaluate(fn, arg);

await E(async () => {
  const sr = 44100, n = sr * 30, L = new Int16Array(n);
  let seed = 7; const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647) * 2 - 1;
  for (let i = 0; i < n; i++) {
    const t = i / sr, beat = (t - 0.25 + 10) % 0.5, half = t % 0.5;   // kicks at 0.25, 0.75, … (bar 1 at 0.25 s)
    const down = Math.floor((t - 0.25 + 10) / 0.5) % 4 === 0;
    let v = beat < 0.12 ? (down ? 1 : 0.6) * Math.sin(2 * Math.PI * (50 + 90 * Math.exp(-beat * 30)) * beat) * Math.exp(-beat * 16) : 0;
    if (half < 0.03) v += rnd() * 0.2 * Math.exp(-half * 120);
    L[i] = Math.max(-1, Math.min(1, v * 0.8)) * 32767;
  }
  const h = new DataView(new ArrayBuffer(44));
  const W = (o, s) => [...s].forEach((c, k) => h.setUint8(o + k, c.charCodeAt(0)));
  W(0, 'RIFF'); h.setUint32(4, 36 + n * 2, true); W(8, 'WAVE'); W(12, 'fmt '); h.setUint32(16, 16, true);
  h.setUint16(20, 1, true); h.setUint16(22, 1, true); h.setUint32(24, sr, true); h.setUint32(28, sr * 2, true);
  h.setUint16(32, 2, true); h.setUint16(34, 16, true); W(36, 'data'); h.setUint32(40, n * 2, true);
  window.__track = new File([h.buffer, L.buffer], 'fp-kick-120.wav', { type: 'audio/wav' });
  const png = async (name, col) => { const c = document.createElement('canvas'); c.width = 160; c.height = 90; const g = c.getContext('2d'); g.fillStyle = col; g.fillRect(0, 0, 160, 90); return new File([await new Promise(r => c.toBlob(r, 'image/png'))], name + '.png', { type: 'image/png' }); };
  window.__imgs = [await png('R', '#e02020'), await png('G', '#20c040'), await png('B', '#2040e0')];
  window.__waitFast = async () => { for (let i = 0; i < 150 && djApp.fastPass.state.stage !== 'done'; i++) await new Promise(r => setTimeout(r, 200)); await new Promise(r => setTimeout(r, 600)); return djApp.fastPass.state; };
  window.__sig = () => JSON.stringify([djApp.tempo.toJSON(), djApp.clipEngine.edl().map(s => [s.start.toFixed(4), s.clipId, s.inPoint.toFixed(3)])]);
  window.__onGrid = () => { const g = djApp.tempo, edl = djApp.clipEngine.edl(); return edl.filter(s => s.start > 0 && Math.abs(g.beatAt(s.start) - Math.round(g.beatAt(s.start))) > 1e-3).length; };
});

// 1) Load without playing: the fast pass runs, with progress, and finds the grid.
const progress = [];
await E(async () => {
  window.__stages = [];
  djApp.fastPass.on((s) => window.__stages.push(s.stage + ':' + s.pct));
  document.getElementById('audioSourceFile').click();
  await djApp.loadAudioFile(window.__track, { autoplay: false });
  djApp.clipEngine.addFiles(window.__imgs);
  djApp.clipEngine.settings.order = 'sequential';
  djApp.clipEngine.settings.timingMode = 'manual'; djApp.clipEngine.settings.manualCount = 1; djApp.clipEngine.settings.manualUnit = 'bar';
  const v = document.getElementById('visualMode'); v.value = 'clips'; v.dispatchEvent(new Event('change'));
});
const st = await E(() => window.__waitFast());
const a = await E(() => ({ tempo: djApp.tempo.toJSON(), label: document.getElementById('topTempo').textContent, stages: window.__stages, sig: window.__sig(), offGrid: window.__onGrid(), edl: djApp.clipEngine.edl().slice(0, 3).map(s => +s.start.toFixed(3)), rec: djApp.record.recordedSeconds(), played: djApp.record.playedSeconds(), dur: djApp.trackSource.duration, status: djApp.clipEngine.status().state, warnings: djApp.renderer.plan().warnings }));
ok('fast pass runs on load with progress (decoding → analysing % → done)', st.stage === 'done' && a.stages.some(s => s.startsWith('analysing:')) && a.stages.some(s => s.startsWith('decoding')), a.stages.filter((s, i, x) => x.indexOf(s) === i).slice(0, 6).join(' '));
ok('tempo = 120 BPM (median) with bar 1 at the first kick', a.tempo.bpm === 120 && a.tempo.source === 'median' && Math.abs(a.tempo.offset - 0.25) < 0.04, JSON.stringify(a.tempo));
ok('header reads "120 BPM · median"', a.label === '120 BPM · median', a.label);
ok('the whole song has motion before anything is played', a.rec >= a.dur - 0.05 && a.played === 0 && !a.warnings.some(w => /hasn't been played/.test(w)), `${a.rec.toFixed(2)} of ${a.dur.toFixed(2)} s; warnings: ${a.warnings.join(' | ') || 'none'}`);
ok('cuts on the grid from 0:00 (1 bar = 2 s, within half a 60 fps frame of the kick)', a.edl[0] === 0 && a.offGrid === 0 && Math.abs(a.edl[1] - 0.25) < 0.02 && Math.abs(a.edl[2] - 2.25) < 0.02, JSON.stringify(a.edl));
ok('no "Listening for tempo…" in track mode', a.status !== 'waiting-bpm', a.status);

// 2) Same grid and cuts every load.
const sig2 = await E(async () => { await djApp.loadAudioFile(window.__track, { autoplay: false }); await window.__waitFast(); return window.__sig(); });
ok('the same grid and cuts on every load', sig2 === a.sig);

// 3) ×2, ÷2, type-in and tap move the grid; cuts follow.
const t = await E(async () => {
  const g = djApp.tempo, w = () => new Promise(r => setTimeout(r, 500));
  g.scale(2); await w(); const x2 = { ...g.toJSON(), cuts: djApp.clipEngine.edl().length, off: window.__onGrid() };
  g.scale(0.5); g.scale(0.5); await w(); const h2 = { ...g.toJSON(), cuts: djApp.clipEngine.edl().length };
  g.type('100'); await w(); const ty = { ...g.toJSON(), off: window.__onGrid(), label: document.getElementById('topTempo').textContent };
  g.useDetected(); await w(); const back = window.__sig();
  return { x2, h2, ty, back };
});
ok('×2 doubles the grid (more cuts, still on it), ÷2 halves', t.x2.bpm === 240 && t.x2.source === 'manual' && t.x2.off === 0 && t.h2.bpm === 60 && t.x2.cuts > t.h2.cuts, `${t.x2.cuts} cuts at 240, ${t.h2.cuts} at 60`);
ok('typed 100 BPM: cuts follow, readout says manual', t.ty.bpm === 100 && t.ty.off === 0 && t.ty.label === '100 BPM · manual', t.ty.label);
ok('"Detected" goes back to the fast-pass grid and cuts', t.back === a.sig);

// 4) Played takes win; Refill from fast pass replaces them.
const p = await E(async () => {
  const e = djApp.clipEngine;
  const before = e.edl().filter(s => s.fast).length;
  djApp.seekMaster(4); await djApp.toggleAudio(); await new Promise(r => setTimeout(r, 3000)); await djApp.toggleAudio();
  await new Promise(r => setTimeout(r, 800));
  const edl = e.edl();
  const played = edl.filter(s => !s.fast), fast = edl.filter(s => s.fast);
  const overlap = played.some(pc => fast.some(f => f.start < pc.end - 1e-3 && f.end > pc.start + 1e-3));
  const playedSec = djApp.record.playedSeconds();
  const lastEnd = edl[edl.length - 1].end;
  djApp.fastPass.refill();
  const after = e.edl();
  return { before, played: played.length, playedSec, overlap, lastEnd, afterPlayed: after.filter(s => !s.fast).length, afterPlayedSec: djApp.record.playedSeconds(), sig: window.__sig() };
});
ok('played takes win over fast ones (no overlap, rest still filled)', p.played >= 1 && !p.overlap && p.playedSec > 2 && Math.abs(p.lastEnd - 30) < 0.05, `${p.played} played cuts, ${p.playedSec.toFixed(2)} s played`);
ok('Refill from fast pass replaces the played takes', p.afterPlayed === 0 && p.afterPlayedSec === 0 && p.sig === a.sig);

// 5) Cancel.
const c = await E(async () => {
  const run = djApp.fastPass.run(window.__track);
  await new Promise(r => setTimeout(r, 30));
  djApp.fastPass.cancel();
  const res = await run;
  return { res, stage: djApp.fastPass.state.stage };
});
ok('the fast pass can be cancelled', c.res === false && (c.stage === 'cancelled' || c.stage === 'decoding'), JSON.stringify(c));
await E(() => window.__waitFast(djApp.fastPass.run(window.__track)));
await E(() => window.__waitFast());

// 6) A never-played track exports with full motion.
const x = await E(async () => {
  window.showSaveFilePicker = async () => (await navigator.storage.getDirectory()).getFileHandle('fp-export.mp4', { create: true });
  const res = await djApp.renderer.export({ size: '720p', range: 'all', fps: 30, quality: 'standard', name: 'fp' }, () => {});
  const M = await djApp.renderer.lib();
  const file = await (await (await navigator.storage.getDirectory()).getFileHandle('fp-export.mp4')).getFile();
  const input = new M.Input({ source: new M.BlobSource(file), formats: M.ALL_FORMATS });
  const vt = await input.getPrimaryVideoTrack();
  const sink = new M.CanvasSink(vt, { width: 64, height: 36, fit: 'fill' });
  const colour = async (tt) => { const d = (await sink.getCanvas(tt)).canvas.getContext('2d').getImageData(0, 0, 64, 36).data; let r = 0, g = 0, b = 0; for (let i = 0; i < d.length; i += 4) { r += d[i]; g += d[i + 1]; b += d[i + 2]; } const k = d.length / 4; return [r / k, g / k, b / k].map(Math.round); };
  const dom = (cl) => ['R', 'G', 'B'][cl.indexOf(Math.max(...cl))];
  const seq = [];
  for (let tt = 1.25; tt < 29; tt += 2) seq.push(dom(await colour(tt)));
  return { dur: res.duration, seq: seq.join('') };
});
ok('never-played track exports whole, cutting every bar to the end', Math.abs(x.dur - 30) < 0.1 && /^(RGB)+R?G?$|^(GBR)+G?B?$|^(BRG)+B?R?$/.test(x.seq) && x.seq.length >= 14, `${x.dur.toFixed(2)} s, colours every bar: ${x.seq}`);

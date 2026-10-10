// Control track start (Omar, 2026-10-10; D-99): the music can start later
// than 0:00. Typed in the Start box (exact) or grabbed on the Master lane
// (double-click, move, click to drop; whole bars, Alt = free; Esc cancels).
// Before the start the fast pass still cuts on the grid.
const E = (fn, arg) => page.evaluate(fn, arg);

await E(async () => {
  // 60 s, 120 BPM kicks from 0.25 s (1 bar = 2 s), a 5 kHz tone on top.
  const sr = 22050, n = sr * 60, L = new Int16Array(n);
  for (let i = 0; i < n; i++) { const t = i / sr, b = (t - 0.25 + 10) % 0.5, down = Math.floor((t - 0.25 + 10) / 0.5) % 4 === 0; L[i] = Math.max(-1, Math.min(1, (b < 0.12 ? (down ? 1 : 0.6) * Math.sin(2 * Math.PI * (50 + 90 * Math.exp(-b * 30)) * b) * Math.exp(-b * 16) : 0) * 0.8)) * 32767; }
  const h = new DataView(new ArrayBuffer(44)); const W = (o, s) => [...s].forEach((c, k) => h.setUint8(o + k, c.charCodeAt(0)));
  W(0, 'RIFF'); h.setUint32(4, 36 + n * 2, true); W(8, 'WAVE'); W(12, 'fmt '); h.setUint32(16, 16, true); h.setUint16(20, 1, true); h.setUint16(22, 1, true);
  h.setUint32(24, sr, true); h.setUint32(28, sr * 2, true); h.setUint16(32, 2, true); h.setUint16(34, 16, true); W(36, 'data'); h.setUint32(40, n * 2, true);
  const png = async (name, col) => { const c = document.createElement('canvas'); c.width = 96; c.height = 54; const g = c.getContext('2d'); g.fillStyle = col; g.fillRect(0, 0, 96, 54); return new File([await new Promise(r => c.toBlob(r, 'image/png'))], name + '.png', { type: 'image/png' }); };
  document.getElementById('audioSourceFile').click();
  await djApp.loadAudioFile(new File([h.buffer, L.buffer], 'start-120.wav', { type: 'audio/wav' }), { autoplay: false });
  const e = djApp.clipEngine;
  e.addFiles([await png('A', '#c33'), await png('B', '#3a3'), await png('C', '#33c')]);
  for (let i = 0; i < 50 && !e.assets.every(a => a.ready); i++) await new Promise(r => setTimeout(r, 100));
  e.assets.forEach(a => { a.show = 'full'; });
  const v = document.getElementById('visualMode'); v.value = 'clips'; v.dispatchEvent(new Event('change'));
  for (let i = 0; i < 100 && djApp.fastPass.state.stage !== 'done'; i++) await new Promise(r => setTimeout(r, 200));
  await new Promise(r => setTimeout(r, 700)); djApp.fastPass.flush();
});
await sleep(300);
const head0 = await E(() => ({ start: document.getElementById('masterStart').value, rowShown: !document.getElementById('masterStartRow').hidden, src: document.getElementById('chMasterSub').textContent, light: !!document.querySelector('.ch-src #masterLight'), off: djApp.tempo.offset, bpm: djApp.tempo.bpm }));
ok('the Master header: Start [0:00] with the length, then the source with its light', head0.start === '0:00' && head0.rowShown && head0.src === 'start-120' && head0.light, JSON.stringify(head0));

// Typed: 0:08 → the music starts at 8 s.
await page.click('#masterStart', { clickCount: 3 }); await page.keyboard.type('0:08'); await page.keyboard.press('Enter'); await sleep(900);
const r1 = await E(() => {
  djApp.fastPass.flush();
  const edl = djApp.clipEngine.edl(), g = djApp.tempo;
  return { start: djApp.trackStart, field: document.getElementById('masterStart').value, song: djApp.songLength(), music: djApp.musicLength(), len: document.getElementById('masterLength').textContent, off: +g.offset.toFixed(3), pre: edl.filter(s => s.start < 8).map(s => +s.start.toFixed(2)), lastEnd: +edl[edl.length - 1].end.toFixed(2), plan: djApp.renderer.plan().duration };
});
ok('typed 0:08: the music starts at 8 s, the song is 68 s, the length still reads the music (1:00)', r1.start === 8 && r1.field === '0:08' && r1.song === 68 && r1.music === 60 && r1.len === '1:00' && r1.plan === 68 && r1.lastEnd === 68, JSON.stringify(r1));
ok('the grid moved with the music (8 s = 4 bars: same phase), and the pre-roll is cut on it', Math.abs(r1.off - head0.off) < 0.01 && r1.pre.length >= 2 && r1.pre[0] === 0 && r1.pre.slice(1).every(t => Math.abs(((t - r1.off) / 0.5) - Math.round((t - r1.off) / 0.5)) < 0.02), JSON.stringify({ off: [head0.off, r1.off], pre: r1.pre }));

// Playback across the start.
const p1 = await E(async () => {
  const ts = djApp.trackSource;
  djApp.seekMaster(6.5);
  const pre = { t: +djApp.masterTime().toFixed(2), el: +ts.audio.currentTime.toFixed(2), paused: ts.audio.paused };
  await djApp.toggleAudio();
  await new Promise(r => setTimeout(r, 600));
  const during = { t: +djApp.masterTime().toFixed(2), playing: ts.isPlaying, elPaused: ts.audio.paused };
  await new Promise(r => setTimeout(r, 1600));
  const after = { t: +djApp.masterTime().toFixed(2), el: +ts.audio.currentTime.toFixed(2), elPaused: ts.audio.paused };
  await djApp.toggleAudio();
  djApp.seekMaster(20);
  const seek = { t: +djApp.masterTime().toFixed(2), el: +ts.audio.currentTime.toFixed(2) };
  return { pre, during, after, seek };
});
ok('before the start the clock runs with the music paused; at 0:08 the music comes in from its beginning', p1.pre.t === 6.5 && p1.pre.el === 0 && p1.during.playing && p1.during.elPaused && p1.during.t > 6.8 && p1.during.t < 8 && !p1.after.elPaused && Math.abs((p1.after.t - 8) - p1.after.el) < 0.15 && p1.seek.t === 20 && p1.seek.el === 12, JSON.stringify(p1));

// The export places the music at 8 s.
const mix = await E(async () => {
  const parts = await djApp.renderer.prepareAudio(djApp.clipEngine.edl(), null);
  const tr = parts.find(p => p.level);
  return { at: tr && tr.at, n: parts.length };
});
ok('the export places the music at 0:08', mix.at === 8, JSON.stringify(mix));

// Master fades start where the music starts.
const fd = await E(() => {
  djApp.setMasterFade('in', { on: true, len: 2, unit: 's', shape: 'linear' });
  const v = [djApp.masterFadeLevel(8), djApp.masterFadeLevel(9), djApp.masterFadeLevel(10.5)].map(x => +x.toFixed(2));
  djApp.setMasterFade('in', { on: false });
  return v;
});
ok('the fade-in starts with the music (0 at 0:08, ½ at 0:09, full at 0:10)', fd.join() === '0,0.5,1', fd.join());

// Grab: double-click the Master lane, move right ~2.3 bars → snaps to 2 bars (+4 s); click drops.
const geo = async () => E(() => { const c = document.getElementById('timelineCanvas'), r = c.getBoundingClientRect(), T = djApp.timeline; return { y: r.top + T.ROWS.ruler + T.ROWS.master / 2, x: (t) => 0, left: r.left, w: r.width, start: T.view.start, span: T.view.span }; });
const G = await geo();
const X = (t) => G.left + ((t - G.start) / G.span) * G.w;
await page.mouse.click(X(30), G.y, { clickCount: 2 }); await sleep(200);
await page.mouse.move(X(34.6), G.y, { steps: 4 }); await sleep(150);
const mid = await E(() => ({ grab: !!djApp.timeline.grab, lead: djApp.timeline.grab && djApp.timeline.grab.lead, start: djApp.trackStart }));
await page.mouse.click(X(34.6), G.y); await sleep(600);
const g1 = await E(() => ({ start: djApp.trackStart, grab: !!djApp.timeline.grab, field: document.getElementById('masterStart').value, dirty: djApp.project.dirty }));
ok('double-click grabs the control track; moving snaps to whole bars; a click drops it (0:08 → 0:12)', mid.grab && mid.lead === 12 && mid.start === 8 && g1.start === 12 && !g1.grab && g1.field === '0:12' && g1.dirty, JSON.stringify({ mid, g1 }));

// Alt = free; Esc cancels.
await page.mouse.click(X(30), G.y, { clickCount: 2 }); await sleep(200);
await page.keyboard.down('Alt'); await page.mouse.move(X(30.7), G.y, { steps: 3 }); await sleep(100);
const free = await E(() => +djApp.timeline.grab.lead.toFixed(1));
await page.keyboard.up('Alt');
await page.keyboard.press('Escape'); await sleep(200);
const esc = await E(() => ({ start: djApp.trackStart, grab: !!djApp.timeline.grab }));
ok('Alt moves freely; Esc puts it back', Math.abs(free - 12.7) < 0.2 && esc.start === 12 && !esc.grab, JSON.stringify({ free, esc }));

// Can't go before 0:00; the length still works on the music.
const lo = await E(() => { djApp.setTrackStart(-5); const a = djApp.trackStart; djApp.setTrackStart(12); djApp.setTrackLength(40); const b = { song: djApp.songLength(), music: djApp.musicLength() }; djApp.setTrackLength(null); return { a, b }; });
ok('the start stops at 0:00; a 40 s length ends the song at 0:52', lo.a === 0 && lo.b.song === 52 && lo.b.music === 40, JSON.stringify(lo));

// Saved with the project; the grid comes back where it was.
const re = await E(async () => {
  const off = djApp.tempo.offset;
  const blob = await djApp.project.build();
  djApp.project.dirty = false;
  djApp.setTrackStart(0, { mark: false });
  await djApp.project.open(new File([blob], 'start.mnt'));
  for (let i = 0; i < 100 && djApp.fastPass.state.stage !== 'done'; i++) await new Promise(r => setTimeout(r, 200));
  await new Promise(r => setTimeout(r, 400));
  return { start: djApp.trackStart, off: [+off.toFixed(3), +djApp.tempo.offset.toFixed(3)], t: +djApp.masterTime().toFixed(2), el: +djApp.trackSource.audio.currentTime.toFixed(2), song: djApp.songLength() };
});
ok('saved and reopened: the start, the grid and the song length come back', re.start === 12 && re.off[0] === re.off[1] && re.song === 72 && re.el === 0, JSON.stringify(re));

// A new track starts at 0:00 again.
const nt = await E(async () => {
  const f = djApp.trackSource.file;
  await djApp.loadAudioFile(new File([await f.arrayBuffer()], 'again.wav', { type: 'audio/wav' }), { autoplay: false });
  return { start: djApp.trackStart, song: djApp.songLength() };
});
ok('loading a new track starts it at 0:00', nt.start === 0 && nt.song === 60, JSON.stringify(nt));

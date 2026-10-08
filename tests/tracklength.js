// Master track length (Omar, 2026-10-08; D-97): the song's time under the
// Master label; click to shorten it (30 s at least) — everything follows.
const E = (fn, arg) => page.evaluate(fn, arg);

await E(async () => {
  const sr = 22050, n = sr * 60, L = new Int16Array(n);
  for (let i = 0; i < n; i++) { const t = i / sr, b = (t - 0.25 + 10) % 0.5, down = Math.floor((t - 0.25 + 10) / 0.5) % 4 === 0; L[i] = Math.max(-1, Math.min(1, (b < 0.12 ? (down ? 1 : 0.6) * Math.sin(2 * Math.PI * (50 + 90 * Math.exp(-b * 30)) * b) * Math.exp(-b * 16) : 0) * 0.8)) * 32767; }
  const h = new DataView(new ArrayBuffer(44)); const W = (o, s) => [...s].forEach((c, k) => h.setUint8(o + k, c.charCodeAt(0)));
  W(0, 'RIFF'); h.setUint32(4, 36 + n * 2, true); W(8, 'WAVE'); W(12, 'fmt '); h.setUint32(16, 16, true); h.setUint16(20, 1, true); h.setUint16(22, 1, true);
  h.setUint32(24, sr, true); h.setUint32(28, sr * 2, true); h.setUint16(32, 2, true); h.setUint16(34, 16, true); W(36, 'data'); h.setUint32(40, n * 2, true);
  const png = async (name, col) => { const c = document.createElement('canvas'); c.width = 96; c.height = 54; const g = c.getContext('2d'); g.fillStyle = col; g.fillRect(0, 0, 96, 54); return new File([await new Promise(r => c.toBlob(r, 'image/png'))], name + '.png', { type: 'image/png' }); };
  document.getElementById('audioSourceFile').click();
  await djApp.loadAudioFile(new File([h.buffer, L.buffer], 'len-120.wav', { type: 'audio/wav' }), { autoplay: false });
  const e = djApp.clipEngine;
  e.addFiles([await png('A', '#c33'), await png('B', '#3a3'), await png('End', '#33c')]);
  for (let i = 0; i < 50 && !e.assets.every(a => a.ready); i++) await new Promise(r => setTimeout(r, 100));
  e.assets.forEach(a => { a.show = 'full'; });
  const end = e.assets.find(a => a.name === 'End'); end.storyHold = 4; e.setClipStory(end.id, 'cta');
  const t = djApp.text.add('credits');
  const v = document.getElementById('visualMode'); v.value = 'clips'; v.dispatchEvent(new Event('change'));
  for (let i = 0; i < 100 && djApp.fastPass.state.stage !== 'done'; i++) await new Promise(r => setTimeout(r, 200));
  await new Promise(r => setTimeout(r, 700)); djApp.fastPass.flush();
  window.__creditsId = t.id;
});
await sleep(300);
const label0 = await E(() => document.getElementById('masterLength').textContent);
await page.click('#masterLength'); await sleep(200);
await E(() => { const p = document.getElementById('trackLengthPop'); p.querySelector('#lenMin').value = 0; p.querySelector('#lenSec').value = 40; p.querySelector('#lenSec').dispatchEvent(new Event('change')); });
await sleep(800);
const r = await E(async () => {
  djApp.fastPass.flush();
  const e = djApp.clipEngine, edl = e.edl();
  const cta = e.storyBlocks().find(b => b.role === 'cta');
  const cr = djApp.text.windowOf(djApp.text.get(window.__creditsId));
  return { len: djApp.songLength(), label: document.getElementById('masterLength').textContent, lastEnd: +edl[edl.length - 1].end.toFixed(2), after: edl.filter(s => s.start >= 40).length, cta: cta && [+cta.start.toFixed(2), +cta.end.toFixed(2)], credits: cr && [+cr[0].toFixed(2), +cr[1].toFixed(2)], plan: djApp.renderer.plan().duration, fade: (() => { djApp.setMasterFade('out', { on: true, len: 2, unit: 's', shape: 'linear' }); const v2 = [djApp.masterFadeLevel(39), djApp.masterFadeLevel(40)]; djApp.setMasterFade('out', { on: false }); return v2; })() };
});
ok('the Master label shows the track\'s time', label0 === '01:00', label0);
ok('set to 0:40: cuts, the CTA and end-locked credits end at 0:40; the export is 40 s; fades end there', r.len === 40 && /00:40/.test(r.label) && r.lastEnd === 40 && r.after === 0 && r.cta[1] === 40 && r.credits[1] === 40 && r.plan === 40 && r.fade[0] === 0.5 && r.fade[1] === 0, JSON.stringify(r));
const lo = await E(() => { djApp.setTrackLength(10); return djApp.songLength(); });
ok('it can\'t go below 30 s', lo === 30, String(lo));
const play = await E(async () => { djApp.seekMaster(28.5); await djApp.toggleAudio(); await new Promise(r2 => setTimeout(r2, 2500)); return { playing: djApp.trackSource.isPlaying, t: +djApp.masterTime().toFixed(2) }; });
ok('playback stops at the set end', !play.playing && play.t <= 30.2, JSON.stringify(play));
const re = await E(async () => {
  djApp.setTrackLength(45);
  const blob = await djApp.project.build();
  djApp.project.dirty = false;
  await djApp.project.open(new File([blob], 'len.mnt'));
  for (let i = 0; i < 100 && djApp.fastPass.state.stage !== 'done'; i++) await new Promise(r2 => setTimeout(r2, 200));
  const kept = djApp.songLength();
  document.getElementById('masterLength').click();
  await new Promise(r2 => setTimeout(r2, 100));
  document.getElementById('lenAll').click();
  return { kept, full: djApp.songLength(), setTo: djApp.trackLength };
});
ok('saved with the project; "Full length" goes back to the whole track', re.kept === 45 && re.full === 60 && re.setTo === null, JSON.stringify(re));

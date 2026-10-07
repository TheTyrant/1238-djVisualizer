// Alpha projects open and play as before (v2.4 rule 3, D-79, D-80).
// tests/fixtures/alpha-v1.mnt was saved by the alpha (BASSMNTalphaV1 / v2
// branch): a packed 20 s, 120 BPM track, three image clips in Clip
// Auto-Editor mode (manual 1-bar cuts, a band and a pace set), bass
// sensitivity 1.3, and 12 s played (7 cuts).
// Optional: ALPHA_URL=http://127.0.0.1:8766/index.html (the alpha served
// from a v2 worktree) also checks the alpha refuses a Stable05 project.
const E = (fn, arg) => page.evaluate(fn, arg);
const FIX = 'tests/fixtures/alpha-v1.mnt';
const base = url.replace(/index\.html.*$/, '');

const res = await E(async ({ fix, base }) => {
  const buf = await (await fetch(base + fix)).arrayBuffer();
  const file = new File([buf], 'alpha-v1.mnt');
  const zr = await ProjectFile.readZip(file);
  const { strFromU8 } = await djApp.project.zipLib();
  const project = JSON.parse(strFromU8(await zr.bytes('project.json')));
  const frames = await zr.bytes('record/frames.bin');
  await djApp.project.open(file);
  for (let i = 0; i < 100 && djApp.fastPass.state.stage !== 'done'; i++) await new Promise(r => setTimeout(r, 200));
  await new Promise(r => setTimeout(r, 800));
  const e = djApp.clipEngine;
  const pick = (s) => ({ clipId: s.clipId, start: +s.start.toFixed(4), end: +s.end.toFixed(4), inPoint: +(s.inPoint || 0).toFixed(4), transition: s.transition, band: s.band });
  const now = new Uint8Array(djApp.record.toBytes());
  let framesSame = true;
  for (let i = 0; i < frames.length; i++) if (frames[i] !== now[i]) { framesSame = false; break; }
  return {
    version: project.version,
    settings: JSON.stringify({ ...project.engine.settings, storyMode: true }) === JSON.stringify(e.settings),
    bandTransitions: JSON.stringify(project.engine.bandTransitions) === JSON.stringify(e.bandTransitions),
    eq: project.eq.mode === djApp.eqMode && project.eq.sensitivity.bass === djApp.bassGain,
    mode: project.visualMode === djApp.visualizer.currentMode,
    assets: JSON.stringify(project.assets.map(a => [a.id, a.kind, a.band, a.pace, a.story])) === JSON.stringify(e.assets.map(a => [a.id, a.kind, a.band, a.pace, a.story])),
    fullAt1x: e.assets.every(a => e.speedOf(a) === 1 && e.usedRange(a).start === 0 && (a.kind !== 'video' || Math.abs(e.usedRange(a).end - e.sourceLength(a)) < 1e-6) && !(a.sections && a.sections.length)),
    savedCuts: project.record.edl.map(pick),
    playedCuts: e.edl().filter(s => !s.fast).map(pick),
    framesSame, savedFrames: frames.length / SessionRecord.FRAME_BYTES,
    tempo: djApp.tempo.toJSON(), detected: djApp.tempo.detected,
    lastEnd: e.edl().length ? e.edl()[e.edl().length - 1].end : 0,
    recorded: djApp.record.recordedSeconds(), duration: djApp.trackSource.duration,
  };
}, { fix: FIX, base });

ok('fixture is an alpha project (format version 1)', res.version === 1);
ok('settings come back (Auto-Editor settings, band transitions)', res.settings && res.bandTransitions);
ok('EQ mode and sensitivity come back', res.eq);
ok('visual mode and every clip’s kind / band / pace / position come back', res.mode && res.assets);
ok('alpha clips show their full length at 1×, no sections (v2.4 step 2)', res.fullAt1x);
ok('played cuts are exactly the saved cut list', JSON.stringify(res.savedCuts) === JSON.stringify(res.playedCuts), `${res.savedCuts.length} saved, ${res.playedCuts.length} played`);
ok('played frames are byte-for-byte the saved recording', res.framesSame, `${res.savedFrames} frames`);
ok('alpha projects keep the live clock (tempo source "live")', res.tempo.source === 'live', JSON.stringify(res.tempo));
ok('fast pass fills the unplayed rest (motion + cuts to the end)', Math.abs(res.lastEnd - res.duration) < 0.05 && res.recorded >= res.duration - 0.05, `cuts to ${res.lastEnd.toFixed(2)} s, motion ${res.recorded.toFixed(2)} of ${res.duration.toFixed(2)} s`);

// Saving in Stable05 asks once, offers a copy, and writes format 2.
const save = await E(async () => {
  const p = djApp.project;
  const written = [];
  const fakeHandle = (name) => ({ name, kind: 'file', createWritable: async () => ({ write: async (c) => { written.push(c instanceof Blob ? new Uint8Array(await c.arrayBuffer()) : new Uint8Array(c.buffer ? c.buffer.slice(c.byteOffset, c.byteOffset + c.byteLength) : c)); }, close: async () => {}, abort: async () => {} }), getFile: async () => new File(written, name), isSameEntry: async () => false });
  p.handle = fakeHandle('alpha-v1.mnt');
  p.openedVersion = 1;
  let asked = null, picked = 0;
  const conf = window.confirm;
  window.confirm = (m) => { asked = m; return true; };
  const picker = window.showSaveFilePicker;
  window.showSaveFilePicker = async () => { picked++; return fakeHandle('alpha-v1 (Stable05).mnt'); };
  try {
    await p.save(false);
    const firstAsk = asked;
    asked = null; written.length = 0;
    await p.save(false);
    const file = new File(written, 'x.mnt');
    const zr = await ProjectFile.readZip(file);
    const { strFromU8 } = await p.zipLib();
    const json = JSON.parse(strFromU8(await zr.bytes('project.json')));
    let b64 = '';
    const all = new Uint8Array(await file.arrayBuffer());
    for (let i = 0; i < all.length; i += 0x8000) b64 += String.fromCharCode.apply(null, all.subarray(i, i + 0x8000));
    return { firstAsk, secondAsk: asked, picked, name: p.handle.name, version: json.version, tempo: json.tempo, b64: btoa(b64), fastCuts: json.record.edl.filter(s => s.fast).length, played: json.record.edl.filter(s => !s.fast).length };
  } finally { window.confirm = conf; window.showSaveFilePicker = picker; }
});
ok('first save of an alpha project offers "Save as a copy" once', !!save.firstAsk && /alpha/.test(save.firstAsk) && save.secondAsk === null && save.picked === 1, `asked: ${save.firstAsk && save.firstAsk.split('\n')[0]}`);
ok('Stable05 saves format version 2 with the tempo', save.version === 2 && save.tempo && save.tempo.source === 'live', JSON.stringify(save.tempo));
ok('saved cut list keeps the played cuts and marks the fast ones', save.played === res.savedCuts.length && save.fastCuts > 0, `${save.played} played, ${save.fastCuts} fast`);

// Re-open the Stable05 save: same played cuts.
const again = await E(async (b64) => {
  const bin = atob(b64), u = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i);
  djApp.project.dirty = false;
  await djApp.project.open(new File([u], 'alpha-v1 (Stable05).mnt'));
  for (let i = 0; i < 100 && djApp.fastPass.state.stage !== 'done'; i++) await new Promise(r => setTimeout(r, 200));
  await new Promise(r => setTimeout(r, 800));
  return djApp.clipEngine.edl().filter(s => !s.fast).map(s => ({ clipId: s.clipId, start: +s.start.toFixed(4), end: +s.end.toFixed(4), inPoint: +(s.inPoint || 0).toFixed(4), transition: s.transition, band: s.band }));
}, save.b64);
ok('reopened Stable05 project: same played cuts', JSON.stringify(again) === JSON.stringify(res.savedCuts));

if (process.env.ALPHA_URL) {
  const alpha = await browser.newPage();
  await alpha.goto(process.env.ALPHA_URL, { waitUntil: 'networkidle0' });
  await sleep(1200);
  const err = await alpha.evaluate(async (b64) => {
    const bin = atob(b64), u = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i);
    try { await djApp.project.open(new File([u], 'stable05.mnt')); return null; } catch (e) { return e.message; }
  }, save.b64);
  ok('the alpha refuses a Stable05 project', /newer/.test(err || ''), err);
  await alpha.close();
}

// Step 2 (v2.4): clip model — amount used, sections, speed, Fit to bars (D-82).
// Self-contained: a 30 s, 120 BPM track (1 bar = 2 s) and a 40 s "clock" clip
// made in the page. Each clip frame's colour encodes its own time
// (red = t / 40 × 255) and it carries a 440 Hz tone, so an export can be
// read back: which source second is on screen, and at what pitch.
const E = (fn, arg) => page.evaluate(fn, arg);

await E(async () => {
  // Track: kicks every 0.5 s from 0.25 s, beat 1 of each bar louder.
  const sr = 44100, n = sr * 30, L = new Int16Array(n);
  let seed = 7; const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647) * 2 - 1;
  for (let i = 0; i < n; i++) {
    const t = i / sr, beat = (t - 0.25 + 10) % 0.5, half = t % 0.5;
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
  window.__track = new File([h.buffer, L.buffer], 'cm-kick-120.wav', { type: 'audio/wav' });

  // Clock clip: 40 s, 10 fps, colour = time; 440 Hz tone.
  const M = await djApp.renderer.lib();
  const unpatch = OfflineRenderer.patchEncoder();
  try {
    const out = new M.Output({ format: new M.Mp4OutputFormat({ fastStart: 'in-memory' }), target: new M.BufferTarget() });
    const c = document.createElement('canvas'); c.width = 160; c.height = 90;
    const g = c.getContext('2d');
    const vcodec = await M.getFirstEncodableVideoCodec(['avc', 'vp9', 'av1'], { width: 160, height: 90 });
    const vs = new M.CanvasSource(c, { codec: vcodec, bitrate: M.QUALITY_HIGH, keyFrameInterval: 1 });
    out.addVideoTrack(vs, { frameRate: 10 });
    const acodec = await djApp.renderer.audioCodec(M);
    const as = new M.AudioBufferSource({ codec: acodec, bitrate: M.QUALITY_HIGH });
    out.addAudioTrack(as);
    await out.start();
    const DUR = 40, asr = 48000;
    const ab = new AudioBuffer({ length: asr * DUR, numberOfChannels: 1, sampleRate: asr });
    const d = ab.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = 0.5 * Math.sin(2 * Math.PI * 440 * i / asr);
    await as.add(ab);
    for (let f = 0; f < DUR * 10; f++) {
      const r = Math.round((f / 10 / DUR) * 255);
      g.fillStyle = `rgb(${r},40,${255 - r})`; g.fillRect(0, 0, 160, 90);
      await vs.add(f / 10, 0.1);
    }
    await out.finalize();
    window.__clock = new File([out.target.buffer], 'T40-clock.mp4', { type: 'video/mp4' });
  } finally { unpatch(); }

  window.__waitFast = async () => { for (let i = 0; i < 150 && djApp.fastPass.state.stage !== 'done'; i++) await new Promise(r => setTimeout(r, 200)); await new Promise(r => setTimeout(r, 700)); };
  window.__settle = async () => { await new Promise(r => setTimeout(r, 600)); djApp.fastPass.flush(); };
  // Export [a, b] of the timeline and read back the source time on screen
  // (from the red level) and the tone's pitch.
  window.__export = async (a, b, times, name) => {
    window.showSaveFilePicker = async () => (await navigator.storage.getDirectory()).getFileHandle(name, { create: true });
    const res = await djApp.renderer.export({ size: '720p', range: { start: a, end: b }, fps: 30, quality: 'high', name }, () => {});
    const M2 = await djApp.renderer.lib();
    const file = await (await (await navigator.storage.getDirectory()).getFileHandle(name)).getFile();
    const input = new M2.Input({ source: new M2.BlobSource(file), formats: M2.ALL_FORMATS });
    const vt = await input.getPrimaryVideoTrack();
    const sink = new M2.CanvasSink(vt, { width: 32, height: 18, fit: 'fill' });
    const src = [];
    for (const t of times) {
      const px = (await sink.getCanvas(t - a)).canvas.getContext('2d').getImageData(8, 4, 16, 10).data;
      let r = 0; for (let i = 0; i < px.length; i += 4) r += px[i];
      src.push(+((r / (px.length / 4)) / 255 * 40).toFixed(2));
    }
    let hz = null;
    const at = await input.getPrimaryAudioTrack();
    if (at) {
      const asink = new M2.AudioBufferSink(at);
      let crossings = 0, samples = 0, prev = 0, rate = 48000;
      for await (const { buffer } of asink.buffers(1, Math.min(b - a, 7))) {
        rate = buffer.sampleRate;
        const ch = buffer.getChannelData(0);
        for (let i = 0; i < ch.length; i++) { if (prev < 0 && ch[i] >= 0) crossings++; prev = ch[i]; samples++; }
      }
      hz = samples ? Math.round(crossings / (samples / rate)) : null;
    }
    return { dur: res.duration, src, hz };
  };
});

const setup = await E(async () => {
  document.getElementById('audioSourceFile').click();
  await djApp.loadAudioFile(window.__track, { autoplay: false });
  const e = djApp.clipEngine;
  e.addFiles([window.__clock]);
  for (let i = 0; i < 50 && !(e.assets[0] && e.assets[0].ready && e.assets[0].duration > 0); i++) await new Promise(r => setTimeout(r, 200));
  Object.assign(e.settings, { order: 'sequential', timingMode: 'manual', manualCount: 1, manualUnit: 'bar', transitionMode: 'jump' });
  const v = document.getElementById('visualMode'); v.value = 'clips'; v.dispatchEvent(new Event('change'));
  await window.__waitFast();
  await window.__settle();
  const a = e.assets[0];
  const card = document.querySelector(`.bin-card[data-id="${a.id}"] .bin-dur`);
  return { id: a.id, dur: +a.duration.toFixed(2), used: e.usedRange(a), speed: e.speedOf(a), card: card && card.textContent, bpm: djApp.tempo.bpm };
});
ok('new clip shows its full length at 1× (and the card says so)', setup.dur >= 39.9 && setup.used.start === 0 && Math.abs(setup.used.end - setup.dur) < 0.01 && setup.speed === 1 && setup.card === '00:40', JSON.stringify(setup));
const id = setup.id;

// 1) Amount used: 0:20–0:32.
const r1 = await E(async (id) => {
  const e = djApp.clipEngine;
  e.setUsed(id, 20, 32);
  await window.__settle();
  const segs = e.edl().filter(s => s.clipId === id);
  const card = document.querySelector(`.bin-card[data-id="${id}"] .bin-dur`);
  return { n: segs.length, ins: segs.map(s => +s.inPoint.toFixed(2)), ranges: [...new Set(segs.map(s => JSON.stringify(s.range)))], card: card.textContent, set: card.classList.contains('is-set') };
}, id);
ok('0:20–0:32: every in-point inside it, card shows 0:12', r1.n > 5 && r1.ins.every(x => x >= 20 && x < 32) && r1.ranges.length === 1 && r1.ranges[0] === '[20,32]' && r1.card === '00:12' && r1.set, `${r1.n} cuts, in-points ${Math.min(...r1.ins)}–${Math.max(...r1.ins)}`);
const x1 = await E(async (id) => {
  const segs = djApp.clipEngine.edl().filter(s => s.clipId === id && s.start < 12);
  const times = segs.map(s => (s.start + s.end) / 2);
  const out = await window.__export(0, 12, times, 'cm-range.mp4');
  const expect = segs.map(s => djApp.renderer.clipTime(s, null, (s.start + s.end) / 2, 40));
  return { got: out.src, expect: expect.map(v => +v.toFixed(2)) };
}, id);
ok('export of the range shows only 0:20–0:32, at the recorded in-points', x1.got.length > 3 && x1.got.every((v, i) => v >= 19.6 && v <= 32.4 && Math.abs(v - x1.expect[i]) < 0.6), `source s on screen ${x1.got.join(' ')} (expected ${x1.expect.join(' ')})`);

// 2) Sections: markers at 10, 20, 30 s -> 4 cards, each cut on its own.
const r2 = await E(async (id) => {
  const e = djApp.clipEngine;
  e.setUsed(id, 0, null);
  e.setSections(id, [10, 20, 30]);
  const kids = e.sectionsOf(e.clipById(id));
  e.setClipBand(kids[2].id, 'high');
  e.setSpeed(kids[3].id, 2);
  e.setClipPace(kids[1].id, 'phrase');
  await window.__settle();
  const edl = e.edl();
  const per = kids.map(k => { const b = e.sectionBounds(k); const s = edl.filter(x => x.clipId === k.id); return { name: k.name, n: s.length, inside: s.every(x => x.inPoint >= b.start - 1e-6 && x.inPoint < b.end && x.range[0] === b.start && x.range[1] === b.end), speeds: [...new Set(s.map(x => x.speed))], holds: [...new Set(s.map(x => x.holdBeats))] }; });
  const cards = [...document.querySelectorAll('.bin-card .bin-name')].map(c => c.textContent);
  const strip = [...document.querySelectorAll('.bin-card .bin-section')].length;
  return { per, cards, strip, parentInCut: edl.some(s => s.clipId === id), stackLen: e.stack.length, pool: e.pickList().length, media: e.mediaAssets.length };
}, id);
ok('4 sections: one card with a 4-section strip, picked as 4, no copy of the video', r2.stackLen === 1 && r2.pool === 4 && r2.media === 1 && r2.cards.length === 1 && r2.strip === 4, JSON.stringify({ cards: r2.cards, strip: r2.strip, pool: r2.pool }));
ok('each section cuts on its own (own part, own speed / pace)', r2.per.every(p => p.n > 0 && p.inside) && !r2.parentInCut && r2.per[3].speeds.join() === '2' && r2.per[1].holds.join() !== r2.per[0].holds.join(), JSON.stringify(r2.per.map(p => [p.n, p.speeds, p.holds])));

// 3) Fit to bars: 0:00–0:12 into 4 bars (8 s at 120 BPM) -> 1.5×.
const r3 = await E(async (id) => {
  const e = djApp.clipEngine;
  e.setSections(id, []);
  e.setUsed(id, 0, 12);
  const fit = e.fitToBars(id, 2, 4);
  await window.__settle();
  const segs = e.edl().filter(s => s.clipId === id);
  const off = djApp.tempo.offset;
  const full = segs.filter(s => s.start >= off - 1e-6 && s.end < 29.9);   // after the lead-in to bar 1
  return { fit, n: segs.length, lens: [...new Set(full.map(s => +(s.end - s.start).toFixed(3)))], ins: [...new Set(segs.map(s => s.inPoint))], starts: segs.slice(0, 4).map(s => +s.start.toFixed(3)) };
}, id);
ok('Fit to bars: 12 s into 4 bars = 1.5×, every cut exactly 4 bars (8 s), from the used start', r3.fit && r3.fit.bars === 4 && Math.abs(r3.fit.speed - 1.5) < 1e-9 && r3.lens.length === 1 && Math.abs(r3.lens[0] - 8) < 1e-3 && r3.ins.join() === '0', JSON.stringify(r3));
const r3b = await E(async (id) => {
  const e = djApp.clipEngine;
  e.setClipStory(id, 'hook');
  e.fitToBars(id, 2, 3);
  const h3 = e.storyBlocks().find(b => b.role === 'hook');
  e.fitToBars(id, 2, 4);
  await window.__settle();
  const h4 = e.storyBlocks().find(b => b.role === 'hook');
  return { hook: h3 && [h3.start, +h3.end.toFixed(3)], capped: h4 && +h4.end.toFixed(3), cap: e.storyCap() };
}, id);
ok('locked as Hook: fitted to 3 bars plays exactly 6 s; 4 bars (8 s) is held to the D-78 cap (¼ of 30 s)', r3b.hook && r3b.hook[0] === 0 && Math.abs(r3b.hook[1] - 6) < 1e-3 && Math.abs(r3b.capped - 7.5) < 1e-3, JSON.stringify(r3b));
const x3 = await E(async () => {
  djApp.musicMuted = true;   // only the clip's own sound
  const out = await window.__export(0, 8, [1, 4, 7], 'cm-fit.mp4');
  djApp.musicMuted = false;
  return out;
});
ok('export matches: 1.5× through 0:00–0:12 (frames at 1, 4, 7 s = source 1.5, 6, 10.5 s)', [1.5, 6, 10.5].every((v, i) => Math.abs(x3.src[i] - v) < 0.6), x3.src.join(' '));
ok('the clip’s sound is resampled with the speed (440 Hz → 660 Hz)', x3.hz && Math.abs(x3.hz - 660) < 15, `${x3.hz} Hz`);

// Live: the element plays at the speed, with the pitch following.
const live = await E(async () => {
  djApp.seekMaster(0); await djApp.toggleAudio(); await new Promise(r => setTimeout(r, 1500));
  const el = djApp.clipEngine.assets[0].el;
  const r = { rate: el.playbackRate, pitch: el.preservesPitch, muted: el.muted };
  await djApp.toggleAudio();
  return r;
});
ok('live: the clip plays at 1.5× with its pitch following', live.rate === 1.5 && live.pitch === false && live.muted === false, JSON.stringify(live));

// 4) Save / reopen keeps used, speed and sections; the video is packed once.
const r4 = await E(async (id) => {
  const e = djApp.clipEngine;
  e.setClipStory(id, 'none');
  e.setSections(id, [10, 20, 30]);
  const kids = e.sectionsOf(e.clipById(id));
  e.setSpeed(kids[3].id, 2);
  e.setUsed(kids[0].id, 2, 8);
  djApp.project.pack = true;
  const entries = await djApp.project.entries();
  const media = entries.filter(x => /^media\/assets\//.test(x.name)).map(x => x.name);
  const blob = await djApp.project.build();
  djApp.project.dirty = false;
  await djApp.project.open(new File([blob], 'cm.mnt'));
  await window.__waitFast();
  const p = e.mediaAssets[0];
  const ks = e.sectionsOf(p);
  return { media, sections: p.sections, kids: ks.map(k => [k.name, k.speed, JSON.stringify(e.usedRange(k))]), ready: ks.every(k => k.ready) };
}, id);
ok('saved and reopened: sections, per-section speed and used part come back; the video is packed once', r4.media.length === 1 && r4.sections.join() === '10,20,30' && r4.kids.length === 4 && r4.kids[3][1] === 2 && r4.kids[0][2] === '{"start":2,"end":8}' && r4.ready, JSON.stringify(r4));

// 5) Sections editor by mouse: click adds a marker on the nearest bar line,
// dragging snaps to bars, right-click deletes.
const geo = await E(() => {
  const e = djApp.clipEngine, p = e.mediaAssets[0];
  e.setSections(p.id, []);
  e.setSpeed(p.id, 1);
  djApp.clipTools.openSections(p);
  const c = document.getElementById('sectCanvas'), r = c.getBoundingClientRect(), g = djApp.clipTools.geom();
  const toX = (t) => r.left + (g.x(t) / c.width) * r.width;
  return { y: r.top + (60 / c.height) * r.height, x5: toX(5.2), x6: toX(6), x9: toX(8.7), x8: toX(8), bar: djApp.clipTools.barSource(p) };
});
await page.mouse.click(geo.x5, geo.y); await sleep(200);
const s1 = await E(() => djApp.clipEngine.mediaAssets[0].sections.slice());
await page.mouse.move(geo.x6, geo.y); await page.mouse.down(); await page.mouse.move(geo.x9, geo.y, { steps: 6 }); await page.mouse.up(); await sleep(200);
const s2 = await E(() => djApp.clipEngine.mediaAssets[0].sections.slice());
const cards2 = await E(() => djApp.clipEngine.pickList().map(c => c.name));
await page.mouse.click(geo.x8, geo.y, { button: 'right' }); await sleep(200);
const s3 = await E(() => djApp.clipEngine.mediaAssets[0].sections.slice());
await E(() => djApp.clipTools.closeSections());
ok('Sections editor: click adds on a bar line, drag snaps to bars, right-click deletes', geo.bar === 2 && s1.join() === '6' && s2.join() === '8' && cards2.length === 2 && s3.length === 0, `bar ${geo.bar} s · click → ${s1} · drag → ${s2} (${cards2.join(', ')}) · right-click → [${s3}]`);

// 5b) Slice every ½ / 1 / 4 / 8 / 16 bars (Omar, 2026-10-10): auto-cut on
// the grid, replaceable, undoable, and markers removable without hunting.
const sl = await E(async () => {
  const e = djApp.clipEngine, p = e.mediaAssets[0], T = djApp.clipTools;
  const wait = () => new Promise(r => setTimeout(r, 60));
  e.setSpeed(p.id, 1); e.setUsed(p.id, 0, null); e.setSections(p.id, [30]);
  T.openSections(p);
  const btn = (b) => document.querySelector(`.sect-div[data-bars="${b}"]`);
  const out = { labels: [...document.querySelectorAll('.sect-div')].map(b => b.textContent) };
  btn(4).click(); await wait();
  out.four = p.sections.slice(); out.fourCards = e.sectionsOf(p).length;
  btn(0.5).click(); await wait();
  out.half = p.sections.length;
  document.dispatchEvent(new KeyboardEvent('keydown', { key: 'z', ctrlKey: true, bubbles: true })); await wait();
  out.undo1 = p.sections.slice();
  document.getElementById('sectUndo').click(); await wait();
  out.undo2 = p.sections.slice();
  // Used part 0:03–0:27, every 8 bars (16 s): 3 | 19 | 27, outside parts kept but not used.
  e.setUsed(p.id, 3, 27); btn(8).click(); await wait();
  out.used = p.sections.slice(); out.usedAs = e.sectionsOf(p).map(c => c.asClip);
  out.msg = document.getElementById('sectMsg').textContent;
  // The cap: at 0.25× one bar is 0.5 s of the clip, ½ bar = 0.25 s → 160 sections.
  e.setUsed(p.id, 0, null); e.setSpeed(p.id, 0.25);
  const before = p.sections.slice();
  btn(0.5).click(); await wait();
  out.capKept = p.sections.join() === before.join();
  out.capMsg = document.getElementById('sectMsg').classList.contains('is-warn');
  e.setSpeed(p.id, 1);
  // Too short: a 10 s used part can't be cut every 8 bars (16 s).
  e.setUsed(p.id, 0, 10); const b2 = p.sections.slice(); btn(8).click(); await wait();
  out.short = p.sections.join() === b2.join() && /too short/.test(document.getElementById('sectMsg').textContent);
  e.setUsed(p.id, 0, null);
  btn(4).click(); await wait();
  // × in the list on section 3 removes the cut before it (16 s).
  document.querySelectorAll('#sectList .sect-del')[2].click(); await wait();
  out.listX = p.sections.slice();
  return out;
});
ok('Slice every: 1/2, 1, 4, 8, 16 bars; 4 bars on a 40 s clip = cuts every 8 s (5 sections), replacing the old marker', sl.labels.join('|') === '1/2 bar|1 bar|4 bars|8 bars|16 bars' && sl.four.join() === '8,16,24,32' && sl.fourCards === 5, JSON.stringify(sl));
ok('1/2 bar makes 40 sections; Ctrl+Z and Undo step back (4 bars, then the hand-placed marker)', sl.half === 39 && sl.undo1.join() === '8,16,24,32' && sl.undo2.join() === '30', JSON.stringify([sl.half, sl.undo1, sl.undo2]));
ok('inside the used part (0:03–0:27): cut at 3, 19, 27; the parts outside are kept but not used', sl.used.join() === '3,19,27' && sl.usedAs.join() === 'false,true,true,false' && /not used/.test(sl.msg), JSON.stringify([sl.used, sl.usedAs]));
ok('more than 64 sections is refused with a message; markers untouched', sl.capKept && sl.capMsg);
ok('a used part shorter than the division says so and cuts nothing', sl.short);
ok('× on a section in the list removes the cut before it', sl.listX.join() === '8,24,32', sl.listX.join());

// Select a marker by mouse, nudge it with →, delete it with Delete; the ×
// on a hovered marker deletes too.
const g5 = await E(() => {
  const c = document.getElementById('sectCanvas'), r = c.getBoundingClientRect(), g = djApp.clipTools.geom();
  const toX = (t) => r.left + (g.x(t) / c.width) * r.width;
  const toY = (y) => r.top + (y / c.height) * r.height;
  return { x8: toX(8), y: toY(40) };
});
await page.mouse.click(g5.x8, g5.y); await sleep(150);
await page.keyboard.press('ArrowRight'); await sleep(150);
const k1 = await E(() => djApp.clipEngine.mediaAssets[0].sections.slice());
await page.keyboard.press('Delete'); await sleep(150);
const k2 = await E(() => djApp.clipEngine.mediaAssets[0].sections.slice());
// (the list is shorter now, so the dialog has re-centred: measure again)
const g6 = await E(() => { const c = document.getElementById('sectCanvas'), r = c.getBoundingClientRect(), g = djApp.clipTools.geom(); return { x: r.left + (g.x(24) / c.width) * r.width, y: r.top + (40 / c.height) * r.height, yX: r.top + ((g.stripY + g.stripH - 11) / c.height) * r.height }; });
await page.mouse.move(g6.x, g6.y); await sleep(100); await page.mouse.move(g6.x, g6.yX); await sleep(100);
await page.mouse.click(g6.x, g6.yX); await sleep(150);
const k3 = await E(() => { const s = djApp.clipEngine.mediaAssets[0].sections.slice(); djApp.clipTools.closeSections(); djApp.clipEngine.setSections(djApp.clipEngine.mediaAssets[0].id, []); return s; });
ok('click a marker to select it: → moves it one bar, Delete removes it; the × on a hovered marker removes it', k1.join() === '10,24,32' && k2.join() === '24,32' && k3.join() === '32', JSON.stringify([k1, k2, k3]));

// 5c) Many sections: the card grows so every chip fits; a section can be
// made a clip of its own and put back (Omar, 2026-10-10; D-100).
const wide = await E(async () => {
  const e = djApp.clipEngine, p = e.mediaAssets[0];
  e.setSpeed(p.id, 1); e.setUsed(p.id, 0, null);
  e.setSections(p.id, Array.from({ length: 32 }, (_, k) => (k + 1) * 1.2));   // 33 sections
  await new Promise(r => setTimeout(r, 300));
  const card = document.querySelector(`.bin-card[data-id="${p.id}"]`), cr = card.getBoundingClientRect();
  const chips = [...card.querySelectorAll('.bin-section')].map(b => b.getBoundingClientRect());
  return { n: chips.length, cardW: Math.round(cr.width), inside: chips.every(r => r.left >= cr.left - 0.5 && r.right <= cr.right + 0.5), minChip: Math.round(Math.min(...chips.map(r => r.width))), frames: !!card.querySelector('.bin-frames'), thumbW: Math.round((card.querySelector('.bin-thumb') || card).getBoundingClientRect().width) };
});
ok('33 sections: the card grows so every chip fits inside it (14 px at least), frames beside the thumbnail', wide.n === 33 && wide.cardW >= 33 * 16 + 12 && wide.inside && wide.minChip >= 14 && wide.frames && wide.thumbW <= 172, JSON.stringify(wide));

const own = await E(async () => {
  const e = djApp.clipEngine, p = e.mediaAssets[0], s7 = e.sectionsOf(p)[6];
  const before = { stack: e.stack.length, pool: e.pickList().length };
  // from the section's settings
  e.select(s7.id); djApp.sidebar.open('assets'); await new Promise(r => setTimeout(r, 150));
  document.getElementById('propSectOwn').click(); await new Promise(r => setTimeout(r, 400));
  const ids = e.stack.map(c => c.id), pool = e.pickList();
  const card = document.querySelector(`.bin-card[data-id="${s7.id}"]`);
  const chip = document.querySelector(`.bin-card[data-id="${p.id}"] .bin-section.is-own`);
  const after = { stack: e.stack.length, pool: pool.length, inPool: pool.filter(c => c.id === s7.id).length, next: ids[ids.indexOf(p.id) + 1] === s7.id, card: !!card, chip: chip && chip.textContent, thumb: !!s7.ownThumb, imp: !!document.getElementById('propImportance') };
  // its own place in the stack
  e.moveClip(s7.id, 0);
  const top = e.stack[0].id === s7.id;
  // saved and reopened
  const blob = await djApp.project.build();
  djApp.project.dirty = false;
  await djApp.project.open(new File([blob], 'own.mnt'));
  await window.__waitFast();
  const p2 = e.mediaAssets[0], k2 = e.sectionsOf(p2)[6];
  const kept = { own: !!k2.own, top: e.stack[0].id === k2.id };
  // back onto the strip, from its card
  await new Promise(r => setTimeout(r, 300));
  document.querySelector(`.bin-card[data-id="${k2.id}"] .bin-sect`).click(); await new Promise(r => setTimeout(r, 300));
  const back = { own: !!k2.own, stack: e.stack.length, pool: e.pickList().filter(c => c.id === k2.id).length, card: !!document.querySelector(`.bin-card[data-id="${k2.id}"]`) };
  // the Sections editor's ↗
  djApp.clipTools.openSections(p2); await new Promise(r => setTimeout(r, 150));
  document.querySelectorAll('#sectList .sect-own')[2].click(); await new Promise(r => setTimeout(r, 150));
  const viaEditor = e.sectionsOf(p2)[2].own;
  djApp.clipTools.closeSections();
  e.setSections(p2.id, []);
  return { before, after, top, kept, back, viaEditor, clipsLeft: e.stack.length };
});
ok('"Make its own clip": its own card under its clip, picked once through it, chip marked ↗, frame of its own, Importance', own.after.stack === own.before.stack + 1 && own.after.pool === own.before.pool && own.after.inPool === 1 && own.after.next && own.after.card && own.after.chip === '↗7' && own.after.imp, JSON.stringify(own.after));
ok('it moves in the stack on its own; saved and reopened; "↩ Back" returns it to the strip; ↗ in the Sections editor works too', own.top && own.kept.own && own.kept.top && !own.back.own && own.back.stack === own.before.stack && own.back.pool === 1 && !own.back.card && own.viaEditor && own.clipsLeft === own.before.stack, JSON.stringify({ top: own.top, kept: own.kept, back: own.back, viaEditor: own.viaEditor }));

// 6) Live: two sections of one video blend with the band transitions
// (each section has its own player on the same file).
const blend = await E(async () => {
  const e = djApp.clipEngine, p = e.mediaAssets[0];
  e.setSpeed(p.id, 1);
  e.setSections(p.id, [20]);
  e.settings.transitionMode = 'crossfade';
  djApp.seekMaster(1); await djApp.toggleAudio();
  let seen = null;
  for (let i = 0; i < 120 && !seen; i++) {
    await new Promise(r => setTimeout(r, 50));
    if (e.transition && e.outgoing && e.current && e.outgoing.clip.parent === p.id && e.current.clip.parent === p.id && e.outgoing.clip !== e.current.clip) {
      const a = e.outgoing.clip.el, b = e.current.clip.el;
      seen = { def: e.transition.def.id, separate: a !== b, aT: +a.currentTime.toFixed(2), bT: +b.currentTime.toFixed(2), playing: !a.paused && !b.paused };
    }
  }
  await djApp.toggleAudio();
  e.settings.transitionMode = 'jump';
  return seen;
});
ok('live: a crossfade between two sections of one video shows both (decks A and B on the same file)', blend && blend.def === 'crossfade' && blend.separate && blend.playing && Math.abs(blend.aT - blend.bT) > 5, JSON.stringify(blend));

// Two decks per file at most (A / B), however many sections it has.
const decks = await E(async () => {
  const e = djApp.clipEngine, p = e.mediaAssets[0];
  e.setSections(p.id, [8, 16, 24, 32]);
  e.settings.transitionMode = 'crossfade';
  djApp.seekMaster(1); await djApp.toggleAudio(); await new Promise(r => setTimeout(r, 4000)); await djApp.toggleAudio();
  e.settings.transitionMode = 'jump';
  const players = [...document.querySelectorAll('video')].filter(v => v.src === p.url || v.currentSrc === p.url).length;
  return { sections: e.sectionsOf(p).length, players };
});
ok('a video with 5 sections uses at most two players (decks A and B)', decks.sections === 5 && decks.players >= 1 && decks.players <= 2, JSON.stringify(decks));

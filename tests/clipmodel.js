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
  return { per, cards, parentInCut: edl.some(s => s.clipId === id), stackLen: e.stack.length, media: e.mediaAssets.length };
}, id);
ok('4 sections = 4 cards, no copy of the video', r2.stackLen === 4 && r2.media === 1 && r2.cards.length === 4 && /· 2\/4$/.test(r2.cards[1]), r2.cards.join(' | '));
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
const cards2 = await E(() => djApp.clipEngine.stack.map(c => c.name));
await page.mouse.click(geo.x8, geo.y, { button: 'right' }); await sleep(200);
const s3 = await E(() => djApp.clipEngine.mediaAssets[0].sections.slice());
await E(() => djApp.clipTools.closeSections());
ok('Sections editor: click adds on a bar line, drag snaps to bars, right-click deletes', geo.bar === 2 && s1.join() === '6' && s2.join() === '8' && cards2.length === 2 && s3.length === 0, `bar ${geo.bar} s · click → ${s1} · drag → ${s2} (${cards2.join(', ')}) · right-click → [${s3}]`);

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
ok('live: a crossfade between two sections of one video shows both (own players, same file)', blend && blend.def === 'crossfade' && blend.separate && blend.playing && Math.abs(blend.aT - blend.bT) > 5, JSON.stringify(blend));

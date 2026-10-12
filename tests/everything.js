// Step 7 (v2.4): one project with every v2.4 feature on at once; the export
// must match the session.
//
// Built here:
// - The track: 40 s at 120 BPM (1 bar = 2 s). The music starts at 0:04 and
//   plays 30 s, so the song ends at 0:34. Fade in 1 bar, fade out 2 s.
// - A voice-over: 6 s of 440 Hz from 0:00, so it plays alone in the pre-roll.
// - The "clock" video: 40 s, red level = source time, cut every 4 bars into
//   5 sections. §1 is not used, §2 plays at 1.5×, §3 has its own card and
//   §4 has a visual mode.
// - Green image: full frame, 2 repeats. Blue image: Over, small, top left.
// - Yellow image: the CTA (last 4 s). A title at the start; end credits.
//
// Checked:
// - Each base cut in the export shows what the cut list says: which clip,
//   and for the clock which source second.
// - Before 0:04 the export has cuts and only the voice's sound.
// - The over image appears in its corner, and the CTA closes the song.
// - Repeats hold, the own section is picked and §1 never is.
// - Saving and reopening gives the same cut list.
const E = (fn, arg) => page.evaluate(fn, arg);

await E(async () => {
  const wav = (sr, sec, fn) => {
    const n = sr * sec, L = new Int16Array(n);
    for (let i = 0; i < n; i++) L[i] = Math.max(-1, Math.min(1, fn(i / sr))) * 32767;
    const h = new DataView(new ArrayBuffer(44)); const W = (o, s) => [...s].forEach((c, k) => h.setUint8(o + k, c.charCodeAt(0)));
    W(0, 'RIFF'); h.setUint32(4, 36 + n * 2, true); W(8, 'WAVE'); W(12, 'fmt '); h.setUint32(16, 16, true); h.setUint16(20, 1, true); h.setUint16(22, 1, true);
    h.setUint32(24, sr, true); h.setUint32(28, sr * 2, true); h.setUint16(32, 2, true); h.setUint16(34, 16, true); W(36, 'data'); h.setUint32(40, n * 2, true);
    return [h.buffer, L.buffer];
  };
  window.__track = new File(wav(22050, 40, (t) => { const b = (t - 0.25 + 10) % 0.5, down = Math.floor((t - 0.25 + 10) / 0.5) % 4 === 0; return (b < 0.12 ? (down ? 1 : 0.6) * Math.sin(2 * Math.PI * (50 + 90 * Math.exp(-b * 30)) * b) * Math.exp(-b * 16) : 0) * 0.8; }), 'ev-kick-120.wav', { type: 'audio/wav' });
  window.__voice = new Blob(wav(22050, 6, (t) => 0.5 * Math.sin(2 * Math.PI * 440 * t)), { type: 'audio/wav' });
  const png = async (name, col) => { const c = document.createElement('canvas'); c.width = 160; c.height = 90; const g = c.getContext('2d'); g.fillStyle = col; g.fillRect(0, 0, 160, 90); return new File([await new Promise(r => c.toBlob(r, 'image/png'))], name + '.png', { type: 'image/png' }); };
  window.__imgs = [await png('Green', 'rgb(0,200,0)'), await png('Blue', 'rgb(0,0,255)'), await png('Yellow', 'rgb(255,230,0)')];

  // Clock clip: 40 s, 10 fps, red = time / 40 × 255 (no sound needed).
  const M = await djApp.renderer.lib();
  const unpatch = OfflineRenderer.patchEncoder();
  try {
    const out = new M.Output({ format: new M.Mp4OutputFormat({ fastStart: 'in-memory' }), target: new M.BufferTarget() });
    const c = document.createElement('canvas'); c.width = 160; c.height = 90;
    const g = c.getContext('2d');
    const vcodec = await M.getFirstEncodableVideoCodec(['avc', 'vp9', 'av1'], { width: 160, height: 90 });
    const vs = new M.CanvasSource(c, { codec: vcodec, bitrate: M.QUALITY_HIGH, keyFrameInterval: 1 });
    out.addVideoTrack(vs, { frameRate: 10 });
    await out.start();
    for (let f = 0; f < 400; f++) {
      const r = Math.round((f / 10 / 40) * 255);
      g.fillStyle = `rgb(${r},40,${255 - r})`; g.fillRect(0, 0, 160, 90);
      await vs.add(f / 10, 0.1);
    }
    await out.finalize();
    window.__clock = new File([out.target.buffer], 'Clock.mp4', { type: 'video/mp4' });
  } finally { unpatch(); }
  window.__waitFast = async () => { for (let i = 0; i < 150 && djApp.fastPass.state.stage !== 'done'; i++) await new Promise(r => setTimeout(r, 200)); await new Promise(r => setTimeout(r, 700)); djApp.fastPass.flush(); };
});

// ---- the project ----------------------------------------------------------
const setup = await E(async () => {
  document.getElementById('audioSourceFile').click();
  await djApp.loadAudioFile(window.__track, { autoplay: false });
  const e = djApp.clipEngine;
  e.addFiles([window.__clock, ...window.__imgs]);
  for (let i = 0; i < 80 && !e.assets.every(a => a.ready && (a.kind !== 'video' || a.duration > 0)); i++) await new Promise(r => setTimeout(r, 200));
  Object.assign(e.settings, { transitionMode: 'jump' });
  const v = document.getElementById('visualMode'); v.value = 'clips'; v.dispatchEvent(new Event('change'));
  await window.__waitFast();
  const by = (n) => e.assets.find(a => a.name === n);
  const clock = by('Clock'), green = by('Green'), blue = by('Blue'), yellow = by('Yellow');
  // Sections every 4 bars (8 s): 5 sections.
  djApp.clipTools.openSections(clock); djApp.clipTools.autoSlice(4); djApp.clipTools.closeSections();
  const S = e.sectionsOf(clock);
  e.setAssetAsClip(S[0].id, false);              // §1 not used
  e.setSpeed(S[1].id, 1.5);                       // §2 at 1.5×
  e.setSectionOwn(S[2].id, true);                 // §3 its own clip
  e.setClipVisual ? e.setClipVisual(S[3].id, { mode: 'bars' }) : (S[3].visual = { ...S[3].visual, mode: 'bars' });   // §4 visual mode
  green.show = 'full'; e.setRepeats ? e.setRepeats(green.id, 2) : (green.repeats = 2);
  blue.show = 'over'; blue.placement = Placement.defaults({ anchor: 'tl', size: 20 });
  yellow.show = 'full'; yellow.storyHold = 4; e.setClipStory(yellow.id, 'cta');
  // Titles
  const title = djApp.text.add('title');
  const credits = djApp.text.add('credits');
  // Voice-over from 0:00
  await djApp.voice.load(window.__voice, { offset: 0, name: 'VO' });
  // Track: starts at 0:04, 30 s long, fades
  djApp.setTrackStart(4);
  djApp.setTrackLength(30);
  djApp.setMasterFade('in', { on: true, len: 1, unit: 'bar', shape: 'linear' });
  djApp.setMasterFade('out', { on: true, len: 2, unit: 's', shape: 'linear' });
  e.emit('clips');
  await new Promise(r => setTimeout(r, 800)); djApp.fastPass.flush();
  window.__ids = { clock: clock.id, green: green.id, blue: blue.id, yellow: yellow.id, s: S.map(s => s.id), title: title.id, credits: credits.id };
  return { sections: S.length, song: djApp.songLength(), start: djApp.trackStart, bpm: djApp.tempo.bpm, stack: e.stack.map(c => c.name), visual: S[3].visual.mode };
});
ok('the project: 5 sections (§3 its own card), song 0:04–0:34 at 120 BPM, voice, titles, CTA, over image', setup.sections === 5 && setup.song === 34 && setup.start === 4 && setup.bpm === 120 && setup.stack.some(n => /3\/5/.test(n)) && setup.visual === 'bars', JSON.stringify(setup));

// ---- the session's cut list -----------------------------------------------
const plan = await E(() => {
  const e = djApp.clipEngine, I = window.__ids, edl = e.edl();
  const base = edl.filter(s => s.stream !== 'over'), over = edl.filter(s => s.stream === 'over');
  const cr = djApp.text.windowOf(djApp.text.get(I.credits));
  return {
    base: base.map(s => ({ id: s.clipId, a: +s.start.toFixed(3), b: +s.end.toFixed(3), story: !!s.story })),
    over: over.map(s => ({ id: s.clipId, a: +s.start.toFixed(3), b: +s.end.toFixed(3) })),
    credits: cr, pre: base.filter(s => s.start < 4).length,
    greens: base.filter(s => s.clipId === I.green).length, own: base.filter(s => s.clipId === I.s[2]).length, s1: base.filter(s => s.clipId === I.s[0]).length,
    end: +edl.reduce((m, s) => Math.max(m, s.end), 0).toFixed(2), duration: djApp.renderer.plan().duration,
  };
});
ok('the cut list: cuts in the pre-roll, green at most twice, the own section picked, §1 never, ends at 0:34', plan.pre >= 1 && plan.greens >= 1 && plan.greens <= 2 && plan.own >= 1 && plan.s1 === 0 && plan.end === 34 && plan.duration === 34, JSON.stringify({ pre: plan.pre, greens: plan.greens, own: plan.own, s1: plan.s1, end: plan.end, dur: plan.duration, over: plan.over.length }));

// ---- export and read back ---------------------------------------------------
const x = await E(async () => {
  const e = djApp.clipEngine, I = window.__ids, edl = e.edl();
  window.showSaveFilePicker = async () => (await navigator.storage.getDirectory()).getFileHandle('everything.mp4', { create: true });
  const res = await djApp.renderer.export({ size: '720p', fps: 30, quality: 'high', name: 'everything.mp4' }, () => {});
  const M = await djApp.renderer.lib();
  const file = await (await (await navigator.storage.getDirectory()).getFileHandle('everything.mp4')).getFile();
  const input = new M.Input({ source: new M.BlobSource(file), formats: M.ALL_FORMATS });
  const vt = await input.getPrimaryVideoTrack();
  const sink = new M.CanvasSink(vt, { width: 32, height: 18, fit: 'fill' });
  const patch = async (t, x0, y0, w, h) => { const d = (await sink.getCanvas(t)).canvas.getContext('2d').getImageData(x0, y0, w, h).data; let r = 0, g = 0, b = 0; for (let i = 0; i < d.length; i += 4) { r += d[i]; g += d[i + 1]; b += d[i + 2]; } const n = d.length / 4; return [r / n, g / n, b / n].map(Math.round); };
  const cr = djApp.text.windowOf(djApp.text.get(I.credits)), tw = djApp.text.windowOf(djApp.text.get(I.title));
  // Base cuts: sample the middle of each (≥ 0.4 s, not under the credits, not the visual-mode section).
  const checks = [];
  for (const s of edl.filter(s => s.stream !== 'over')) {
    if (s.end - s.start < 0.4 || s.clipId === I.s[3]) continue;
    const t = (s.start + s.end) / 2;
    if (cr && t >= cr[0] - 0.2) continue;
    if (tw && t >= tw[0] - 0.2 && t <= tw[1] + 0.2) continue;   // the title is on screen (checked below)
    const [r, g, b] = await patch(t, 14, 6, 4, 3);
    const a = e.clipById(s.clipId);
    let want, got, pass;
    if (a.id === I.green) { want = 'green'; got = `${r},${g},${b}`; pass = g > 150 && r < 60; }
    else if (a.id === I.yellow) { want = 'yellow'; got = `${r},${g},${b}`; pass = r > 200 && g > 180 && b < 80; }
    else { want = +djApp.renderer.clipTime(s, null, t, 40).toFixed(2); got = +((r / 255) * 40).toFixed(2); pass = Math.abs(got - want) < 0.7; }
    checks.push({ t: +t.toFixed(2), want, got, pass });
  }
  // Over image: top-left corner blue in the middle of each over cut.
  const overs = [];
  for (const s of edl.filter(s => s.stream === 'over' && s.end - s.start >= 0.4)) {
    const [r, g, b] = await patch((s.start + s.end) / 2, 0, 0, 3, 2);
    overs.push({ t: +((s.start + s.end) / 2).toFixed(2), rgb: [r, g, b], pass: b > 150 && r < 90 });
  }
  // Title: white text on screen in its window, gone after it.
  const big = new M.CanvasSink(vt, { width: 320, height: 180, fit: 'fill' });
  const bright = async (t) => { const d = (await big.getCanvas(t)).canvas.getContext('2d').getImageData(0, 0, 320, 180).data; let n = 0; for (let i = 0; i < d.length; i += 4) if (d[i] > 230 && d[i + 1] > 230 && d[i + 2] > 230) n++; return n; };
  const title = { win: tw && tw.map(v => +v.toFixed(2)), during: await bright((tw[0] + tw[1]) / 2), after: await bright(tw[1] + 1.5) };
  // CTA: the last 4 s, top-right corner (credits sit lower).
  const [cr2, cg2, cb2] = await patch(32.5, 28, 0, 4, 3);
  // Sound: the pre-roll is the voice alone (440 Hz); the music is there after 0:04 and fades out at the end.
  const at = await input.getPrimaryAudioTrack();
  const asink = new M.AudioBufferSink(at);
  const sound = async (a, b) => { let cross = 0, n = 0, prev = 0, sq = 0, rate = 48000; for await (const { buffer } of asink.buffers(a, b)) { rate = buffer.sampleRate; const ch = buffer.getChannelData(0); for (let i = 0; i < ch.length; i++) { if (prev < 0 && ch[i] >= 0) cross++; prev = ch[i]; sq += ch[i] * ch[i]; n++; } } return { hz: n ? Math.round(cross / (n / rate)) : 0, rms: n ? +Math.sqrt(sq / n).toFixed(4) : 0 }; };
  return { dur: +res.duration.toFixed(2), title, checks, overs, cta: [cr2, cg2, cb2], pre: await sound(0.5, 3.5), music: await sound(10, 14), tail: await sound(33.7, 33.95) };
});
const bad = x.checks.filter(c => !c.pass);
ok(`every sampled base cut in the export shows what the cut list says (${x.checks.length} cuts, clock source time ±0.7 s)`, x.dur === 34 && x.checks.length >= 6 && bad.length === 0, JSON.stringify(bad.length ? bad : x.checks.slice(0, 6)));
ok('the title shows (white text) during its window and is gone after', x.title.during >= 40 && x.title.after < 5, JSON.stringify(x.title));
ok('the over image sits in its corner during its cuts; the CTA closes the song', x.overs.length >= 1 && x.overs.every(o => o.pass) && x.cta[0] > 200 && x.cta[1] > 180 && x.cta[2] < 80, JSON.stringify({ overs: x.overs, cta: x.cta }));
ok('sound: the voice alone before 0:04 (440 Hz), the music after it, faded out at the end', Math.abs(x.pre.hz - 440) < 20 && x.pre.rms > 0.1 && x.music.rms > 0.02 && x.tail.rms < x.music.rms * 0.35, JSON.stringify({ pre: x.pre, music: x.music, tail: x.tail }));

// ---- save and reopen ----------------------------------------------------------
const re = await E(async () => {
  const sig = () => djApp.clipEngine.edl().map(s => `${s.clipId}@${s.start.toFixed(2)}-${s.end.toFixed(2)}${s.stream === 'over' ? 'o' : ''}`).join(' ');
  const before = sig();
  const blob = await djApp.project.build();
  djApp.project.dirty = false;
  await djApp.project.open(new File([blob], 'everything.mnt'));
  await window.__waitFast();
  const e = djApp.clipEngine, clock = e.mediaAssets.find(a => a.name === 'Clock');
  return { same: sig() === before, start: djApp.trackStart, song: djApp.songLength(), own: e.sectionsOf(clock).map(s => !!s.own).join(), voice: djApp.voice.isLoaded, text: djApp.text.items.length, fades: [djApp.masterFade.in.on, djApp.masterFade.out.on].join(), dirty: djApp.project.dirty };
});
ok('saved and reopened: the same cut list, start, length, own section, voice, titles and fades', re.same && re.start === 4 && re.song === 34 && re.own === 'false,false,true,false,false' && re.voice && re.text === 2 && re.fades === 'true,true' && !re.dirty, JSON.stringify(re));

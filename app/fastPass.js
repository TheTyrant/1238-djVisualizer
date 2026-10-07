// Fast pass (v2.4, D-80): the whole song analysed the moment it loads.
//
// The track is decoded offline and fed, frame by frame on a simulated
// 60 fps clock, through a second instance of the FROZEN AudioProcessor —
// its own bandEnergy() / detectBeat() / BPM maths, untouched. Only its
// inputs are simulated:
//   - the AnalyserNode (fftSize 1024, smoothing 0.3, −90…−10 dB, the same
//     settings TrackSource uses), reproduced from the Web Audio spec:
//     mono down-mix, Blackman window, FFT, |X|/N, time smoothing, dB → byte;
//   - Date.now(), which the beat detector reads, stepped 1/60 s per frame.
// The analysis EQ (D-51), when on, is applied to the decoded audio first,
// so the fast pass hears what the live analysis hears.
//
// From that it produces:
//   - the per-frame analysis log (SessionRecord frames marked "fast"),
//   - the tempo grid (median BPM after lock, bar-1 phase; TempoGrid),
//   - the cut list, by running the ClipEngine scheduler itself (dry, no
//     media touched) on the same clock.
// Anything played for real wins: played frames and cuts are never replaced
// by fast ones ("Refill from fast pass" replaces them on request).
class FastPass {
  static FPS = 60;
  static FFT = 1024;
  static SLICE_MS = 10;         // work per slice before giving the page a turn

  constructor(app) {
    this.app = app;
    this.data = null;           // analysis of the loaded track (see analyse())
    this.mono = null;           // decoded track, mono, at the analysis rate
    this.job = null;
    this.state = { stage: 'idle', pct: 0 };
    this.listeners = new Set();
    this.timer = null;
  }

  on(fn) { this.listeners.add(fn); }
  emit() { this.listeners.forEach(fn => fn(this.state)); }
  setState(stage, pct = 0, text = '') { this.state = { stage, pct, text }; this.emit(); }

  get busy() { return !!this.job; }

  cancel() {
    if (this.job) this.job.cancelled = true;
    this.job = null;
  }

  // Track unloaded / replaced: forget everything about the old one.
  clear() {
    this.cancel();
    clearTimeout(this.timer);
    clearTimeout(this.eqTimer);
    this.data = null;
    this.mono = null;
    this.setState('idle');
  }

  // ---- 1. decode + analyse ----------------------------------------------

  async run(file) {
    this.clear();
    const job = { cancelled: false };
    this.job = job;
    const app = this.app;
    try {
      this.setState('decoding', 0, 'Decoding…');
      const sr = (app.audioProcessor.audioContext && app.audioProcessor.audioContext.sampleRate) || 48000;
      const bytes = await file.arrayBuffer();
      if (job.cancelled) return false;
      const audio = await new OfflineAudioContext(2, 1, sr).decodeAudioData(bytes);
      if (job.cancelled) return false;
      // The analyser down-mixes to mono before it analyses (speaker rules).
      const n = audio.length, mono = new Float32Array(n);
      const chs = audio.numberOfChannels;
      const data = Array.from({ length: chs }, (_, c) => audio.getChannelData(c));
      for (let i0 = 0; i0 < n; i0 += 262144) {
        const i1 = Math.min(n, i0 + 262144);
        for (let c = 0; c < chs; c++) { const d = data[c]; for (let i = i0; i < i1; i++) mono[i] += d[i] / chs; }
        await new Promise(r => setTimeout(r, 0));
        if (job.cancelled) return false;
      }
      this.mono = { samples: mono, sr, duration: audio.duration };
      return await this.analyse(job);
    } catch (e) {
      console.warn('Fast pass failed (the track still plays):', e);
      if (this.job === job) this.setState('failed', 0, 'Fast pass failed');
      return false;
    } finally {
      if (this.job === job) this.job = null;
    }
  }

  reanalyseSoon(ms = 800) {
    if (!this.mono) return;
    clearTimeout(this.eqTimer);
    this.eqTimer = setTimeout(() => {
      if (this.app.timelineRolling()) { this.reanalyseSoon(1500); return; }
      this.reanalyse();
    }, ms);
  }

  // Re-analyse the decoded track (the analysis EQ changed).
  async reanalyse() {
    if (!this.mono) return false;
    this.cancel();
    const job = { cancelled: false };
    this.job = job;
    try { return await this.analyse(job); } finally { if (this.job === job) this.job = null; }
  }

  async eqApplied(samples, sr) {
    const eq = this.app.eq;
    const live = eq.active ? eq.bands.filter(b => eq.isActiveBand(b)) : [];
    if (!live.length) return samples;
    const ctx = new OfflineAudioContext(1, samples.length, sr);
    const buf = ctx.createBuffer(1, samples.length, sr);
    buf.copyToChannel(samples, 0);
    const src = ctx.createBufferSource();
    src.buffer = buf;
    let prev = src;
    live.forEach(b => {
      const f = ctx.createBiquadFilter();
      f.type = b.type; f.frequency.value = b.freq; f.Q.value = b.q; f.gain.value = b.gain;
      prev.connect(f); prev = f;
    });
    prev.connect(ctx.destination);
    src.start();
    return (await ctx.startRendering()).getChannelData(0);
  }

  async analyse(job) {
    const { sr, duration } = this.mono;
    this.setState('analysing', 0, 'Analysing…');
    const x = await this.eqApplied(this.mono.samples, sr);
    if (job.cancelled) return false;

    const N = FastPass.FFT, half = N / 2, BINS = SessionRecord.BINS, per = Math.max(1, Math.floor(half / BINS));
    const frames = Math.floor(duration * FastPass.FPS) + 1;
    const out = {
      frames, duration, sr,
      rms: new Float32Array(frames), bass: new Float32Array(frames), mid: new Float32Array(frames), high: new Float32Array(frames),
      bpm: new Uint16Array(frames), active: new Uint8Array(frames), bins: new Uint8Array(frames * BINS),
      edges: [],                 // detected beat times (s)
    };

    // The simulated AnalyserNode.
    const an = FastPass.analyser(N, 0.3, -90, -10);
    const freq = new Uint8Array(half), time = new Uint8Array(N), win = new Float32Array(N);

    // A second AudioProcessor, frozen code, fed by the simulation.
    const proc = new AudioProcessor();
    proc.audioContext = { sampleRate: sr };
    proc.analyserNode = {
      frequencyBinCount: half, fftSize: N,
      getByteFrequencyData: (a) => a.set(freq), getByteTimeDomainData: (a) => a.set(time),
    };
    proc.dataArray = new Uint8Array(half);
    proc.timeDataArray = new Uint8Array(N);
    let data = null;
    proc.onDataUpdate = (d) => { data = d; proc.isRunning = false; };   // no requestAnimationFrame loop

    const T0 = 1.7e12;   // a wall-clock-like start, so the first beat behaves as live
    let lastBeat = proc.lastBeatTime;
    for (let f0 = 0, f1 = 0; f0 < frames; f0 = f1) {
      const until = performance.now() + FastPass.SLICE_MS;
      FastPass.withClock(() => T0, () => {
        for (let f = f0; f < frames; f++) {
          if (f > f0 && performance.now() > until) { f1 = f; return; }
          f1 = f + 1;
          FastPass.clockMs = T0 + (f * 1000) / FastPass.FPS;
          const end = Math.round((f / FastPass.FPS) * sr);
          for (let i = 0; i < N; i++) { const k = end - N + i; win[i] = k >= 0 && k < x.length ? x[k] : 0; }
          an.process(win, freq, time);
          data = null;
          proc.isRunning = true;
          proc.updateAudioData();
          proc.isRunning = false;
          if (!data) continue;
          out.rms[f] = data.rms; out.bass[f] = data.bass; out.mid[f] = data.mid; out.high[f] = data.high;
          out.bpm[f] = data.bpm || 0; out.active[f] = data.isActive ? 1 : 0;
          const s = data.spectrum;
          for (let k = 0; k < BINS; k++) {
            let sum = 0;
            for (let j = 0; j < per; j++) sum += s[k * per + j] || 0;
            out.bins[f * BINS + k] = Math.max(0, Math.min(255, Math.round((sum / per) * 255)));
          }
          if (proc.lastBeatTime !== lastBeat) { lastBeat = proc.lastBeatTime; out.edges.push(f / FastPass.FPS); }
        }
      });
      this.setState('analysing', Math.round((f1 / frames) * 100), `Analysing… ${Math.round((f1 / frames) * 100)}%`);
      await new Promise(r => setTimeout(r, 0));
      if (job.cancelled) { this.setState('cancelled', 0, 'Fast pass cancelled'); return false; }
    }

    Object.assign(out, FastPass.tempoOf(out));
    this.data = out;
    this.app.tempo.detect(out.tempo, out.offset);
    this.fill({ rolling: true });
    this.setState('done', 100, out.tempo > 0 ? `${out.tempo} BPM` : 'No steady beat found');
    return true;
  }

  // Run fn with Date.now() and console.log replaced (the frozen detector
  // reads the clock and logs every beat). Always restored, and synchronous,
  // so nothing else ever sees the simulated clock.
  static clockMs = 0;
  static withClock(_, fn) {
    const now = Date.now, log = console.log;
    Date.now = () => FastPass.clockMs;
    console.log = () => {};
    try { return fn(); } finally { Date.now = now; console.log = log; }
  }

  // AnalyserNode, per the Web Audio spec (getByteFrequencyData /
  // getByteTimeDomainData on one block of fftSize samples).
  static analyser(N, smoothing, minDb, maxDb) {
    const half = N / 2;
    const blackman = new Float32Array(N);
    const a = 0.16, a0 = (1 - a) / 2, a1 = 0.5, a2 = a / 2;
    for (let i = 0; i < N; i++) blackman[i] = a0 - a1 * Math.cos((2 * Math.PI * i) / N) + a2 * Math.cos((4 * Math.PI * i) / N);
    const re = new Float64Array(N), im = new Float64Array(N), smooth = new Float64Array(half);
    const levels = Math.log2(N), rev = new Uint32Array(N);
    for (let i = 0; i < N; i++) { let r = 0; for (let b = 0; b < levels; b++) r = (r << 1) | ((i >> b) & 1); rev[i] = r; }
    const cos = new Float64Array(half), sin = new Float64Array(half);
    for (let i = 0; i < half; i++) { cos[i] = Math.cos((2 * Math.PI * i) / N); sin[i] = Math.sin((2 * Math.PI * i) / N); }
    const scale = 255 / (maxDb - minDb);
    return {
      process(x, freqOut, timeOut) {
        for (let i = 0; i < N; i++) {
          const v = 128 * (x[i] + 1);
          timeOut[i] = v <= 0 ? 0 : v >= 255 ? 255 : v | 0;
          re[rev[i]] = x[i] * blackman[i];
          im[rev[i]] = 0;
        }
        for (let size = 2; size <= N; size <<= 1) {
          const h = size >> 1, step = N / size;
          for (let s = 0; s < N; s += size) {
            for (let j = 0; j < h; j++) {
              const k = j * step, wr = cos[k], wi = -sin[k];
              const p = s + j, q = p + h;
              const tr = re[q] * wr - im[q] * wi, ti = re[q] * wi + im[q] * wr;
              re[q] = re[p] - tr; im[q] = im[p] - ti;
              re[p] += tr; im[p] += ti;
            }
          }
        }
        for (let k = 0; k < half; k++) {
          const mag = Math.hypot(re[k], im[k]) / N;
          smooth[k] = smoothing * smooth[k] + (1 - smoothing) * mag;
          const db = smooth[k] > 0 ? 20 * Math.log10(smooth[k]) : -1000;
          const v = scale * (db - minDb);
          freqOut[k] = v <= 0 ? 0 : v >= 255 ? 255 : v | 0;
        }
      },
    };
  }

  // Tempo = median BPM once the detector has locked, refined to the tempo
  // near it (±25 %) that the detected beats fit best — the frozen detector
  // drifts on busy songs (a 97 BPM track reads 97…114, median 112, while
  // its beats line up at exactly 97). Bar 1 = the phase that best fits the
  // detected beats (circular mean), on the beat of the bar with the most
  // bass (D-81).
  static tempoOf(d) {
    let first = -1;
    for (let f = 0; f < d.frames; f++) if (d.bpm[f] > 0) { first = f; break; }
    if (first < 0) return { tempo: 0, offset: 0 };
    const vals = Array.from(d.bpm.subarray(first)).filter(v => v > 0).sort((p, q) => p - q);
    const m = vals.length >> 1;
    const median = vals.length % 2 ? vals[m] : (vals[m - 1] + vals[m]) / 2;
    const lockT = first / FastPass.FPS;
    const edges = d.edges.filter(t => t >= lockT - 2);
    const fit = (bpm) => {
      const P = 60 / bpm;
      let x = 0, y = 0;
      edges.forEach(t => { const a = (2 * Math.PI * t) / P; x += Math.cos(a); y += Math.sin(a); });
      return { x, y, r: edges.length ? Math.hypot(x, y) / edges.length : 0 };
    };
    let tempo = median, bestR = fit(median).r;
    const r0 = bestR;
    for (let b = Math.ceil(median * 0.75 * 10) / 10; b <= median * 1.25; b += 0.1) { const r = fit(b).r; if (r > bestR) { bestR = r; tempo = b; } }
    for (let b = tempo - 0.1; b <= tempo + 0.1; b += 0.01) { const r = fit(b).r; if (r > bestR) { bestR = r; tempo = b; } }
    // Only a clearly better fit replaces the median.
    if (!(bestR >= 0.2 && bestR >= r0 * 1.5)) tempo = median;
    tempo = Math.round(tempo * 100) / 100;
    if (Math.abs(tempo - Math.round(tempo)) < 0.05) tempo = Math.round(tempo);
    const P = 60 / tempo;
    const { x: sx, y: sy } = fit(tempo);
    let phase = sx || sy ? ((Math.atan2(sy, sx) / (2 * Math.PI)) * P) : 0;
    phase = ((phase % P) + P) % P;
    // The detector fires once bass is over its threshold AND still rising,
    // which can be several frames after the hit (8 on a soft kick). Move the
    // phase back to where the bass starts rising, within a third of a beat
    // before the detected beats (never later than a sliver after them).
    const rise = (t) => { const f = Math.ceil(t * FastPass.FPS - 1e-9); return f >= 1 && f < d.frames ? Math.max(0, d.bass[f] - d.bass[f - 1]) : 0; };
    const onsetAt = (dl) => { let s = 0; for (let t = ((phase + dl) % P + P) % P; t < d.duration; t += P) s += rise(t); return s; };
    const steps = [];
    for (let dl = -0.33 * P; dl <= 0.05 * P; dl += 1 / 240) steps.push([dl, onsetAt(dl)]);
    const top = Math.max(...steps.map(s => s[1]));
    if (top > 0) {
      const i = steps.findIndex(s => s[1] >= top * 0.999);
      let j = i; while (j + 1 < steps.length && steps[j + 1][1] >= top * 0.999) j++;
      phase = (((phase + (steps[i][0] + steps[j][0]) / 2) % P) + P) % P;   // centre of the best frame
    }
    const bpb = MusicalTime.beatsPerBar();
    let best = 0, bestScore = -1;
    for (let k = 0; k < bpb; k++) {
      let score = 0;
      for (let t = phase + k * P; t < d.duration; t += P * bpb) {
        // the hit's peak: the most bass in the 100 ms after the onset
        let peak = 0;
        for (let f = Math.ceil(t * FastPass.FPS), e = Math.min(d.frames, f + 6); f < e; f++) peak = Math.max(peak, d.bass[f]);
        score += peak;
      }
      if (score > bestScore) { bestScore = score; best = k; }
    }
    return { tempo, offset: phase + best * P, median, fit: Math.round(bestR * 1000) / 1000 };
  }

  // ---- 2. fill the session (frames + cuts) ------------------------------

  // Debounced refill after edits (clips, settings, tempo). Never while the
  // timeline rolls: it fills once playback stops.
  soon(ms = 350) {
    if (!this.data) return;
    clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      this.timer = null;
      if (this.app.timelineRolling()) { this.soon(1000); return; }
      this.fill();
    }, ms);
  }

  // Run a pending refill now (before saving or exporting).
  flush() {
    if (!this.timer) return;
    clearTimeout(this.timer);
    this.timer = null;
    if (!this.app.timelineRolling()) this.fill();
  }

  // Sensitivity-adjusted analysis for frame f (what onDataUpdate passes on).
  frameData(f) {
    const d = this.data, app = this.app, BINS = SessionRecord.BINS;
    const spectrum = new Array(BINS);
    for (let k = 0; k < BINS; k++) spectrum[k] = d.bins[f * BINS + k] / 255;
    return {
      rms: d.rms[f], bass: d.bass[f] * app.sensitivity('bass'), mid: d.mid[f] * app.sensitivity('mid'),
      high: d.high[f] * app.sensitivity('high'), spectrum, bpm: d.bpm[f], isActive: !!d.active[f],
    };
  }

  // While the timeline rolls, only on request (right after the analysis):
  // played frames and cuts still win, and playing on overwrites the fast
  // ones as it goes.
  fill({ rolling = false } = {}) {
    const d = this.data, app = this.app;
    if (!d || !app.isTrackMode() || (app.timelineRolling() && !rolling)) return false;
    const rec = app.record, e = app.clipEngine;
    const T0 = 1.7e12;

    // Shim of the visualizer's beat clock (beatFlash / beatPulse), run with
    // DJVisualizer's own updateAudioData on the simulated clock.
    const viz = { audioData: {}, bpmInterval: 0, lastBeatTime: 0, beatFlash: 0, beatPulse: 0, currentMode: app.visualizer.currentMode };
    const sim = this.simEngine(viz);
    const fps = FastPass.FPS;
    let t = 0;
    if (sim) sim.clock = () => t;

    const seed = FastPass.rng(0x5eed ^ d.frames);
    const rnd = Math.random;
    Math.random = seed;
    try {
      FastPass.withClock(null, () => {
        let lastBeat = viz.lastBeatTime;
        for (let f = 0; f < d.frames; f++) {
          FastPass.clockMs = T0 + (f * 1000) / fps;
          t = f / fps;
          const data = this.frameData(f);
          DJVisualizer.prototype.updateAudioData.call(viz, data);
          const edge = viz.lastBeatTime !== lastBeat;
          lastBeat = viz.lastBeatTime;
          rec.writeFast(f, data, viz, edge);
          if (sim) sim.update(data);
        }
      });
    } finally { Math.random = rnd; }

    // Cuts: fast ones only where nothing was played for real.
    e.segments = e.segments.filter(s => s.pass !== 'fast');
    if (sim) {
      sim.closeOpenSegment(d.duration);
      const played = FastPass.spans(e.segments.map(s => [s.start, s.end == null ? e.lastAdvanceTime : s.end]));
      const pieces = [];
      sim.edl().forEach(s => FastPass.subtract([s.start, s.end], played).forEach(([a, b]) => {
        if (b - a < 1 / FastPass.FPS) return;   // slivers under a frame: nothing to see
        const cut = { ...s, start: a, end: b, inPoint: s.inPoint + (a - s.start) * (s.speed || 1), pass: 'fast', fast: true };
        if (a > s.start) { cut.transition = 'jump'; cut.blendSec = 0; }
        pieces.push(cut);
      }));
      e.segments.push(...pieces);
    }
    e.emit('fill');
    return true;
  }

  // The real scheduler, run dry on the fast clock, sharing the clips and
  // settings (read only).
  simEngine(viz) {
    const e = this.app.clipEngine;
    if (!e.clips.length && !e.storyBlocks().length) return null;
    const sim = new ClipEngine(viz);
    sim.dry = true;
    sim.assets = e.assets;
    sim.settings = e.settings;
    sim.bandTransitions = e.bandTransitions;
    sim.songDuration = () => this.data.duration;
    sim.isAdvancing = () => true;
    const g = this.app.tempo;
    // The grid in use; with the live clock chosen, unplayed parts still
    // follow the detected grid so they export with motion.
    const bpm = g.source !== 'live' && g.bpm > 0 ? g.bpm : (g.detected ? g.detected.bpm : 0);
    const offset = g.source !== 'live' && g.bpm > 0 ? g.offset : (g.detected ? g.detected.offset : 0);
    sim.grid = bpm > 0 ? { active: true, bpm, beatAt: (tt) => (tt - offset) / (60 / bpm), timeOfBeat: (b) => offset + b * (60 / bpm) } : null;
    sim.pass = 'fast';
    return sim;
  }

  // ---- 3. refill (replace played takes) ----------------------------------

  refill() {
    if (!this.data) return false;
    const app = this.app, e = app.clipEngine;
    if (app.timelineRolling()) return false;
    app.record.clear();
    e.segments = [];
    e.beats = [];
    e.current = null;
    return this.fill();
  }

  // ---- helpers ------------------------------------------------------------

  static rng(seed) {
    let s = seed >>> 0;
    return () => {
      s = (s + 0x6D2B79F5) >>> 0;
      let r = Math.imul(s ^ (s >>> 15), 1 | s);
      r = (r + Math.imul(r ^ (r >>> 7), 61 | r)) ^ r;
      return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
    };
  }

  static spans(list) {
    const s = list.filter(([a, b]) => b > a).sort((p, q) => p[0] - q[0]);
    const out = [];
    s.forEach(([a, b]) => { const l = out[out.length - 1]; if (l && a <= l[1] + 1e-6) l[1] = Math.max(l[1], b); else out.push([a, b]); });
    return out;
  }

  static subtract([a, b], spans) {
    let parts = [[a, b]];
    spans.forEach(([s, e]) => {
      parts = parts.flatMap(([p, q]) => (e <= p || s >= q) ? [[p, q]] : [[p, Math.min(q, s)], [Math.max(p, e), q]].filter(([u, v]) => v > u));
    });
    return parts;
  }
}

if (typeof module !== 'undefined') module.exports = FastPass;

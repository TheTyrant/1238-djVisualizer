// Fixed tempo grid (v2.4, D-81).
//
// In track mode the edit follows one fixed grid instead of the live beat
// clock: tempo = the median BPM the frozen detector settled on over the
// whole song (fast pass, D-80), bar 1 at the phase that best fits the
// detected beats. Cuts land on it from 0:00, every time the track loads.
//
//   bpm     beats per minute
//   offset  seconds from 0:00 to the downbeat of bar 1 (0 ≤ offset < 1 bar)
//   source  'median' (fast pass) | 'manual' (×2, ÷2, typed, tapped) |
//           'live'   (the realtime clock, as in the alpha; live mode always)
//
// Beat positions are in beats from bar 1 (negative before it), so
// MusicalTime's bar/beat helpers work on them unchanged.
class TempoGrid {
  constructor(app) {
    this.app = app;
    this.bpm = 0;
    this.offset = 0;
    this.source = 'median';
    this.detected = null;      // { bpm, offset } from the last fast pass
    this.taps = [];
    this.listeners = new Set();
  }

  on(fn) { this.listeners.add(fn); }
  // why: 'edit' (×2, ÷2, typed, tapped, live / detected chosen) or 'detect'
  // (the fast pass, a reset or a project opening) — only edits are changes.
  emit(why = 'edit') { this.listeners.forEach(fn => fn(why)); }

  // The grid drives the edit in track mode unless the live clock is chosen.
  get active() { return this.source !== 'live' && this.bpm > 0 && !!this.app && this.app.isTrackMode(); }

  get beatSec() { return this.bpm > 0 ? 60 / this.bpm : 0; }
  get barSec() { return this.beatSec * MusicalTime.beatsPerBar(); }

  beatAt(t) { return this.bpm > 0 ? (t - this.offset) / this.beatSec : 0; }
  timeOfBeat(b) { return this.offset + b * this.beatSec; }

  // Grid lines in [t0, t1] as { time, index } (index 0 = bar 1, beat 1).
  beatsIn(t0, t1) {
    if (!(this.bpm > 0)) return [];
    const out = [];
    for (let i = Math.ceil(this.beatAt(Math.max(0, t0))); ; i++) {
      const time = this.timeOfBeat(i);
      if (time > t1 || out.length > 20000) break;
      if (time >= 0) out.push({ time, index: i });
    }
    return out;
  }

  // ---- changes -----------------------------------------------------------

  set(patch, { silent = false, why = 'edit' } = {}) {
    Object.assign(this, patch);
    if (this.bpm > 0) {
      const bar = this.barSec;
      this.offset = ((this.offset % bar) + bar) % bar;
    }
    if (!silent) this.emit(why);
  }

  // The fast pass found a tempo: used unless one was set by hand.
  detect(bpm, offset) {
    this.detected = bpm > 0 ? { bpm, offset } : null;
    if (this.source === 'median' || !(this.bpm > 0)) this.set({ bpm: bpm || 0, offset: offset || 0, source: this.source === 'live' ? 'live' : 'median' }, { why: 'detect' });
    else this.emit('detect');
  }

  scale(f) {
    if (!(this.bpm > 0)) return;
    this.set({ bpm: Math.max(20, Math.min(400, Math.round(this.bpm * f * 100) / 100)), source: 'manual' });
  }

  type(bpm) {
    const v = parseFloat(bpm);
    if (!(v >= 20 && v <= 400)) return false;
    this.set({ bpm: Math.round(v * 100) / 100, source: 'manual' });
    return true;
  }

  // Tap tempo: the average of the last taps (4 or more). While the track
  // plays, the last tap also places the beat (keeping the bar phase nearest
  // to the current one).
  tap() {
    const now = performance.now() / 1000;
    if (this.taps.length && now - this.taps[this.taps.length - 1] > 2) this.taps = [];
    this.taps.push(now);
    if (this.taps.length > 8) this.taps.shift();
    if (this.taps.length < 4) return this.taps.length;
    const iv = (this.taps[this.taps.length - 1] - this.taps[0]) / (this.taps.length - 1);
    const patch = { bpm: Math.round((60 / iv) * 10) / 10, source: 'manual' };
    const app = this.app;
    if (app && app.isTrackMode() && app.trackSource.isPlaying) {
      const t = app.masterTime(), beat = 60 / patch.bpm, old = this.offset;
      const phase = ((t % beat) + beat) % beat;
      let best = phase, bestD = Infinity;
      for (let k = 0; k < MusicalTime.beatsPerBar(); k++) {
        const cand = phase + k * beat, d = Math.abs(cand - old);
        if (d < bestD) { bestD = d; best = cand; }
      }
      patch.offset = best;
    }
    this.set(patch);
    return this.taps.length;
  }

  useLive() { this.set({ source: 'live' }); }

  useDetected() {
    if (this.detected) this.set({ bpm: this.detected.bpm, offset: this.detected.offset, source: 'median' });
  }

  label() {
    if (this.source === 'live' || !(this.bpm > 0)) {
      const live = this.app && this.app.visualizer && this.app.visualizer.audioData ? this.app.visualizer.audioData.bpm : 0;
      return `${live > 0 ? live : '--'} BPM · live`;
    }
    const n = Number.isInteger(this.bpm) ? this.bpm : this.bpm.toFixed(1);
    return `${n} BPM · ${this.source}`;
  }

  toJSON() { return { bpm: this.bpm, offset: Math.round(this.offset * 10000) / 10000, source: this.source }; }

  // Projects from before Stable05 have no tempo: they keep the live clock
  // so they play as they did (D-81, Proposed).
  fromJSON(t) {
    this.taps = [];
    this.detected = null;
    if (!t) this.set({ bpm: 0, offset: 0, source: 'live' }, { silent: true });
    else this.set({ bpm: t.bpm || 0, offset: t.offset || 0, source: ['median', 'manual', 'live'].includes(t.source) ? t.source : 'median' }, { silent: true });
    this.emit('detect');
  }

  reset() {
    this.taps = [];
    this.detected = null;
    this.set({ bpm: 0, offset: 0, source: 'median' }, { why: 'detect' });
  }
}

if (typeof module !== 'undefined') module.exports = TempoGrid;

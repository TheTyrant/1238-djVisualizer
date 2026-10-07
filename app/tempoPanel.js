// Header TEMPO readout (v2.4, D-81) and the fast-pass progress row in the
// Status overlay (D-80).
//
// The readout says which tempo the edit follows and where it came from:
// "97 BPM · median" (fast pass), "· manual" (×2, ÷2, typed or tapped) or
// "· live" (the realtime detector, as in the alpha). Clicking it opens:
//   ÷2 [ 97 ] ×2       Tap · Detected · Live clock
//   Refill from fast pass (replaces played takes, asks first)
class TempoPanel {
  constructor(app) {
    this.app = app;
    this.tempo = app.tempo;
    this.fast = app.fastPass;
  }

  init() {
    const $ = (id) => document.getElementById(id);
    this.el = {
      pick: $('tempoPick'), btn: $('tempoBtn'), label: $('topTempo'), pop: $('tempoPop'), input: $('tempoInput'),
      half: $('tempoHalf'), dbl: $('tempoDouble'), tap: $('tempoTap'), detected: $('tempoDetected'), live: $('tempoLive'),
      note: $('tempoNote'), refill: $('fastRefill'),
      item: $('fastPassItem'), text: $('fastPassText'), cancel: $('fastPassCancel'),
    };
    const el = this.el;
    if (!el.btn) return;
    el.btn.addEventListener('click', () => (el.pop.hidden ? this.open() : this.close()));
    document.addEventListener('pointerdown', (e) => { if (!el.pick.contains(e.target)) this.close(); });
    el.pop.addEventListener('keydown', (e) => { if (e.key === 'Escape') { e.preventDefault(); this.close(); el.btn.focus(); } e.stopPropagation(); });
    el.half.addEventListener('click', () => this.tempo.scale(0.5));
    el.dbl.addEventListener('click', () => this.tempo.scale(2));
    el.input.addEventListener('change', () => { if (!this.tempo.type(el.input.value)) this.render(); });
    el.input.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); el.input.blur(); } });
    el.tap.addEventListener('click', () => this.tap());
    el.detected.addEventListener('click', () => this.tempo.useDetected());
    el.live.addEventListener('click', () => this.tempo.useLive());
    el.refill.addEventListener('click', () => this.refill());
    el.cancel.addEventListener('click', () => this.fast.cancel());

    this.tempo.on(() => this.render());
    this.fast.on(() => this.renderFast());
    // The live label follows the detector while the live clock is used.
    setInterval(() => { if (this.tempo.source === 'live' || !(this.tempo.bpm > 0)) this.renderLabel(); }, 500);
    this.render();
    this.renderFast();
  }

  open() {
    this.render();
    this.el.pop.hidden = false;
    this.el.btn.setAttribute('aria-expanded', 'true');
    this.el.input.focus();
    this.el.input.select();
  }

  close() {
    if (!this.el || this.el.pop.hidden) return;
    this.el.pop.hidden = true;
    this.el.btn.setAttribute('aria-expanded', 'false');
  }

  tap() {
    const n = this.tempo.tap();
    if (n < 4) this.el.note.textContent = `Tap ${4 - n} more time${4 - n === 1 ? '' : 's'} on the beat…`;
  }

  refill() {
    const app = this.app;
    if (!this.fast.data) { app.notify('The fast pass hasn’t finished yet.'); return; }
    if (app.timelineRolling()) { app.notify('Stop playback first.'); return; }
    const played = app.record.playedSeconds();
    if (played > 0.5 && !window.confirm(`Replace the ${fmtTime(played, false)} you played with the fast pass? The played cuts and motion are discarded.`)) return;
    this.fast.refill();
    app.project.markDirty();
    app.notify('Refilled from the fast pass');
    this.close();
  }

  renderLabel() {
    if (!this.el) return;
    const text = this.tempo.label();
    if (this.el.label.textContent !== text) this.el.label.textContent = text;
    this.el.pick.dataset.source = this.tempo.source;
  }

  render() {
    if (!this.el) return;
    const g = this.tempo, el = this.el, track = this.app.isTrackMode();
    this.renderLabel();
    if (document.activeElement !== el.input) el.input.value = g.bpm > 0 ? String(g.bpm) : '';
    const has = g.bpm > 0;
    el.half.disabled = el.dbl.disabled = !has;
    el.detected.disabled = !g.detected || (g.source === 'median' && g.detected.bpm === g.bpm);
    el.live.disabled = g.source === 'live';
    el.refill.disabled = !this.fast.data || !track;
    const bar = has ? `bar 1 at ${g.offset.toFixed(2)} s` : '';
    el.note.textContent = !track
      ? 'Live input follows the realtime clock.'
      : g.source === 'live'
        ? `Following the realtime detector (as the alpha did).${g.detected ? ` Detected: ${g.detected.bpm} BPM.` : ''}`
        : `${g.source === 'manual' ? 'Set by hand' : 'Median of the fast pass'} · ${bar}. Cuts follow this grid from 0:00.`;
  }

  renderFast() {
    if (!this.el || !this.el.item) return;
    const s = this.fast.state;
    const show = s.stage === 'decoding' || s.stage === 'analysing' || s.stage === 'failed' || s.stage === 'cancelled';
    this.el.item.hidden = !show;
    this.el.text.textContent = s.text || '';
    this.el.cancel.hidden = !(s.stage === 'decoding' || s.stage === 'analysing');
    if (s.stage === 'cancelled' || s.stage === 'failed') {
      clearTimeout(this.hideTimer);
      this.hideTimer = setTimeout(() => { if (this.fast.state === s) this.el.item.hidden = true; }, 4000);
    }
    this.render();
  }
}

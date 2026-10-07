// Clip tools (v2.4 step 2, D-82): the "amount used" range popover and the
// Sections editor.
//
// Range: click a card's time readout (or Used in the clip's options). Two
// handles over the clip's length set where the usable part starts and how
// much of it there is; the auto-editor only picks in-points inside it and a
// locked clip plays exactly this part.
//
// Sections: a filmstrip of the clip over a bar ruler. Bar lines are the
// fixed tempo grid's bar (D-81) at the clip's speed, in source seconds.
// Click to add a marker on the nearest bar line, drag one to move it (it
// snaps to bars), right-click to delete. Each section becomes its own clip
// card ("A · 2/4") sharing the same video.
class ClipTools {
  constructor(app) {
    this.app = app;
    this.engine = app.clipEngine;
    this.strips = new Map();   // asset url -> { frames: [canvas], times }
  }

  init() {
    document.addEventListener('pointerdown', (e) => {
      if (this.pop && !this.pop.hidden && !this.pop.contains(e.target) && !(this.anchor && this.anchor.contains(e.target))) this.closeRange();
    });
    document.addEventListener('keydown', (e) => {
      if (e.key !== 'Escape') return;
      if (this.sect) { e.preventDefault(); e.stopPropagation(); this.closeSections(); }
      else if (this.pop && !this.pop.hidden) { e.preventDefault(); e.stopPropagation(); this.closeRange(); }
    }, true);
    this.engine.on((type) => {
      if (type === 'clips' && this.pop && !this.pop.hidden) this.syncRange();
      if (type === 'clips' && this.sect) this.drawSections();
    });
    this.app.tempo.on(() => { if (this.sect) this.drawSections(); });
  }

  // Source seconds per bar at the clip's speed (the grid's bar; 120 BPM
  // when no tempo is known yet).
  barSource(a) {
    const g = this.app.tempo;
    const bpm = g.bpm > 0 ? g.bpm : (this.app.visualizer.audioData && this.app.visualizer.audioData.bpm) || 120;
    const p = this.engine.parentOf(a) || a;
    return (60 / bpm) * MusicalTime.beatsPerBar() * this.engine.speedOf(p);
  }

  barSeconds() {
    const g = this.app.tempo;
    const bpm = g.bpm > 0 ? g.bpm : (this.app.visualizer.audioData && this.app.visualizer.audioData.bpm) || 120;
    return (60 / bpm) * MusicalTime.beatsPerBar();
  }

  // ---- amount used -------------------------------------------------------

  openRange(a, anchor) {
    if (!a || a.kind !== 'video') return;
    if (!this.pop) this.buildRange();
    this.asset = a;
    this.anchor = anchor || null;
    this.pop.hidden = false;
    this.syncRange();
    const r = anchor ? anchor.getBoundingClientRect() : { left: innerWidth / 2 - 150, top: innerHeight / 2, bottom: innerHeight / 2 };
    const w = this.pop.offsetWidth, h = this.pop.offsetHeight;
    const left = Math.max(8, Math.min(innerWidth - w - 8, r.left - 20));
    const top = r.top - h - 10 > 8 ? r.top - h - 10 : Math.min(innerHeight - h - 8, r.bottom + 10);
    this.pop.style.left = `${left}px`;
    this.pop.style.top = `${top}px`;
    this.el.start.focus();
  }

  closeRange() {
    if (!this.pop || this.pop.hidden) return;
    this.pop.hidden = true;
    this.asset = null;
    if (this.anchor && document.body.contains(this.anchor)) this.anchor.focus();
    this.anchor = null;
  }

  buildRange() {
    const pop = document.createElement('div');
    pop.className = 'clip-pop';
    pop.id = 'clipRangePop';
    pop.setAttribute('role', 'dialog');
    pop.setAttribute('aria-label', 'Amount used');
    pop.hidden = true;
    pop.innerHTML = `
      <div class="clip-pop-head"><span class="clip-pop-k">Amount used</span><span class="clip-pop-name" id="clipRangeName"></span></div>
      <div class="range2" id="clipRangeTrack">
        <div class="range2-fill" id="clipRangeFill"></div>
        <input type="range" id="clipRangeA" min="0" max="1" step="0.01" aria-label="Start">
        <input type="range" id="clipRangeB" min="0" max="1" step="0.01" aria-label="End">
      </div>
      <div class="clip-pop-row">
        <label>Start <input type="number" id="clipRangeStart" min="0" step="0.1"> s</label>
        <label>Amount <input type="number" id="clipRangeLen" min="0.1" step="0.1"> s</label>
      </div>
      <p class="clip-pop-note" id="clipRangeNote"></p>
      <div class="clip-pop-row">
        <button type="button" class="btn" id="clipRangeAll">Whole clip</button>
        <button type="button" class="btn btn-primary" id="clipRangeDone">Done</button>
      </div>`;
    document.body.appendChild(pop);
    this.pop = pop;
    const $ = (id) => document.getElementById(id);
    this.el = { name: $('clipRangeName'), a: $('clipRangeA'), b: $('clipRangeB'), fill: $('clipRangeFill'), start: $('clipRangeStart'), len: $('clipRangeLen'), note: $('clipRangeNote') };
    const lim = () => (this.asset.parent ? this.engine.sectionBounds(this.asset) : { start: 0, end: this.engine.sourceLength(this.asset) });
    const set = (s, e) => { if (this.asset) this.engine.setUsed(this.asset.id, s, e); };
    this.el.a.addEventListener('input', () => { const r = this.engine.usedRange(this.asset); set(Math.min(+this.el.a.value, r.end - 0.1), r.end); });
    this.el.b.addEventListener('input', () => { const r = this.engine.usedRange(this.asset); set(r.start, Math.max(+this.el.b.value, r.start + 0.1)); });
    this.el.start.addEventListener('change', () => { const r = this.engine.usedRange(this.asset), len = r.end - r.start, s = parseFloat(this.el.start.value) || 0; set(s, Math.min(lim().end, s + len)); });
    this.el.len.addEventListener('change', () => { const r = this.engine.usedRange(this.asset); set(r.start, r.start + Math.max(0.1, parseFloat(this.el.len.value) || 0.1)); });
    $('clipRangeAll').addEventListener('click', () => { const L = lim(); set(L.start, L.end); });
    $('clipRangeDone').addEventListener('click', () => this.closeRange());
  }

  syncRange() {
    const a = this.asset;
    if (!a) return;
    const e = this.engine, el = this.el;
    const L = a.parent ? e.sectionBounds(a) : { start: 0, end: e.sourceLength(a) };
    const r = e.usedRange(a);
    el.name.textContent = a.name;
    [el.a, el.b].forEach(i => { i.min = L.start; i.max = L.end; });
    if (document.activeElement !== el.a) el.a.value = r.start;
    if (document.activeElement !== el.b) el.b.value = r.end;
    const span = Math.max(0.001, L.end - L.start);
    el.fill.style.left = `${((r.start - L.start) / span) * 100}%`;
    el.fill.style.width = `${((r.end - r.start) / span) * 100}%`;
    if (document.activeElement !== el.start) el.start.value = r.start.toFixed(1);
    if (document.activeElement !== el.len) el.len.value = (r.end - r.start).toFixed(1);
    const sp = e.speedOf(a);
    el.note.textContent = `Source ${fmtTime(e.sourceLength(a), false)} · used ${fmtTime(r.end - r.start, true)} (${fmtTime(r.start, true)}–${fmtTime(r.end, true)}) · on screen ${fmtTime(e.screenLength(a), true)}${sp !== 1 ? ` at ${ClipTools.speedLabel(sp)}` : ''}`;
  }

  static speedLabel(v) {
    const named = { 0.25: '¼×', 0.5: '½×', 0.75: '¾×', 1: '1×', 1.5: '1½×', 2: '2×', 4: '4×' };
    return named[v] || `${+v.toFixed(2)}×`;
  }

  // ---- sections -----------------------------------------------------------

  openSections(a) {
    const p = this.engine.parentOf(a) || a;
    if (!p || p.kind !== 'video') return;
    this.closeRange();
    this.closeSections();
    const ov = document.createElement('div');
    ov.className = 'sect-overlay';
    ov.innerHTML = `
      <div class="sect-panel" role="dialog" aria-label="Sections">
        <div class="sect-head">
          <h3>Sections <span class="sect-name"></span></h3>
          <span class="sect-bar" id="sectBar"></span>
        </div>
        <canvas class="sect-canvas" id="sectCanvas" width="960" height="150" aria-label="Clip filmstrip with bar ruler"></canvas>
        <p class="hint">Click to add a marker on a bar line · drag a marker to move it (it snaps to bars) · right-click a marker to delete it. Each section becomes its own clip card.</p>
        <ol class="sect-list" id="sectList"></ol>
        <div class="sect-foot">
          <button type="button" class="btn" id="sectClear">Clear sections</button>
          <button type="button" class="btn btn-primary" id="sectDone">Done</button>
        </div>
      </div>`;
    document.body.appendChild(ov);
    ov.querySelector('.sect-name').textContent = p.name;
    this.sect = { p, ov, canvas: ov.querySelector('#sectCanvas'), drag: null };
    ov.addEventListener('pointerdown', (e) => { if (e.target === ov) this.closeSections(); });
    ov.querySelector('#sectDone').addEventListener('click', () => this.closeSections());
    ov.querySelector('#sectClear').addEventListener('click', () => this.engine.setSections(p.id, []));
    this.wireCanvas();
    this.drawSections();
    this.filmstrip(p).then(() => this.drawSections());
  }

  closeSections() {
    if (!this.sect) return;
    this.sect.ov.remove();
    this.sect = null;
  }

  geom() {
    const s = this.sect, c = s.canvas, dur = this.engine.sourceLength(s.p) || 1;
    const pad = 12, w = c.width - pad * 2;
    return { c, dur, pad, w, x: (t) => pad + (t / dur) * w, t: (x) => ((x - pad) / w) * dur, stripY: 8, stripH: 90, rulerY: 104 };
  }

  snap(t) {
    const g = this.geom(), bar = this.barSource(this.sect.p);
    return Math.max(0, Math.min(g.dur, Math.round(t / bar) * bar));
  }

  wireCanvas() {
    const s = this.sect, c = s.canvas;
    const posOf = (e) => { const r = c.getBoundingClientRect(); return (e.clientX - r.left) * (c.width / r.width); };
    const near = (x) => { const g = this.geom(); return s.p.sections.findIndex(t => Math.abs(g.x(t) - x) < 7); };
    c.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      const i = near(posOf(e));
      if (i >= 0) this.engine.setSections(s.p.id, s.p.sections.filter((_, k) => k !== i));
    });
    c.addEventListener('pointerdown', (e) => {
      if (e.button !== 0) return;
      const x = posOf(e), i = near(x), g = this.geom();
      if (i >= 0) { s.drag = { i, t: s.p.sections[i] }; c.setPointerCapture(e.pointerId); return; }
      const t = this.snap(g.t(x));
      if (t > 0.05 && t < g.dur - 0.05 && !s.p.sections.some(v => Math.abs(v - t) < 0.01)) this.engine.setSections(s.p.id, [...s.p.sections, t]);
    });
    c.addEventListener('pointermove', (e) => {
      if (!s.drag) { c.style.cursor = near(posOf(e)) >= 0 ? 'ew-resize' : 'copy'; return; }
      s.drag.t = this.snap(this.geom().t(posOf(e)));
      this.drawSections();
    });
    const end = () => {
      if (!s.drag) return;
      const list = s.p.sections.slice();
      list[s.drag.i] = s.drag.t;
      s.drag = null;
      this.engine.setSections(s.p.id, list);
    };
    c.addEventListener('pointerup', end);
    c.addEventListener('pointercancel', end);
  }

  drawSections() {
    const s = this.sect;
    if (!s) return;
    const g = this.geom(), ctx = g.c.getContext('2d');
    const css = (n) => getComputedStyle(document.documentElement).getPropertyValue(n).trim() || '#000';
    const ink = css('--ink'), paper = css('--paper'), ink3 = css('--ink-3'), high = css('--high');
    ctx.clearRect(0, 0, g.c.width, g.c.height);
    // filmstrip
    ctx.fillStyle = '#000';
    ctx.fillRect(g.pad, g.stripY, g.w, g.stripH);
    const strip = this.strips.get(s.p.url);
    if (strip && strip.frames.length) {
      const n = strip.frames.length, cw = g.w / n;
      strip.frames.forEach((f, i) => { if (f) ctx.drawImage(f, g.pad + i * cw, g.stripY, cw, g.stripH); });
    }
    // bar ruler (source seconds per bar at the clip's speed)
    const bar = this.barSource(s.p);
    ctx.fillStyle = paper; ctx.fillRect(g.pad, g.rulerY, g.w, 34);
    ctx.strokeStyle = ink; ctx.lineWidth = 1; ctx.strokeRect(g.pad + 0.5, g.rulerY + 0.5, g.w - 1, 33);
    ctx.font = '10px "JetBrains Mono", monospace';
    const pxBar = (bar / g.dur) * g.w;
    const every = pxBar < 14 ? Math.ceil(14 / pxBar) : 1;
    for (let k = 0; k * bar <= g.dur + 1e-6; k++) {
      const x = Math.round(g.x(k * bar)) + 0.5;
      const major = k % every === 0;
      ctx.strokeStyle = major ? ink : ink3;
      ctx.beginPath(); ctx.moveTo(x, g.rulerY); ctx.lineTo(x, g.rulerY + (major ? 14 : 7)); ctx.stroke();
      if (major && pxBar * every > 22) { ctx.fillStyle = ink; ctx.fillText(String(k + 1), x + 3, g.rulerY + 26); }
    }
    // markers
    const marks = s.p.sections.slice();
    if (s.drag) marks[s.drag.i] = s.drag.t;
    marks.forEach((t) => {
      const x = Math.round(g.x(t)) + 0.5;
      ctx.strokeStyle = high; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.moveTo(x, g.stripY - 4); ctx.lineTo(x, g.rulerY + 34); ctx.stroke();
      ctx.fillStyle = high;
      ctx.beginPath(); ctx.moveTo(x - 6, g.stripY - 6); ctx.lineTo(x + 6, g.stripY - 6); ctx.lineTo(x, g.stripY + 2); ctx.closePath(); ctx.fill();
    });
    ctx.lineWidth = 1;
    // section labels on the strip
    const pts = [0, ...marks.slice().sort((a, b) => a - b), g.dur];
    if (pts.length > 2) {
      ctx.font = '700 11px "JetBrains Mono", monospace';
      for (let k = 0; k < pts.length - 1; k++) {
        const x = g.x(pts[k]) + 5;
        ctx.fillStyle = 'rgba(0,0,0,0.65)'; ctx.fillRect(x - 3, g.stripY + 4, 40, 16);
        ctx.fillStyle = '#fff'; ctx.fillText(`${k + 1}/${pts.length - 1}`, x, g.stripY + 16);
      }
    }
    // readouts
    const barS = this.barSeconds();
    const head = s.ov.querySelector('#sectBar');
    head.textContent = `1 bar = ${barS.toFixed(2)} s on screen = ${bar.toFixed(2)} s of the clip at ${ClipTools.speedLabel(this.engine.speedOf(s.p))}`;
    const list = s.ov.querySelector('#sectList');
    list.textContent = '';
    this.engine.sectionsOf(s.p).forEach(c => {
      const b = this.engine.sectionBounds(c);
      const li = document.createElement('li');
      const bars = +((b.end - b.start) / bar).toFixed(2);
      li.textContent = `${c.name} · ${fmtTime(b.start, true)}–${fmtTime(b.end, true)} · ${bars} bar${bars === 1 ? '' : 's'}`;
      list.appendChild(li);
    });
    if (!list.children.length) {
      const li = document.createElement('li');
      li.className = 'hint';
      li.textContent = 'No sections yet: the whole clip is one card.';
      list.appendChild(li);
    }
  }

  // Frames across the clip, from a separate <video> (never disturbs playback).
  async filmstrip(p) {
    if (!p.url || this.strips.has(p.url)) return;
    const n = 16, dur = this.engine.sourceLength(p);
    const strip = { frames: new Array(n).fill(null) };
    this.strips.set(p.url, strip);
    const v = document.createElement('video');
    v.muted = true; v.preload = 'auto'; v.src = p.url;
    await new Promise((res) => { v.addEventListener('loadeddata', res, { once: true }); v.addEventListener('error', res, { once: true }); });
    for (let i = 0; i < n; i++) {
      const t = ((i + 0.5) / n) * (dur || v.duration || 1);
      await new Promise((res) => { const done = () => res(); v.addEventListener('seeked', done, { once: true }); setTimeout(done, 1500); v.currentTime = t; });
      const c = document.createElement('canvas');
      c.width = 96; c.height = Math.max(1, Math.round(96 * (v.videoHeight || 9) / (v.videoWidth || 16)));
      try { c.getContext('2d').drawImage(v, 0, 0, c.width, c.height); strip.frames[i] = c; } catch (e) { /* not decodable */ }
      if (this.sect && this.sect.p === p && i % 4 === 3) this.drawSections();
    }
    v.removeAttribute('src');
  }
}

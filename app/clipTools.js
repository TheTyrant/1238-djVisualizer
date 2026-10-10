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
// Slice every ½ / 1 / 4 / 8 / 16 bars cuts the used part on that grid;
// click adds a marker, drag moves it (it snaps), × / right-click / Delete
// removes it, ←/→ nudges the selected one, Ctrl+Z undoes. Each section
// shows on the clip's card strip ("A · 2/4") and shares the same video.
class ClipTools {
  static DIVISIONS = [0.5, 1, 4, 8, 16];   // Slice every … bars
  static MAX_SECTIONS = 64;

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
      if (this.sect && e.key !== 'Escape' && this.sectionKey(e)) { e.preventDefault(); e.stopPropagation(); return; }
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
        <div class="sect-slice" role="group" aria-label="Slice every">
          <span class="sect-slice-label">Slice every</span>
          ${ClipTools.DIVISIONS.map(d => `<button type="button" class="btn sect-div" data-bars="${d}">${d === 0.5 ? '1/2' : d} bar${d > 1 ? 's' : ''}</button>`).join('')}
          <span class="sect-msg" id="sectMsg" role="status"></span>
        </div>
        <canvas class="sect-canvas" id="sectCanvas" width="960" height="150" aria-label="Clip filmstrip with bar ruler"></canvas>
        <p class="hint">Slice every … cuts the whole clip (or its used part) on that grid. Click to add a marker · drag to move it (it snaps to the grid) · hover and click × or right-click to delete · click a marker, then Delete removes it and ←/→ moves it one step · Ctrl+Z undoes. Each section shows on the clip's card and gets its own pace, band and speed.</p>
        <ol class="sect-list" id="sectList"></ol>
        <div class="sect-foot">
          <button type="button" class="btn" id="sectUndo" disabled>Undo</button>
          <button type="button" class="btn" id="sectClear">Clear sections</button>
          <button type="button" class="btn btn-primary" id="sectDone">Done</button>
        </div>
      </div>`;
    document.body.appendChild(ov);
    ov.querySelector('.sect-name').textContent = p.name;
    this.sect = { p, ov, canvas: ov.querySelector('#sectCanvas'), drag: null, sel: -1, hover: -1, step: 1, undo: [] };
    ov.addEventListener('pointerdown', (e) => { if (e.target === ov) this.closeSections(); });
    ov.querySelector('#sectDone').addEventListener('click', () => this.closeSections());
    ov.querySelector('#sectClear').addEventListener('click', () => this.applySections([]));
    ov.querySelector('#sectUndo').addEventListener('click', () => this.undoSections());
    ov.querySelectorAll('.sect-div').forEach(b => b.addEventListener('click', () => this.autoSlice(+b.dataset.bars)));
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

  // The grid starts at the start of the clip's used part, so slices, the
  // ruler and snapping all line up with where the clip begins playing.
  gridStart() { return this.engine.usedRange(this.sect.p).start; }
  stepSource() { return this.barSource(this.sect.p) * this.sect.step; }

  snap(t) {
    const g = this.geom(), st = this.stepSource(), o = this.gridStart();
    return Math.max(0, Math.min(g.dur, o + Math.round((t - o) / st) * st));
  }

  // ---- edits (each one can be undone) ---------------------------------

  snapshot() {
    const p = this.sect.p;
    return { sections: p.sections.slice(), asClip: this.engine.sectionsOf(p).map(c => c.asClip) };
  }

  applySections(times, asClip = null) {
    const s = this.sect, e = this.engine;
    s.undo.push(this.snapshot());
    if (s.undo.length > 50) s.undo.shift();
    s.sel = -1; s.hover = -1;
    e.setSections(s.p.id, times);
    if (asClip) {
      e.sectionsOf(s.p).forEach((c, k) => { if (k < asClip.length) c.asClip = asClip[k]; });
      e.renumber();
      e.emit('clips');
    }
  }

  undoSections() {
    const s = this.sect;
    if (!s || !s.undo.length) return;
    const snap = s.undo.pop(), e = this.engine;
    s.sel = -1; s.hover = -1;
    e.setSections(s.p.id, snap.sections);
    e.sectionsOf(s.p).forEach((c, k) => { if (k < snap.asClip.length) c.asClip = snap.asClip[k]; });
    e.renumber();
    e.emit('clips');
    this.say('Undone.');
  }

  // Slice every n bars (½, 1, 4, 8, 16) across the used part. Replaces the
  // markers already there (Undo brings them back). Parts outside the used
  // range become sections of their own, set to not be used.
  autoSlice(bars) {
    const s = this.sect, e = this.engine, g = this.geom();
    const st = this.barSource(s.p) * bars, u = e.usedRange(s.p);
    if (!(st > 0) || !(u.end > u.start)) return;
    const cuts = [];
    for (let k = 1; u.start + k * st < u.end - 0.05; k++) cuts.push(u.start + k * st);
    const inner = cuts.length + 1;
    const name = `${bars === 0.5 ? '1/2' : bars} bar${bars > 1 ? 's' : ''}`;
    if (!cuts.length) { this.say(`The ${u.start > 0.05 || u.end < g.dur - 0.05 ? 'used part' : 'clip'} is ${(+((u.end - u.start) / this.barSource(s.p)).toFixed(2))} bars long, too short to cut every ${name}.`, true); return; }
    const pts = [...(u.start > 0.05 ? [u.start] : []), ...cuts, ...(u.end < g.dur - 0.05 ? [u.end] : [])];
    if (pts.length + 1 > ClipTools.MAX_SECTIONS) {
      this.say(`Every ${name} would make ${pts.length + 1} sections; ${ClipTools.MAX_SECTIONS} is the most. Pick a longer division.`, true);
      return;
    }
    s.step = bars < 1 ? 0.5 : 1;
    const asClip = [...(u.start > 0.05 ? [false] : []), ...new Array(inner).fill(true), ...(u.end < g.dur - 0.05 ? [false] : [])];
    this.applySections(pts, asClip);
    this.say(`Sliced into ${inner} sections of ${name}${asClip.includes(false) ? ' (the parts outside the used range are kept but not used)' : ''}.`);
  }

  removeMarker(i) {
    const s = this.sect;
    if (i < 0 || i >= s.p.sections.length) return;
    this.applySections(s.p.sections.filter((_, k) => k !== i));
  }

  moveMarker(i, t) {
    const s = this.sect, list = s.p.sections.slice();
    if (i < 0 || i >= list.length || Math.abs(list[i] - t) < 0.001) return;
    list[i] = t;
    this.applySections(list);
    // keep the moved marker selected (its index after sorting)
    s.sel = s.p.sections.findIndex(v => Math.abs(v - +t.toFixed(3)) < 0.002);
    this.drawSections();
  }

  say(text, warn = false) {
    const m = this.sect && this.sect.ov.querySelector('#sectMsg');
    if (!m) return;
    m.textContent = text;
    m.classList.toggle('is-warn', warn);
  }

  // Keys while the editor is open: Delete / Backspace, ← / →, Ctrl+Z.
  sectionKey(e) {
    const s = this.sect;
    if ((e.ctrlKey || e.metaKey) && !e.shiftKey && e.key.toLowerCase() === 'z') { this.undoSections(); return true; }
    if (s.sel < 0) return false;
    if (e.key === 'Delete' || e.key === 'Backspace') { this.removeMarker(s.sel); return true; }
    if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
      const t = this.snap(s.p.sections[s.sel] + (e.key === 'ArrowLeft' ? -1 : 1) * this.stepSource());
      const g = this.geom();
      if (t > 0.05 && t < g.dur - 0.05 && !s.p.sections.some((v, k) => k !== s.sel && Math.abs(v - t) < 0.01)) this.moveMarker(s.sel, t);
      return true;
    }
    return false;
  }

  wireCanvas() {
    const s = this.sect, c = s.canvas;
    const pos = (e) => { const r = c.getBoundingClientRect(); return { x: (e.clientX - r.left) * (c.width / r.width), y: (e.clientY - r.top) * (c.height / r.height) }; };
    const near = (x) => { const g = this.geom(); return s.p.sections.findIndex(t => Math.abs(g.x(t) - x) < 7); };
    // the × shown on a hovered or selected marker
    const onX = (pt) => { const i = s.hover >= 0 ? s.hover : s.sel; if (i < 0) return -1; const b = this.xBox(i); return b && Math.abs(pt.x - b.x) <= 8 && Math.abs(pt.y - b.y) <= 8 ? i : -1; };
    c.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      const i = near(pos(e).x);
      if (i >= 0) this.removeMarker(i);
    });
    c.addEventListener('pointerdown', (e) => {
      if (e.button !== 0) return;
      const pt = pos(e), xi = onX(pt);
      if (xi >= 0) { this.removeMarker(xi); this.drawSections(); return; }
      const i = near(pt.x), g = this.geom();
      if (i >= 0) { s.sel = i; s.drag = { i, t: s.p.sections[i], moved: false }; c.setPointerCapture(e.pointerId); this.drawSections(); return; }
      const t = this.snap(g.t(pt.x));
      if (t > 0.05 && t < g.dur - 0.05 && !s.p.sections.some(v => Math.abs(v - t) < 0.01)) {
        this.applySections([...s.p.sections, t]);
        s.sel = s.p.sections.findIndex(v => Math.abs(v - +t.toFixed(3)) < 0.002);
        this.drawSections();
      } else if (s.sel >= 0) { s.sel = -1; this.drawSections(); }
    });
    c.addEventListener('pointermove', (e) => {
      const pt = pos(e);
      if (!s.drag) {
        const h = near(pt.x);
        const was = s.hover;
        s.hover = h >= 0 ? h : (onX(pt) >= 0 ? s.hover : -1);
        c.style.cursor = onX(pt) >= 0 ? 'pointer' : h >= 0 ? 'ew-resize' : 'copy';
        if (was !== s.hover) this.drawSections();
        return;
      }
      const t = this.snap(this.geom().t(pt.x));
      if (Math.abs(t - s.drag.t) > 0.001) s.drag.moved = true;
      s.drag.t = t;
      this.drawSections();
    });
    c.addEventListener('pointerleave', () => { if (!s.drag && s.hover >= 0) { s.hover = -1; this.drawSections(); } });
    const end = () => {
      if (!s.drag) return;
      const d = s.drag;
      s.drag = null;
      if (d.moved) this.moveMarker(d.i, d.t);
      this.drawSections();
    };
    c.addEventListener('pointerup', end);
    c.addEventListener('pointercancel', end);
  }

  // Where marker i's × sits (canvas px), at the bottom of the filmstrip.
  xBox(i) {
    const t = this.sect.p.sections[i];
    if (t == null) return null;
    const g = this.geom();
    return { x: Math.round(g.x(t)), y: g.stripY + g.stripH - 11 };
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
    // sections set to not be used are shaded
    const kids = this.engine.sectionsOf(s.p);
    kids.forEach(c => {
      if (c.asClip) return;
      const b = this.engine.sectionBounds(c);
      ctx.fillStyle = 'rgba(0,0,0,0.6)';
      ctx.fillRect(g.x(b.start), g.stripY, g.x(b.end) - g.x(b.start), g.stripH);
    });
    // bar ruler (source seconds per bar at the clip's speed), from the start
    // of the used part; half-bar ticks when slicing in halves
    const bar = this.barSource(s.p), o = this.gridStart();
    ctx.fillStyle = paper; ctx.fillRect(g.pad, g.rulerY, g.w, 34);
    ctx.strokeStyle = ink; ctx.lineWidth = 1; ctx.strokeRect(g.pad + 0.5, g.rulerY + 0.5, g.w - 1, 33);
    ctx.font = '10px "JetBrains Mono", monospace';
    const pxBar = (bar / g.dur) * g.w;
    const every = pxBar < 14 ? Math.ceil(14 / pxBar) : 1;
    const k0 = -Math.floor(o / bar);
    for (let k = k0; o + k * bar <= g.dur + 1e-6; k++) {
      const x = Math.round(g.x(o + k * bar)) + 0.5;
      const major = k % every === 0;
      ctx.strokeStyle = major ? ink : ink3;
      ctx.beginPath(); ctx.moveTo(x, g.rulerY); ctx.lineTo(x, g.rulerY + (major ? 14 : 7)); ctx.stroke();
      if (major && k >= 0 && pxBar * every > 22) { ctx.fillStyle = ink; ctx.fillText(String(k + 1), x + 3, g.rulerY + 26); }
      if (s.step < 1 && pxBar > 10) {
        const xh = Math.round(g.x(o + (k + 0.5) * bar)) + 0.5;
        if (xh < g.pad + g.w) { ctx.strokeStyle = ink3; ctx.beginPath(); ctx.moveTo(xh, g.rulerY); ctx.lineTo(xh, g.rulerY + 5); ctx.stroke(); }
      }
    }
    // markers (the selected one is drawn thicker, in ink)
    const marks = s.p.sections.slice();
    if (s.drag) marks[s.drag.i] = s.drag.t;
    marks.forEach((t, i) => {
      const x = Math.round(g.x(t)) + 0.5, sel = i === s.sel;
      ctx.strokeStyle = sel ? ink : high; ctx.lineWidth = sel ? 3 : 2;
      ctx.beginPath(); ctx.moveTo(x, g.stripY - 4); ctx.lineTo(x, g.rulerY + 34); ctx.stroke();
      ctx.fillStyle = sel ? ink : high;
      ctx.beginPath(); ctx.moveTo(x - 6, g.stripY - 6); ctx.lineTo(x + 6, g.stripY - 6); ctx.lineTo(x, g.stripY + 2); ctx.closePath(); ctx.fill();
    });
    ctx.lineWidth = 1;
    // section labels on the strip (skipped when they would overlap)
    const pts = [0, ...marks.slice().sort((a, b) => a - b), g.dur];
    if (pts.length > 2) {
      ctx.font = '700 11px "JetBrains Mono", monospace';
      for (let k = 0; k < pts.length - 1; k++) {
        const x = g.x(pts[k]) + 5, label = `${k + 1}/${pts.length - 1}`, lw = ctx.measureText(label).width + 6;
        if (g.x(pts[k + 1]) - g.x(pts[k]) < lw + 6) continue;
        ctx.fillStyle = 'rgba(0,0,0,0.65)'; ctx.fillRect(x - 3, g.stripY + 4, lw, 16);
        ctx.fillStyle = '#fff'; ctx.fillText(label, x, g.stripY + 16);
      }
    }
    // the × on the hovered (or selected) marker
    const xi = !s.drag ? (s.hover >= 0 ? s.hover : s.sel) : -1;
    const b = xi >= 0 && this.xBox(xi);
    if (b) {
      ctx.fillStyle = '#fff'; ctx.strokeStyle = '#000';
      ctx.beginPath(); ctx.arc(b.x, b.y, 8, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
      ctx.lineWidth = 2;
      ctx.beginPath(); ctx.moveTo(b.x - 3.5, b.y - 3.5); ctx.lineTo(b.x + 3.5, b.y + 3.5); ctx.moveTo(b.x + 3.5, b.y - 3.5); ctx.lineTo(b.x - 3.5, b.y + 3.5); ctx.stroke();
      ctx.lineWidth = 1;
    }
    // readouts
    const barS = this.barSeconds();
    const head = s.ov.querySelector('#sectBar');
    head.textContent = `1 bar = ${barS.toFixed(2)} s on screen = ${bar.toFixed(2)} s of the clip at ${ClipTools.speedLabel(this.engine.speedOf(s.p))}`;
    s.ov.querySelector('#sectUndo').disabled = !s.undo.length;
    const list = s.ov.querySelector('#sectList');
    list.textContent = '';
    kids.forEach((c, k) => {
      const bb = this.engine.sectionBounds(c);
      const li = document.createElement('li');
      const bars = +((bb.end - bb.start) / bar).toFixed(2);
      const txt = document.createElement('span');
      txt.textContent = `${c.name} · ${fmtTime(bb.start, true)}–${fmtTime(bb.end, true)} · ${bars} bar${bars === 1 ? '' : 's'}${c.asClip ? '' : ' · not used'}${c.own ? ' · own clip' : ''}`;
      const x = document.createElement('button');
      x.type = 'button';
      x.className = 'sect-x sect-del';
      x.textContent = '×';
      // Removing a section removes the cut at its start (the first one: at its end).
      const mi = k > 0 ? k - 1 : 0;
      x.title = k > 0 ? 'Remove the cut before this section (joins it to the one before)' : 'Remove the cut after this section (joins it to the next)';
      x.setAttribute('aria-label', `Remove ${c.name}`);
      x.addEventListener('click', () => this.removeMarker(mi));
      // ↗ its own clip (a card of its own in the stack), or back (D-100)
      const o = document.createElement('button');
      o.type = 'button';
      o.className = 'sect-x sect-own' + (c.own ? ' is-on' : '');
      o.textContent = c.own ? '↩' : '↗';
      o.title = c.own ? 'Back onto the clip’s strip' : 'Make this section its own clip (its own card in the Action clips)';
      o.setAttribute('aria-label', `${c.own ? 'Put back' : 'Make its own clip'}: ${c.name}`);
      o.addEventListener('click', () => this.engine.setSectionOwn(c.id, !c.own));
      li.append(txt, o, x);
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

// Workspace layout (v2.4, D-84): resizable areas and lanes, remembered.
//
// The layout is one small record — a list of heights — kept in this
// build's own storage (Stable05 and the alpha don't share it, D-79):
//   editor   the bottom editor (viewport ↕ editor handle)
//   bin      the Action Editor's height (its own grip, like a lane); null =
//            whatever the lanes leave
//   lanes    master / clips / voice / text heights (each lane's lower edge)
//   clipsExpanded  clip lane full size, or the compact band strip (D-85)
//   aeGlobalOpen   the Auto-Editor's "Global edit" section (D-86)
// Double-click any handle to put that size back to its default.
class Workspace {
  static KEY = 'bssmnt.layout';
  static LANES = { master: 72, clips: 64, voice: 40, text: 40 };
  static MIN = { master: 32, clips: 40, voice: 24, text: 24 };
  static MAX = 260;
  static COMPACT = 38;          // band strip 22 + over-stream row 8 + gaps
  static BIN_MIN = 64;

  constructor(app) {
    this.app = app;
    this.state = { editor: null, bin: null, lanes: { ...Workspace.LANES }, clipsExpanded: false, aeGlobalOpen: true };
    this.load();
  }

  load() {
    try {
      const s = JSON.parse(localStorage.getItem(Workspace.KEY) || 'null');
      if (s && typeof s === 'object') {
        this.state = { ...this.state, ...s, lanes: { ...Workspace.LANES, ...(s.lanes || {}) } };
      } else {
        const old = parseInt(localStorage.getItem('djv.editorHeight'), 10);   // before v2.4
        if (old) this.state.editor = old;
      }
    } catch (e) { /* storage blocked: defaults */ }
  }

  save() {
    try { localStorage.setItem(Workspace.KEY, JSON.stringify(this.state)); } catch (e) { /* storage blocked */ }
  }

  // Height of a timeline lane as drawn.
  laneHeight(name) {
    if (name === 'ruler') return 28;
    if (name === 'clips' && !this.state.clipsExpanded) return Workspace.COMPACT;
    return this.state.lanes[name] || Workspace.LANES[name];
  }

  init() {
    const $ = (id) => document.getElementById(id);
    this.el = { editor: $('editorPanel'), main: $('editorMain'), split: $('panelSplitter'), binSplit: $('binGrip'), grips: $('laneGrips'), expand: $('clipsExpand'), clipsSub: $('chClipsSub'), ae: $('aeGlobal'), area: $('tlArea') };
    const el = this.el;
    this.applyEditor();
    this.applyBin();

    // viewport ↕ editor
    this.drag(el.split, () => el.editor.getBoundingClientRect().height, (h0, dy) => {
      this.state.editor = Math.round(Math.max(230, Math.min(window.innerHeight * 0.8, h0 - dy)));
      this.applyEditor();
    }, () => { this.state.editor = null; this.applyEditor(); });

    // The Action Editor is a lane like the others: its own grip on its
    // lower edge (Omar, 2026-10-08). The one main drag is viewport ↕ editor.
    if (el.binSplit) {
      this.drag(el.binSplit, () => this.binNow(), (h0, dy) => {
        this.state.bin = Math.round(Math.max(Workspace.BIN_MIN, Math.min(600, h0 + dy)));
        this.applyBin();
      }, () => { this.state.bin = null; this.applyBin(); });
    }

    // clip lane: compact band strip ⇄ full lane
    if (el.expand) {
      el.expand.addEventListener('click', () => { this.state.clipsExpanded = !this.state.clipsExpanded; this.save(); this.applyExpand(); this.app.timeline.resizeCanvas(); });
      this.applyExpand();
    }
    if (el.ae) {
      el.ae.open = this.state.aeGlobalOpen !== false;
      el.ae.addEventListener('toggle', () => { this.state.aeGlobalOpen = el.ae.open; this.save(); });
    }
    // Every fold-out row in the shelves remembers being open or folded.
    this.state.folds = this.state.folds || {};
    document.querySelectorAll('.side-panel details.menu-sub[id]').forEach(d => {
      if (d.id === 'aeGlobal') return;
      if (d.id in this.state.folds) d.open = !!this.state.folds[d.id];
      d.addEventListener('toggle', () => { this.state.folds[d.id] = d.open; this.save(); });
    });
  }

  binNow() {
    const bin = document.getElementById('clipBin');
    return bin ? bin.getBoundingClientRect().height : 120;
  }

  applyEditor() {
    if (!this.el.editor) return;
    this.el.editor.style.height = this.state.editor ? `${this.state.editor}px` : '';
  }

  applyBin() {
    const m = this.el.main;
    if (!m) return;
    m.classList.toggle('has-bin-h', !!this.state.bin);
    if (this.state.bin) m.style.setProperty('--bin-h', `${this.state.bin}px`);
    else m.style.removeProperty('--bin-h');
  }

  applyExpand() {
    const on = !!this.state.clipsExpanded;
    this.el.expand.setAttribute('aria-pressed', String(on));
    this.el.expand.innerHTML = on ? '&#x25BE;' : '&#x25B8;';
    this.el.expand.setAttribute('aria-label', on ? 'Show the clip lane as a compact band strip' : 'Show the clip lane full size');
    if (this.el.clipsSub) this.el.clipsSub.textContent = on ? 'Auto-edit' : 'Strip + over';
  }

  // A drag handle: start() gives the size when the drag starts, set(size0,
  // dy) applies it while dragging; double-click resets. Saved on release.
  drag(handle, start, set, reset) {
    if (!handle) return;
    handle.addEventListener('pointerdown', (e) => {
      if (e.button !== 0) return;
      e.preventDefault();
      const y0 = e.clientY, s0 = start();
      handle.classList.add('dragging');
      handle.setPointerCapture(e.pointerId);
      const move = (ev) => set(s0, ev.clientY - y0);
      const up = () => {
        handle.classList.remove('dragging');
        handle.removeEventListener('pointermove', move);
        handle.removeEventListener('pointerup', up);
        handle.removeEventListener('pointercancel', up);
        this.save();
        this.app.timeline.resizeCanvas();
      };
      handle.addEventListener('pointermove', move);
      handle.addEventListener('pointerup', up);
      handle.addEventListener('pointercancel', up);
    });
    handle.addEventListener('dblclick', (e) => { e.preventDefault(); reset(); this.save(); this.app.timeline.resizeCanvas(); });
  }

  // One grip on the lower edge of each resizable lane (called after the
  // timeline lays its lanes out). The compact strip has a fixed height.
  renderGrips(lanes) {
    const box = this.el && this.el.grips;
    if (!box) return;
    const shown = lanes.filter(l => l.name !== 'ruler' && !(l.name === 'clips' && !this.state.clipsExpanded));
    const key = shown.map(l => l.name).join('|');
    if (key === this.gripKey) {
      // Same lanes: just move the grips (one may be mid-drag).
      shown.forEach(l => { const g = box.querySelector(`[data-lane="${l.name}"]`); if (g) g.style.top = `${l.y + l.h - 3}px`; });
      return;
    }
    this.gripKey = key;
    box.textContent = '';
    shown.forEach(l => {
      const g = document.createElement('div');
      g.className = 'lane-grip';
      g.dataset.lane = l.name;
      g.style.top = `${l.y + l.h - 3}px`;
      g.title = `Drag to resize the ${l.name} lane · double-click to reset`;
      box.appendChild(g);
      this.drag(g, () => this.state.lanes[l.name], (h0, dy) => {
        this.state.lanes[l.name] = Math.round(Math.max(Workspace.MIN[l.name], Math.min(Workspace.MAX, h0 + dy)));
        this.app.timeline.resizeCanvas();
      }, () => { this.state.lanes[l.name] = Workspace.LANES[l.name]; });
    });
  }
}

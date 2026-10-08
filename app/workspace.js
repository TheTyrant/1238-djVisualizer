// Workspace layout (v2.4, D-84, reworked as drawers with Omar 2026-10-08,
// D-96): the bottom shelf is a stack of drawers — Master, Clips, Voice,
// Text, Action clips — under the timeline ruler.
//
//   One main drag (viewport ↕ shelf) sets the shelf's height; every drawer
//   grows or shrinks with it, evenly (each keeps its share).
//   Between two drawers sits a divider: a 1 px white line with a pill in the
//   middle. Dragging it moves height from one drawer to the other.
//   The compact clip strip (D-85) keeps its fixed height.
//
// The layout is one small record kept in this build's own storage (D-79):
//   editor  the shelf's height · lanes  each drawer's share (weights)
//   clipsExpanded · aeGlobalOpen · folds · groupFolds
// Double-click a divider (or the main drag) to put it back to the default.
class Workspace {
  static KEY = 'bssmnt.layout';
  static LANES = { master: 72, clips: 64, voice: 40, text: 40, bin: 150 };   // default shares
  static MIN = { master: 32, clips: 40, voice: 24, text: 24, bin: 64 };
  static COMPACT = 38;          // band strip 22 + over-stream row 8 + gaps
  static RULER = 28;
  static LABELS = { master: 'Master', clips: 'Clips', voice: 'Voice', text: 'Text', bin: 'Action clips' };

  constructor(app) {
    this.app = app;
    this.state = { editor: null, lanes: { ...Workspace.LANES }, clipsExpanded: false, aeGlobalOpen: true };
    this.px = {};
    this.load();
  }

  load() {
    try {
      const s = JSON.parse(localStorage.getItem(Workspace.KEY) || 'null');
      if (s && typeof s === 'object') {
        this.state = { ...this.state, ...s, lanes: { ...Workspace.LANES, ...(s.lanes || {}) } };
        delete this.state.bin;   // pre-drawer Action Editor height
      } else {
        const old = parseInt(localStorage.getItem('djv.editorHeight'), 10);   // before v2.4
        if (old) this.state.editor = old;
      }
    } catch (e) { /* storage blocked: defaults */ }
  }

  save() {
    try { localStorage.setItem(Workspace.KEY, JSON.stringify(this.state)); } catch (e) { /* storage blocked */ }
  }

  // Drawers on screen, top to bottom (the compact strip is in the list but
  // doesn't share the space).
  drawers() {
    const app = this.app;
    const out = ['master', 'clips'];
    if (app.voice && app.voice.isLoaded) out.push('voice');
    if (app.text && app.text.items.length) out.push('text');
    out.push('bin');
    return out;
  }

  flexible(name) { return !(name === 'clips' && !this.state.clipsExpanded); }

  // Split the shelf between the drawers by their shares.
  compute() {
    const main = this.el && this.el.main;
    const avail = main ? main.clientHeight : 0;
    const names = this.drawers();
    const flexNames = names.filter(n => this.flexible(n));
    const fixed = Workspace.RULER + (this.flexible('clips') ? 0 : Workspace.COMPACT);
    const flex = Math.max(0, avail - fixed);
    const W = this.state.lanes;
    const sum = flexNames.reduce((s, n) => s + (W[n] || Workspace.LANES[n]), 0) || 1;
    const px = {};
    let used = 0;
    flexNames.forEach((n, i) => {
      const h = i === flexNames.length - 1 ? Math.max(Workspace.MIN[n], flex - used) : Math.max(Workspace.MIN[n], Math.round(((W[n] || Workspace.LANES[n]) / sum) * flex));
      px[n] = h;
      used += h;
    });
    this.px = px;
    this.flexPx = flex;
    this.weightPerPx = sum / Math.max(1, flex);
    if (main && px.bin) main.style.setProperty('--bin-h', `${px.bin}px`);
  }

  // Height of a timeline lane as drawn.
  laneHeight(name) {
    if (name === 'ruler') return Workspace.RULER;
    if (name === 'clips' && !this.state.clipsExpanded) return Workspace.COMPACT;
    return this.px[name] || Workspace.LANES[name];
  }

  init() {
    const $ = (id) => document.getElementById(id);
    this.el = { editor: $('editorPanel'), main: $('editorMain'), split: $('panelSplitter'), grips: $('laneGrips'), expand: $('clipsExpand'), clipsSub: $('chClipsSub'), ae: $('aeGlobal') };
    const el = this.el;
    // The dividers sit over the whole shelf (lanes and Action clips).
    if (el.grips && el.main && el.grips.parentElement !== el.main) el.main.appendChild(el.grips);
    this.applyEditor();

    // The one main drag: viewport ↕ shelf. The drawers follow (ResizeObserver).
    this.drag(el.split, () => el.editor.getBoundingClientRect().height, (h0, dy) => {
      this.state.editor = Math.round(Math.max(230, Math.min(window.innerHeight * 0.85, h0 - dy)));
      this.applyEditor();
    }, () => { this.state.editor = null; this.applyEditor(); });
    if (el.main && window.ResizeObserver) {
      let pending = false;
      new ResizeObserver(() => {
        if (pending) return;
        pending = true;
        requestAnimationFrame(() => { pending = false; if (this.app.timeline && this.app.timeline.ctx) this.app.timeline.resizeCanvas(); });
      }).observe(el.main);
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

  applyEditor() {
    if (!this.el.editor) return;
    this.el.editor.style.height = this.state.editor ? `${this.state.editor}px` : '';
  }

  applyExpand() {
    const on = !!this.state.clipsExpanded;
    this.el.expand.setAttribute('aria-pressed', String(on));
    this.el.expand.innerHTML = on ? '&#x25BE;' : '&#x25B8;';
    this.el.expand.setAttribute('aria-label', on ? 'Show the clip lane as a compact band strip' : 'Show the clip lane full size');
    if (this.el.clipsSub) this.el.clipsSub.textContent = on ? 'Auto-edit' : 'Strip + over';
  }

  // A drag handle: start() gives the state when the drag starts, set(s0,
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

  // The dividers, one on each line between two drawers (called after the
  // timeline lays its lanes out). laid = the timeline lanes with y / h.
  renderGrips(laid) {
    const box = this.el && this.el.grips;
    if (!box) return;
    const lanes = laid.filter(l => l.name !== 'ruler');
    const tlBottom = laid.reduce((m, l) => Math.max(m, l.y + l.h), 0);
    const order = lanes.map(l => l.name).concat('bin');
    const bottoms = Object.fromEntries(lanes.map(l => [l.name, l.y + l.h]));
    const lines = [];
    for (let i = 0; i < order.length - 1; i++) {
      // the flexible drawer above this line, and the one below it
      let u = i; while (u >= 0 && !this.flexible(order[u])) u--;
      let d = i + 1; while (d < order.length && !this.flexible(order[d])) d++;
      if (u < 0 || d >= order.length) continue;
      lines.push({ key: `${order[i]}|${order[i + 1]}`, y: order[i] === 'bin' ? tlBottom : bottoms[order[i]], upper: order[u], lower: order[d], label: `${Workspace.LABELS[order[i]]} / ${Workspace.LABELS[order[i + 1]]}` });
    }
    const key = lines.map(l => `${l.key}>${l.upper}|${l.lower}`).join(',');
    if (key === this.gripKey) {
      lines.forEach(l => { const g = box.querySelector(`[data-between="${l.key}"]`); if (g) g.style.top = `${l.y}px`; });
      return;
    }
    this.gripKey = key;
    box.textContent = '';
    lines.forEach(l => {
      const g = document.createElement('div');
      g.className = 'drawer-div';
      g.dataset.between = l.key;
      g.dataset.upper = l.upper;
      g.dataset.lower = l.lower;
      g.style.top = `${l.y}px`;
      g.setAttribute('role', 'separator');
      g.setAttribute('aria-orientation', 'horizontal');
      g.title = `Drag to resize ${l.label} · double-click to reset`;
      g.innerHTML = '<span class="drawer-pill"></span>';
      box.appendChild(g);
      this.drag(g, () => ({ hu: this.px[l.upper], hl: this.px[l.lower] }), (s0, dy) => {
        const total = s0.hu + s0.hl;
        const nu = Math.max(Workspace.MIN[l.upper], Math.min(total - Workspace.MIN[l.lower], s0.hu + dy));
        const k = this.weightPerPx;
        this.state.lanes[l.upper] = nu * k;
        this.state.lanes[l.lower] = (total - nu) * k;
        this.app.timeline.resizeCanvas();
      }, () => { this.state.lanes[l.upper] = Workspace.LANES[l.upper]; this.state.lanes[l.lower] = Workspace.LANES[l.lower]; });
    });
  }
}

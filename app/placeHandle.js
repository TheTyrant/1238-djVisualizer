// Viewport drag handle for placements (v2.4, D-87): while 03 Sound is open,
// the selected Media Layer (bass / mid / high) or Over image gets a dashed
// box on the viewport. Dragging it moves the item; the move lands on the
// breakpoint on screen (D-63), so 16:9 and 9:16 keep separate layouts.
class PlaceHandle {
  constructor(app) {
    this.app = app;
    this.engine = app.clipEngine;
    this.viz = app.visualizer;
  }

  init(container) {
    if (!container) return;
    const h = document.createElement('div');
    h.className = 'text-handle place-handle';
    h.hidden = true;
    h.title = 'Drag to place it';
    h.innerHTML = '<span class="text-handle-tag"></span>';
    container.appendChild(h);
    this.h = h;
    this.tag = h.firstChild;
    this.container = container;
    let drag = null;
    h.addEventListener('pointerdown', (e) => {
      const t = this.target();
      if (!t) return;
      e.preventDefault();
      h.setPointerCapture(e.pointerId);
      const bp = this.bp();
      const pl = t.ensure();
      const lay = Placement.target(pl, bp), eff = Placement.at(pl, bp);
      drag = { x: e.clientX, y: e.clientY, sx: eff.x || 0, sy: eff.y || 0, lay, rect: this.canvasRect() };
      h.classList.add('dragging');
    });
    h.addEventListener('pointermove', (e) => {
      if (!drag) return;
      const clamp = (v) => Math.max(-1, Math.min(1, v));
      drag.lay.x = clamp(drag.sx + (e.clientX - drag.x) / drag.rect.width);
      drag.lay.y = clamp(drag.sy + (e.clientY - drag.y) / drag.rect.height);
    });
    const end = () => {
      if (!drag) return;
      drag.lay.x = Math.round(drag.lay.x * 1000) / 1000;
      drag.lay.y = Math.round(drag.lay.y * 1000) / 1000;
      drag = null;
      h.classList.remove('dragging');
      this.app.project.markDirty();
      this.engine.emit('clips');
    };
    h.addEventListener('pointerup', end);
    h.addEventListener('pointercancel', end);
    const loop = () => { requestAnimationFrame(loop); this.update(); };
    loop();
  }

  bp() { return this.app.display ? this.app.display.breakpoint : 'base'; }

  canvasRect() {
    const p = this.viz.p5Instance;
    return p && p.canvas ? p.canvas.getBoundingClientRect() : this.container.getBoundingClientRect();
  }

  // What the handle edits: { ensure(), box(), label } or null.
  target() {
    if (!this.app.sidebar || !this.app.sidebar.isOpen('assets')) return null;
    const a = this.engine.clipById(this.engine.selectedId);
    if (!a || a.parent) return null;
    if (a.layer && a.layer !== 'background' && this.viz.currentMode === 'layers' || (a.layer && a.layer !== 'background' && this.engine.settings.overlayLayers && this.viz.currentMode === 'clips')) {
      const L = this.viz.layers[a.layer];
      if (!L.media) return null;
      return {
        label: `${a.layer} layer`,
        ensure: () => { if (!L.placement) L.placement = JSON.parse(JSON.stringify(Placement.fromLayer(a.layer, L))); return L.placement; },
        box: () => this.viz.layerBoxes && this.viz.layerBoxes[a.layer],
      };
    }
    if (a.kind === 'image' && a.show === 'over' && this.viz.currentMode === 'clips') {
      return { label: 'over video', ensure: () => a.placement, box: () => (this.engine.overBox && this.engine.overBox.id === a.id ? this.engine.overBox : null) };
    }
    return null;
  }

  update() {
    const h = this.h;
    if (!h) return;
    const t = this.target();
    this.engine.previewOver = !!(t && t.label === 'over video');
    const b = t && t.box();
    if (!b) { if (!h.hidden) h.hidden = true; return; }
    const p = this.viz.p5Instance;
    const r = this.canvasRect(), c = this.container.getBoundingClientRect();
    const s = r.width / (p ? p.width : r.width);
    const w = b.w * s, hh = b.h * s;
    const cx = r.left - c.left + r.width / 2 + b.cx * s, cy = r.top - c.top + r.height / 2 + b.cy * s;
    h.hidden = false;
    h.style.left = `${cx - w / 2}px`;
    h.style.top = `${cy - hh / 2}px`;
    h.style.width = `${w}px`;
    h.style.height = `${hh}px`;
    h.style.transform = b.rot ? `rotate(${b.rot}rad)` : '';
    const label = `${t.label} · ${DisplaySize.BREAKPOINTS[this.bp()].short}`;
    if (this.tag.textContent !== label) this.tag.textContent = label;
  }
}

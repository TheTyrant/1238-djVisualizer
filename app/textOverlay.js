// Text: titles, credits and general text (v2.4, D-60). The first piece of
// the overlay system (the rest is roadmap only).
//
// Text items sit on the master timeline and draw on top of every visual
// mode: in the viewport, in fullscreen, in the pop-out output window, and
// (later) in the offline renderer, all through one render() function. Sizes
// are fractions of the frame height, so text looks the same at any output
// resolution.
//
// Timing ("lock"): start  = from the beginning (+ optional offset)
//                  end    = the last <duration> seconds of the track
//                  time   = at an exact time on the timeline
// In live mode there is no end, so End-locked items play when "Show now"
// is pressed.
class TextOverlay {
  static FONTS = {
    display: '"Boldonse", "Inter Tight", "Segoe UI", sans-serif',
    sans: '"Inter Tight", "Segoe UI", system-ui, sans-serif',
    mono: '"JetBrains Mono", Consolas, monospace',
    serif: 'Georgia, "Times New Roman", serif',
  };
  static SIZES = { s: 0.035, m: 0.05, l: 0.07, xl: 0.11 };
  // Layout that a breakpoint (D-63) can override; words, font, colour,
  // animation and timing are shared by every size.
  static BP_KEYS = ['position', 'x', 'y', 'size', 'align', 'plate', 'anchor', 'ox', 'oy', 'safe'];
  // 9:16 safe areas (D-89): what platform UI covers on a vertical video.
  // Editable constants; drawn faintly on the viewport while 04 Effects is open.
  static SAFE = { top: 0.12, bottom: 0.22, right: 0.14, left: 0 };
  static ANCHORS = { tl: [0, 0], tc: [0.5, 0], tr: [1, 0], ml: [0, 0.5], mc: [0.5, 0.5], mr: [1, 0.5], bl: [0, 1], bc: [0.5, 1], br: [1, 1] };
  // Trend presets (D-89): a look + an animation, applied in one go.
  static PRESETS = {
    bold: { label: 'Bold stack', style: { font: 'display', size: 'xl', align: 'center', position: 'anchor', anchor: 'mc', ox: 0, oy: 0, plate: 'shadow', caps: true }, anim: 'pop' },
    words: { label: 'Word by word (on the beat)', style: { font: 'sans', size: 'l', align: 'center', position: 'anchor', anchor: 'mc', ox: 0, oy: 0, plate: 'shadow', caps: false }, anim: 'words' },
    highlight: { label: 'Highlight word', style: { font: 'sans', size: 'l', align: 'center', position: 'anchor', anchor: 'mc', ox: 0, oy: 0, plate: 'none', highlight: true, accent: '#ffd400' }, anim: 'fade' },
    lower: { label: 'Lower third', style: { font: 'sans', size: 'm', align: 'left', position: 'anchor', anchor: 'bl', ox: 0.06, oy: -0.1, plate: 'none', bar: true, accent: '#ff3b30', caps: false }, anim: 'slide' },
    trackin: { label: 'Track-in', style: { font: 'sans', size: 'l', align: 'center', position: 'anchor', anchor: 'mc', ox: 0, oy: 0, plate: 'shadow', caps: true }, anim: 'trackin' },
    mask: { label: 'Mask reveal', style: { font: 'display', size: 'l', align: 'center', position: 'anchor', anchor: 'mc', ox: 0, oy: 0, plate: 'none', accent: '#ffffff', caps: true }, anim: 'mask' },
  };

  applyPreset(id, key) {
    const it = this.get(id), P = TextOverlay.PRESETS[key];
    if (!it || !P) return;
    it.preset = key;
    Object.assign(it.style, { highlight: false, bar: false, caps: false }, P.style);
    if (it.bp) Object.values(it.bp).forEach(o => ['position', 'anchor', 'ox', 'oy', 'align', 'size', 'plate'].forEach(k => delete o[k]));
    it.anim = P.anim;
    if (key === 'highlight' && !/\*[^*]+\*/.test(it.content || '')) it.content = String(it.content || 'Make it pop').replace(/(\S+)\s*$/, '*$1*');
    if (key === 'lower' && !/\n/.test(it.content || '')) it.content = `${it.content || 'Your Name'}\nWhat you do`;
    this.emit('change');
  }

  static defaults(kind) {
    const base = {
      kind, anchor: 'time', start: 0, duration: 4, firedAt: null,
      style: { font: 'sans', size: 'l', color: '#ffffff', align: 'center', position: 'lower', plate: 'shadow' },
      anim: 'fade',
    };
    if (kind === 'title') return { ...base, anchor: 'start', start: 0, duration: 5, content: 'TITLE\nSubtitle',
      style: { ...base.style, font: 'display', size: 'xl', position: 'center' } };
    if (kind === 'credits') return { ...base, anchor: 'end', duration: 15, anim: 'roll',
      content: '# Credits\n\nDirected by\nYour Name\n\nMusic\nArtist — Track\n\nThanks for watching',
      style: { ...base.style, font: 'sans', size: 'm', position: 'center' } };
    return { ...base, content: 'Your text', style: { ...base.style, plate: 'plate', align: 'left' } };
  }

  constructor(app) {
    this.app = app;
    this.items = [];
    this.nextId = 1;
    this.selectedId = null;
    this.listeners = new Set();
    this.boxes = new Map();     // on-screen bounds per item (viewport), for the drag handle
  }

  on(fn) { this.listeners.add(fn); }
  emit(type) { this.listeners.forEach(fn => fn(type)); }

  // ---- model -------------------------------------------------------------

  add(kind) {
    const item = { id: this.nextId++, ...TextOverlay.defaults(kind) };
    if (item.anchor === 'time') item.start = +this.app.masterTime().toFixed(1);
    this.items.push(item);
    this.selectedId = item.id;
    this.emit('change');
    return item;
  }

  get(id) { return this.items.find(i => i.id === id); }

  // Style edits go to the breakpoint on screen (D-63): layout keys on a
  // breakpoint other than Base are stored as overrides for it.
  update(id, patch) {
    const it = this.get(id);
    if (!it) return;
    if ('anchor' in patch || 'start' in patch) patch.firedWall = null;
    if (patch.style) {
      const target = this.layoutTarget(it);
      Object.entries(patch.style).forEach(([k, v]) => {
        if (TextOverlay.BP_KEYS.includes(k)) target[k] = v; else it.style[k] = v;
      });
      delete patch.style;
    }
    Object.assign(it, patch);
    this.emit('change');
  }

  // ---- breakpoints (D-63) -----------------------------------------------------

  activeBp() { return this.app.display ? this.app.display.breakpoint : 'base'; }

  // Style as seen at breakpoint bp: Base, with that breakpoint's overrides.
  styleFor(it, bp = this.activeBp()) {
    const o = bp !== 'base' && it.bp && it.bp[bp];
    return o ? { ...it.style, ...o } : it.style;
  }

  // Where a layout edit lands right now (the Base style, or the override).
  layoutTarget(it, bp = this.activeBp()) {
    if (bp === 'base') return it.style;
    if (!it.bp) it.bp = {};
    if (!it.bp[bp]) it.bp[bp] = {};
    return it.bp[bp];
  }

  overrides(it, bp = this.activeBp()) {
    return bp !== 'base' && it.bp && it.bp[bp] ? Object.keys(it.bp[bp]) : [];
  }

  resetBp(id, bp = this.activeBp()) {
    const it = this.get(id);
    if (it && it.bp) { delete it.bp[bp]; this.emit('change'); }
  }

  remove(id) {
    this.items = this.items.filter(i => i.id !== id);
    if (this.selectedId === id) this.selectedId = null;
    this.emit('change');
  }

  select(id) { this.selectedId = id; this.emit('select'); }

  // Live mode: play an item from now (End-locked items have no end to sit on).
  fire(id) {
    const it = this.get(id);
    if (it) { it.firedAt = this.app.masterTime(); it.firedWall = performance.now() / 1000; this.emit('change'); }
  }

  // [start, end) on the master timeline, or null if it can't be placed yet.
  windowOf(it) {
    const d = Math.max(0.2, +it.duration || 0);
    if (it.firedAt != null) return [it.firedAt, it.firedAt + d];
    if (it.anchor === 'clip') {
      // Locked to a positioned clip (D-89): follows its Hook / Result / CTA block.
      const b = this.app.clipEngine && this.app.clipEngine.storyBlocks().find(x => x.role === it.lockRole);
      return b ? [b.start, b.end] : null;
    }
    if (it.anchor === 'start') return [Math.max(0, +it.start || 0), Math.max(0, +it.start || 0) + d];
    if (it.anchor === 'end') {
      const end = this.app.isTrackMode() ? this.app.songLength() : 0;
      return end > 0 ? [Math.max(0, end - d), end] : null;
    }
    return [Math.max(0, +it.start || 0), Math.max(0, +it.start || 0) + d];
  }

  // ---- drawing -------------------------------------------------------------

  // Draw every item visible at time t into a 2D context of size W×H.
  // preview: an item id to show faded even outside its time (editing while
  // paused, D-62); during playback every item keeps strictly to its time.
  // live = false (export): Show now items sit at their master time.
  render(ctx, W, H, t, preview = null, live = true) {
    ctx.clearRect(0, 0, W, H);
    if (ctx === this.ctx) this.boxes = new Map();
    const bp = DisplaySize.bpFor(W, H);     // the layout for this frame shape
    let drawn = 0;
    if (ctx === this.ctx && this.previewing && bp === 'vertical') { this.drawSafe(ctx, W, H); drawn++; }
    for (const src of this.items) {
      const it = bp === 'base' || !src.bp || !src.bp[bp] ? src : { ...src, style: this.styleFor(src, bp) };
      let win = this.windowOf(it);
      let tt = t;
      // Show now runs on the wall clock, so it plays even while the live clock is stopped.
      if (live && it.firedWall != null && !this.app.isTrackMode()) { tt = performance.now() / 1000; win = [it.firedWall, it.firedWall + (win[1] - win[0])]; }
      let p = null, ghost = false;
      if (win && tt >= win[0] && tt < win[1]) p = (tt - win[0]) / (win[1] - win[0]);
      else if (it.id === preview) { p = it.anim === 'roll' ? 0.35 : 0.5; ghost = true; }
      if (p == null) continue;
      const box = this.drawItem(ctx, W, H, it, p, (win ? win[1] - win[0] : it.duration), ghost);
      if (ctx === this.ctx && box) this.boxes.set(it.id, { ...box, ghost });
      drawn++;
    }
    return drawn;
  }

  // 9:16 safe areas, faint, on the viewport only (D-89).
  drawSafe(ctx, W, H) {
    const S = TextOverlay.SAFE;
    ctx.save();
    ctx.fillStyle = 'rgba(255, 64, 64, 0.10)';
    ctx.fillRect(0, 0, W, H * S.top);
    ctx.fillRect(0, H * (1 - S.bottom), W, H * S.bottom);
    ctx.fillRect(W * (1 - S.right), H * S.top, W * S.right, H * (1 - S.top - S.bottom));
    ctx.setLineDash([6, 6]);
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.35)';
    ctx.lineWidth = 1;
    ctx.strokeRect(0.5, H * S.top + 0.5, W * (1 - S.right) - 1, H * (1 - S.top - S.bottom) - 1);
    ctx.restore();
  }

  lines(it, H) {
    const base = H * (TextOverlay.SIZES[it.style.size] || 0.05);
    let raw = String(it.content || '').split('\n');
    if (it.style.caps) raw = raw.map(s => s.toUpperCase());
    return raw.map((text, i) => {
      let size = base, weight = it.style.font === 'display' ? 400 : 600, t = text;
      if (it.kind === 'credits' && t.startsWith('# ')) { t = t.slice(2); size = base * 1.4; weight = 800; }
      else if (it.kind === 'title' && i > 0) { size = base * 0.42; weight = 500; }
      else if (it.style.bar && i > 0) { size = base * 0.62; weight = 500; }        // lower third: name, then a line
      else if (it.style.bar && i === 0) { weight = 800; }
      return { text: t, size, weight, gap: t.trim() === '' ? base * 0.6 : size * 1.25 };
    });
  }

  drawItem(ctx, W, H, it, p, dur, ghost = false) {
    const L = this.lines(it, H);
    const blockH = L.reduce((h, l) => h + l.gap, 0);
    const fadeP = Math.min(0.25, 0.6 / Math.max(0.6, dur));
    let alpha = 1;
    if (it.anim === 'mask' || it.anim === 'words') alpha = Math.min(1, (1 - p) / fadeP);   // they reveal themselves; fade out only
    else if (it.anim !== 'none' && it.anim !== 'roll') alpha = Math.min(1, p / fadeP, (1 - p) / fadeP);
    else if (it.anim === 'roll') alpha = Math.min(1, p / 0.04, (1 - p) / 0.04);
    alpha = Math.max(0, alpha);
    if (ghost) alpha = 0.55;
    if (alpha <= 0) return null;

    const align = it.style.align;
    const pad = W * 0.06;
    let x = align === 'left' ? pad : align === 'right' ? W - pad : W / 2;
    let y;
    const family0 = TextOverlay.FONTS[it.style.font] || TextOverlay.FONTS.sans;
    let maxW0 = 0;
    L.forEach(l => { ctx.font = `${l.weight} ${l.size}px ${family0}`; maxW0 = Math.max(maxW0, ctx.measureText(l.text.replace(/\*/g, '')).width); });
    if (it.anim !== 'roll' && it.style.position === 'anchor') {
      // Screen lock (D-89): the block's anchor point on the frame's (inside
      // the 9:16 safe areas when asked), plus an offset.
      const a = TextOverlay.ANCHORS[it.style.anchor] || TextOverlay.ANCHORS.mc;
      const S = it.style.safe && DisplaySize.bpFor(W, H) === 'vertical' ? TextOverlay.SAFE : { top: 0, bottom: 0, left: 0, right: 0 };
      const rx = S.left * W, ry = S.top * H, rw = W * (1 - S.left - S.right), rh = H * (1 - S.top - S.bottom);
      const left = rx + a[0] * rw - a[0] * maxW0 + (it.style.ox || 0) * W;
      y = ry + a[1] * rh - a[1] * blockH + (it.style.oy || 0) * H;
      x = align === 'left' ? left : align === 'right' ? left + maxW0 : left + maxW0 / 2;
      if (it.anim === 'rise') y += (1 - alpha) * H * 0.03;
      if (it.anim === 'slide') x -= (1 - alpha) * W * 0.04;
    } else if (it.anim === 'roll') {
      y = H - p * (H + blockH);                  // credits roll bottom → top
    } else if (it.style.position === 'free') {
      // Placed by dragging (D-62): x/y are fractions of the frame.
      x = (it.style.x != null ? it.style.x : 0.5) * W;
      y = (it.style.y != null ? it.style.y : 0.5) * H;
      if (it.anim === 'rise') y += (1 - alpha) * H * 0.03;
    } else {
      const pos = it.style.position;
      y = pos === 'top' ? H * 0.08 : pos === 'bottom' ? H * 0.92 - blockH : pos === 'lower' ? H * 0.72 - blockH / 2 : (H - blockH) / 2;
      if (it.anim === 'rise') y += (1 - alpha) * H * 0.03;
    }

    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.textAlign = align;
    ctx.textBaseline = 'top';
    const family = TextOverlay.FONTS[it.style.font] || TextOverlay.FONTS.sans;

    let maxW = 0;
    L.forEach(l => { ctx.font = `${l.weight} ${l.size}px ${family}`; maxW = Math.max(maxW, ctx.measureText(l.text.replace(/\*/g, '')).width); });
    const boxLeft = align === 'left' ? x : align === 'right' ? x - maxW : x - maxW / 2;
    if (it.style.plate === 'plate') {
      const px = H * 0.02;
      const left = align === 'left' ? x - px : align === 'right' ? x - maxW - px : x - maxW / 2 - px;
      ctx.fillStyle = 'rgba(0,0,0,0.6)';
      ctx.fillRect(left, y - px, maxW + px * 2, blockH + px * 1.4);
    }
    if (it.style.plate === 'shadow') {
      ctx.shadowColor = 'rgba(0,0,0,0.75)';
      ctx.shadowBlur = H * 0.012;
      ctx.shadowOffsetY = H * 0.003;
    }
    const el = p * dur;                       // seconds into the item
    const accent = it.style.accent || '#ffd400';
    // Pop (Bold stack): scale in from 115 %.
    if (it.anim === 'pop' && !ghost) {
      const s = 1 + 0.15 * Math.max(0, 1 - el / 0.25);
      const cx = boxLeft + maxW / 2, cy = y + blockH / 2;
      ctx.translate(cx, cy); ctx.scale(s, s); ctx.translate(-cx, -cy);
    }
    // Track-in: letter spacing closes up as it fades in.
    if (it.anim === 'trackin' && 'letterSpacing' in ctx) ctx.letterSpacing = `${Math.max(0, 1 - el / 0.8) * 0.45 * L[0].size}px`;
    // Lower third: an accent bar beside the block.
    if (it.style.bar) {
      ctx.save(); ctx.shadowColor = 'transparent';
      const bw = Math.max(2, H * 0.006), grow = ghost ? 1 : Math.min(1, el / 0.35);
      ctx.fillStyle = accent;
      ctx.fillRect(boxLeft - bw * 3, y, bw, blockH * grow);
      ctx.restore();
    }
    // Mask reveal: wipes up from behind a line under the block.
    let reveal = 1;
    if (it.anim === 'mask' && !ghost) {
      reveal = Math.min(1, el / 0.45);
      const ly = y + blockH;
      ctx.save(); ctx.shadowColor = 'transparent';
      ctx.fillStyle = accent;
      ctx.fillRect(boxLeft, ly + H * 0.004, maxW * Math.min(1, el / 0.25), Math.max(1, H * 0.003));
      ctx.restore();
      ctx.beginPath(); ctx.rect(boxLeft - W, y - H, maxW + 2 * W, H + blockH); ctx.clip();
      ctx.translate(0, (1 - reveal) * blockH * 1.05);
    }
    // Word by word: one more word on each beat of the grid (or every 0.5 s).
    const beat = this.app.tempo && this.app.tempo.bpm > 0 ? this.app.tempo.beatSec : 0.5;
    const shown = it.anim === 'words' && !ghost ? Math.floor(el / beat) + 1 : Infinity;
    const words = it.anim === 'words' || it.style.highlight;
    ctx.fillStyle = it.style.color || '#ffffff';
    let yy = y, wi = 0;
    for (const l of L) {
      if (l.text.trim()) {
        ctx.font = `${l.weight} ${l.size}px ${family}`;
        if (!words) ctx.fillText(l.text, x, yy);
        else wi = this.drawWords(ctx, l, x, yy, align, { shown, start: wi, el, beat, accent, color: it.style.color || '#ffffff', highlight: it.style.highlight, pop: it.anim === 'words' && !ghost });
      }
      yy += l.gap;
    }
    ctx.restore();
    return { x: boxLeft, y, w: maxW, h: blockH, anchorX: x };
  }

  // A line drawn word by word: *word* gets an accent plate (Highlight
  // word); with Word by word only the first `shown` words, the newest
  // popping in. Returns the running word count.
  drawWords(ctx, l, x, y, align, o) {
    const parts = l.text.split(/(\s+)/);
    const clean = (s) => s.replace(/\*/g, '');
    const full = ctx.measureText(clean(l.text)).width;
    let cx = align === 'left' ? x : align === 'right' ? x - full : x - full / 2;
    let n = o.start;
    let hot = false;
    const saveAlign = ctx.textAlign;
    ctx.textAlign = 'left';
    for (const part of parts) {
      if (!part) continue;
      if (/^\s+$/.test(part)) { cx += ctx.measureText(part).width; continue; }
      if (part.startsWith('*')) hot = true;
      const word = clean(part), w = ctx.measureText(word).width;
      if (n < o.shown) {
        const age = o.el - n * o.beat;
        const s = o.pop ? 1 + 0.35 * Math.max(0, 1 - age / 0.15) : 1;
        ctx.save();
        if (s !== 1) { ctx.translate(cx + w / 2, y + l.size / 2); ctx.scale(s, s); ctx.translate(-(cx + w / 2), -(y + l.size / 2)); }
        if (hot && o.highlight) {
          ctx.shadowColor = 'transparent';
          const px = l.size * 0.14;
          ctx.fillStyle = o.accent; ctx.fillRect(cx - px, y - px * 0.4, w + px * 2, l.size * 1.12);
          ctx.fillStyle = '#111111';
        } else ctx.fillStyle = o.color;
        ctx.fillText(word, cx, y);
        ctx.restore();
      }
      if (part.endsWith('*')) hot = false;
      n++;
      cx += w;
    }
    ctx.textAlign = saveAlign;
    return n;
  }

  // ---- viewport overlay ----------------------------------------------------

  attach(container) {
    const c = document.createElement('canvas');
    c.className = 'text-overlay';
    c.setAttribute('aria-hidden', 'true');
    c.hidden = true;
    container.appendChild(c);
    this.canvas = c;
    this.ctx = c.getContext('2d');
    const fit = () => {
      const dpr = window.devicePixelRatio || 1;
      c.width = Math.max(1, Math.round(container.clientWidth * dpr));
      c.height = Math.max(1, Math.round(container.clientHeight * dpr));
    };
    new ResizeObserver(fit).observe(container);
    fit();
    // make sure the web fonts are ready before the first draw
    if (document.fonts) ['Boldonse', 'Inter Tight', 'JetBrains Mono'].forEach(f => document.fonts.load(`600 40px "${f}"`).catch(() => {}));
    const loop = () => {
      requestAnimationFrame(loop);
      // The canvas is taken out of the page whenever nothing is on screen:
      // an empty full-size layer over the WebGL canvas still costs
      // compositing time every frame.
      if (!this.items.length && !this.drawn) return;
      const preview = this.previewing && !this.app.timelineRolling() ? this.selectedId : null;
      this.drawn = this.render(this.ctx, c.width, c.height, this.app.masterTime(), preview) > 0;
      if (c.hidden === this.drawn) c.hidden = !this.drawn;
      this.updateHandle();
    };
    loop();
    this.makeHandle(container);
  }

  // ---- drag handle (D-62) ----------------------------------------------------
  // While 04 Text is open, the selected base text gets a dashed box on the
  // viewport. Dragging it places the text anywhere (position "Free").

  makeHandle(container) {
    const h = document.createElement('div');
    h.className = 'text-handle';
    h.hidden = true;
    h.title = 'Drag to move this text';
    h.innerHTML = '<span class="text-handle-tag"></span>';
    container.appendChild(h);
    this.handle = h;
    this.handleTag = h.firstChild;
    let drag = null;
    h.addEventListener('pointerdown', (e) => {
      const it = this.get(this.selectedId);
      const box = this.boxes && this.boxes.get(this.selectedId);
      if (!it || !box) return;
      e.preventDefault();
      h.setPointerCapture(e.pointerId);
      const W = this.canvas.width, H = this.canvas.height;
      // Moves land on the breakpoint on screen (D-63).
      const target = this.layoutTarget(it);
      const eff = this.styleFor(it);
      // Start from where it is drawn now, whatever its position preset.
      if (eff.position === 'anchor') {
        // Screen lock (D-89): dragging moves the offset from the anchor.
        target.ox = eff.ox || 0; target.oy = eff.oy || 0;
        drag = { x: e.clientX, y: e.clientY, sx: target.ox, sy: target.oy, cw: this.canvas.clientWidth, ch: this.canvas.clientHeight, target, off: true };
      } else {
        if (eff.position !== 'free') { target.x = box.anchorX / W; target.y = box.y / H; target.position = 'free'; }
        else { target.x = eff.x; target.y = eff.y; target.position = 'free'; }
        drag = { x: e.clientX, y: e.clientY, sx: target.x, sy: target.y, cw: this.canvas.clientWidth, ch: this.canvas.clientHeight, target };
      }
      h.classList.add('dragging');
    });
    h.addEventListener('pointermove', (e) => {
      if (!drag) return;
      const it = this.get(this.selectedId);
      if (!it) return;
      const clamp = (v) => Math.max(-0.2, Math.min(1.2, v));
      if (drag.off) {
        drag.target.ox = Math.max(-1, Math.min(1, drag.sx + (e.clientX - drag.x) / drag.cw));
        drag.target.oy = Math.max(-1, Math.min(1, drag.sy + (e.clientY - drag.y) / drag.ch));
        return;
      }
      drag.target.x = clamp(drag.sx + (e.clientX - drag.x) / drag.cw);
      drag.target.y = clamp(drag.sy + (e.clientY - drag.y) / drag.ch);
    });
    const end = () => {
      if (!drag) return;
      const t = drag.target;
      drag = null;
      h.classList.remove('dragging');
      if (t.ox != null) { t.ox = Math.round(t.ox * 1000) / 1000; t.oy = Math.round(t.oy * 1000) / 1000; }
      if (t.x != null) { t.x = Math.round(t.x * 1000) / 1000; t.y = Math.round(t.y * 1000) / 1000; }
      this.emit('change');
    };
    h.addEventListener('pointerup', end);
    h.addEventListener('pointercancel', end);
  }

  updateHandle() {
    const h = this.handle;
    if (!h) return;
    const it = this.previewing ? this.get(this.selectedId) : null;
    const pos = it ? this.styleFor(it).position : null;
    const box = it && it.anim !== 'roll' && (it.kind === 'text' || pos === 'anchor' || pos === 'free') && this.boxes ? this.boxes.get(it.id) : null;   // text, or a title in Screen lock (D-89)
    if (!box) { if (!h.hidden) h.hidden = true; return; }
    const s = this.canvas.clientWidth / this.canvas.width;     // canvas px → CSS px
    const pad = 6;
    h.hidden = false;
    h.style.left = `${box.x * s - pad}px`;
    h.style.top = `${box.y * s - pad}px`;
    h.style.width = `${box.w * s + pad * 2}px`;
    h.style.height = `${box.h * s + pad * 2}px`;
    h.classList.toggle('ghost', box.ghost);
    const win = this.windowOf(it);
    // Text running past the frame edge is cut off in the video: say so.
    const W = this.canvas.width, H = this.canvas.height;
    const off = box.x < -1 || box.y < -1 || box.x + box.w > W + 1 || box.y + box.h > H + 1;
    h.classList.toggle('is-clipped', off);
    const tag = off ? 'Runs off the frame at this size' : box.ghost && win ? `Preview · on screen ${fmtTime(win[0], true)}–${fmtTime(win[1], true)}` : '';
    if (this.handleTag.textContent !== tag) this.handleTag.textContent = tag;
  }

  // ---- project file ----------------------------------------------------------

  toJSON() { return { nextId: this.nextId, items: this.items.map(i => ({ ...i, style: { ...i.style }, bp: JSON.parse(JSON.stringify(i.bp || {})), firedAt: null, firedWall: null })) }; }

  fromJSON(data) {
    this.items = (data && data.items || []).map(i => ({ ...TextOverlay.defaults(i.kind), ...i, style: { ...TextOverlay.defaults(i.kind).style, ...i.style } }));
    this.nextId = Math.max((data && data.nextId) || 1, ...this.items.map(i => i.id + 1));
    this.selectedId = null;
    this.emit('change');
  }
}

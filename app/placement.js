// Placement (v2.4 step 4, D-87): one model for where a Media Layer, an image
// over the video, or a title sits in the frame.
//
//   anchor    9-point: tl tc tr / ml mc mr / bl bc br — that point of the
//             item sits on the same point of the frame
//   x, y      offset, fractions of the frame width / height
//   size      % of the frame the item fits inside (contain) or covers
//             (cover): 80 contain = the alpha's Media Layer look
//   rotation  degrees · opacity 0–1
//   fit       'contain' | 'cover'
//   blend     'normal' | 'screen' | 'multiply' | 'overlay' | 'add'
//   z         stacking order (higher draws on top)
//   react     { mode: 'none' | 'rattle' | 'pulse', band: 'bass'|'mid'|'high' }
//   bp        per-breakpoint overrides of the layout keys (D-63)
// Everything is relative to the frame, so the viewport, the pop-out and the
// offline renderer draw the same thing at any size.
const Placement = (() => {
  const ANCHORS = {
    tl: [0, 0], tc: [0.5, 0], tr: [1, 0],
    ml: [0, 0.5], mc: [0.5, 0.5], mr: [1, 0.5],
    bl: [0, 1], bc: [0.5, 1], br: [1, 1],
  };
  const LAYOUT_KEYS = ['anchor', 'x', 'y', 'size', 'rotation', 'fit'];
  const BLENDS = ['normal', 'screen', 'multiply', 'overlay', 'add'];
  const RATTLE_PX = 18;     // the alpha's bass rattle, in canvas pixels

  function defaults(over = {}) {
    return { anchor: 'mc', x: 0, y: 0, size: 80, rotation: 0, opacity: 1, fit: 'contain', blend: 'normal', z: 1, react: { mode: 'none', band: 'bass' }, bp: {}, ...over };
  }

  // A Media Layer slot as the alpha drew it (identical, D-87):
  // justify left / centre / right → anchor middle-left / centre / right;
  // stack bottom / middle / top → z 0 / 1 / 2; 80 % contain; bass rattles.
  function fromLayer(slot, L) {
    if (slot === 'background') return defaults({ anchor: 'mc', size: 100, fit: 'cover', z: -1 });
    const anchor = { left: 'ml', center: 'mc', right: 'mr' }[L.justify] || 'mc';
    const z = { bottom: 0, middle: 1, top: 2 }[L.stack];
    return defaults({ anchor, z: z == null ? 1 : z, react: { mode: slot === 'bass' ? 'rattle' : 'none', band: slot } });
  }

  // The layout seen at breakpoint bp: Base plus that breakpoint's overrides.
  function at(pl, bp = 'base') {
    const o = bp !== 'base' && pl.bp && pl.bp[bp];
    return o ? { ...pl, ...o } : pl;
  }

  // Where an edit of a layout key lands: Base, or the breakpoint's overrides.
  function target(pl, bp = 'base') {
    if (bp === 'base') return pl;
    if (!pl.bp) pl.bp = {};
    if (!pl.bp[bp]) pl.bp[bp] = {};
    return pl.bp[bp];
  }

  // The item's box in a W×H frame (centre-origin, as p5 WEBGL draws):
  // { cx, cy, w, h, rot (rad), alpha }. audio: { bass, mid, high,
  // beatPulse } and noise(t) for the rattle; time for its phase.
  function box(pl, W, H, mw, mh, react = null) {
    const a = ANCHORS[pl.anchor] || ANCHORS.mc;
    const s = (pl.size == null ? 80 : pl.size) / 100;
    const k = pl.fit === 'cover' ? Math.max(W / mw, H / mh) : Math.min(W / mw, H / mh);
    let w = mw * k * s, h = mh * k * s;
    // anchor point of the item on the same point of the frame, plus offset
    let cx = (a[0] - 0.5) * W - (a[0] - 0.5) * w + (pl.x || 0) * W;
    let cy = (a[1] - 0.5) * H - (a[1] - 0.5) * h + (pl.y || 0) * H;
    if (react && pl.react && pl.react.mode !== 'none') {
      const lvl = react.levels[pl.react.band] || 0;
      if (pl.react.mode === 'rattle') {
        cx += (react.noise(react.time * 40) - 0.5) * 2 * RATTLE_PX * lvl;
        cy += (react.noise(react.time * 40 + 500) - 0.5) * 2 * RATTLE_PX * lvl;
      } else if (pl.react.mode === 'pulse') {
        const g = 1 + 0.12 * (react.beatPulse || 0) + 0.15 * lvl;
        w *= g; h *= g;
      }
    }
    return { cx, cy, w, h, rot: ((pl.rotation || 0) * Math.PI) / 180, alpha: pl.opacity == null ? 1 : Math.max(0, Math.min(1, pl.opacity)) };
  }

  // p5 blend constants (WEBGL has no OVERLAY: Screen stands in for it).
  function p5Blend(p, blend) {
    switch (blend) {
      case 'screen': case 'overlay': return p.SCREEN;
      case 'multiply': return p.MULTIPLY;
      case 'add': return p.ADD;
      default: return p.BLEND;
    }
  }

  // Draw a p5 image / graphic with a placement, in a WEBGL (centre-origin) frame.
  function draw(p, img, pl, W, H, react = null, extraAlpha = 1) {
    if (!img) return null;
    const mw = img.width || 1, mh = img.height || 1;
    const b = box(pl, W, H, mw, mh, react);
    p.push();
    if (pl.blend && pl.blend !== 'normal') p.blendMode(p5Blend(p, pl.blend));
    p.translate(b.cx, b.cy);
    if (b.rot) p.rotate(b.rot);
    // Tint always set inside push / pop: after noTint() p5's WebGL renderer
    // (the export's) has no tint at all and image() fails.
    p.tint(255, Math.max(0, Math.min(1, b.alpha * extraAlpha)) * 255);
    p.image(img, -b.w / 2, -b.h / 2, b.w, b.h);
    if (pl.blend && pl.blend !== 'normal') p.blendMode(p.BLEND);
    p.pop();
    return b;
  }

  return { ANCHORS, LAYOUT_KEYS, BLENDS, defaults, fromLayer, at, target, box, draw };
})();

if (typeof module !== 'undefined') module.exports = Placement;

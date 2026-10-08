// Per-clip visual mode (v2.4 step 5, D-90). A clip or section can show a
// visual mode while it's on air:
//   mode   'none' | spectrum | particles | rings | waves | mandala | tunnel | galaxy | polygons
//   show   'replace' (the visual instead of the clip) | 'over' (on top of it)
//   bg     'none' (clear every frame) | 'trail' (fade, so motion leaves
//          streaks) | 'solid' (a colour)
//   solid  '#rrggbb' · tint null (the mode's own colours) or '#rrggbb'
// The visual draws into its own transparent layer — a WebGL graphic, or a
// 2D one for Spectrum Bars (the export's canvas version, D-61) — that is
// then drawn over the clip (Over) or over black (Replace). Live and the
// export use this same class, so they match.
class VisualLayer {
  static MODES = [['none', 'None'], ['spectrum', 'Spectrum Bars'], ['particles', 'Floating Particles'], ['rings', 'Frequency Rings'], ['waves', 'Wave Forms'], ['mandala', 'Mandala'], ['tunnel', 'Tunnel Vision'], ['galaxy', 'Galaxy'], ['polygons', 'Polygon Collage']];
  static DRAW = { particles: 'drawFloatingParticles3D', rings: 'drawFrequencyRings3D', waves: 'drawAudioWaves', mandala: 'drawMandala', tunnel: 'drawTunnel', galaxy: 'drawGalaxy', polygons: 'drawAudioPolygons' };
  static TRAIL = 30 / 255;      // per 60 Hz frame, like the full-screen modes' background(0,0,0,30)

  static defaults() { return { mode: 'none', show: 'over', bg: 'none', solid: '#000000', tint: null }; }

  constructor() {
    this.g = null;      // WebGL layer
    this.g2 = null;     // 2D layer (Spectrum Bars)
    this.key = '';      // what the layer last held (so a new clip starts clean)
  }

  layer(p, W, H, webgl) {
    const name = webgl ? 'g' : 'g2';
    let g = this[name];
    if (!g || g.width !== W || g.height !== H) {
      if (g) g.remove();
      g = webgl ? p.createGraphics(W, H, p.WEBGL) : p.createGraphics(W, H);
      g.pixelDensity(1);
      if (webgl) g.setAttributes && g.setAttributes('alpha', true);
      this[name] = g;
      g.clear();
    }
    return g;
  }

  // Draw visual v for the clip on air into p (WEBGL, centre origin).
  // key: changes when another cut starts (the layer starts empty);
  // dt: seconds since the last frame (Trail fades by time, not frames).
  draw(p, viz, v, key, dt = 1 / 60, alpha = 1) {
    if (!v || !v.mode || v.mode === 'none') return false;
    const W = p.width, H = p.height;
    const fresh = key !== this.key;
    this.key = key;
    let g;
    if (v.mode === 'spectrum') {
      g = this.layer(p, W, H, false);
      const ctx = g.drawingContext;
      this.background(g, v, dt, fresh, false);
      VisualLayer.spectrum(ctx, W, H, viz.audioData || {});
    } else {
      g = this.layer(p, W, H, true);
      this.background(g, v, dt, fresh, true);
      const fn = VisualLayer.DRAW[v.mode];
      if (fn && viz[fn]) {
        g.push();
        viz[fn](g);
        g.pop();
      }
    }
    p.push();
    if (v.show === 'replace') { p.noStroke(); p.fill(0); p.rect(-W / 2, -H / 2, W, H); }
    const c = v.tint ? VisualLayer.rgb(v.tint) : [255, 255, 255];
    p.tint(c[0], c[1], c[2], Math.max(0, Math.min(1, alpha)) * 255);
    p.image(g, -W / 2, -H / 2, W, H);
    p.pop();
    return true;
  }

  background(g, v, dt, fresh, webgl) {
    if (v.bg === 'solid') {
      const c = VisualLayer.rgb(v.solid || '#000000');
      if (webgl) g.background(c[0], c[1], c[2]);
      else { const x = g.drawingContext; x.fillStyle = v.solid || '#000'; x.fillRect(0, 0, g.width, g.height); }
      return;
    }
    if (v.bg === 'trail' && !fresh) {
      // Fade what's there (alpha too, so the clip shows through as it fades).
      const a = 1 - Math.pow(1 - VisualLayer.TRAIL, Math.max(0.25, dt * 60));
      if (webgl) {
        g.push();
        g.blendMode(g.REMOVE);
        g.noStroke();
        g.fill(0, 0, 0, a * 255);
        g.rect(-g.width / 2, -g.height / 2, g.width, g.height);
        g.blendMode(g.BLEND);
        g.pop();
      } else {
        const x = g.drawingContext;
        x.save(); x.globalCompositeOperation = 'destination-out'; x.fillStyle = `rgba(0,0,0,${a})`; x.fillRect(0, 0, g.width, g.height); x.restore();
      }
      return;
    }
    g.clear();
  }

  remove() {
    if (this.g) this.g.remove();
    if (this.g2) this.g2.remove();
    this.g = this.g2 = null;
  }

  static rgb(hex) {
    const m = /^#?([0-9a-f]{6})$/i.exec(hex || '');
    return m ? [0, 2, 4].map(i => parseInt(m[1].slice(i, i + 2), 16)) : [255, 255, 255];
  }

  // Spectrum Bars on a 2D canvas, transparent between the bars (the
  // export's version, D-61, without its black fill).
  static spectrum(ctx, W, H, d) {
    const spec = d.spectrum || [];
    const pad = Math.round(H * 0.03);
    const n = 64;
    const slot = (W - pad * 2) / n, bar = Math.max(1, slot * 0.66);
    const cols = [[255, 80, 80], [80, 255, 120], [80, 160, 255]];
    const top = H - pad * 2;
    for (let i = 0; i < n; i++) {
      const v = Math.max(0, Math.min(1, spec[i] || 0));
      const h = v * top;
      if (h < 0.5) continue;
      const x = pad + i * slot + (slot - bar) / 2, y = H - pad - h;
      const c = cols[i % 3];
      const gr = ctx.createLinearGradient(0, y, 0, H - pad);
      gr.addColorStop(0, `rgba(${c[0]},${c[1]},${c[2]},0.8)`);
      gr.addColorStop(1, `rgba(${c[0]},${c[1]},${c[2]},1)`);
      ctx.fillStyle = gr;
      ctx.fillRect(x, y, bar, h);
    }
  }
}

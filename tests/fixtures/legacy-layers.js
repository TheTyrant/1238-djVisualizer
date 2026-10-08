// The alpha's Media Layer drawing (BASSMNTalphaV1, commit 9f32a00), verbatim,
// for tests/placement.js: v2.4 must draw existing layers identically (D-87).
window.LEGACY_LAYERS = {
  drawReactiveLayers(p) {
    const stackOrder = { bottom: 0, middle: 1, top: 2 };
    ['bass', 'mid', 'high']
      .filter(name => this.layers[name].enabled && this.layers[name].media)
      .sort((a, b) => stackOrder[this.layers[a].stack] - stackOrder[this.layers[b].stack])
      .forEach(name => this.drawSingleLayer(p, name, { reactive: true }));
  },
  drawSingleLayer(p, layerName, { reactive }) {
    const layer = this.layers[layerName];
    if (!layer.media) return;

    const mediaW = layer.media.width || 1;
    const mediaH = layer.media.height || 1;

    let baseW, baseH;
    if (reactive) {
      // Contain-fit with margin: shrink to fit fully within the canvas,
      // leaving room to be positioned via justify.
      const fitScale = Math.min(this.w / mediaW, this.h / mediaH) * 0.8;
      baseW = mediaW * fitScale;
      baseH = mediaH * fitScale;
    } else {
      // Background: cover-fit, fills the full frame (may crop the image),
      // since it's meant to be a full backdrop, not a positioned element.
      const coverScale = Math.max(this.w / mediaW, this.h / mediaH);
      baseW = mediaW * coverScale;
      baseH = mediaH * coverScale;
    }

    // Justify sets horizontal anchor; vertical stays centered for now.
    let x = 0;
    if (reactive) {
      if (layer.justify === 'left') x = -this.w / 2 + baseW / 2;
      else if (layer.justify === 'right') x = this.w / 2 - baseW / 2;
    }

    let offsetX = 0, offsetY = 0;

    // Bass rattle: small, fast x/y jitter scaled to bass energy. On by
    // default per spec. No scale or rotation involved -- just shakes in place.
    if (reactive && layerName === 'bass') {
      const bass = this.audioData.bass || 0;
      const rattleAmplitude = 18; // px, tune to taste
      offsetX = (p.noise(this.time * 40) - 0.5) * 2 * rattleAmplitude * bass;
      offsetY = (p.noise(this.time * 40 + 500) - 0.5) * 2 * rattleAmplitude * bass;
    }

    p.push();
    p.translate(x + offsetX, offsetY);
    p.image(layer.bridge ? layer.bridge.frame() : layer.media, -baseW / 2, -baseH / 2, baseW, baseH);
    p.pop();
  },
};

// 03 Assets (v2.1, D-44): one bin for images and video, the asset list,
// and the selected asset's properties, shown where the fixed
// Bass/Mid/High upload slots used to be. Options change with the item.
//
// Media Layers are an option on an asset ("Use as: Media Layer"). The
// layer engine is unchanged: ClipEngine.setAssetLayer() calls
// DJVisualizer.loadLayerMedia()/clearLayerMedia(), and the layer controls
// below edit visualizer.layers[slot] through its existing methods. The
// controls keep their old IDs (layerEnabled/Justify/Stack-<slot>) so the
// visualizer's auto-justify and stack-swap can still update them.
class AssetPanel {
  constructor(app) {
    this.app = app;
    this.engine = app.clipEngine;
    this.viz = app.visualizer;
  }

  init() {
    this.list = document.getElementById('assetList');
    this.props = document.getElementById('assetProps');
    const input = document.getElementById('assetUpload');
    const drop = document.getElementById('assetDrop');

    input.addEventListener('change', (e) => {
      this.addAndSelect(e.target.files);
      e.target.value = '';
    });
    // Files can be dropped anywhere on the 02 Assets panel (the list, the
    // EQ, the options), not only on the small drop zone; the zone and the
    // panel both light up while files are over it.
    const panel = document.getElementById('customMediaSection');
    const hasFiles = (e) => e.dataTransfer && Array.from(e.dataTransfer.types || []).includes('Files');
    const lit = (on) => { drop.classList.toggle('drag-over', on); panel.classList.toggle('drag-over-panel', on); };
    panel.addEventListener('dragover', (e) => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = 'copy';
      lit(true);
    });
    panel.addEventListener('dragleave', (e) => { if (!panel.contains(e.relatedTarget)) lit(false); });
    panel.addEventListener('drop', (e) => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      e.stopPropagation();
      MediaLibrary.captureDrop(e);
      lit(false);
      this.addAndSelect(e.dataTransfer.files);
    });

    this.engine.on((type) => {
      if (type === 'clips' || type === 'select') this.render();
    });
    // ON AIR / decode state change without an event; refresh just the
    // status rows a few times a second.
    setInterval(() => this.refreshStatus(), 250);
    this.render();
  }

  addAndSelect(files) {
    if (this.app.openIfProject(files)) return;
    const split = MediaConvert.split(files);
    this.app.convertThenAdd(split.later, (fs) => this.addAndSelect(fs));   // Windows Media (D-73)
    files = split.now;
    if (!files.length) return;
    const { added, rejected } = this.engine.addFiles(files);
    if (added.length) this.engine.select(added[0].id);
    this.app.notify(this.app.addedMessage(added, rejected));
  }

  render() {
    this.renderList();
    this.renderProps(this.engine.clipById(this.engine.selectedId));
  }

  renderList() {
    const sel = this.engine.selectedId;
    this.list.textContent = '';
    // Sections sit right under their clip (D-82).
    const order = [];
    this.engine.mediaAssets.forEach(a => { order.push(a); order.push(...this.engine.sectionsOf(a)); });
    order.forEach(a => {
      const row = document.createElement('button');
      row.type = 'button';
      row.className = 'asset-row' + (a.id === sel ? ' selected' : '') + (a.error || a.offline ? ' bin-error' : '') + (a.parent ? ' is-section' : '');
      row.setAttribute('role', 'option');
      row.setAttribute('aria-selected', String(a.id === sel));
      row.dataset.id = a.id;

      const thumb = document.createElement(a.thumb ? 'img' : 'span');
      thumb.className = 'asset-thumb';
      if (a.thumb) { thumb.src = a.thumb.toDataURL('image/jpeg', 0.7); thumb.alt = ''; }

      const name = document.createElement('span');
      name.className = 'asset-name';
      name.textContent = a.name;
      name.title = a.name;

      const tags = document.createElement('span');
      tags.className = 'asset-tags';
      tags.textContent = this.roleTags(a);

      row.append(thumb, name, tags);
      row.addEventListener('click', () => this.engine.select(a.id));
      this.list.appendChild(row);
    });
  }

  roleTags(a) {
    const t = [a.parent ? `§${a.section + 1}` : a.kind === 'image' ? 'IMG' : 'VID'];
    if (this.engine.isSplit(a)) t.push(`${a.sections.length + 1} sections`);
    if (a.asClip && (!a.parent || a.own)) t.push(`#${a.importance}`);   // sections sit on their clip's card, not in the stack (unless made their own clip, D-100)
    if (a.layer) t.push(a.layer.slice(0, 3).toUpperCase());
    if (this.engine.settings.storyMode && a.story !== 'none') t.push(({ hook: 'HOOK', result: 'RES', cta: 'CTA' })[a.story]);
    return t.join(' · ');
  }

  // ---- properties ------------------------------------------------------

  renderProps(a) {
    const P = this.props;
    P.textContent = '';
    if (!a) {
      const hint = document.createElement('p');
      hint.className = 'hint';
      hint.textContent = this.engine.assets.length
        ? 'Select an asset to see its options.'
        : 'Add images or video. Each one can be an auto-edit clip, a Media Layer, or both.';
      P.appendChild(hint);
      return;
    }

    const head = document.createElement('div');
    head.className = 'props-head';
    head.innerHTML = `<span class="kind-badge">${a.kind === 'image' ? 'Image' : 'Video'}</span>`;
    const nm = document.createElement('span');
    nm.className = 'props-name';
    nm.textContent = a.name;
    nm.title = a.name;
    head.appendChild(nm);
    P.appendChild(head);

    // Use as: two independent switches (Q16)
    const useAs = this.group('Use as');
    const clipBox = this.check('Auto-edit clip', a.asClip, (on) => this.engine.setAssetAsClip(a.id, on));
    clipBox.id = 'propAsClip';
    useAs.appendChild(clipBox.parentElement);
    if (!a.parent) {
      const layerSel = this.select([['', 'No Media Layer'], ['background', 'Layer: Background'], ['bass', 'Layer: Bass'], ['mid', 'Layer: Mid'], ['high', 'Layer: High']],
        a.layer || '', (v) => this.engine.setAssetLayer(a.id, v || null));
      layerSel.id = 'propLayer';
      layerSel.setAttribute('aria-label', 'Media Layer slot');
      useAs.appendChild(layerSel);
    }
    if (a.layer && a.layer !== 'background') {
      useAs.appendChild(this.layerControls(a.layer));
      const L = this.viz.layers[a.layer];
      useAs.appendChild(this.placementControls(
        () => L.placement || Placement.fromLayer(a.layer, L),
        () => { if (!L.placement) L.placement = JSON.parse(JSON.stringify(Placement.fromLayer(a.layer, L))); return L.placement; },
        `Placement · ${a.layer} layer`));
    }
    P.appendChild(useAs);
    // Images (D-88): over the video, or full frame like a video clip.
    if (a.kind === 'image' && !a.parent) {
      const sg = this.group('Show');
      const seg = document.createElement('div');
      seg.className = 'seg seg-btns';
      seg.id = 'propShow';
      seg.setAttribute('role', 'radiogroup');
      [['over', 'Over video'], ['full', 'Full frame']].forEach(([v, label]) => {
        const b = document.createElement('button');
        b.type = 'button'; b.textContent = label; b.dataset.v = v;
        b.setAttribute('role', 'radio');
        b.setAttribute('aria-checked', String((a.show || 'full') === v));
        if ((a.show || 'full') === v) b.classList.add('on');
        b.addEventListener('click', () => { a.show = v; if (v === 'over' && !a.placement) a.placement = Placement.defaults({ size: 60, z: 10 }); this.engine.emit('clips'); });
        seg.appendChild(b);
      });
      sg.appendChild(seg);
      const note = document.createElement('p');
      note.className = 'hint';
      note.textContent = (a.show || 'full') === 'over'
        ? (this.engine.hasVideos() ? 'Plays above the video for its hold while the video keeps cutting underneath. Drag it on the viewport to place it.' : 'No videos to play over yet: shows full frame until there are.')
        : 'Fills the frame like a video clip.';
      sg.appendChild(note);
      if ((a.show || 'full') === 'over') {
        if (!a.placement) a.placement = Placement.defaults({ size: 60, z: 10 });
        sg.appendChild(this.placementControls(() => a.placement, () => a.placement, 'Placement'));
      }
      P.appendChild(sg);
    }

    // Story Position (Story Mode only, D-33). A story asset has a fixed
    // place and plays once, so Pace and Importance don't apply to it.
    const storyMode = this.engine.settings.storyMode;
    const isStory = storyMode && a.story !== 'none';
    if (storyMode) {
      // Position lock (D-58): three positions in total. A position held by
      // another asset is greyed out; once all three are used, assets
      // without one can't pick any (the control fades and goes dead).
      const sg = this.group('Position lock');
      const holders = {};
      this.engine.assets.forEach(x => { if (x.story !== 'none') holders[x.story] = x; });
      const full = Object.keys(holders).length >= 3 && a.story === 'none';
      const labels = { hook: 'Hook', result: 'Result / Climax', cta: 'CTA' };
      const pos = this.select(
        [['none', 'None'], ['hook', labels.hook], ['result', labels.result], ['cta', labels.cta]], a.story,
        (v) => this.engine.setClipStory(a.id, v), 'propStory',
        full ? 'All three positions are in use. Clear one on another clip to use it here.'
          : 'Hook = beginning, Result / Climax = after the automated content, CTA = ending. Each plays once.');
      Array.from(pos.options).forEach(o => {
        const h = holders[o.value];
        if (h && h !== a) { o.disabled = true; o.textContent = `${labels[o.value]} (in use: ${h.name})`; }
      });
      if (full) { pos.disabled = true; pos.classList.add('is-dead'); }
      sg.appendChild(this.row('Position', pos));
      if (isStory && a.kind === 'image') {
        const hold = document.createElement('input');
        hold.type = 'number';
        hold.id = 'propStoryHold';
        hold.min = 0.5;
        hold.step = 0.5;
        hold.value = a.storyHold;
        hold.addEventListener('change', () => this.engine.setStoryHold(a.id, parseFloat(hold.value) || 3));
        sg.appendChild(this.row('Holds (s)', hold));
      } else if (isStory) {
        const note = document.createElement('p');
        note.className = 'hint';
        const cap = this.engine.storyCap(), own = this.engine.screenLength(a);
        const whole = this.engine.usedLength(a) >= this.engine.sourceLength(a) - 0.05;
        note.textContent = own > cap + 0.05
          ? `Plays once with its own sound — the first ${fmtTime(cap, false)} of ${whole ? 'it' : 'its used part'} (a locked clip is capped at a quarter of the song).`
          : `Plays ${whole ? 'its full length' : `its used part (${fmtTime(own, true)} on screen)`} once, with its own sound.`;
        sg.appendChild(note);
      }
      if (isStory) sg.appendChild(this.fadeControls(a));
      P.appendChild(sg);
    }

    // Clip fields (only when used as an auto-edit clip, and not a story asset)
    if (a.asClip && !isStory) {
      const clipG = this.group('Clip');
      clipG.appendChild(this.row('Band', this.select(
        [['any', 'Any band'], ['bass', 'Bass'], ['mid', 'Mid'], ['high', 'High']], a.band,
        (v) => this.engine.setClipBand(a.id, v), 'propBand',
        'Band pool (used when clip order = By dominant band)')));
      const paces = [['global', 'Global'], ...Object.entries(MusicalTime.AUTO_PACES).map(([k, v]) => [k, v.label])];
      if (a.pace === 'fit') paces.push(['fit', `Fit: ${a.fitBars} bar${a.fitBars === 1 ? '' : 's'}`]);
      clipG.appendChild(this.row('Pace', this.select(paces, a.pace,
        (v) => this.engine.setClipPace(a.id, v), 'propPace',
        'How long this clip holds on screen. Global follows the Auto-Editor panel.')));
      const imp = document.createElement('input');
      imp.type = 'number';
      imp.id = 'propImportance';
      imp.min = 1;
      imp.max = this.engine.clips.length;
      imp.value = a.importance;
      imp.title = 'Place in the Action Editor stack (1 = top, picked most)';
      imp.addEventListener('change', () => this.engine.setClipImportance(a.id, parseInt(imp.value, 10) || 1));
      if (!a.parent || a.own) clipG.appendChild(this.row('Importance', imp));
      // Repeats (D-93): how many times it may appear; 0 = no limit.
      const rep = document.createElement('input');
      rep.type = 'number'; rep.id = 'propRepeats'; rep.min = 0; rep.step = 1; rep.value = a.repeats || 0;
      rep.title = 'How many times this clip may appear on the timeline (0 = no limit)';
      rep.addEventListener('change', () => this.engine.setRepeats(a.id, rep.value));
      clipG.appendChild(this.row('Repeats', rep));
      const used = this.engine.cutsOf(a);
      const rn = document.createElement('p');
      rn.className = 'hint';
      rn.id = 'propRepeatsNote';
      rn.textContent = a.repeats > 0 ? `On the timeline ${used} of ${a.repeats} time${a.repeats === 1 ? '' : 's'}${used > a.repeats ? ' — over its limit because every clip has used its repeats' : used === a.repeats ? ' — used up; it sits out from here' : ''}.` : `No limit · on the timeline ${used} time${used === 1 ? '' : 's'} so far.`;
      clipG.appendChild(rn);
      P.appendChild(clipG);
    }
    if (a.kind === 'video' && !this.engine.isSplit(a)) P.appendChild(this.timingControls(a));
    else if (this.engine.isSplit(a)) P.appendChild(this.splitNote(a));
    if ((a.asClip || a.parent) && !this.engine.isSplit(a)) P.appendChild(this.visualControls(a));

    // Per-asset status (D-43)
    const st = this.group('Status');
    st.classList.add('asset-status');
    st.id = 'assetStatus';
    P.appendChild(st);
    this.fillStatus(a, st);

    const rm = document.createElement('button');
    rm.type = 'button';
    rm.className = 'btn btn-block';
    rm.id = 'propRemove';
    rm.textContent = a.parent ? 'Remove all sections' : 'Remove asset';
    rm.addEventListener('click', () => (a.parent ? this.engine.setSections(a.parent, []) : this.engine.removeAsset(a.id)));
    P.appendChild(rm);
  }

  lengthText(a) {
    const e = this.engine, src = e.sourceLength(a), used = e.usedLength(a), scr = e.screenLength(a);
    if (Math.abs(used - src) < 0.05 && Math.abs(scr - used) < 0.05) return fmtTime(src, true);
    return `${src.toFixed(1)} → ${used.toFixed(1)} → ${scr.toFixed(1)} s`;   // source → used → on screen
  }

  // Amount used, speed, Fit to bars and sections (D-82).
  timingControls(a) {
    const e = this.engine;
    const g = this.group('Timing');
    g.classList.add('timing-group');
    if (a.parent) {
      const p = e.parentOf(a);
      const note = document.createElement('p');
      note.className = 'hint';
      note.textContent = a.own
        ? `Section ${a.section + 1} of ${a.of} of ${p ? p.name : 'its clip'} — a clip of its own, with its own card and place in the stack; same video.`
        : `Section ${a.section + 1} of ${a.of} of ${p ? p.name : 'its clip'} — on that clip's card; same video, its own settings.`;
      g.appendChild(note);
      // Make it a clip of its own, or put it back on the strip (D-100).
      const own = document.createElement('button');
      own.type = 'button';
      own.className = 'btn btn-block';
      own.id = 'propSectOwn';
      own.textContent = a.own ? `↩ Back into ${p ? p.name : 'its clip'}` : '↗ Make its own clip';
      own.title = a.own ? 'Return it to its clip’s strip' : 'Give this section its own card in the Action clips, with its own place in the stack';
      own.addEventListener('click', () => e.setSectionOwn(a.id, !a.own));
      g.appendChild(own);
    }
    // Amount used
    const r = e.usedRange(a);
    const used = document.createElement('button');
    used.type = 'button';
    used.className = 'btn btn-block prop-used';
    used.id = 'propUsed';
    used.textContent = `${r.start.toFixed(1)}–${r.end.toFixed(1)} s · ${(r.end - r.start).toFixed(1)} s`;
    used.title = 'The part of the clip the auto-editor may use';
    used.addEventListener('click', () => this.app.clipTools.openRange(a, used));
    g.appendChild(this.row('Used', used, 'div'));
    // Speed: presets + number
    const sp = e.speedOf(a);
    const speeds = document.createElement('div');
    speeds.className = 'seg seg-btns speed-btns';
    speeds.id = 'propSpeeds';
    speeds.setAttribute('role', 'radiogroup');
    speeds.setAttribute('aria-label', 'Speed');
    ClipEngine.SPEEDS.forEach(v => {
      const b = document.createElement('button');
      b.type = 'button';
      b.textContent = ClipTools.speedLabel(v).replace('×', '');
      b.title = `${ClipTools.speedLabel(v)} speed`;
      b.setAttribute('role', 'radio');
      b.setAttribute('aria-checked', String(Math.abs(sp - v) < 1e-6));
      if (Math.abs(sp - v) < 1e-6) b.classList.add('on');
      b.addEventListener('click', () => e.setSpeed(a.id, v));
      speeds.appendChild(b);
    });
    g.appendChild(this.row('Speed', speeds, 'div'));
    const num = document.createElement('input');
    num.type = 'number'; num.id = 'propSpeed'; num.min = 0.25; num.max = 4; num.step = 0.05; num.value = +sp.toFixed(3);
    num.title = 'Speed (0.25–4×). The clip’s own sound changes pitch with it.';
    num.addEventListener('change', () => e.setSpeed(a.id, num.value));
    g.appendChild(this.row('Custom ×', num));
    // Fit to bars
    const barSec = this.app.clipTools.barSeconds();
    const fit = document.createElement('div');
    fit.className = 'fit-row';
    const bars = document.createElement('input');
    bars.type = 'number'; bars.id = 'propFitBars'; bars.min = 1; bars.step = 1;
    bars.value = a.pace === 'fit' && a.fitBars ? a.fitBars : Math.max(1, Math.round(e.usedLength(a) / barSec));
    bars.setAttribute('aria-label', 'Bars');
    const fitBtn = document.createElement('button');
    fitBtn.type = 'button'; fitBtn.className = 'btn'; fitBtn.id = 'propFit'; fitBtn.textContent = 'Fit to bars';
    fitBtn.title = 'Set the speed so the used part fills exactly this many bars';
    fitBtn.addEventListener('click', () => e.fitToBars(a.id, this.app.clipTools.barSeconds(), parseInt(bars.value, 10) || 1));
    fit.append(bars, fitBtn);
    g.appendChild(this.row('Bars', fit, 'div'));
    const out = document.createElement('p');
    out.className = 'hint';
    out.id = 'propTimingNote';
    const scr = e.screenLength(a);
    out.textContent = `On screen ${fmtTime(scr, true)} = ${+(scr / barSec).toFixed(2)} bars${a.pace === 'fit' ? ` · holds ${a.fitBars} bar${a.fitBars === 1 ? '' : 's'}` : ''}.`;
    g.appendChild(out);
    // Sections
    const sect = document.createElement('button');
    sect.type = 'button'; sect.className = 'btn btn-block'; sect.id = 'propSections';
    sect.textContent = a.parent ? 'Edit sections…' : 'Sections…';
    sect.title = 'Split the clip on bar markers; each section becomes its own card';
    sect.addEventListener('click', () => this.app.clipTools.openSections(a));
    g.appendChild(sect);
    return g;
  }

  // Per-clip visual mode (D-90): a visual mode while this clip is on air,
  // instead of it (Replace) or on top of it (Over).
  visualControls(a) {
    const e = this.engine, v = { ...VisualLayer.defaults(), ...(a.visual || {}) };
    const g = this.group('Visual');
    g.classList.add('visual-group');
    const set = (patch) => e.setVisual(a.id, patch);
    g.appendChild(this.row('Mode', this.select(VisualLayer.MODES, v.mode, (m) => set({ mode: m }), 'propVisual', 'A visual mode while this clip is on air')));
    if (v.mode === 'none') return g;
    const show = document.createElement('div');
    show.className = 'seg seg-btns';
    show.id = 'propVisualShow';
    show.setAttribute('role', 'radiogroup');
    [['over', 'Over'], ['replace', 'Replace']].forEach(([k, label]) => {
      const b = document.createElement('button');
      b.type = 'button'; b.textContent = label; b.dataset.v = k;
      b.setAttribute('role', 'radio');
      b.setAttribute('aria-checked', String(v.show === k));
      if (v.show === k) b.classList.add('on');
      b.title = k === 'over' ? 'On its own transparent layer, over the clip' : 'Instead of the clip';
      b.addEventListener('click', () => set({ show: k }));
      show.appendChild(b);
    });
    g.appendChild(this.row('Show', show, 'div'));
    const bgRow = document.createElement('div');
    bgRow.className = 'react-row';
    const col = document.createElement('input');
    col.type = 'color'; col.id = 'propVisualSolid'; col.value = v.solid || '#000000';
    col.disabled = v.bg !== 'solid';
    col.addEventListener('change', () => set({ solid: col.value }));
    bgRow.append(this.select([['none', 'None (clear)'], ['trail', 'Trail'], ['solid', 'Solid']], v.bg, (b) => set({ bg: b }), 'propVisualBg', 'None = cleared every frame · Trail = motion leaves streaks · Solid = a colour'), col);
    g.appendChild(this.row('Background', bgRow, 'div'));
    const tintRow = document.createElement('div');
    tintRow.className = 'react-row';
    const tint = document.createElement('input');
    tint.type = 'color'; tint.id = 'propVisualTint'; tint.value = v.tint || '#ffffff';
    tint.disabled = !v.tint;
    tint.addEventListener('change', () => set({ tint: tint.value }));
    tintRow.append(this.select([['default', 'Default'], ['custom', 'Custom tint']], v.tint ? 'custom' : 'default', (k) => set({ tint: k === 'custom' ? (v.tint || '#ffd400') : null }), 'propVisualColour', 'The mode’s own colours, or tinted'), tint);
    g.appendChild(this.row('Colour', tintRow, 'div'));
    return g;
  }

  splitNote(a) {
    const g = this.group('Sections');
    const note = document.createElement('p');
    note.className = 'hint';
    note.textContent = `Split into ${a.sections.length + 1} sections, shown as a strip on its card. Click a section there to give it its own pace, band and speed.`;
    g.appendChild(note);
    const b = document.createElement('button');
    b.type = 'button'; b.className = 'btn btn-block'; b.id = 'propSections'; b.textContent = 'Edit sections…';
    b.addEventListener('click', () => this.app.clipTools.openSections(a));
    g.appendChild(b);
    return g;
  }

  // Placement (D-87): anchor, offset, size, rotation, opacity, fit, blend,
  // react. Layout keys land on the breakpoint on screen (D-63).
  placementControls(get, ensure, title) {
    const wrap = document.createElement('details');
    wrap.className = 'placement-controls';
    wrap.open = true;
    wrap.id = 'propPlacement';
    const sum = document.createElement('summary');
    const bp = this.app.display ? this.app.display.breakpoint : 'base';
    sum.textContent = `${title} — ${DisplaySize.BREAKPOINTS[bp].short}`;
    wrap.appendChild(sum);
    const eff = Placement.at(get(), bp);
    const set = (k, v) => {
      const pl = ensure();
      (Placement.LAYOUT_KEYS.includes(k) ? Placement.target(pl, bp) : pl)[k] = v;
      this.app.project.markDirty();
      this.engine.emit('clips');
    };
    // 9-point anchor
    const grid = document.createElement('div');
    grid.className = 'anchor-grid';
    grid.id = 'propAnchor';
    grid.setAttribute('role', 'radiogroup');
    grid.setAttribute('aria-label', 'Anchor');
    Object.keys(Placement.ANCHORS).forEach(k => {
      const b = document.createElement('button');
      b.type = 'button'; b.dataset.v = k;
      b.title = { tl: 'Top left', tc: 'Top centre', tr: 'Top right', ml: 'Middle left', mc: 'Centre', mr: 'Middle right', bl: 'Bottom left', bc: 'Bottom centre', br: 'Bottom right' }[k];
      b.setAttribute('aria-label', b.title);
      b.setAttribute('aria-checked', String(eff.anchor === k));
      if (eff.anchor === k) b.classList.add('on');
      b.addEventListener('click', () => { set('anchor', k); set('x', 0); set('y', 0); });
      grid.appendChild(b);
    });
    wrap.appendChild(this.row('Anchor', grid, 'div'));
    const num = (id, label, v, min, max, step, onSet) => {
      const i = document.createElement('input');
      i.type = 'number'; i.id = id; i.min = min; i.max = max; i.step = step; i.value = v;
      i.addEventListener('change', () => onSet(parseFloat(i.value)));
      wrap.appendChild(this.row(label, i));
      return i;
    };
    num('propPx', 'X %', Math.round((eff.x || 0) * 1000) / 10, -100, 100, 0.5, (v) => set('x', (v || 0) / 100));
    num('propPy', 'Y %', Math.round((eff.y || 0) * 1000) / 10, -100, 100, 0.5, (v) => set('y', (v || 0) / 100));
    num('propSize', 'Size %', eff.size, 5, 200, 1, (v) => set('size', Math.max(5, Math.min(200, v || 80))));
    num('propRot', 'Rotate °', eff.rotation || 0, -180, 180, 1, (v) => set('rotation', v || 0));
    num('propOpacity', 'Opacity %', Math.round((eff.opacity == null ? 1 : eff.opacity) * 100), 0, 100, 5, (v) => set('opacity', Math.max(0, Math.min(100, v)) / 100));
    wrap.appendChild(this.row('Fit', this.select([['contain', 'Contain'], ['cover', 'Cover']], eff.fit || 'contain', (v) => set('fit', v), 'propFit')));
    wrap.appendChild(this.row('Blend', this.select([['normal', 'Normal'], ['screen', 'Screen'], ['multiply', 'Multiply'], ['overlay', 'Overlay'], ['add', 'Add']], eff.blend || 'normal', (v) => set('blend', v), 'propBlend')));
    const r = eff.react || { mode: 'none', band: 'bass' };
    const react = document.createElement('div');
    react.className = 'react-row';
    react.append(
      this.select([['none', 'None'], ['rattle', 'Rattle'], ['pulse', 'Pulse']], r.mode, (v) => set('react', { ...(ensure().react || r), mode: v }), 'propReact', 'React to the music'),
      this.select([['bass', 'Bass'], ['mid', 'Mid'], ['high', 'High']], r.band, (v) => set('react', { ...(ensure().react || r), band: v }), 'propReactBand', 'Band it reacts to'));
    wrap.appendChild(this.row('React', react, 'div'));
    if (bp !== 'base') {
      const pl = get();
      const has = pl.bp && pl.bp[bp] && Object.keys(pl.bp[bp]).length;
      const reset = document.createElement('button');
      reset.type = 'button'; reset.className = 'btn btn-block'; reset.id = 'propPlacementReset';
      reset.textContent = has ? `Use Base layout on ${DisplaySize.BREAKPOINTS[bp].short}` : `${DisplaySize.BREAKPOINTS[bp].short} follows Base`;
      reset.disabled = !has;
      reset.addEventListener('click', () => { const p2 = ensure(); if (p2.bp) delete p2.bp[bp]; this.engine.emit('clips'); });
      wrap.appendChild(reset);
    }
    return wrap;
  }

  // Auto Fade Music around a locked clip (D-59). Ticking it reveals the
  // fade shapes (icons) and the fade length.
  static FADES = {
    linear: { label: 'Linear', path: 'M1 3 L9 13 L15 13 L23 3' },
    smooth: { label: 'Smooth', path: 'M1 3 C6 3 5 13 9 13 L15 13 C19 13 18 3 23 3' },
    snap: { label: 'Snap (holds, then drops fast)', path: 'M1 3 L7 3 L9 13 L15 13 L17 3 L23 3' },
    duck: { label: 'Duck (dips, never silent)', path: 'M1 3 L8 9 L16 9 L23 3' },
  };

  fadeControls(a) {
    const f = a.fade || { on: false, curve: 'smooth', bars: 1 };
    const wrap = document.createElement('div');
    wrap.className = 'fade-controls';
    const box = this.check('Auto fade music', f.on, (on) => { this.engine.setClipFade(a.id, { on }); this.app.applyMusicLevel(); });
    box.id = 'propFade';
    box.title = 'Fade the music out into this clip and back in after it';
    wrap.appendChild(box.parentElement);
    if (!f.on) return wrap;
    const shapes = document.createElement('div');
    shapes.className = 'fade-shapes';
    shapes.setAttribute('role', 'radiogroup');
    shapes.setAttribute('aria-label', 'Fade shape');
    Object.entries(AssetPanel.FADES).forEach(([k, v]) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'fade-shape' + (f.curve === k ? ' on' : '');
      b.dataset.v = k;
      b.title = v.label;
      b.setAttribute('role', 'radio');
      b.setAttribute('aria-checked', String(f.curve === k));
      b.setAttribute('aria-label', v.label);
      b.innerHTML = `<svg viewBox="0 0 24 16" width="36" height="24" aria-hidden="true"><path d="${v.path}" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round" stroke-linecap="round"/></svg>`;
      b.addEventListener('click', () => this.engine.setClipFade(a.id, { curve: k }));
      shapes.appendChild(b);
    });
    wrap.appendChild(shapes);
    const len = this.select([['0.5', '½ bar'], ['1', '1 bar'], ['2', '2 bars']], String(f.bars),
      (v) => this.engine.setClipFade(a.id, { bars: parseFloat(v) }), 'propFadeLength', 'How long the music takes to fade out and back in');
    wrap.appendChild(this.row('Fade length', len));
    return wrap;
  }

  // Enabled / justify / stack for a bass/mid/high layer, bound to the
  // visualizer exactly as the old sidebar controls were.
  layerControls(slot) {
    const L = this.viz.layers[slot];
    const wrap = document.createElement('div');
    wrap.className = 'layer-controls-group';
    const en = this.check('Layer enabled', L.enabled, (on) => {
      L.enabled = on;
      this.viz.autoAssignJustify();
    });
    en.id = `layerEnabled-${slot}`;
    wrap.appendChild(en.parentElement);
    const row = document.createElement('div');
    row.className = 'layer-controls';
    const j = this.select([['left', 'Left'], ['center', 'Center'], ['right', 'Right']], L.justify,
      (v) => { L.justify = v; if (L.placement) { Placement.target(L.placement, this.app.display ? this.app.display.breakpoint : 'base').anchor = { left: 'ml', center: 'mc', right: 'mr' }[v]; this.engine.emit('clips'); } }, `layerJustify-${slot}`, 'Justify');
    const s = this.select([['top', 'Top'], ['middle', 'Middle'], ['bottom', 'Bottom']], L.stack,
      (v) => { this.viz.assignStackPosition(slot, v); ['bass', 'mid', 'high'].forEach(k => { const X = this.viz.layers[k]; if (X.placement) X.placement.z = { bottom: 0, middle: 1, top: 2 }[X.stack]; }); }, `layerStack-${slot}`, 'Stack');
    j.setAttribute('aria-label', 'Layer justify');
    s.setAttribute('aria-label', 'Layer stack');
    row.append(j, s);
    wrap.appendChild(row);
    return wrap;
  }

  fillStatus(a, el) {
    el.querySelectorAll('.status-item').forEach(n => n.remove());
    const now = this.engine.nowShowing();
    const onAir = !!(now && now.clip === a);
    const roles = [];
    if (this.engine.settings.storyMode && a.story !== 'none') roles.push(`Story ${a.story}`);
    else if (a.asClip) roles.push(`Clip #${a.importance}`);
    if (a.layer) roles.push(`Layer ${a.layer}`);
    const rows = [
      ['Type', a.kind === 'image' ? 'Image' : 'Video'],
      ['Length', a.kind === 'image' ? 'Still' : (this.engine.sourceLength(a) ? this.lengthText(a) : '…')],   // source → used → on screen (D-82)
      ['Size', a.width ? `${a.width}×${a.height}` : '…'],
      ['Rotation', a.kind === 'video' ? (a.rotation ? `${a.rotation}° (corrected)` : 'None') : '—'],
      ['Decode', a.offline ? 'Offline: reconnect in 01 File' : a.error ? 'ERR' : a.ready ? 'OK' : 'Loading…'],
      ['On air', onAir ? 'Yes' : 'No'],
      ['Role', roles.join(' · ') || 'Unused'],
    ];
    rows.forEach(([k, v]) => {
      const r = document.createElement('div');
      r.className = 'status-item' + (k === 'On air' && onAir ? ' on-air' : '') + (k === 'Decode' && a.error ? ' is-err' : '');
      r.innerHTML = `<span class="status-label">${k}</span>`;
      const val = document.createElement('span');
      val.textContent = v;
      if (k === 'Decode' && a.error) val.title = `${a.error}. Try Chrome/Edge, or convert to WebM (VP9) or H.264 MP4.`;
      r.appendChild(val);
      el.appendChild(r);
    });
  }

  refreshStatus() {
    const el = document.getElementById('assetStatus');
    const a = this.engine.clipById(this.engine.selectedId);
    if (el && a) this.fillStatus(a, el);
  }

  // ---- small DOM helpers -----------------------------------------------

  // An options group: a fold-out row like 01 File's (Omar, 2026-10-08),
  // open unless folded before (remembered by its title).
  group(title) {
    const ws = this.app.workspace;
    const folds = ws ? (ws.state.groupFolds = ws.state.groupFolds || {}) : {};
    const g = document.createElement('details');
    g.className = 'prop-group prop-fold';
    g.open = folds[title] !== false;
    const t = document.createElement('summary');
    t.className = 'prop-label prop-fold-head';
    t.innerHTML = '<span></span><span class="menu-caret" aria-hidden="true">&#x25B8;</span>';
    t.firstChild.textContent = title;
    g.appendChild(t);
    g.addEventListener('toggle', () => { folds[title] = g.open; if (ws) ws.save(); });
    return g;
  }

  // A row of buttons is a div: inside a <label>, a click anywhere on the
  // row would press the first button.
  row(label, control, tag = 'label') {
    const r = document.createElement(tag);
    r.className = 'prop-row';
    const l = document.createElement('span');
    l.className = 'prop-row-label';
    l.textContent = label;
    r.append(l, control);
    return r;
  }

  select(options, value, onChange, id, title) {
    const s = document.createElement('select');
    options.forEach(([v, l]) => s.add(new Option(l, v)));
    s.value = value;
    if (id) s.id = id;
    if (title) s.title = title;
    s.addEventListener('change', () => onChange(s.value));
    return s;
  }

  check(label, checked, onChange) {
    const l = document.createElement('label');
    l.className = 'prop-check';
    const c = document.createElement('input');
    c.type = 'checkbox';
    c.checked = checked;
    c.addEventListener('change', () => onChange(c.checked));
    const s = document.createElement('span');
    s.textContent = label;
    l.append(c, s);
    return c;
  }
}

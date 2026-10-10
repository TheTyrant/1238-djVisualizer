// Bottom editor panel: master timeline (ruler + master lane) over the clip
// editor lane, plus the Auto-Editor properties column, the clip bin and the
// viewport HUD. Drawing is a single 2D canvas redrawn at ~30fps.
//
// Two timeline modes:
//   track -- bounded to the loaded file's duration; click/drag to seek
//   live  -- unbounded session time; the view scrolls with the playhead
class TimelinePanel {
  constructor(app) {
    this.app = app;
    this.engine = app.clipEngine;
    // Lane heights come from the workspace layout (D-84); these are the defaults.
    this.ROWS_DEFAULT = { ruler: 28, master: 72, clips: 64, voice: 40, text: 40 };
    this.LIVE_WINDOW = 30;                                // seconds visible in live mode
    this.view = { start: 0, span: 30, fit: true };
    this.energy = [];     // { t, b, m, h } per analysis frame
    this.peaks = null;    // Float32Array of min/max pairs for the track waveform
    this.lastDraw = 0;
    this.css = getComputedStyle(document.documentElement);
  }

  init() {
    const $ = (id) => document.getElementById(id);
    this.canvas = $('timelineCanvas');
    this.ctx = this.canvas.getContext('2d');
    this.el = {
      time: $('tlTime'), barBeat: $('tlBarBeat'), bpm: $('tlBpm'), band: $('tlBand'),
      badge: $('tlModeBadge'), summary: $('tlSummary'), masterSub: $('chMasterSub'),
      play: $('tlPlay'), stop: $('tlStop'), home: $('tlHome'),
      binCards: $('binCards'), binCount: $('binCount'), bin: $('clipBin'), upload: $('clipUpload'),
      hud: $('viewportHud'), hint: $('viewportHint'), readout: $('propReadout'),
      topMode: $('topMode'), topSource: $('topSource'), viewportMode: $('viewportModeLabel'),
    };

    this.color = (name) => this.css.getPropertyValue(name).trim();

    this.initTransport();
    this.initProps();
    this.initBin();
    this.initCanvasInteraction();
    this.initMasterFades();
    this.initTrackLength();
    this.initTrackStart();

    // Text lane appears once there is any text (D-60).
    this.app.text.on(() => {
      const has = this.app.text.items.length > 0;
      const ch = document.getElementById('chText');
      if (ch && ch.hidden === has) { ch.hidden = !has; this.resizeCanvas(); }
    });

    // Voice lane appears only while a voice track exists (D-41).
    this.app.voice.on(() => {
      document.getElementById('chVoice').hidden = !this.app.voice.isLoaded;
      document.getElementById('chVoiceSub').textContent = this.app.voice.isLoaded ? this.app.voice.name : '—';
      this.resizeCanvas();
    });

    this.engine.on((type) => {
      if (type === 'clips' || type === 'select') this.renderBin();
    });

    const modeSelect = document.getElementById('visualMode');
    const onMode = () => {
      const label = modeSelect.selectedOptions[0].textContent;
      if (this.el.topMode) this.el.topMode.textContent = label;
      if (this.el.viewportMode) this.el.viewportMode.textContent = label;
    };
    modeSelect.addEventListener('change', onMode);
    onMode();

    new ResizeObserver(() => this.resizeCanvas()).observe(this.canvas.parentElement);
    this.resizeCanvas();
    this.renderBin();
    this.syncProps();
    requestAnimationFrame(() => this.loop());
  }

  // ---- data in ---------------------------------------------------------

  onAudioFrame(d) {
    if (!this.app.timelineRolling()) return;
    const t = this.app.masterTime();
    const last = this.energy[this.energy.length - 1];
    if (last && t < last.t) this.energy = this.energy.filter(e => e.t < t);   // seeked back
    this.energy.push({ t, b: d.bass || 0, m: d.mid || 0, h: d.high || 0 });
    if (this.energy.length > 40000) this.energy.splice(0, 10000);
  }

  resetSession() {
    this.energy = [];
    this.view = { start: 0, span: this.LIVE_WINDOW, fit: true };
  }

  // Waveform overview for track mode. Decoded separately from playback --
  // purely for drawing; analysis still runs through AudioProcessor.
  async loadTrackWaveform(file) {
    this.peaks = null;
    try {
      const buf = await file.arrayBuffer();
      const ctx = new OfflineAudioContext(1, 1, 44100);
      const audio = await ctx.decodeAudioData(buf);
      const data = audio.getChannelData(0);
      const buckets = 2400;
      const size = Math.max(1, Math.floor(data.length / buckets));
      const peaks = new Float32Array(buckets * 2);
      for (let i = 0; i < buckets; i++) {
        let mn = 0, mx = 0;
        const end = Math.min(data.length, (i + 1) * size);
        for (let j = i * size; j < end; j++) {
          const v = data[j];
          if (v < mn) mn = v;
          if (v > mx) mx = v;
        }
        peaks[i * 2] = mn;
        peaks[i * 2 + 1] = mx;
      }
      this.peaks = peaks;
      this.peaksDuration = audio.duration;
    } catch (e) {
      console.warn('Waveform decode failed (timeline still works):', e);
    }
  }

  // ---- transport -------------------------------------------------------

  initTransport() {
    document.getElementById('tlFireResult').addEventListener('click', () => this.engine.fireStory('result'));
    document.getElementById('tlFireCta').addEventListener('click', () => this.engine.fireStory('cta'));
    this.el.play.addEventListener('click', () => this.app.toggleAudio());
    this.el.stop.addEventListener('click', () => this.app.transportStop());
    this.el.home.addEventListener('click', () => this.app.seekMaster(0));
  }

  // ---- properties ------------------------------------------------------

  initProps() {
    const s = this.engine.settings;
    const $ = (id) => document.getElementById(id);

    this.segButtons($('propTimingMode'), null, (v) => { s.timingMode = v; this.syncProps(); });

    const pace = $('propAutoPace');
    Object.entries(MusicalTime.AUTO_PACES).forEach(([k, v]) => pace.add(new Option(`${v.label} (≥ ${v.minSeconds}s per cut)`, k)));
    pace.addEventListener('change', () => { s.autoPace = pace.value; this.syncProps(); });

    const unitSeg = $('propUnit');
    ['sixteenth', 'eighth', 'beat', 'half', 'bar', 'measure'].forEach(k => {
      const b = document.createElement('button');
      b.type = 'button';
      b.dataset.v = k;
      b.textContent = MusicalTime.UNITS[k].label;
      b.title = MusicalTime.UNITS[k].long;
      unitSeg.appendChild(b);
    });
    this.segButtons(unitSeg, null, (v) => { s.manualUnit = v; this.syncProps(); });

    const count = $('propCount');
    const setCount = (n) => { s.manualCount = Math.max(1, Math.min(64, Math.round(n) || 1)); this.syncProps(); };
    count.addEventListener('change', () => setCount(parseFloat(count.value)));
    $('propCountDec').addEventListener('click', () => setCount(s.manualCount - 1));
    $('propCountInc').addEventListener('click', () => setCount(s.manualCount + 1));

    // Quick tempo multipliers: single / double / triple / quad time.
    const quick = $('propQuick');
    MusicalTime.MULTIPLIERS.slice(0, 4).forEach(m => {
      const b = document.createElement('button');
      b.type = 'button';
      b.dataset.v = String(m.beats);
      b.textContent = `×${m.beats}`;
      b.title = `${m.label} — switch every ${MusicalTime.describeBeats(m.beats)}`;
      quick.appendChild(b);
    });
    this.segButtons(quick, null, (v) => {
      s.timingMode = 'manual'; s.manualUnit = 'beat'; s.manualCount = parseInt(v, 10);
      this.syncProps();
    });

    const order = $('propOrder');
    order.addEventListener('change', () => { s.order = order.value; });

    const trans = $('propTransition');
    trans.add(new Option('Auto — by triggering band', 'band'));
    ClipTransitions.list().forEach(t => trans.add(new Option(t.label, t.id)));
    trans.addEventListener('change', () => { s.transitionMode = trans.value; this.syncProps(); });

    const map = $('propBandMap');
    ['bass', 'mid', 'high'].forEach(band => {
      const lab = document.createElement('label');
      lab.className = band;
      lab.innerHTML = `<span class="chip"></span>${band}`;
      const sel = document.createElement('select');
      sel.setAttribute('aria-label', `${band} transition`);
      ClipTransitions.list().forEach(t => sel.add(new Option(t.label, t.id)));
      sel.value = this.engine.bandTransitions[band];
      sel.addEventListener('change', () => { this.engine.bandTransitions[band] = sel.value; });
      map.append(lab, sel);
    });

    const inPoint = $('propInPoint');
    inPoint.addEventListener('change', () => { s.inPoint = inPoint.value; });

    const overlay = $('propOverlay');
    overlay.addEventListener('change', () => { s.overlayLayers = overlay.checked; });

    // Story Mode (step 7). Off = Free Mode: the automation is unchanged.
    if ($('propStoryMode')) this.segButtons($('propStoryMode'), null, (v) => {
      this.engine.setStoryMode(v === 'on');
      this.app.applyMusicLevel();
      this.syncProps();
    });
    const fade = $('propStoryFade');
    if (fade) fade.addEventListener('change', () => {
      s.storyFade = fade.checked;
      this.app.applyMusicLevel();
    });
  }

  storyHint() {
    const s = this.engine.settings;
    if (!s.storyMode) return 'Free Mode: the automation runs unrestricted.';
    const used = this.engine.assets.filter(a => a.story !== 'none').length;
    if (!used) return 'No positions set. Give up to three clips a position (Hook, Result / Climax, CTA) in 03 Sound › Asset timing; everything else stays automated.';
    const roles = { hook: 'Hook', result: 'Result', cta: 'CTA' };
    const set = Object.keys(roles).map(r => {
      const a = this.engine.assets.find(x => x.story === r);
      return `${roles[r]}: ${a ? a.name : '—'}`;
    }).join(' · ');
    const where = this.app.isTrackMode()
      ? 'Hook → automated content → Result → CTA, placed on the song.'
      : 'Live: Hook plays on Start; fire Result and CTA from the transport. Music fades need a track file.';
    return `${where} ${set} (${used} of 3 used)`;
  }

  segButtons(container, _unused, onPick) {
    container.addEventListener('click', (e) => {
      const b = e.target.closest('button[data-v]');
      if (b) onPick(b.dataset.v);
    });
  }

  syncProps() {
    const s = this.engine.settings;
    const $ = (id) => document.getElementById(id);
    const mark = (id, v) => $(id).querySelectorAll('button').forEach(b => b.classList.toggle('on', b.dataset.v === String(v)));
    mark('propTimingMode', s.timingMode);
    mark('propUnit', s.manualUnit);
    mark('propQuick', s.timingMode === 'manual' && s.manualUnit === 'beat' ? s.manualCount : '');
    $('propCount').value = s.manualCount;
    $('propAutoPace').value = s.autoPace;
    $('propOrder').value = s.order;
    $('propTransition').value = s.transitionMode;
    $('propInPoint').value = s.inPoint;
    $('propOverlay').checked = s.overlayLayers;
    if ($('propStoryMode')) mark('propStoryMode', s.storyMode ? 'on' : 'off');
    if ($('propStoryFade')) {
      $('propStoryFade').checked = s.storyFade;
      $('propStoryFade').disabled = !s.storyMode || !this.app.isTrackMode();
      $('propStoryFadeRow').hidden = false;
    }
    $('propStoryHint').textContent = this.storyHint();
    $('propBandMap').hidden = s.transitionMode !== 'band';
    document.querySelectorAll('[data-show-timing]').forEach(el => {
      el.hidden = el.dataset.showTiming !== s.timingMode;
    });
    this.updateReadout();
    if (this.el.binCards) this.renderBin();   // Clip order By band groups the Action Editor (D-86)
  }

  // Band members (D-86): per band, its swatch, how many clips, their tags
  // as chips (click = select that card), lit while that band triggered the
  // cut on air.
  renderMembers() {
    const box = document.getElementById('bandMembers');
    if (!box) return;
    const e = this.engine, m = e.bandMembers(), tags = e.memberTags();
    const cur = e.current && e.current.segment;
    const hot = cur && !cur.story ? cur.band : null;
    const onAir = e.current ? e.current.clip.id : null;
    const key = JSON.stringify([ClipEngine.BANDS.map(b => m[b].map(c => `${c.id}:${c.name}`)), hot, onAir, e.selectedId]);
    if (key === this.membersKey) return;
    this.membersKey = key;
    box.textContent = '';
    ClipEngine.BANDS.forEach(b => {
      const row = document.createElement('div');
      row.className = 'bm-row' + (hot === b ? ' is-hot' : '');
      row.dataset.band = b;
      row.title = hot === b ? `${b} triggered the cut on air` : '';
      row.innerHTML = `<span class="band-swatch ${b}"></span><span class="bm-label">${b === 'any' ? 'Any' : b}</span><span class="bm-count">${m[b].length}</span>`;
      const chips = document.createElement('span');
      chips.className = 'bm-chips';
      if (!m[b].length) { const n = document.createElement('span'); n.className = 'bm-empty'; n.textContent = '—'; chips.appendChild(n); }
      m[b].forEach(c => {
        const chip = document.createElement('button');
        chip.type = 'button';
        chip.className = 'bm-chip' + (c.id === onAir ? ' on-air' : '') + (c.id === e.selectedId ? ' selected' : '');
        chip.textContent = tags.get(c.id);
        chip.title = `${c.name} — click to select its card`;
        chip.addEventListener('click', () => {
          e.select(c.id);
          const card = this.el.binCards.querySelector(`.bin-card[data-id="${c.parent || c.id}"]`);
          if (card) { card.scrollIntoView({ block: 'nearest', inline: 'nearest' }); card.focus({ preventScroll: true }); }
        });
        chips.appendChild(chip);
      });
      row.appendChild(chips);
      box.appendChild(row);
    });
  }

  updateReadout() {
    const st = this.engine.status();
    const s = this.engine.settings;
    // Panel readout is the global setting; clips with their own pace say so
    // on their bin card and in the header summary.
    const globalMs = MusicalTime.beatsToMs(st.globalBeats, st.bpm);
    const secs = st.bpm > 0 ? (globalMs / 1000).toFixed(2) + 's' : '— s (needs BPM)';
    const how = s.timingMode === 'auto'
      ? `AUTO · ${st.autoLabel.toUpperCase()}`
      : `MANUAL · ${s.manualCount} × ${MusicalTime.UNITS[s.manualUnit].long}`;
    this.el.readout.innerHTML = `Cut every <b>${MusicalTime.describeBeats(st.globalBeats)}</b> = ${secs}<br>${how}`;
  }

  // ---- Action Editor (was the clip bin, D-45) ----------------------------
  //
  // The auto-edit clips as an ordered stack. Position = Importance
  // (1 = top). Clicking a card selects the asset and opens its options in
  // 03 Assets; dragging a card (or Alt+←/→) moves it in the stack. Files
  // dropped here are still added as assets (shortcut).

  initBin() {
    this.el.upload.addEventListener('change', (e) => {
      this.app.addDroppedFiles(e.target.files);
      e.target.value = '';
    });
    const bin = this.el.bin;
    this.dragId = null;

    // A card drag carries its own data type, so it can never be mistaken
    // for a file drop (and a missed "dragend" can't block file drops).
    const CARD = 'application/x-bssmnt-card';
    const isCard = (e) => e.dataTransfer && Array.from(e.dataTransfer.types || []).includes(CARD);
    window.addEventListener('dragend', () => { this.dragId = null; this.showInsert(-1); });

    // Reordering cards (an in-page drag) is handled on the Action Editor row.
    bin.addEventListener('dragover', (e) => {
      if (!isCard(e)) return;
      e.preventDefault();
      const g = this.groupAt(e);
      this.el.binCards.querySelectorAll('.bin-group').forEach(x => x.classList.toggle('drop-target', x === g));
      this.showInsert(this.insertIndexAt(e.clientX, g));
    });
    bin.addEventListener('dragleave', (e) => {
      if (!bin.contains(e.relatedTarget)) this.showInsert(-1);
    });
    bin.addEventListener('drop', (e) => {
      if (!isCard(e)) return;
      e.preventDefault();
      e.stopPropagation();
      const id = Number(e.dataTransfer.getData(CARD)) || this.dragId;
      const g = this.groupAt(e);
      if (id != null && g) this.dropInGroup(id, g, this.insertIndexAt(e.clientX, g));
      else if (id != null) this.reorderTo(id, this.insertIndexAt(e.clientX));
      this.dragId = null;
      this.showInsert(-1);
      this.el.binCards.querySelectorAll('.bin-group').forEach(x => x.classList.remove('drop-target'));
    });

    // Files from the desktop can be dropped anywhere on the bottom editor
    // (Clips lane, timeline, Action Editor) and are added as assets.
    const editor = document.getElementById('editorPanel');
    const hasFiles = (e) => e.dataTransfer && Array.from(e.dataTransfer.types || []).includes('Files');
    editor.addEventListener('dragover', (e) => {
      if (isCard(e) || !hasFiles(e)) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = 'copy';
      bin.classList.add('drag-over');
      editor.classList.add('drag-over-panel');
    });
    editor.addEventListener('dragleave', (e) => {
      if (!editor.contains(e.relatedTarget)) { bin.classList.remove('drag-over'); editor.classList.remove('drag-over-panel'); }
    });
    editor.addEventListener('drop', (e) => {
      if (isCard(e) || !hasFiles(e)) return;
      e.preventDefault();
      e.stopPropagation();
      MediaLibrary.captureDrop(e);
      bin.classList.remove('drag-over');
      editor.classList.remove('drag-over-panel');
      this.app.addDroppedFiles(e.dataTransfer.files);
    });
  }

  // Insertion slot 0..N under the pointer (before the card whose centre is
  // to the right of x).
  // The band group under the pointer (grouped Action Editor only).
  groupAt(e) {
    const groups = Array.from(this.el.binCards.querySelectorAll('.bin-group'));
    if (!groups.length) return null;
    const hit = e.target && e.target.closest && e.target.closest('.bin-group');
    if (hit) return hit;
    return groups.find(g => { const r = g.getBoundingClientRect(); return e.clientX >= r.left && e.clientX <= r.right + 10; }) || groups[groups.length - 1];
  }

  // Drop into a band group: the card joins that band (if it wasn't in it)
  // and takes the place it was dropped at, among that band's cards.
  dropInGroup(id, group, slot) {
    const e = this.engine, band = group.dataset.band;
    const clip = e.clipById(id);
    if (!clip) return;
    const members = Array.from(group.querySelectorAll('.bin-card:not(.story-card)')).map(c => Number(c.dataset.id)).filter(x => x !== id);
    const fromSlot = Array.from(group.querySelectorAll('.bin-card:not(.story-card)')).findIndex(c => Number(c.dataset.id) === id);
    if (fromSlot >= 0 && slot > fromSlot) slot--;
    if (clip.band !== band) e.setClipBand(id, band);
    const stack = e.stack.filter(c => c.id !== id);
    let to;
    if (!members.length) to = stack.length;
    else if (slot < members.length) to = stack.findIndex(c => c.id === members[slot]);
    else to = stack.findIndex(c => c.id === members[members.length - 1]) + 1;
    e.moveClip(id, Math.max(0, to));
  }

  insertIndexAt(x, group = null) {
    const cards = Array.from((group || this.el.binCards).querySelectorAll('.bin-card:not(.story-card)'));
    for (let i = 0; i < cards.length; i++) {
      const r = cards[i].getBoundingClientRect();
      if (x < r.left + r.width / 2) return i;
    }
    return cards.length;
  }

  showInsert(slot, group = this.el.binCards.querySelector('.bin-group.drop-target')) {
    this.el.binCards.querySelectorAll('.insert-before, .insert-after').forEach(c => c.classList.remove('insert-before', 'insert-after'));
    const cards = Array.from((group || this.el.binCards).querySelectorAll('.bin-card:not(.story-card)'));
    cards.forEach((c, i) => {
      c.classList.toggle('insert-before', i === slot);
      c.classList.toggle('insert-after', slot === cards.length && i === cards.length - 1);
    });
  }

  // slot is an insertion point in the current stack; convert to the index
  // the clip ends up at once it's been lifted out.
  reorderTo(id, slot) {
    const from = this.engine.stack.findIndex(c => c.id === id);
    if (from < 0) return;
    this.engine.moveClip(id, slot > from ? slot - 1 : slot);
  }

  renderBin() {
    const CARD_TYPE = 'application/x-bssmnt-card';
    const cards = this.el.binCards;
    const clips = this.engine.stack;
    const focusedId = document.activeElement && document.activeElement.closest && document.activeElement.closest('.bin-card')
      ? document.activeElement.closest('.bin-card').dataset.id : null;
    this.el.binCount.textContent = `${clips.length} clip${clips.length === 1 ? '' : 's'}`;
    cards.textContent = '';
    // Band members (D-85): B1 / M2 / H1 / A1 tags; grouped by band when the
    // clip order is By band (D-86).
    const tagOf = this.engine.memberTags();
    const grouped = this.engine.settings.order === 'band';
    cards.classList.toggle('grouped', grouped);
    const groups = {};
    if (grouped) {
      ClipEngine.BANDS.forEach(b => {
        const g = document.createElement('div');
        g.className = 'bin-group';
        g.dataset.band = b;
        const head = document.createElement('div');
        head.className = 'bin-group-head';
        const n = clips.filter(c => (c.band || 'any') === b).length;
        head.innerHTML = `<span class="band-swatch ${b}"></span><span>${b === 'any' ? 'Any' : b} · ${n}</span>`;
        const list = document.createElement('div');
        list.className = 'bin-group-cards';
        g.append(head, list);
        groups[b] = list;
        cards.appendChild(g);
      });
    }
    clips.forEach((clip, i) => {
      const card = document.createElement('div');
      card.className = 'bin-card' + (clip.id === this.engine.selectedId ? ' selected' : '');
      card.dataset.id = clip.id;
      card.dataset.band = clip.band;
      card.tabIndex = 0;
      card.draggable = true;
      card.setAttribute('role', 'option');
      card.setAttribute('aria-selected', String(clip.id === this.engine.selectedId));
      card.setAttribute('aria-label', `${i + 1}. ${clip.name}`);
      card.title = 'Click for options. Drag (or Alt+←/→) to change its place in the stack.';

      let thumb;
      if (clip.thumb) {
        thumb = document.createElement('img');
        thumb.src = clip.thumb.toDataURL('image/jpeg', 0.8);
        thumb.alt = '';
        thumb.draggable = false;
      } else {
        thumb = document.createElement('div');
      }
      thumb.className = 'bin-thumb';

      const rank = document.createElement('span');
      rank.className = 'bin-rank';
      rank.textContent = clip.importance;

      const meta = document.createElement('div');
      meta.className = 'bin-meta';
      const name = document.createElement('span');
      name.className = 'bin-name';
      name.textContent = clip.name;
      name.title = clip.name;
      // Video: used length, and on-screen length when the speed changes it.
      // Click it for the amount used (D-82).
      const isVid = clip.kind === 'video' && clip.ready && !clip.offline && !clip.error;
      const dur = document.createElement(isVid ? 'button' : 'span');
      dur.className = 'bin-dur';
      if (isVid) {
        const e = this.engine, used = e.usedLength(clip), scr = e.screenLength(clip), src = e.sourceLength(clip);
        dur.type = 'button';
        dur.textContent = Math.abs(scr - used) < 0.05 ? fmtTime(used, false) : `${fmtTime(used, false)}→${fmtTime(scr, false)}`;
        const whole = clip.parent ? (() => { const b = e.sectionBounds(clip); return b.end - b.start; })() : src;
        if (used < whole - 0.05) dur.classList.add('is-set');
        dur.title = `Source ${fmtTime(src, false)} · used ${fmtTime(used, false)} · on screen ${fmtTime(scr, false)} (${ClipTools.speedLabel(e.speedOf(clip))}). Click to set the amount used.`;
        dur.setAttribute('aria-label', `Amount used: ${dur.title}`);
        dur.addEventListener('click', (ev) => { ev.stopPropagation(); this.app.clipTools.openRange(clip, dur); });
        dur.addEventListener('keydown', (ev) => ev.stopPropagation());
      } else {
        dur.textContent = clip.offline ? 'OFFLINE' : clip.error ? 'ERR' : !clip.ready ? '…' : clip.kind === 'image' ? 'Still' : fmtTime(clip.duration, false);
      }
      if (clip.error) {
        card.classList.add('bin-error');
        card.title = `${clip.error}. Try Chrome/Edge, or convert to WebM (VP9) or H.264 MP4.`;
      }
      meta.append(name, dur);

      const tags = document.createElement('div');
      tags.className = 'bin-tags';
      const t = [clip.kind === 'image' ? 'IMG' : 'VID'];
      if (clip.speed && clip.speed !== 1) t.push(ClipTools.speedLabel(clip.speed));
      if (clip.repeats > 0) t.push(`×${clip.repeats}`);
      if (clip.pace === 'fit') t.push(`${clip.fitBars} bar${clip.fitBars === 1 ? '' : 's'}`);
      else if (clip.pace !== 'global' && MusicalTime.AUTO_PACES[clip.pace]) t.push(MusicalTime.AUTO_PACES[clip.pace].label);
      if (clip.band !== 'any') t.push(clip.band);
      if (clip.layer) t.push(`layer ${clip.layer}`);
      const tagText = document.createElement('span');
      tagText.className = 'bin-tag-text';
      tagText.textContent = t.join(' · ');
      tags.appendChild(tagText);
      if (isVid) {
        const sb = document.createElement('button');
        sb.type = 'button';
        sb.className = 'bin-sect';
        sb.textContent = this.engine.isSplit(clip) ? 'Edit §' : 'Sections';
        sb.title = 'Split this clip on bar markers (each section becomes its own card)';
        sb.addEventListener('click', (ev) => { ev.stopPropagation(); this.app.clipTools.openSections(clip); });
        sb.addEventListener('keydown', (ev) => ev.stopPropagation());
        tags.appendChild(sb);
      }

      const bar = document.createElement('div');
      bar.className = 'bin-band-bar';

      // A clip with sections (D-82): one card, its sections as a strip in
      // the card's lower area. Click a section to edit it in 03 Sound.
      let strip = null;
      if (this.engine.isSplit(clip)) {
        strip = document.createElement('div');
        strip.className = 'bin-sections';
        strip.setAttribute('role', 'group');
        strip.setAttribute('aria-label', 'Sections');
        this.engine.sectionsOf(clip).forEach(s => {
          const b = this.engine.sectionBounds(s);
          const btn = document.createElement('button');
          btn.type = 'button';
          btn.className = `bin-section band-${s.band || 'any'}` + (s.id === this.engine.selectedId ? ' selected' : '') + (s.asClip ? '' : ' is-off');
          btn.style.flexGrow = String(Math.max(0.05, b.end - b.start));
          btn.textContent = tagOf.get(s.id) || String(s.section + 1);
          btn.title = `${s.name} · ${fmtTime(b.start, true)}–${fmtTime(b.end, true)} · ${s.band === 'any' ? 'any band' : s.band}${s.pace !== 'global' ? ' · ' + s.pace : ''}${s.speed !== 1 ? ' · ' + ClipTools.speedLabel(s.speed) : ''} — click to edit this section`;
          btn.addEventListener('click', (ev) => { ev.stopPropagation(); this.engine.select(s.id); if (this.app.sidebar) this.app.sidebar.open('assets'); });
          btn.addEventListener('keydown', (ev) => ev.stopPropagation());
          strip.appendChild(btn);
        });
      }
      const member = document.createElement('span');
      member.className = 'bin-member';
      member.textContent = tagOf.get(clip.id) || (strip ? `${clip.sections.length + 1}§` : '');
      member.title = 'Band member: band letter + rank within the band';
      card.append(rank, member, thumb, bar, meta, tags);
      if (strip) card.appendChild(strip);
      if (this.engine.clipById(this.engine.selectedId) && this.engine.clipById(this.engine.selectedId).parent === clip.id) card.classList.add('selected');
      const select = () => {
        this.engine.select(clip.id);
        if (this.app.sidebar) this.app.sidebar.open('assets');
      };
      card.addEventListener('click', select);
      card.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') { e.preventDefault(); select(); }
        if (e.altKey && (e.key === 'ArrowLeft' || e.key === 'ArrowRight')) {
          e.preventDefault();
          this.engine.moveClip(clip.id, i + (e.key === 'ArrowLeft' ? -1 : 1));
        }
      });
      card.addEventListener('dragstart', (e) => {
        this.dragId = clip.id;
        e.dataTransfer.effectAllowed = 'move';
        e.dataTransfer.setData(CARD_TYPE, String(clip.id));
        e.dataTransfer.setData('text/plain', String(clip.id));
        card.classList.add('dragging');
      });
      card.addEventListener('dragend', () => {
        this.dragId = null;
        card.classList.remove('dragging');
        this.showInsert(-1);
      });
      (grouped ? groups[clip.band] || groups.any : cards).appendChild(card);
    });
    // Story Mode: Hook first, Result / CTA last, as fixed markers (D-45).
    const story = this.engine.storyAssets();
    if (story.hook) cards.prepend(this.storyCard(story.hook, 'Hook'));
    if (story.result) cards.appendChild(this.storyCard(story.result, 'Result'));
    if (story.cta) cards.appendChild(this.storyCard(story.cta, 'CTA'));
    if (focusedId) {
      const again = cards.querySelector(`[data-id="${focusedId}"]`);
      if (again) again.focus();
    }
    this.markShowing();
  }

  storyCard(a, label) {
    const card = document.createElement('div');
    card.className = 'bin-card story-card' + (a.id === this.engine.selectedId ? ' selected' : '');
    card.dataset.id = a.id;
    card.tabIndex = 0;
    card.setAttribute('role', 'option');
    card.setAttribute('aria-label', `${label}: ${a.name}`);
    card.title = 'Story block: fixed place, plays once. Click for options.';
    const tag = document.createElement('span');
    tag.className = 'bin-rank story-tag';
    tag.textContent = label;
    let thumb;
    if (a.thumb) { thumb = document.createElement('img'); thumb.src = a.thumb.toDataURL('image/jpeg', 0.8); thumb.alt = ''; thumb.draggable = false; }
    else thumb = document.createElement('div');
    thumb.className = 'bin-thumb';
    const meta = document.createElement('div');
    meta.className = 'bin-meta';
    meta.innerHTML = `<span class="bin-name"></span><span class="bin-dur"></span>`;
    meta.firstChild.textContent = a.name;
    meta.lastChild.textContent = a.kind === 'image' ? `${a.storyHold}s` : fmtTime(a.duration, false);
    const tags = document.createElement('div');
    tags.className = 'bin-tags';
    tags.textContent = 'Story · once';
    card.append(tag, thumb, meta, tags);
    const select = () => { this.engine.select(a.id); if (this.app.sidebar) this.app.sidebar.open('assets'); };
    card.addEventListener('click', select);
    card.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); select(); } });
    return card;
  }

  markShowing() {
    const now = this.engine.nowShowing();
    this.el.binCards.querySelectorAll('.bin-card').forEach(c => {
      c.classList.toggle('showing', !!now && String(now.clip.id) === c.dataset.id);
    });
  }

  // ---- canvas interaction ---------------------------------------------

  initCanvasInteraction() {
    const c = this.canvas;
    let dragging = false;
    const timeAt = (e) => {
      const r = c.getBoundingClientRect();
      return this.view.start + ((e.clientX - r.left) / r.width) * this.view.span;
    };
    c.addEventListener('pointerdown', (e) => {
      const r = c.getBoundingClientRect();
      if (this.grab) { e.stopImmediatePropagation(); this.dropTrack(this.grabLead(timeAt(e), e.altKey)); return; }
      const hit = (this.textHits || []).find(b => e.clientX - r.left >= b.x0 && e.clientX - r.left <= b.x1 && e.clientY - r.top >= b.y0 && e.clientY - r.top <= b.y1);
      if (hit) {
        e.stopImmediatePropagation();
        this.app.text.select(hit.id);
        if (this.app.sidebar) this.app.sidebar.open('text');
        this.textDrag = { id: hit.id, x: e.clientX, start: hit.start, moved: false };
        c.setPointerCapture(e.pointerId);
        return;
      }
      if (!this.app.isTrackMode()) return;
      c.setPointerCapture(e.pointerId);
      // Ruler (D-91): drag to select a range (snapped to beats on the tempo
      // grid; Alt = free); Shift moves the nearest edge of the selection.
      if (e.clientY - r.top < this.ROWS.ruler) {
        const t = this.snapT(timeAt(e), e.altKey);
        const s = this.selection;
        if (e.shiftKey && s) this.selDrag = { anchor: Math.abs(t - s.a) < Math.abs(t - s.b) ? s.b : s.a };
        else this.selDrag = { anchor: t };
        this.setSelection({ a: Math.min(this.selDrag.anchor, t), b: Math.max(this.selDrag.anchor, t) }, true);
        return;
      }
      // Lanes: scrub — the playhead moves and shows what was recorded there;
      // the cut list is never touched (the engine catches up on play).
      dragging = true;
      this.app.scrubTo(timeAt(e));
    });
    c.addEventListener('pointermove', (e) => {
      if (this.grab) { this.grab.lead = this.grabLead(timeAt(e), e.altKey); return; }
      if (this.textDrag) {
        const d = this.textDrag;
        const dt = ((e.clientX - d.x) / c.clientWidth) * this.view.span;
        if (Math.abs(e.clientX - d.x) > 3) d.moved = true;
        if (d.moved) {
          const it = this.app.text.get(d.id);
          if (it) { it.anchor = 'time'; it.firedAt = null; it.firedWall = null; it.start = Math.max(0, Math.round((d.start + dt) * 10) / 10); }
        }
        return;
      }
      if (this.selDrag) {
        const t = this.snapT(timeAt(e), e.altKey);
        this.setSelection({ a: Math.min(this.selDrag.anchor, t), b: Math.max(this.selDrag.anchor, t) }, true);
        return;
      }
      if (dragging) this.app.scrubTo(timeAt(e));
    });
    c.addEventListener('pointerup', (e) => {
      if (this.textDrag) {
        const moved = this.textDrag.moved;
        this.textDrag = null;
        if (moved) this.app.text.emit('change');
        return;
      }
      if (this.selDrag) {
        this.selDrag = null;
        if (this.selection && this.selection.b - this.selection.a < 0.05) this.setSelection(null);
        else this.setSelection(this.selection);
        return;
      }
      if (!dragging) return;
      dragging = false;
      this.app.scrubTo(timeAt(e));
    });
    // Ctrl/Cmd+wheel zooms around the cursor, wheel pans (track mode).
    c.addEventListener('wheel', (e) => {
      if (!this.app.isTrackMode()) return;
      e.preventDefault();
      const dur = this.app.songLength() || 1;
      if (e.ctrlKey || e.metaKey) {
        const t = timeAt(e);
        const span = Math.max(2, Math.min(dur, this.view.span * (e.deltaY > 0 ? 1.15 : 0.87)));
        const frac = (t - this.view.start) / this.view.span;
        this.view.start = t - frac * span;
        this.view.span = span;
      } else {
        this.view.start += (e.deltaX || e.deltaY) / c.clientWidth * this.view.span;
      }
      this.view.start = Math.max(0, Math.min(dur - this.view.span, this.view.start));
      this.view.fit = this.view.span >= dur;
    }, { passive: false });
    c.addEventListener('dblclick', (e) => {
      const r = c.getBoundingClientRect(), y = e.clientY - r.top;
      // On the Master lane: pick up the control track (D-99); elsewhere: fit.
      if (this.app.isTrackMode() && y >= this.ROWS.ruler && y < this.ROWS.ruler + this.ROWS.master) { this.grabTrack(timeAt(e)); return; }
      this.view.fit = true;
    });
  }

  // ---- control track start (D-99) -----------------------------------------
  // Two ways to move where the music starts: double-click the Master lane to
  // pick it up, move, click to drop (snaps to whole bars; Alt = free; Esc
  // cancels) — or type a time in the Start box (exact).

  // Compact m:ss (m:ss.s when not on a whole second) — fits the header.
  static fmtStart(s) {
    const t = Math.round(s * 10) / 10, m = Math.floor(t / 60), r = +(t - m * 60).toFixed(1);
    const sec = Number.isInteger(r) ? String(r).padStart(2, '0') : r.toFixed(1).padStart(4, '0');
    return `${m}:${sec}`;
  }

  // "1:05", "0:08.5", "8", "8.25" → seconds (null if not a time).
  static parseStart(txt) {
    const m = String(txt).trim().match(/^(?:(\d+):)?(\d+(?:\.\d*)?)$/);
    if (!m) return null;
    return (m[1] ? +m[1] * 60 : 0) + +m[2];
  }

  leadShown() { return this.grab ? this.grab.lead : this.app.trackStart; }

  grabTrack(t) {
    if (this.app.timelineRolling()) this.app.toggleAudio();
    this.grab = { from: this.app.trackStart, at: t, lead: this.app.trackStart };
    this.canvas.classList.add('grabbing');
  }

  // Where the music would start with the pointer at t: moved by whole bars
  // (the grid moves with the music, so it stays on its bars), Alt = free.
  grabLead(t, free) {
    const g = this.grab, bar = this.app.tempo.barSec;
    let d = t - g.at;
    if (!free && bar > 0) d = Math.round(d / bar) * bar;
    return Math.max(0, Math.min(TrackSource.MAX_START, g.from + d));
  }

  dropTrack(lead) {
    if (!this.grab) return;
    this.grab = null;
    this.canvas.classList.remove('grabbing');
    if (lead != null) this.app.setTrackStart(lead);
  }

  initTrackStart() {
    const inp = document.getElementById('masterStart');
    if (!inp) return;
    const commit = () => {
      const v = TimelinePanel.parseStart(inp.value);
      if (v != null) this.app.setTrackStart(v);
      inp.value = TimelinePanel.fmtStart(this.app.trackStart);
    };
    inp.addEventListener('keydown', (e) => {
      e.stopPropagation();
      if (e.key === 'Enter') { e.preventDefault(); commit(); inp.blur(); }
      else if (e.key === 'Escape') { e.preventDefault(); inp.value = TimelinePanel.fmtStart(this.app.trackStart); inp.blur(); }
    });
    inp.addEventListener('change', commit);
    inp.addEventListener('focus', () => inp.select());
    document.addEventListener('keydown', (e) => {
      if (this.grab && e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); this.dropTrack(null); }
    }, true);
  }

  // The start line on the Master lane, and the grabbed track's label.
  drawTrackStart(ctx, x, y, h) {
    const app = this.app, lead = this.leadShown();
    if (!app.isTrackMode() || (!(lead > 0) && !this.grab)) return;
    const sx = Math.round(x(lead)) + 0.5;
    ctx.save();
    if (lead > 0) { ctx.fillStyle = 'rgba(0, 0, 0, 0.35)'; ctx.fillRect(x(0), y, sx - x(0), h); }
    ctx.strokeStyle = '#ffffff'; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(sx, y); ctx.lineTo(sx, y + h); ctx.stroke();
    const label = this.grab ? `START ${TimelinePanel.fmtStart(lead)} · click to drop · Esc` : `START ${TimelinePanel.fmtStart(lead)}`;
    ctx.font = '600 10px "JetBrains Mono", monospace';
    const w = ctx.measureText(label).width + 8;
    ctx.fillStyle = this.grab ? '#ffffff' : 'rgba(0, 0, 0, 0.6)';
    ctx.fillRect(sx + 2, y + 3, w, 15);
    ctx.fillStyle = this.grab ? '#000000' : '#ffffff';
    ctx.fillText(label, sx + 6, y + 14);
    ctx.restore();
  }

  // ---- master track length (D-97) ------------------------------------------

  initTrackLength() {
    const btn = document.getElementById('masterLength');
    if (!btn) return;
    const pop = document.createElement('div');
    pop.className = 'clip-pop len-pop';
    pop.id = 'trackLengthPop';
    pop.setAttribute('role', 'dialog');
    pop.setAttribute('aria-label', 'Track length');
    pop.hidden = true;
    pop.innerHTML = `<div class="clip-pop-head"><span class="clip-pop-k">Track length</span><span class="clip-pop-name" id="lenFull"></span></div>
      <input type="range" id="lenRange" min="30" step="0.5" aria-label="Length">
      <div class="clip-pop-row"><label>Min <input type="number" id="lenMin" min="0" step="1"></label><label>Sec <input type="number" id="lenSec" min="0" max="59.9" step="0.5"></label></div>
      <p class="clip-pop-note">The song ends here: cuts, positions (CTA), end-locked text, fades and the export follow. 30 s at least.</p>
      <div class="clip-pop-row"><button type="button" class="btn" id="lenAll">Full length</button><button type="button" class="btn btn-primary" id="lenDone">Done</button></div>`;
    document.body.appendChild(pop);
    const $ = (id) => pop.querySelector('#' + id);
    const sync = () => {
      const d = this.app.trackSource.fileDuration || 0, L = this.app.musicLength();
      $('lenRange').max = d; $('lenRange').value = L;
      $('lenMin').value = Math.floor(L / 60); $('lenSec').value = +(L % 60).toFixed(1);
      $('lenFull').textContent = `of ${fmtTime(d, false)}`;
    };
    const set = (s) => { this.app.setTrackLength(s); sync(); };
    $('lenRange').addEventListener('input', () => set(parseFloat($('lenRange').value)));
    const fromFields = () => set((parseFloat($('lenMin').value) || 0) * 60 + (parseFloat($('lenSec').value) || 0));
    $('lenMin').addEventListener('change', fromFields);
    $('lenSec').addEventListener('change', fromFields);
    $('lenAll').addEventListener('click', () => set(null));
    $('lenDone').addEventListener('click', () => { pop.hidden = true; });
    btn.addEventListener('click', () => {
      if (!pop.hidden) { pop.hidden = true; return; }
      sync();
      pop.hidden = false;
      const r = btn.getBoundingClientRect();
      pop.style.left = `${Math.max(8, r.left)}px`;
      pop.style.top = `${Math.max(8, r.top - pop.offsetHeight - 8)}px`;
    });
    document.addEventListener('pointerdown', (e) => { if (!pop.hidden && !pop.contains(e.target) && e.target !== btn) pop.hidden = true; });
  }

  // ---- master fades (D-92) ------------------------------------------------

  initMasterFades() {
    const btn = document.getElementById('masterFadesBtn');
    if (!btn) return;
    const pop = document.createElement('div');
    pop.className = 'clip-pop fade-pop';
    pop.id = 'masterFadesPop';
    pop.setAttribute('role', 'dialog');
    pop.setAttribute('aria-label', 'Master fades');
    pop.hidden = true;
    document.body.appendChild(pop);
    const render = () => {
      const F = this.app.masterFade;
      btn.setAttribute('aria-pressed', String(F.in.on || F.out.on));
      pop.innerHTML = '<div class="clip-pop-head"><span class="clip-pop-k">Master fades</span><span class="clip-pop-name">music bus, after the analyser</span></div>';
      ['in', 'out'].forEach(k => {
        const f = F[k];
        const row = document.createElement('div');
        row.className = 'fade-row';
        row.innerHTML = `<label class="prop-check"><input type="checkbox" id="fade${k}On" ${f.on ? 'checked' : ''}><span>Fade ${k}</span></label>
          <select id="fade${k}Shape" aria-label="Shape"><option value="linear">Linear</option><option value="smooth">Smooth</option><option value="snap">Snap</option></select>
          <input type="number" id="fade${k}Len" min="0.25" step="0.25" value="${f.len}" aria-label="Length">
          <select id="fade${k}Unit" aria-label="Unit"><option value="bars">bars</option><option value="s">s</option></select>`;
        row.querySelector('select[aria-label=Shape]').value = f.shape;
        row.querySelector('select[aria-label=Unit]').value = f.unit;
        row.querySelector('input[type=checkbox]').addEventListener('change', (e) => { this.app.setMasterFade(k, { on: e.target.checked }); render(); });
        row.querySelector('select[aria-label=Shape]').addEventListener('change', (e) => this.app.setMasterFade(k, { shape: e.target.value }));
        row.querySelector('input[type=number]').addEventListener('change', (e) => this.app.setMasterFade(k, { len: Math.max(0.25, parseFloat(e.target.value) || 1) }));
        row.querySelector('select[aria-label=Unit]').addEventListener('change', (e) => this.app.setMasterFade(k, { unit: e.target.value }));
        pop.appendChild(row);
      });
      const note = document.createElement('p');
      note.className = 'clip-pop-note';
      note.textContent = 'Shapes as the locked-clip fades (D-59). Also used for the edge fades of a Selection export.';
      pop.appendChild(note);
    };
    btn.addEventListener('click', () => {
      if (!pop.hidden) { pop.hidden = true; return; }
      render();
      pop.hidden = false;
      const r = btn.getBoundingClientRect();
      pop.style.left = `${Math.max(8, r.left)}px`;
      pop.style.top = `${Math.max(8, r.top - pop.offsetHeight - 8)}px`;
    });
    document.addEventListener('pointerdown', (e) => { if (!pop.hidden && !pop.contains(e.target) && e.target !== btn) pop.hidden = true; });
    this.renderFadesBtn = render;
  }

  // ---- selection (D-91) ----------------------------------------------------

  snapT(t, free = false) {
    const dur = this.app.trackSource.duration || 0;
    t = Math.max(0, Math.min(dur || t, t));
    const g = this.app.tempo;
    if (free || !g.active) return t;
    const b = Math.round(g.beatAt(t));
    return Math.max(0, Math.min(dur || Infinity, g.timeOfBeat(b)));
  }

  // { a, b } seconds, or null. dragging = don't announce yet.
  setSelection(sel, dragging = false) {
    this.selection = sel && sel.b > sel.a ? { a: sel.a, b: sel.b } : null;
    if (!this.selection) this.looping = false;
    if (!dragging && this.app.exportPanel) this.app.exportPanel.refresh();
  }

  selectionLabel() {
    const s = this.selection;
    if (!s) return '';
    const g = this.app.tempo, len = s.b - s.a;
    const bars = g.bpm > 0 ? len / g.barSec : 0;
    return `${fmtTime(len, true)}${bars ? ` · ${+bars.toFixed(2)} bar${Math.abs(bars - 1) < 1e-6 ? '' : 's'}` : ''}${this.looping ? ' · LOOP' : ''}`;
  }

  // While looping: past the end of the selection → back to its start.
  loopCheck() {
    // A shortened master track (D-97) stops at its end.
    const app = this.app;
    if (app.trackLength && app.isTrackMode() && app.trackSource.isPlaying && app.masterTime() >= app.songLength() - 0.02 && !(this.looping && this.selection)) app.toggleAudio();
    const s = this.selection;
    if (!this.looping || !s || !this.app.timelineRolling()) return;
    const t = this.app.masterTime();
    if (t >= s.b - 0.02 || t < s.a - 0.5) this.app.seekMaster(s.a);
  }

  drawSelection(ctx, C, x, H) {
    const s = this.selection;
    if (!s) return;
    const x0 = x(s.a), x1 = x(s.b);
    ctx.fillStyle = 'rgba(92, 141, 255, 0.14)';
    ctx.fillRect(x0, 0, x1 - x0, H);
    ctx.fillStyle = C.high;
    ctx.fillRect(Math.round(x0), 0, 1, H);
    ctx.fillRect(Math.round(x1) - 1, 0, 1, H);
    ctx.fillRect(x0, 0, x1 - x0, 3);
    const label = this.selectionLabel();
    ctx.font = '700 9px "JetBrains Mono", monospace';
    const tw = ctx.measureText(label).width + 8;
    const lx = Math.max(0, Math.min(this.W - tw, x0 + 2));
    ctx.fillStyle = C.high; ctx.fillRect(lx, 15, tw, 12);   // under the playhead time
    ctx.fillStyle = '#ffffff'; ctx.fillText(label, lx + 4, 24);
  }

  // Master fades (D-92): the ramps over the Master lane.
  drawFadeRamps(ctx, C, x, y, h) {
    const app = this.app, F = app.masterFade;
    if (!app.isTrackMode() || !(F.in.on || F.out.on)) return;
    const dur = app.songLength() || 0, s0 = app.trackStart;
    ctx.save();
    ctx.strokeStyle = '#ffd400'; ctx.lineWidth = 1.5;
    ctx.fillStyle = 'rgba(0, 0, 0, 0.35)';
    const ramp = (t0, t1) => {
      const n = 40;
      ctx.beginPath();
      ctx.moveTo(x(t0), y + h);
      for (let i = 0; i <= n; i++) { const t = t0 + ((t1 - t0) * i) / n; ctx.lineTo(x(t), y + h - app.masterFadeLevel(t) * (h - 4)); }
      ctx.lineTo(x(t1), y + h);
      ctx.closePath();
      ctx.fill();
      ctx.beginPath();
      for (let i = 0; i <= n; i++) { const t = t0 + ((t1 - t0) * i) / n; const yy = y + h - app.masterFadeLevel(t) * (h - 4); if (i) ctx.lineTo(x(t), yy); else ctx.moveTo(x(t), yy); }
      ctx.stroke();
    };
    if (F.in.on) ramp(s0, Math.min(dur, s0 + app.fadeSeconds(F.in)));
    if (F.out.on && dur) ramp(Math.max(s0, dur - app.fadeSeconds(F.out)), dur);
    ctx.restore();
  }

  // Replaced by Workspace (D-84); kept for reference only.
  initSplitterOld() {
    const split = document.getElementById('panelSplitter');
    const editor = document.getElementById('editorPanel');
    const KEY = 'djv.editorHeight';
    try {
      const saved = parseInt(localStorage.getItem(KEY), 10);
      if (saved) editor.style.height = saved + 'px';
    } catch (e) { /* storage unavailable */ }
    let startY = 0, startH = 0;
    const move = (e) => {
      const h = Math.max(230, Math.min(window.innerHeight * 0.75, startH + (startY - e.clientY)));
      editor.style.height = h + 'px';
    };
    const up = () => {
      split.classList.remove('dragging');
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      try { localStorage.setItem(KEY, parseInt(editor.style.height, 10)); } catch (e) { /* ignore */ }
    };
    split.addEventListener('pointerdown', (e) => {
      startY = e.clientY;
      startH = editor.getBoundingClientRect().height;
      split.classList.add('dragging');
      window.addEventListener('pointermove', move);
      window.addEventListener('pointerup', up);
    });
  }

  get ROWS() {
    const ws = this.app.workspace;
    if (!ws) return this.ROWS_DEFAULT;
    return { ruler: 28, master: ws.laneHeight('master'), clips: ws.laneHeight('clips'), voice: ws.laneHeight('voice'), text: ws.laneHeight('text') };
  }

  resizeCanvas() {
    if (this.app.workspace) this.app.workspace.compute();   // drawer heights (D-96)
    const dpr = window.devicePixelRatio || 1;
    const w = this.canvas.clientWidth;
    const R = this.ROWS;
    const lanes = [['ruler', true], ['master', true], ['clips', true], ['voice', this.app.voice.isLoaded], ['text', this.app.text.items.length > 0]];
    let y = 0;
    const laid = [];
    lanes.forEach(([name, on]) => {
      const ch = document.querySelector(`.ch-${name}`);
      if (ch) ch.style.height = `${R[name]}px`;
      if (!on) return;
      laid.push({ name, y, h: R[name] });
      y += R[name];
    });
    const h = y;
    if (this.app.workspace) this.app.workspace.renderGrips(laid);
    this.canvas.style.height = `${h}px`;
    this.canvas.width = Math.max(1, Math.round(w * dpr));
    this.canvas.height = Math.round(h * dpr);
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.W = w;
    this.H = h;
  }

  // ---- frame loop ------------------------------------------------------

  loop() {
    requestAnimationFrame(() => this.loop());
    const now = performance.now();
    if (now - this.lastDraw < 33) return;
    this.lastDraw = now;
    this.updateView();
    this.updateHeader();
    this.updateHud();
    const showing = this.engine.nowShowing();
    const showingId = showing ? showing.clip.id : null;
    if (showingId !== this.shownId) { this.shownId = showingId; this.markShowing(); }
    this.loopCheck();
    this.draw();
    this.renderMembers();
  }

  updateView() {
    const t = this.app.masterTime();
    if (this.app.isTrackMode()) {
      const dur = this.app.trackSource.duration || 1;
      if (this.view.fit) { this.view.start = 0; this.view.span = dur; }
      else if (t > this.view.start + this.view.span * 0.95 || t < this.view.start) {
        this.view.start = Math.max(0, Math.min(dur - this.view.span, t - this.view.span * 0.1));
      }
    } else {
      this.view.span = this.LIVE_WINDOW;
      this.view.start = Math.max(0, t - this.LIVE_WINDOW * 0.85);
    }
  }

  updateHeader() {
    const st = this.engine.status();
    const track = this.app.isTrackMode();
    const t = this.app.masterTime();
    this.el.time.textContent = track
      ? `${fmtTime(t, true)}`
      : fmtTime(t, true);
    this.el.bpm.textContent = st.bpm > 0 ? st.bpm : '--';
    if (st.position >= 0) {
      const bb = MusicalTime.barBeat(st.position);
      this.el.barBeat.textContent = `${bb.bar}.${bb.beat}`;
    } else {
      this.el.barBeat.textContent = '–.–';
    }
    this.el.band.textContent = st.dominant.toUpperCase();
    this.el.band.className = `lcd-v band-chip ${st.dominant}`;

    this.el.badge.textContent = track ? `TRACK ${fmtTime(this.app.songLength(), false)}` : 'LIVE';
    this.el.badge.className = `badge ${track ? 'track' : 'live'}`;
    const subTxt = track ? (this.app.trackSource.file ? this.app.trackSource.file.name.replace(/\.[^.]+$/, '') : 'Track') : 'Live Session';
    if (this.el.masterSub.textContent !== subTxt) { this.el.masterSub.textContent = subTxt; this.el.masterSub.title = subTxt; }
    // Start (D-99) and the music's length (D-97), on one line under the label.
    const startRow = document.getElementById('masterStartRow');
    if (startRow) startRow.hidden = !track;
    const startIn = document.getElementById('masterStart');
    if (startIn && document.activeElement !== startIn) {
      const v = TimelinePanel.fmtStart(this.grab ? this.grab.lead : this.app.trackStart);
      if (startIn.value !== v) startIn.value = v;
    }
    if (startIn) startIn.classList.toggle('is-set', this.app.trackStart > 0 || !!this.grab);
    const lenBtn = document.getElementById('masterLength');
    if (lenBtn) {
      lenBtn.hidden = !track;
      const txt = track ? `${TimelinePanel.fmtStart(Math.round(this.app.musicLength()))}${this.app.trackLength ? ' ✂' : ''}` : '';
      if (lenBtn.textContent !== txt) lenBtn.textContent = txt;
      lenBtn.classList.toggle('is-set', !!this.app.trackLength);
    }
    if (this.el.topSource) this.el.topSource.textContent = this.app.audioSourceMode === 'file' ? 'TRACK' : 'LIVE';
    this.canvas.classList.toggle('no-seek', !track);

    const playing = this.app.timelineRolling() || (track ? this.app.trackSource.isPlaying : this.app.isRunning);
    this.el.play.innerHTML = playing ? '&#x275A;&#x275A;' : '&#x25B6;';
    this.el.play.classList.toggle('is-live', playing);

    const messages = {
      'no-clips': 'Add clips to the bin to start auto-editing',
      'unplayable': 'This browser can’t decode these clips — open in Chrome/Edge or use WebM',
      'idle': this.app.visualizer.currentMode === 'clips'
        ? `${this.engine.clips.length} clips ready · press play`
        : 'Select “Clip Auto-Editor” mode to roll the clip timeline',
      'waiting-bpm': 'Listening for tempo…',
      'running': `${st.clipPace ? `Clip pace ${MusicalTime.AUTO_PACES[st.clipPace].label}: holding` : 'Cutting every'} ${MusicalTime.describeBeats(st.intervalBeats)} · ${(st.intervalMs / 1000).toFixed(2)}s · ${this.engine.segments.length} cuts`,
    };
    const notice = this.app.notice && performance.now() < this.app.notice.until ? this.app.notice.text : null;
    this.el.summary.textContent = notice ? notice : st.story
      ? `Story block: ${({ hook: 'HOOK', result: 'RESULT / CLIMAX', cta: 'CTA' })[st.story]} · automation paused`
      : messages[st.state];

    // Story panel bits that depend on the source mode (track vs live).
    const fadeBox = document.getElementById('propStoryFade');
    const fadeOff = !this.engine.settings.storyMode || !track;
    if (fadeBox && fadeBox.disabled !== fadeOff) fadeBox.disabled = fadeOff;
    const hint = this.storyHint();
    const hintEl = document.getElementById('propStoryHint');
    if (hintEl.textContent !== hint) hintEl.textContent = hint;

    // Live Story Mode: Result / CTA are fired by hand, once each.
    const liveStory = this.engine.settings.storyMode && !track;
    const assets = this.engine.storyAssets();
    [['tlFireResult', 'result'], ['tlFireCta', 'cta']].forEach(([id, role]) => {
      const b = document.getElementById(id);
      b.hidden = !liveStory || !assets[role];
      b.disabled = this.engine.fired.some(f => f.role === role) || !this.app.isRunning;
    });
    this.updateReadout();
  }

  updateHud() {
    const inClips = this.app.visualizer.currentMode === 'clips';
    const now = inClips ? this.engine.nowShowing() : null;
    if (now) {
      // Same row layout as the Status overlay (D-43).
      const tr = ClipTransitions.get(now.segment.transition);
      this.el.hud.innerHTML = '';
      const add = (label, value, cls) => {
        const row = document.createElement('div');
        row.className = 'status-item' + (cls ? ` ${cls}` : '');
        const l = document.createElement('span');
        l.className = 'status-label';
        l.textContent = label;
        const v = document.createElement('span');
        v.textContent = value;
        row.append(l, v);
        this.el.hud.appendChild(row);
      };
      add('On air', now.clip.name, 'on-air');
      add('In', now.clip.kind === 'image' ? 'Still' : fmtTime(now.segment.inPoint, true));
      add('Cut', `${tr.glyph} ${tr.label}${now.transition ? ' …' : ''}`);
      add('Band', now.segment.band);
      if (now.segment.story) add('Story', ({ hook: 'Hook', result: 'Result / Climax', cta: 'CTA' })[now.segment.story], 'on-air');
      this.el.hud.hidden = false;
    } else {
      this.el.hud.hidden = true;
    }

    let hint = '';
    if (inClips) {
      const st = this.engine.status().state;
      if (st === 'no-clips') hint = 'Drop video clips into the Bin below';
      else if (st === 'unplayable') hint = 'Can’t decode these clips in this browser — open in Chrome or Edge';
      else if (st === 'waiting-bpm' && !this.engine.current) hint = 'Listening for tempo…';
      else if (st === 'idle' && !this.engine.current && !this.engine.scrubbing) hint = 'Press play to start the auto-editor';
    }
    this.el.hint.textContent = hint;
    this.el.hint.hidden = !hint;
  }

  // ---- drawing ---------------------------------------------------------

  draw() {
    const ctx = this.ctx, W = this.W, R = this.ROWS;
    if (!W) return;
    const C = {
      ink: this.color('--ink'), ink3: this.color('--ink-3'), paper: this.color('--paper'),
      surface: this.color('--surface'), steel: this.color('--steel'), steel2: this.color('--steel-2'),
      bass: this.color('--bass'), mid: this.color('--mid'), high: this.color('--high'), live: this.color('--live'),
    };
    // Ink / paper at an alpha, so lines and labels follow the skin (D-69).
    const rgbOf = (c) => { const m = /^#([0-9a-f]{6})$/i.exec(c); return m ? [0, 2, 4].map(i => parseInt(m[1].slice(i, i + 2), 16)).join(',') : '26,26,26'; };
    const inkRGB = rgbOf(C.ink), paperRGB = rgbOf(C.paper);
    C.a = (alpha) => `rgba(${inkRGB},${alpha})`;
    C.pa = (alpha) => `rgba(${paperRGB},${alpha})`;
    C.scope = Scope.palette();
    // Drawers (Omar, 2026-10-08; D-96): every lane below the ruler has the
    // Master lane's dark background in both skins, so lanes are drawn with
    // the dark skin's ink. The ruler keeps the skin's colours.
    const scopeBg = this.color('--scope-bg-1') || '#0B1120', scopeBg2 = this.color('--scope-bg-2') || '#131D33';
    const D = {
      ...C, ink: '#ECE8E1', ink3: '#8F8C86', paper: '#0F1012', surface: scopeBg, steel: scopeBg, steel2: scopeBg2,
      bass: '#FF5C5C', mid: '#3DCB80', high: '#5C8DFF', live: '#FF4A42',
      bassInk: '#0F1012', midInk: '#0F1012', highInk: '#0F1012',
      a: (alpha) => `rgba(236,232,225,${alpha})`, pa: (alpha) => `rgba(15,16,18,${alpha})`, scope: C.scope,
    };
    const { start, span } = this.view;
    const x = (t) => ((t - start) / span) * W;
    const now = this.app.masterTime();
    const yMaster = R.ruler, yClips = R.ruler + R.master, H = this.H;

    ctx.clearRect(0, 0, W, H);

    // Backgrounds
    ctx.fillStyle = C.surface; ctx.fillRect(0, 0, W, R.ruler);
    ctx.fillStyle = D.surface; ctx.fillRect(0, yMaster, W, H - yMaster);

    // Track end region (bounded mode)
    if (this.app.isTrackMode()) {
      const endX = x(this.app.songLength());
      if (endX < W) {
        ctx.fillStyle = 'rgba(0, 0, 0, 0.45)';
        ctx.fillRect(endX, yMaster, W - endX, H - yMaster);
      }
    }

    // Beat / bar grid from the beats the engine actually counted
    const bpb = MusicalTime.beatsPerBar();
    const beats = this.app.tempo.active ? this.app.tempo.beatsIn(start, start + span) : this.engine.beats;   // fixed grid (D-81)
    let pxPerBeat = Infinity;
    if (beats.length > 1) pxPerBeat = (x(beats[beats.length - 1].time) - x(beats[0].time)) / (beats.length - 1);
    for (const b of beats) {
      if (b.time < start || b.time > start + span) continue;
      const bx = Math.round(x(b.time)) + 0.5;
      const isBar = b.index % bpb === 0;
      if (!isBar && pxPerBeat < 6) continue;
      ctx.strokeStyle = isBar ? D.a(0.22) : D.a(0.08);
      ctx.beginPath(); ctx.moveTo(bx, yMaster); ctx.lineTo(bx, H); ctx.stroke();
      if (isBar && pxPerBeat * bpb > 22) {
        ctx.fillStyle = D.ink3;
        ctx.font = '9px "JetBrains Mono", monospace';
        ctx.fillText(String(b.index / bpb + 1), bx + 3, yMaster + 10);
      }
    }

    this.drawRuler(ctx, C, x, W, R);
    this.drawMaster(ctx, D, x, W, yMaster, R.master, now);
    this.drawFadeRamps(ctx, D, x, yMaster, R.master);
    this.drawTrackStart(ctx, x, yMaster, R.master);   // D-99
    this.drawClips(ctx, D, x, W, yClips, R.clips, now);
    if (this.app.voice.isLoaded) this.drawVoice(ctx, D, x, W, yClips + R.clips, R.voice);
    if (this.app.text.items.length) this.drawText(ctx, D, x, W, this.textLaneY(), R.text);

    this.drawSelection(ctx, C, x, H);

    // Row rules
    ctx.fillStyle = C.ink;
    ctx.fillRect(0, R.ruler - 1, W, 1);
    // Playhead: skin ink on the ruler, white over the dark drawers.
    const px = Math.round(x(now)) + 0.5;
    if (px >= 0 && px <= W) {
      ctx.lineWidth = 1.5;
      ctx.strokeStyle = C.ink;
      ctx.beginPath(); ctx.moveTo(px, R.ruler - 6); ctx.lineTo(px, R.ruler); ctx.stroke();
      ctx.strokeStyle = '#ffffff';
      ctx.beginPath(); ctx.moveTo(px, R.ruler); ctx.lineTo(px, H); ctx.stroke();
      ctx.lineWidth = 1;
      const label = fmtTime(now, true);
      ctx.font = '700 10px "JetBrains Mono", monospace';
      const tw = ctx.measureText(label).width + 10;
      const lx = Math.max(0, Math.min(W - tw, px - tw / 2));
      ctx.fillStyle = C.ink; ctx.fillRect(lx, 2, tw, 16);
      ctx.fillStyle = C.paper; ctx.fillText(label, lx + 5, 14);
    }
  }

  drawRuler(ctx, C, x, W, R) {
    const { start, span } = this.view;
    const steps = [0.5, 1, 2, 5, 10, 15, 30, 60, 120, 300];
    const step = steps.find(s => (s / span) * W >= 64) || 600;
    const minor = step / 5;
    ctx.fillStyle = C.ink;
    ctx.font = '10px "JetBrains Mono", monospace';
    for (let t = Math.floor(start / minor) * minor; t <= start + span; t += minor) {
      if (t < 0) continue;
      const tx = Math.round(x(t)) + 0.5;
      const major = Math.abs(t / step - Math.round(t / step)) < 1e-6;
      ctx.fillStyle = major ? C.ink : C.a(0.35);
      ctx.fillRect(tx - 0.5, R.ruler - (major ? 10 : 5), 1, major ? 10 : 5);
      if (major) {
        ctx.fillStyle = C.ink;
        ctx.fillText(fmtTime(t, step < 1), tx + 3, 12);
      }
    }
  }

  // Drawn as an analyser window (D-69): navy screen, gradient waveform
  // (played part brighter), glowing band-energy lines.
  drawMaster(ctx, C, x, W, y, h, now) {
    const mid = y + h / 2, P = C.scope;
    Scope.background(ctx, 0, y, W, h, P);
    ctx.fillStyle = P.grid;
    ctx.fillRect(0, Math.round(mid), W, 1);
    // Track waveform
    if (this.app.isTrackMode() && this.peaks) {
      const nowX = x(now);
      const played = Scope.curveGradient(ctx, 0, W, P);
      const ahead = Scope.fillGradient(ctx, y + 4, y + h - 4, P.fillTop, P.fillTop);
      const n = this.peaks.length / 2;
      const dur = this.peaksDuration || this.app.trackSource.fileDuration || 1;
      const lead = this.leadShown();   // the music starts here (D-99)
      for (let px = 0; px < W; px++) {
        const t0 = this.view.start + (px / W) * this.view.span - lead;
        const t1 = this.view.start + ((px + 1) / W) * this.view.span - lead;
        const i0 = Math.floor((t0 / dur) * n), i1 = Math.max(i0 + 1, Math.floor((t1 / dur) * n));
        if (i0 >= n || i1 <= 0) continue;
        let mn = 0, mx = 0;
        for (let i = Math.max(0, i0); i < Math.min(n, i1); i++) {
          if (this.peaks[i * 2] < mn) mn = this.peaks[i * 2];
          if (this.peaks[i * 2 + 1] > mx) mx = this.peaks[i * 2 + 1];
        }
        ctx.globalAlpha = px <= nowX ? 0.9 : 0.42;
        ctx.fillStyle = px <= nowX ? played : ahead;
        ctx.fillRect(px, mid - mx * (h / 2 - 6), 1, Math.max(1, (mx - mn) * (h / 2 - 6)));
      }
      ctx.globalAlpha = 1;
    }

    // Band energy history (both modes), glowing on the screen
    const bands = [['b', P.bass], ['m', P.mid], ['h', P.high]];
    const { start, span } = this.view;
    ctx.save();
    ctx.shadowBlur = 6;
    for (const [k, col] of bands) {
      ctx.strokeStyle = col;
      ctx.shadowColor = col;
      ctx.lineWidth = 1.4;
      ctx.beginPath();
      let started = false, lastPx = -1;
      for (const e of this.energy) {
        if (e.t < start || e.t > start + span) continue;
        const ex = x(e.t);
        if (ex - lastPx < 1) continue;
        lastPx = ex;
        const ey = y + h - 3 - Math.min(1, e[k] * 1.6) * (h - 10);
        if (!started) { ctx.moveTo(ex, ey); started = true; } else ctx.lineTo(ex, ey);
      }
      ctx.stroke();
    }
    ctx.restore();
    ctx.lineWidth = 1;
  }

  // Compact band strip (D-85): exactly the recorded cut list, one block per
  // cut in its clip's band colour, labelled with the band member tag
  // (B1 / M1 / H1 / A1); a thin second row below for the over stream.
  drawBandStrip(ctx, C, x, W, y, h, now) {
    const { start, span } = this.view;
    const top = y + 4, sh = h - 18, oy = y + h - 11, oh = 7;
    const fill = { bass: C.bass, mid: C.mid, high: C.high, any: '#9AA0AC' };
    const ink = { bass: C.bassInk || this.color('--bass-ink'), mid: C.midInk || this.color('--mid-ink'), high: C.highInk || this.color('--high-ink'), any: '#0F1012' };
    const tags = this.engine.memberTags();
    const current = this.engine.current && this.engine.current.segment;
    // over-stream row
    ctx.fillStyle = C.a(0.06);
    ctx.fillRect(0, oy, W, oh);
    ctx.lineWidth = 0.75;
    ctx.font = '700 9px "JetBrains Mono", monospace';
    ctx.textBaseline = 'middle';
    const drawn = [];
    for (const seg of this.engine.segments) {
      const end = seg.end == null ? now : seg.end;
      if (end <= seg.start || end < start || seg.start > start + span) continue;
      const clip = this.engine.clipById(seg.clipId);
      const over = seg.stream === 'over';
      drawn.push({ seg, end, over });
      const x0 = x(seg.start), x1 = x(end), w = Math.max(1, x1 - x0);
      const by = over ? oy : top, bh = over ? oh : sh;
      const band = clip && ClipEngine.BANDS.includes(clip.band) ? clip.band : 'any';
      ctx.fillStyle = seg.story ? C.ink : fill[band];
      ctx.fillRect(x0, by, w, bh);
      ctx.strokeStyle = C.ink;
      ctx.strokeRect(Math.round(x0) + 0.5, by + 0.5, Math.max(1, Math.round(w) - 1), bh - 1);
      if (!over && w > 16) {
        const label = seg.story ? ({ hook: 'HOOK', result: 'RES', cta: 'CTA' })[seg.story] : (tags.get(seg.clipId) || '');
        if (label && ctx.measureText(label).width + 6 < w) {
          ctx.fillStyle = seg.story ? C.paper : ink[band];
          ctx.fillText(label, x0 + 3, by + bh / 2 + 0.5);
        }
      }
      if (seg === current) {
        ctx.lineWidth = 1;
        ctx.strokeStyle = C.live;
        ctx.strokeRect(Math.round(x0) + 0.5, by - 1.5, Math.max(1, Math.round(w) - 1), bh + 2);
        ctx.lineWidth = 0.75;
      }
    }
    this.stripDrawn = drawn;   // what the strip shows (tests)
    // Story positions still to come (track mode plan).
    if (this.engine.settings.storyMode) {
      ctx.setLineDash([3, 3]);
      ctx.strokeStyle = C.live;
      for (const b of this.engine.storyBlocks()) {
        if (b.start <= now || b.start > start + span) continue;
        ctx.strokeRect(Math.round(x(b.start)) + 0.5, top + 0.5, Math.max(1, x(b.end) - x(b.start) - 1), sh - 1);
      }
      ctx.setLineDash([]);
    }
    ctx.lineWidth = 1;
    ctx.textBaseline = 'alphabetic';
    ctx.font = '600 10px "Inter Tight", sans-serif';
  }

  drawClips(ctx, C, x, W, y, h, now) {
    if (!(this.app.workspace && this.app.workspace.state.clipsExpanded)) { this.drawBandStrip(ctx, C, x, W, y, h, now); return; }
    const { start, span } = this.view;
    const top = y + 7, bh = h - 14;
    const bandCol = { bass: C.bass, mid: C.mid, high: C.high };
    const current = this.engine.current && this.engine.current.segment;

    ctx.font = '600 10px "Inter Tight", sans-serif';
    for (const seg of this.engine.segments) {
      const end = seg.end == null ? now : seg.end;
      if (end < start || seg.start > start + span) continue;
      const x0 = x(seg.start), x1 = x(end);
      const w = Math.max(1, x1 - x0);
      const isCur = seg === current;
      const clip = this.engine.clipById(seg.clipId);

      if (seg.stream === 'over') { ctx.fillStyle = C.live; ctx.fillRect(x0, y + 1, w, 4); continue; }   // over stream (D-88)
      if (seg.story) { this.drawStoryBlock(ctx, C, seg.story, x0, x1, top, bh, isCur); continue; }

      ctx.fillStyle = isCur ? C.ink : C.paper;
      ctx.fillRect(x0, top, w, bh);

      // Thumbnail tile
      let textX = x0 + 5;
      if (clip && clip.thumb && w > 30) {
        const th = bh - 8, tw = Math.min(w - 8, th * 16 / 9);
        ctx.save();
        ctx.beginPath(); ctx.rect(x0 + 4, top + 5, tw, th); ctx.clip();
        ctx.drawImage(clip.thumb, x0 + 4, top + 5, th * 16 / 9, th);
        ctx.restore();
        textX = x0 + 8 + tw;
      }
      if (clip && x1 - textX > 26) {
        ctx.save();
        ctx.beginPath(); ctx.rect(textX, top, x1 - textX - 3, bh); ctx.clip();
        ctx.fillStyle = isCur ? C.paper : C.ink;
        ctx.fillText(clip.name, textX, top + 14);
        ctx.font = '9px "JetBrains Mono", monospace';
        ctx.fillStyle = isCur ? C.pa(0.7) : C.ink3;
        ctx.fillText(`${ClipTransitions.get(seg.transition).label} · in ${seg.inPoint.toFixed(1)}s`, textX, top + 27);
        ctx.font = '600 10px "Inter Tight", sans-serif';
        ctx.restore();
      }

      // Band stripe along the bottom
      ctx.fillStyle = bandCol[seg.band] || C.ink;
      ctx.fillRect(x0, top + bh - 3, w, 3);

      ctx.strokeStyle = C.ink;
      ctx.strokeRect(Math.round(x0) + 0.5, top + 0.5, Math.max(1, Math.round(w) - 1), bh - 1);

      this.drawTransitionMark(ctx, C, seg, x0, x(seg.start + (seg.blendSec || 0)), top, bh);
    }

    // Story Mode: outlines of blocks still to come (track mode plan).
    if (this.engine.settings.storyMode) {
      for (const b of this.engine.storyBlocks()) {
        if (b.start <= now || b.start > start + span) continue;
        ctx.save();
        ctx.setLineDash([4, 3]);
        ctx.strokeStyle = C.live;
        ctx.strokeRect(Math.round(x(b.start)) + 0.5, top + 0.5, Math.max(1, x(b.end) - x(b.start) - 1), bh - 1);
        ctx.restore();
        ctx.fillStyle = C.live;
        ctx.font = '700 9px "JetBrains Mono", monospace';
        ctx.fillText(({ hook: 'HOOK', result: 'RESULT', cta: 'CTA' })[b.role], x(b.start) + 5, top + 13);
        ctx.font = '600 10px "Inter Tight", sans-serif';
      }
    }

    // Upcoming cut points (ghost markers), from the live beat clock. The
    // next one is exact; later ones assume the global interval, since the
    // clips (and their paces) haven't been picked yet.
    const st = this.engine.status();
    if (st.state === 'running' && st.position >= 0 && st.bpm > 0 && st.nextCutPos != null) {
      const beatSec = 60 / st.bpm;
      ctx.setLineDash([3, 3]);
      ctx.strokeStyle = C.a(0.45);
      for (let k = 0; k < 24; k++) {
        const t = now + (st.nextCutPos + k * st.globalBeats - st.position) * beatSec;
        if (t > start + span) break;
        if (this.app.isTrackMode() && t > this.app.songLength()) break;
        const gx = Math.round(x(t)) + 0.5;
        ctx.beginPath(); ctx.moveTo(gx, top); ctx.lineTo(gx, top + bh); ctx.stroke();
      }
      ctx.setLineDash([]);
    }
  }

  // Fixed story block on the clip lane: solid, labelled, live-red edge.
  drawStoryBlock(ctx, C, role, x0, x1, top, bh, isCur) {
    const w = Math.max(1, x1 - x0);
    ctx.fillStyle = C.ink;
    ctx.fillRect(x0, top, w, bh);
    ctx.fillStyle = C.live;
    ctx.fillRect(x0, top, Math.min(4, w), bh);
    if (w > 30) {
      ctx.save();
      ctx.beginPath(); ctx.rect(x0, top, w - 2, bh); ctx.clip();
      ctx.fillStyle = C.paper;
      ctx.font = '700 10px "JetBrains Mono", monospace';
      ctx.fillText(({ hook: 'HOOK', result: 'RESULT / CLIMAX', cta: 'CTA' })[role], x0 + 9, top + 14);
      ctx.font = '9px "JetBrains Mono", monospace';
      ctx.fillStyle = C.pa(0.7);
      ctx.fillText(isCur ? 'story · on air' : 'story · once', x0 + 9, top + 27);
      ctx.restore();
    }
    ctx.strokeStyle = C.ink;
    ctx.strokeRect(Math.round(x0) + 0.5, top + 0.5, Math.max(1, Math.round(w) - 1), bh - 1);
    ctx.font = '600 10px "Inter Tight", sans-serif';
  }

  textLaneY() {
    const R = this.ROWS;
    return R.ruler + R.master + R.clips + (this.app.voice.isLoaded ? R.voice : 0);
  }

  // Text lane (D-60): each title / credits / text block on the master timeline.
  drawText(ctx, C, x, W, y, h) {
    ctx.fillStyle = C.surface;
    ctx.fillRect(0, y, W, h);
    ctx.fillStyle = C.a(0.16);
    ctx.fillRect(0, y, W, 1);
    this.textHits = [];
    for (const it of this.app.text.items) {
      const win = this.app.text.windowOf(it);
      if (!win) continue;
      const x0 = x(win[0]), x1 = x(win[1]);
      if (x1 < 0 || x0 > W) continue;
      const sel = it.id === this.app.text.selectedId;
      ctx.fillStyle = sel ? C.ink : C.paper;
      ctx.fillRect(x0, y + 5, Math.max(2, x1 - x0), h - 10);
      ctx.strokeStyle = C.ink;
      ctx.strokeRect(Math.round(x0) + 0.5, y + 5.5, Math.max(1, Math.round(x1 - x0) - 1), h - 11);
      if (x1 - x0 > 24) {
        ctx.save();
        ctx.beginPath(); ctx.rect(x0, y, x1 - x0 - 3, h); ctx.clip();
        ctx.fillStyle = sel ? C.paper : C.ink;
        ctx.font = '700 9px "JetBrains Mono", monospace';
        const kind = it.kind === 'title' ? 'T' : it.kind === 'credits' ? 'CR' : 'Aa';
        const label = (String(it.content).split('\n').find(l => l.trim()) || '').replace(/^#\s*/, '');
        ctx.fillText(`${kind}  ${label}`, x0 + 6, y + h / 2 + 3);
        ctx.restore();
      }
      this.textHits.push({ id: it.id, x0, x1, y0: y, y1: y + h, start: win[0] });
    }
  }

  // Voice lane: the take's waveform at its offset on the master timeline.
  drawVoice(ctx, C, x, W, y, h) {
    const v = this.app.voice, P = C.scope;
    Scope.background(ctx, 0, y, W, h, P);
    ctx.fillStyle = C.a(0.16);
    ctx.fillRect(0, y, W, 1);
    const x0 = x(v.offset), x1 = x(v.offset + v.duration);
    if (x1 < 0 || x0 > W) return;
    ctx.fillStyle = P.grid;
    ctx.fillRect(Math.max(0, x0), y + 4, Math.min(W, x1) - Math.max(0, x0), h - 8);
    const n = v.peaks.length / 2, mid = y + h / 2, amp = h / 2 - 6;
    ctx.fillStyle = Scope.curveGradient(ctx, x0, x1, P);
    for (let px = Math.max(0, Math.floor(x0)); px < Math.min(W, x1); px++) {
      const i = Math.floor(((px - x0) / (x1 - x0)) * n);
      const mn = v.peaks[i * 2] || 0, mx = v.peaks[i * 2 + 1] || 0;
      ctx.fillRect(px, mid - mx * amp, 1, Math.max(1, (mx - mn) * amp));
    }
    ctx.strokeStyle = P.axis;
    ctx.strokeRect(Math.round(x0) + 0.5, y + 4.5, Math.max(1, Math.round(x1 - x0) - 1), h - 9);
  }

  // Jump = solid bar; crossfade = X over the blend; blur = hatched blend.
  drawTransitionMark(ctx, C, seg, x0, xb, top, bh) {
    const blendW = Math.max(0, xb - x0);
    ctx.save();
    ctx.strokeStyle = C.live;
    ctx.fillStyle = C.live;
    if (seg.transition === 'jump' || blendW < 3) {
      ctx.fillRect(x0 - 1, top - 4, 3, bh + 4);
    } else if (seg.transition === 'crossfade') {
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(x0, top + bh); ctx.lineTo(xb, top);
      ctx.moveTo(x0, top); ctx.lineTo(xb, top + bh);
      ctx.stroke();
    } else {
      ctx.beginPath(); ctx.rect(x0, top, blendW, bh); ctx.clip();
      ctx.lineWidth = 1;
      for (let i = -bh; i < blendW; i += 4) {
        ctx.beginPath(); ctx.moveTo(x0 + i, top + bh); ctx.lineTo(x0 + i + bh, top); ctx.stroke();
      }
    }
    ctx.restore();
  }
}

function fmtTime(t, tenths) {
  if (!isFinite(t) || t < 0) t = 0;
  const m = Math.floor(t / 60);
  const s = t - m * 60;
  const ss = tenths ? s.toFixed(1).padStart(4, '0') : String(Math.floor(s)).padStart(2, '0');
  return `${String(m).padStart(2, '0')}:${ss}`;
}

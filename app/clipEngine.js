// Video clip auto-editor.
//
// Advances through a set of uploaded video clips in sync with the music,
// recording each switch as a segment on a clip timeline laid against the
// master (track / live-session) timeline.
//
// Timing source: this does NOT detect beats itself. It reads the beat clock
// DJVisualizer already maintains from audioData.bpm (lastBeatTime /
// bpmInterval, the same clock behind beatFlash/beatPulse). Each time that
// clock ticks we advance one beat; sub-beat position is interpolated from
// bpmInterval. Switch intervals are expressed in beats (see musicalTime.js).
class ClipEngine {
  constructor(visualizer) {
    this.viz = visualizer;
    this.assets = [];        // every imported image/video: one typed list (v2.1, D-44)
    this.nextClipId = 1;
    this.selectedId = null;  // selection shared by 03 Assets and the Action Editor

    this.settings = {
      timingMode: 'auto',      // 'auto' | 'manual'
      autoPace: 'driving',     // key of MusicalTime.AUTO_PACES
      manualCount: 2,
      manualUnit: 'beat',      // key of MusicalTime.UNITS
      order: 'sequential',     // 'sequential' | 'random' | 'band'
      transitionMode: 'band',  // 'band' (auto by band) | a ClipTransitions id
      inPoint: 'random',       // 'random' | 'resume' | 'start'
      overlayLayers: false,    // draw Media Layers (bass/mid/high) over clips
      storyMode: true,         // D-58: positions (Hook / Result / CTA) are always available; with none set this is Free Mode
      storyFade: false,        // Auto Fade Music to Story Blocks
    };
    // Used when transitionMode === 'band': which band triggered the switch
    // picks the transition.
    this.bandTransitions = { bass: 'jump', mid: 'crossfade', high: 'blur' };

    // Master timeline hooks, supplied by the app.
    this.clock = () => 0;            // seconds on the master timeline
    this.isAdvancing = () => false;  // true while the timeline is rolling
    this.songDuration = () => 0;     // track length in track mode, 0 in live mode
    // Fixed tempo grid (D-81): when active, beats and cuts follow it from
    // 0:00 instead of the live beat clock. Supplied by the app (TempoGrid).
    this.grid = null;
    // Dry run (fast pass, D-80): schedule only, never touch the media.
    this.dry = false;

    this.listeners = new Set();
    this.bandAvg = { bass: 0.05, mid: 0.05, high: 0.05 };
    this.bandRatio = { bass: 1, mid: 1, high: 1 };
    this.dominant = 'bass';
    this.reset();
  }

  // ---- lifecycle -------------------------------------------------------

  reset() {
    this.pauseAll();
    this.segments = [];     // { clipId, start, end, inPoint, transition, band, beat }
    this.beats = [];        // { time, index } -- beat grid as the engine saw it
    this.beatIndex = -1;
    this.lastSeenBeatTime = null;
    this.nextCutPos = null;  // beat position of the next scheduled cut
    this.segStartPos = null; // beat position the current shot started on
    this.holdBeats = null;   // current shot's hold length (beats)
    this.current = null;    // { clip, segment }
    this.outgoing = null;
    this.pending = null;    // pre-rolled next clip { clip, inPoint }
    this.transition = null; // { def, startMs, lengthMs }
    this.story = null;      // story block on screen, if any
    this.over = null;       // over-stream cut on screen, if any (D-88)
    // Session record (D-56): segments/beats are kept across seeks. Each
    // play-through after a seek is a "pass" that overwrites only the span
    // it actually plays, like punching in on a DAW track.
    this.pass = 0;
    this.passStart = 0;
    this.lastAdvanceTime = 0;
    this.fired = [];        // live mode: story roles fired this session { role, at }
    this.emit('reset');
  }

  on(fn) { this.listeners.add(fn); return () => this.listeners.delete(fn); }
  emit(type, detail) { this.listeners.forEach(fn => fn(type, detail)); }

  // ---- assets ----------------------------------------------------------
  //
  // One entry per imported file. Defaults reproduce v2: a new asset is an
  // auto-edit clip at the bottom of the stack, Global pace, any band, no
  // Media Layer, no story role.

  // Assets used as auto-edit clips, in stack (Importance) order.
  // Cards in the Action Editor: whole clips (a clip with sections keeps
  // its one card; its sections show as a strip inside it, Omar 2026-10-08).
  get clips() {
    return this.assets.filter(a => a.asClip && !a.parent).sort((a, b) => a.importance - b.importance);
  }

  // ---- clip model (v2.4 step 2, D-82) -------------------------------------
  //
  //   used     { start, end }  the part of the source the auto-editor may use
  //            (end null = to the end). In-points are picked inside it; a
  //            locked clip plays exactly this part (capped, D-78).
  //   speed    0.25–4 (1 = as recorded). On-screen length = used / speed;
  //            the clip's own sound is resampled (pitch follows speed).
  //   sections bar markers on a video (source seconds). Each section is a
  //            child clip ("A · 2/4") with its own Pace, Importance, band,
  //            speed and lock, sharing the parent's video (no copy).
  //   pace 'fit' + fitBars: set by Fit to bars — holds exactly N bars and
  //            plays its used part once from the start.
  // Defaults reproduce the alpha: whole clip, 1×, no sections.
  static clipDefaults() { return { used: { start: 0, end: null }, speed: 1, sections: [], fitBars: null, visual: VisualLayer.defaults(), repeats: 0 }; }

  // Repeats (Omar, 2026-10-08; D-93): how many times a clip may appear on
  // the timeline (0 = no limit). A cut = one appearance; cuts the fast pass
  // filled ahead of the playhead don't count (playing replaces them).
  usesOf(clip) {
    const t = this.clock();
    let n = 0;
    for (const s of this.segments) if (s.clipId === clip.id && !s.story && !(s.fast && s.start >= t - 1e-6)) n++;
    return n;
  }
  spent(c) { return c.repeats > 0 && this.usesOf(c) >= c.repeats; }
  // Every cut of it on the timeline (played and filled), for the readouts.
  cutsOf(clip) { return this.segments.filter(s => s.clipId === clip.id && !s.story).length; }
  setRepeats(id, n) {
    const a = this.clipById(id);
    if (!a) return;
    a.repeats = Math.max(0, Math.round(+n || 0));
    this.emit('clips');
  }

  // Per-clip visual mode (D-90): recorded on each cut so the export draws
  // what was seen.
  static visualOf(clip) {
    const v = clip && clip.visual;
    return v && v.mode && v.mode !== 'none' ? { ...v } : undefined;
  }
  setVisual(id, patch) {
    const a = this.clipById(id);
    if (!a) return;
    a.visual = { ...VisualLayer.defaults(), ...(a.visual || {}), ...patch };
    // the cut on air shows the change at once
    if (this.current && this.current.clip === a) this.current.segment.visual = ClipEngine.visualOf(a);
    this.emit('clips');
  }
  static SPEEDS = [0.25, 0.5, 0.75, 1, 1.5, 2, 4];

  // Band members (v2.4, D-85/D-86): each stack clip's tag — B1, B2 … M1 …
  // H1 … A1 (Any) — ranked within its band by stack position.
  static BANDS = ['bass', 'mid', 'high', 'any'];
  static BAND_LETTER = { bass: 'B', mid: 'M', high: 'H', any: 'A' };
  bandMembers() {
    const out = { bass: [], mid: [], high: [], any: [] };
    this.pickList().forEach(c => (out[c.band] || out.any).push(c));   // sections count on their own
    return out;
  }
  memberTags() {
    const tags = new Map();
    const m = this.bandMembers();
    Object.entries(m).forEach(([b, list]) => list.forEach((c, i) => tags.set(c.id, `${ClipEngine.BAND_LETTER[b]}${i + 1}`)));
    return tags;
  }

  // Assets that own a file (sections read their parent's).
  get mediaAssets() { return this.assets.filter(a => !a.parent); }

  isSplit(a) { return !a.parent && a.kind === 'video' && Array.isArray(a.sections) && a.sections.length > 0; }
  parentOf(a) { return a && a.parent ? this.clipById(a.parent) : null; }
  sectionsOf(a) { return this.assets.filter(c => c.parent === a.id).sort((x, y) => x.section - y.section); }

  // Source length (the file's), and the used part of it.
  sourceLength(a) {
    const p = this.parentOf(a) || a;
    return p.duration || (p.el && isFinite(p.el.duration) ? p.el.duration : 0);
  }
  usedRange(a) {
    const dur = this.sourceLength(a);
    const u = a.used || { start: 0, end: null };
    let start = Math.max(0, u.start || 0), end = u.end == null ? dur : u.end;
    if (dur > 0) { end = Math.min(end, dur); start = Math.min(start, Math.max(0, end - 0.05)); }
    return { start, end: Math.max(start, end) };
  }
  usedLength(a) { const r = this.usedRange(a); return r.end - r.start; }
  speedOf(a) { return a && a.kind === 'video' ? Math.max(0.25, Math.min(4, a.speed || 1)) : 1; }
  screenLength(a) { return this.usedLength(a) / this.speedOf(a); }

  setUsed(id, start, end) {
    const a = this.clipById(id);
    if (!a || a.kind !== 'video') return;
    const lim = a.parent ? this.sectionBounds(a) : { start: 0, end: this.sourceLength(a) || Infinity };
    const s = Math.max(lim.start, Math.min(start, lim.end - 0.1));
    const e = end == null ? null : Math.max(s + 0.1, Math.min(end, lim.end));
    a.used = { start: +s.toFixed(3), end: e == null || (!a.parent && e >= lim.end - 0.001) ? (a.parent ? lim.end : null) : +e.toFixed(3) };
    this.emit('clips');
  }

  setSpeed(id, v) {
    const a = this.clipById(id);
    if (!a || a.kind !== 'video') return;
    a.speed = Math.max(0.25, Math.min(4, Math.round((parseFloat(v) || 1) * 1000) / 1000));
    if (a.pace === 'fit') { a.pace = 'global'; a.fitBars = null; }
    this.emit('clips');
  }

  // Fit to bars: speed = used / (bars × bar length), bars a whole number
  // ≥ 1 (nearest to the clip's length at 1× when not given), speed kept
  // within 0.25–4. The clip then holds exactly those bars.
  fitToBars(id, barSec, bars = null) {
    const a = this.clipById(id);
    if (!a || a.kind !== 'video' || !(barSec > 0)) return null;
    const used = this.usedLength(a);
    let n = Math.max(1, Math.round(bars != null ? bars : used / barSec));
    let speed = used / (n * barSec);
    if (speed > 4) { n = Math.ceil(used / (4 * barSec)); speed = used / (n * barSec); }
    if (speed < 0.25) { n = Math.max(1, Math.floor(used / (0.25 * barSec))); speed = used / (n * barSec); }
    a.speed = Math.max(0.25, Math.min(4, speed));
    a.pace = 'fit';
    a.fitBars = n;
    this.emit('clips');
    return { bars: n, speed: a.speed };
  }

  // Sections: boundaries in source seconds (sorted, inside the clip). The
  // children are rebuilt to match, keeping their settings by position.
  sectionBounds(child) {
    const p = this.parentOf(child);
    if (!p) return { start: 0, end: this.sourceLength(child) };
    const pts = [0, ...p.sections, this.sourceLength(p)];
    return { start: pts[child.section], end: pts[child.section + 1] };
  }

  setSections(id, times) {
    const p = this.clipById(id);
    if (!p || p.parent || p.kind !== 'video') return;
    const dur = this.sourceLength(p);
    const pts = Array.from(new Set(times.map(t => +(+t).toFixed(3)))).filter(t => t > 0.05 && (!dur || t < dur - 0.05)).sort((x, y) => x - y);
    const old = this.sectionsOf(p);
    p.sections = pts;
    const n = pts.length ? pts.length + 1 : 0;
    // Remove extra children; add missing ones (next to the parent in the stack).
    old.slice(n).forEach(c => this.removeAsset(c.id, { silent: true }));
    for (let k = 0; k < n; k++) {
      let c = old[k];
      // New sections take the parent's place in the stack, in order.
      if (!c) c = this.addSection(p, k, { importance: (p.importance || this.clips.length + 1) - 1 + (k + 1) / (n + 1) });
      c.section = k;
      c.of = n;
      const b = this.sectionBounds(c);
      c.used = { start: b.start, end: b.end };
      c.name = `${p.name} · ${k + 1}/${n}`;
    }
    if (!n && p.asClip) p.importance = p.importance || this.clips.length + 1;
    this.renumber();
    this.emit('clips');
  }

  // Two decks per video file at most, like a DJ's A / B (Omar, 2026-10-08):
  // deck A is the clip's own player; deck B is made only when a blend needs
  // two parts of the same video on screen at once (two sections of it).
  sectionPlayer(c) {
    const pp = this.clipById(c.parent);
    if (!pp) return null;
    if (c._deck === 'B') return this.deckB(pp) || pp;
    return pp;
  }

  deckB(pp) {
    const p = this.viz.p5Instance;
    if (!pp.url || !pp.ready || !p) return null;
    if (pp._deckB && pp._deckB.url === pp.url) return pp._deckB;
    this.dropDeckB(pp);
    const media = p.createVideo([pp.url]);
    media.hide();
    media.volume(0);
    media.elt.muted = true;
    media.elt.loop = true;
    media.elt.playsInline = true;
    media.elt.preload = 'auto';
    pp._deckB = { url: pp.url, media, el: media.elt, bridge: pp.rotation ? VideoOrientation.bridge(p, media) : null };
    return pp._deckB;
  }

  dropDeckB(pp) {
    const pl = pp && pp._deckB;
    if (!pl) return;
    if (pl.bridge) pl.bridge.remove();
    try { pl.el.pause(); } catch (e) { /* gone */ }
    pl.media.remove();
    pp._deckB = null;
  }

  // A section about to go on air takes the other deck when the cut on
  // screen is another part of the same video.
  pickDeck(clip) {
    if (!clip || !clip.parent) return;
    const on = this.current && this.current.clip;
    const same = on && on !== clip && (on.parent === clip.parent || on.id === clip.parent);
    clip._deck = same && on._deck !== 'B' ? 'B' : 'A';
  }

  dropSectionPlayer() { /* sections have no player of their own any more */ }

  // A section clip: its own settings; media, file and size come from the
  // parent (read through, never copied).
  addSection(p, k, saved = {}) {
    if (saved.id) this.nextClipId = Math.max(this.nextClipId, saved.id + 1);
    const c = {
      id: saved.id || this.nextClipId++, parent: p.id, section: k, of: saved.of || 1, kind: 'video',
      name: saved.name || `${p.name} · ${k + 1}`, lastPos: 0,
      asClip: saved.asClip !== false, layer: null, band: saved.band || p.band || 'any', pace: saved.pace || 'global',
      importance: saved.importance != null ? saved.importance : this.clips.length + 1,
      story: saved.story || 'none', storyHold: 3, fade: { on: false, curve: 'smooth', bars: 1, ...(saved.fade || {}) },
      used: saved.used ? { ...saved.used } : { start: 0, end: null }, speed: saved.speed || 1, sections: [], fitBars: saved.fitBars || null,
      visual: { ...VisualLayer.defaults(), ...(saved.visual || {}) },
      repeats: saved.repeats || 0,
      ownThumb: null,
    };
    const engine = this;
    ['file', 'url', 'duration', 'width', 'height', 'rotation', 'ready', 'error', 'offline', 'ref', 'path', 'origin'].forEach(k2 => {
      Object.defineProperty(c, k2, { enumerable: true, configurable: true, get() { const pp = engine.clipById(c.parent); return pp ? pp[k2] : (k2 === 'offline' ? true : null); }, set() { /* the parent's */ } });
    });
    // Live, each section has its own player on the parent's file (no copy
    // of the media), so a blend between two sections of one video shows
    // both pictures and follows the band transitions (Omar, 2026-10-08).
    ['media', 'el', 'bridge'].forEach(k2 => {
      Object.defineProperty(c, k2, { enumerable: true, configurable: true, get() { const own = engine.sectionPlayer(c); return own ? own[k2] : null; }, set() { /* own player */ } });
    });
    Object.defineProperty(c, 'thumb', { enumerable: true, configurable: true, get() { const pp = engine.clipById(c.parent); return c.ownThumb || (pp ? pp.thumb : null); }, set(v) { c.ownThumb = v; } });
    this.assets.push(c);
    return c;
  }

  // Video or image by MIME type, or by extension when the system reports
  // none (common on Windows for some video files). null = not usable.
  static kindOf(f) {
    if (f.type.startsWith('video/')) return 'video';
    if (f.type.startsWith('image/')) return 'image';
    if (/.(mp4|m4v|mov|webm|mkv|ogv|3gp|avi)$/i.test(f.name)) return 'video';
    if (/.(png|jpe?g|gif|webp|bmp|avif)$/i.test(f.name)) return 'image';
    return null;
  }

  // Returns { added, rejected } so callers can say what happened instead
  // of silently skipping files.
  addFiles(fileList) {
    const added = [], rejected = [];
    Array.from(fileList || []).forEach(f => {
      const kind = ClipEngine.kindOf(f);
      const a = kind ? this.addAsset(f, kind) : null;
      if (a) added.push(a); else rejected.push(f.name);
    });
    this.emit('added', { added, rejected });
    return { added, rejected };
  }

  addAsset(file, kind = ClipEngine.kindOf(file) || 'video', opts = {}) {
    const p = this.viz.p5Instance;
    if (!p) return;
    if (opts.id) this.nextClipId = Math.max(this.nextClipId, opts.id + 1);
    const asset = {
      id: opts.id || this.nextClipId++, name: file.name.replace(/\.[^.]+$/, ''), file,
      url: URL.createObjectURL(file), kind,
      media: null, el: null, duration: 0, width: 0, height: 0, thumb: null,
      lastPos: 0, ready: false, error: null, rotation: 0,
      asClip: true,              // "Use as: Auto-edit clip"
      layer: null,               // "Use as: Media Layer" slot -> visualizer.layers
      band: 'any',
      pace: 'global',            // 'global' or a MusicalTime.AUTO_PACES key -- how long this clip holds
      importance: this.clips.length + 1,   // = position in the Action Editor stack
      story: 'none',             // 'none' | 'hook' | 'result' | 'cta' (Story Mode only)
      storyHold: 3,              // seconds an image story block holds (Q9)
      fade: { on: false, curve: 'smooth', bars: 1 },   // Auto Fade Music around this locked clip (D-59)
      ...ClipEngine.clipDefaults(),
      // Images (D-88): new ones play OVER the video (own placement);
      // 'full' = full frame, as in the alpha.
      show: kind === 'image' ? 'over' : 'full',
      placement: kind === 'image' ? Placement.defaults({ size: 60, z: 10 }) : null,
    };
    this.assets.push(asset);
    if (kind === 'image') this.loadImageAsset(asset);
    else this.loadVideoAsset(asset);
    this.emit('clips');
    return asset;
  }

  loadImageAsset(asset) {
    this.viz.p5Instance.loadImage(asset.url, (img) => {
      asset.media = img;
      asset.width = img.width;
      asset.height = img.height;
      asset.ready = true;
      const c = document.createElement('canvas');
      c.width = 160;
      c.height = Math.max(1, Math.round(160 * img.height / (img.width || 1)));
      c.getContext('2d').drawImage(img.canvas, 0, 0, c.width, c.height);
      asset.thumb = c;
      this.emit('clips');
    }, () => {
      asset.error = 'Can’t decode this file in this browser';
      this.emit('clips');
    });
  }

  loadVideoAsset(clip) {
    const p = this.viz.p5Instance;
    const url = clip.url;
    const media = p.createVideo([url], () => {
      // Some files (e.g. MediaRecorder WebM) report Infinity until probed;
      // makeThumb() resolves the real duration in that case.
      if (isFinite(media.elt.duration)) clip.duration = media.elt.duration;
      clip.ready = true;
      this.emit('clips');
    });
    // Unsupported codec/container (e.g. H.264 MP4 in VS Code's Simple
    // Browser, which ships without proprietary codecs) never fires the
    // ready callback -- flag it so the bin can say so instead of the clip
    // silently never appearing.
    media.elt.addEventListener('error', () => {
      clip.error = 'Can’t decode this file in this browser';
      clip.ready = false;
      this.emit('clips');
    });
    media.hide();
    media.volume(0);
    media.elt.muted = true;
    media.elt.loop = true;
    media.elt.playsInline = true;
    media.elt.addEventListener('loadedmetadata', () => {
      clip.width = media.elt.videoWidth;
      clip.height = media.elt.videoHeight;
    }, { once: true });
    clip.media = media;
    // Rotated phone video: draw through a 2D copy (D-54).
    clip.rotation = 0;
    VideoOrientation.detect(clip.file).then((rot) => {
      clip.rotation = rot;
      if (rot) clip.bridge = VideoOrientation.bridge(p, media);
      this.emit('clips');
    });
    clip.el = media.elt;
    this.makeThumb(clip);
  }

  // Poster frame (and, if needed, the real duration) from a separate
  // <video> so it never disturbs playback.
  makeThumb(clip) {
    const v = document.createElement('video');
    v.muted = true;
    v.preload = 'auto';
    v.src = clip.url;
    const seekToPoster = () => {
      if (isFinite(v.duration)) clip.duration = v.duration;
      v.addEventListener('seeked', capture, { once: true });
      v.currentTime = Math.min(1, (clip.duration || 0) * 0.15);
    };
    v.addEventListener('loadeddata', () => {
      if (isFinite(v.duration)) { seekToPoster(); return; }
      // Duration unknown: seeking far past the end makes the browser
      // scan the file and report the real duration.
      v.addEventListener('seeked', seekToPoster, { once: true });
      v.currentTime = 1e101;
    }, { once: true });
    const capture = () => {
      const c = document.createElement('canvas');
      c.width = 160;
      c.height = Math.round(160 * (v.videoHeight || 9) / (v.videoWidth || 16));
      c.getContext('2d').drawImage(v, 0, 0, c.width, c.height);
      clip.thumb = c;
      v.removeAttribute('src');
      this.emit('clips');
    };
  }

  // ---- project restore (D-57) -------------------------------------------

  // An asset from a saved project whose file isn't connected yet. It keeps
  // its id (the recorded cut list refers to it), its settings and its saved
  // thumbnail, shows as "Offline" and is skipped by the automation.
  addOfflineAsset(saved, thumb) {
    this.nextClipId = Math.max(this.nextClipId, saved.id + 1);
    const asset = {
      id: saved.id, name: saved.name, file: null, url: null, kind: saved.kind,
      media: null, el: null, duration: saved.duration || 0, width: saved.width || 0, height: saved.height || 0,
      thumb: thumb || null, lastPos: 0, ready: false, error: null, offline: true, ref: saved.ref,
      asClip: saved.asClip, layer: saved.layer, band: saved.band, pace: saved.pace,
      importance: saved.importance, story: saved.story, storyHold: saved.storyHold, rotation: saved.rotation || 0,
      fade: { on: false, curve: 'smooth', bars: 1, ...(saved.fade || {}) },
      path: saved.path || null, origin: saved.origin || null,   // where it lives / came from (D-74)
      ...ClipEngine.clipDefaults(),
      used: saved.used ? { ...saved.used } : { start: 0, end: null }, speed: saved.speed || 1,
      sections: Array.isArray(saved.sections) ? saved.sections.slice() : [], fitBars: saved.fitBars || null,
      show: saved.show || 'full',   // alpha images open as Full frame (D-88)
      visual: { ...VisualLayer.defaults(), ...(saved.visual || {}) },
      repeats: saved.repeats || 0,
      placement: saved.placement ? JSON.parse(JSON.stringify(saved.placement)) : (saved.kind === 'image' ? Placement.defaults({ size: 60, z: 10 }) : null),
    };
    this.assets.push(asset);
    this.emit('clips');
    return asset;
  }

  // Connect a file to an offline asset: load its media in place.
  relinkAsset(id, file) {
    const a = this.clipById(id);
    if (!a || !a.offline) return false;
    a.file = file;
    a.url = URL.createObjectURL(file);
    a.offline = false;
    a.ready = false;
    if (a.kind === 'image') this.loadImageAsset(a); else this.loadVideoAsset(a);
    if (a.layer) this.viz.loadLayerMedia(a.layer, file);
    this.emit('clips');
    return true;
  }

  removeAsset(id, { silent = false } = {}) {
    const clip = this.clipById(id);
    if (!clip) return;
    if (!clip.parent) this.sectionsOf(clip).forEach(c => this.removeAsset(c.id, { silent: true }));
    if (this.current && this.current.clip === clip) this.current = null;
    if (this.outgoing && this.outgoing.clip === clip) { this.outgoing = null; this.transition = null; }
    if (this.pending && this.pending.clip === clip) this.pending = null;
    if (clip.parent) this.dropSectionPlayer(clip);
    if (!clip.parent) {
      this.dropDeckB(clip);
      if (clip.layer && !clip.offline) this.viz.clearLayerMedia(clip.layer);
      if (clip.bridge) clip.bridge.remove();
      if (clip.kind === 'video' && clip.media) clip.media.remove();
      if (clip.url) URL.revokeObjectURL(clip.url);
    }
    this.assets = this.assets.filter(c => c !== clip);
    if (this.selectedId === id) this.selectedId = null;
    if (silent) return;
    this.renumber();
    this.emit('clips');
  }

  setClipBand(id, band) {
    const clip = this.clipById(id);
    if (clip) { clip.band = band; this.emit('clips'); }
  }

  setClipPace(id, pace) {
    const clip = this.clipById(id);
    if (clip) { clip.pace = pace; this.emit('clips'); }
  }

  // "Use as: Auto-edit clip". Re-enabling puts the clip at the bottom of
  // the stack, like a new upload.
  setAssetAsClip(id, on) {
    const a = this.clipById(id);
    if (!a || a.asClip === on) return;
    a.asClip = on;
    if (on) a.importance = Infinity;
    this.renumber();
    this.emit('clips');
  }

  // Importance = position in the Action Editor stack (1 = top, D-32).
  // Moving a clip renumbers the whole stack so positions stay 1..N.
  moveClip(id, toIndex) {
    const stack = this.stack;
    const from = stack.findIndex(c => c.id === id);
    if (from < 0) return;
    const [clip] = stack.splice(from, 1);
    stack.splice(Math.max(0, Math.min(stack.length, toIndex)), 0, clip);
    stack.forEach((c, i) => { c.importance = i + 1; });
    this.renumber();
    this.emit('clips');
  }

  setClipImportance(id, n) { this.moveClip(id, Math.round(n) - 1); }

  // Stack clips are 1..N. Story assets (Story Mode) have no Importance;
  // they sit after the stack and rejoin it at the bottom in Free Mode.
  renumber() {
    const stack = this.stack;
    stack.forEach((c, i) => { c.importance = i + 1; });
    this.clips.filter(c => !stack.includes(c)).forEach((c, i) => { c.importance = stack.length + i + 1; });
  }

  // "Use as: Media Layer". Drives the existing layer engine
  // (DJVisualizer.loadLayerMedia / clearLayerMedia) unchanged, so layers
  // look and react exactly as before. One asset per slot: taking a slot
  // that's in use releases it from the other asset.
  setAssetLayer(id, slot) {
    const a = this.clipById(id);
    if (!a || a.layer === slot) return;
    if (a.layer) { this.viz.clearLayerMedia(a.layer); a.layer = null; }
    if (slot) {
      const holder = this.assets.find(x => x.layer === slot);
      if (holder) holder.layer = null;
      this.viz.loadLayerMedia(slot, a.file);
      a.layer = slot;
    }
    this.emit('clips');
  }

  select(id) {
    this.selectedId = id;
    this.emit('select', id);
  }

  clipById(id) { return this.assets.find(c => c.id === id); }

  pauseAll() {
    if (this.dry) return;
    (this.assets || []).forEach(c => { if (c.el && !c.el.paused) c.el.pause(); });
  }

  // ---- timing ----------------------------------------------------------

  // Global switch interval from the Auto-Editor panel.
  intervalBeats(bpm) {
    const s = this.settings;
    if (s.timingMode === 'auto') return MusicalTime.autoMultiplier(bpm, s.autoPace).beats;
    return MusicalTime.toBeats(s.manualCount, s.manualUnit);
  }

  // How long a given clip holds once it's on screen: its own pace if set,
  // otherwise the global interval. Per-clip pace wins over manual timing too.
  intervalFor(clip, bpm) {
    if (clip && clip.pace === 'fit' && clip.fitBars > 0) return MusicalTime.toBeats(clip.fitBars, 'bar');
    if (clip && clip.pace && clip.pace !== 'global' && MusicalTime.AUTO_PACES[clip.pace]) return MusicalTime.autoMultiplier(bpm, clip.pace).beats;
    return this.intervalBeats(bpm);
  }

  status() {
    const bpm = this.bpmOf(this.viz.audioData);
    const curClip = this.current && this.current.clip;
    const beats = this.intervalFor(curClip, bpm);
    let state = 'running';
    if (this.clips.length === 0) state = 'no-clips';
    else if (!this.clips.some(c => c.ready) && this.clips.some(c => c.error)) state = 'unplayable';
    else if (!this.isAdvancing()) state = 'idle';
    else if (!this.gridOn() && (!(bpm > 0) || this.beatIndex < 0)) state = 'waiting-bpm';
    return {
      state, bpm,
      intervalBeats: beats,
      intervalMs: MusicalTime.beatsToMs(beats, bpm),
      globalBeats: this.intervalBeats(bpm),
      clipPace: curClip && curClip.pace && curClip.pace !== 'global' && MusicalTime.AUTO_PACES[curClip.pace] ? curClip.pace : null,
      nextCutPos: this.nextCutPos,
      story: this.story ? this.story.role : null,
      autoLabel: MusicalTime.autoMultiplier(bpm, this.settings.autoPace).label,
      dominant: this.dominant,
      position: this.gridOn() ? Math.max(0, this.grid.beatAt(this.clock())) : this.beatIndex >= 0 ? this.beatIndex + this.beatPhase() : -1,
    };
  }

  gridOn() { return !!(this.grid && this.grid.active); }

  // The grid's BPM while it drives the edit, else the live detector's.
  bpmOf(audioData) { return this.gridOn() ? this.grid.bpm : ((audioData && audioData.bpm) || 0); }

  beatPhase() {
    if (this.gridOn()) { const p = this.grid.beatAt(this.clock()); return p - Math.floor(p); }
    if (!this.viz.bpmInterval || this.lastSeenBeatTime == null) return 0;
    return Math.min(0.999, Math.max(0, (Date.now() - this.lastSeenBeatTime) / this.viz.bpmInterval));
  }

  // Playback rate for a clip's element; its sound follows (resampled, D-82).
  static rate(el, sp) {
    if (!el) return;
    if ('preservesPitch' in el) el.preservesPitch = false;
    else if ('mozPreservesPitch' in el) el.mozPreservesPitch = false;
    if (el.playbackRate !== sp) el.playbackRate = sp;
  }

  // A regular clip loops inside its used part (live; the renderer wraps the
  // same way from the segment's range).
  keepInRange(entry) {
    if (this.dry || !entry || !entry.clip || entry.clip.kind !== 'video' || entry.segment.story) return;
    const el = entry.clip.el, rg = entry.segment.range;
    if (!el || !rg) return;
    if (el.currentTime >= rg[1] - 0.03 || el.currentTime < rg[0] - 0.25) { try { el.currentTime = rg[0]; } catch (e) { /* not seekable */ } }
  }

  // Called once per analysis frame, after DJVisualizer.updateAudioData().
  update(audioData) {
    this.trackBands(audioData);
    if (!this.isAdvancing()) return;
    // Rolling again after a scrub: take the new position now (D-91).
    if (this.pendingSeek != null) { const t = this.pendingSeek; this.pendingSeek = null; this.scrubbing = false; this.seekTo(t); }
    this.keepInRange(this.current);
    if (this.clips.length === 0 && !this.storyBlocks().length) return;

    const bpm = this.bpmOf(audioData);
    this.overwritePlayed(this.clock());
    if (this.gridOn()) { this.updateOnGrid(bpm); return; }

    // Beat edge from the visualizer's clock. Counted through story blocks
    // too, so the bar grid stays continuous.
    if (bpm > 0 && this.viz.lastBeatTime !== this.lastSeenBeatTime) {
      this.lastSeenBeatTime = this.viz.lastBeatTime;
      this.beatIndex++;
      this.beats.push({ time: this.clock(), index: this.beatIndex, pass: this.pass });
      this.emit('beat', this.beatIndex);
    }

    // Story Mode: while the master time is inside a story block, that block
    // owns the screen (no automated picks). When it ends, cutting re-syncs
    // on the master beat grid, the same way it does after a seek (D-34).
    let block = this.settings.storyMode ? this.storyBlockAt(this.clock()) : null;
    if (block && this.isOver(block.clip)) { this.overStory(block); block = null; }
    if (block) { this.playStory(block); return; }
    if (this.story) {
      this.endStory();
      if (!(bpm > 0) || this.beatIndex < 0) { this.cut(bpm, null); return; }
      this.nextCutPos = null;
    }

    // Put a clip on screen as soon as the timeline rolls; beat-locked
    // cutting takes over once BPM locks (the first beat cuts).
    if (!this.current) this.cut(bpm, null);

    if (!(bpm > 0) || this.beatIndex < 0) return;

    const pos = this.beatIndex + this.beatPhase();

    // First beat after start / seek / tempo lock: cut on it and start
    // scheduling from there.
    if (this.nextCutPos == null) {
      this.cut(bpm, Math.floor(pos));
      return;
    }

    // Each cut schedules the next one from the segment's own start, using
    // the on-screen clip's hold (its pace, or the global interval). If that
    // hold changes mid-shot (panel edit, clip pace edit, auto multiplier
    // stepping with tempo), reschedule without firing an extra cut.
    const hold = this.intervalFor(this.current && this.current.clip, bpm);
    if (hold !== this.holdBeats) {
      this.holdBeats = hold;
      const elapsed = pos - this.segStartPos;
      this.nextCutPos = this.segStartPos + Math.max(1, Math.ceil(elapsed / hold + 1e-6)) * hold;
    }

    if (pos >= this.nextCutPos - 1e-6) {
      this.cut(bpm, this.nextCutPos);
      return;
    }

    // Pre-roll: pick + seek the next clip up to one beat early so the
    // incoming frame is decoded by the time the cut lands.
    const untilCut = this.nextCutPos - pos;
    if (!this.pending && untilCut <= Math.min(1, hold / 2)) {
      this.pending = this.prepare(this.choose(), bpm);
    }
  }

  // Fixed grid (D-81): beats come from the grid, a picture is on screen
  // from 0:00, and cuts land on multiples of the hold counted from bar 1 —
  // the same places every time. After a seek or a story block, cutting
  // continues on the grid without an extra cut.
  updateOnGrid(bpm) {
    const t = this.clock();
    const pos = this.grid.beatAt(t);
    const idx = Math.floor(pos);
    if (idx !== this.beatIndex) {
      this.beatIndex = idx;
      if (idx >= 0) this.beats.push({ time: this.grid.timeOfBeat ? this.grid.timeOfBeat(idx) : t, index: idx, pass: this.pass });
      this.emit('beat', idx);
    }
    let block = this.settings.storyMode ? this.storyBlockAt(t) : null;
    if (block && this.isOver(block.clip)) { this.overStory(block); block = null; }
    if (block) { this.playStory(block); return; }
    if (this.story) { const end = this.story.end; this.endStory(); this.cut(bpm, null, end != null && end <= t ? end : t); this.alignToGrid(pos, bpm); return; }
    // First picture: from where playback started (0:00 after Stop), not
    // from the first analysis frame a few ms later.
    if (!this.current) { this.cut(bpm, null, t - this.passStart < 0.1 ? this.passStart : t); this.alignToGrid(pos, bpm); return; }
    if (this.nextCutPos == null) this.alignToGrid(pos, bpm);
    const hold = this.intervalFor(this.current.clip, bpm);
    if (hold !== this.holdBeats) {
      this.holdBeats = hold;
      this.nextCutPos = this.segStartPos + Math.max(1, Math.ceil((pos - this.segStartPos) / hold + 1e-6)) * hold;
    }
    // The cut is recorded at the grid line itself, not the frame after it.
    if (pos >= this.nextCutPos - 1e-6) { this.cut(bpm, this.nextCutPos, Math.min(t, this.grid.timeOfBeat(this.nextCutPos))); return; }
    const untilCut = this.nextCutPos - pos;
    if (!this.pending && untilCut <= Math.min(1, hold / 2)) this.pending = this.prepare(this.choose(), bpm);
  }

  alignToGrid(pos, bpm) {
    const hold = this.intervalFor(this.current && this.current.clip, bpm);
    this.holdBeats = hold;
    this.segStartPos = Math.floor(pos / hold + 1e-6) * hold;
    this.nextCutPos = this.segStartPos + hold;
  }

  // Which band is currently most excited relative to its own recent level.
  // Raw values aren't comparable across bands (bass reads much hotter), so
  // each band is normalized by a slow running average of itself.
  trackBands(d) {
    let best = this.dominant, bestRatio = -1;
    ['bass', 'mid', 'high'].forEach(b => {
      const v = d[b] || 0;
      this.bandAvg[b] = this.bandAvg[b] * 0.985 + v * 0.015;
      const r = v / (this.bandAvg[b] + 0.01);
      this.bandRatio[b] = r;
      if (r > bestRatio) { bestRatio = r; best = b; }
    });
    // Small hysteresis so the dominant band doesn't flicker frame to frame.
    if (best !== this.dominant && this.bandRatio[best] > this.bandRatio[this.dominant] * 1.08) {
      this.dominant = best;
    }
  }

  // The Action Editor stack: clips minus story assets while Story Mode is
  // on (story assets have fixed places and no Importance, D-33).
  get stack() {
    const sm = this.settings.storyMode;
    return this.clips.filter(c => !(sm && c.story !== 'none'));
  }

  // Clips the automation may pick: decoded, in stack order.
  regularPool() {
    return this.pickList().filter(c => c.ready);
  }

  // What the automation picks from, in stack order: a clip with sections is
  // replaced by its sections (each with its own pace / band / speed).
  pickList() {
    const sm = this.settings.storyMode;
    return this.stack.flatMap(c => (this.isSplit(c) ? this.sectionsOf(c).filter(s => s.asClip && !(sm && s.story !== 'none')) : [c]));
  }

  // ---- Story Mode (v2.1 step 7, D-33–D-35) ------------------------------

  setStoryMode(on) {
    this.settings.storyMode = on;
    if (!on && this.story) this.endStory();
    this.renumber();
    this.emit('clips');
  }

  // One asset per role: taking a role that's in use releases it from the
  // other asset. Positions are kept while Story Mode is off (Free Mode
  // ignores them).
  setClipStory(id, role) {
    const a = this.clipById(id);
    if (!a) return;
    if (role !== 'none') {
      const holder = this.assets.find(x => x !== a && x.story === role);
      if (holder) holder.story = 'none';
    }
    a.story = role;
    this.renumber();
    this.emit('clips');
  }

  setClipFade(id, patch) {
    const a = this.clipById(id);
    if (a) { a.fade = { ...(a.fade || { on: false, curve: 'smooth', bars: 1 }), ...patch }; this.emit('clips'); }
  }

  setStoryHold(id, seconds) {
    const a = this.clipById(id);
    if (a) { a.storyHold = Math.max(0.5, seconds); this.emit('clips'); }
  }

  storyAssets() {
    const out = {};
    if (!this.settings.storyMode) return out;
    this.assets.forEach(a => { if (a.story !== 'none' && a.ready) out[a.story] = a; });
    return out;
  }

  // A video block plays its own length once; an image holds storyHold (Q9).
  // Each block is capped at a quarter of the song (30 s live), so a long
  // clip (e.g. a screen recording) can't take over the whole edit: Hook +
  // Result + CTA together never exceed three quarters (D-78).
  static STORY_LIVE_MAX = 30;
  storyCap(songDur = this.songDuration ? this.songDuration() : 0) {
    return songDur > 0 ? songDur / 4 : ClipEngine.STORY_LIVE_MAX;
  }

  storyLength(a, songDur) {
    const own = a.kind === 'image' ? a.storyHold : this.screenLength(a);
    return Math.min(own, this.storyCap(songDur));
  }

  // Track mode: blocks sit on the song's own timeline (D-34), so the
  // master timeline stays the only clock. HOOK at the start, CTA at the
  // end, RESULT/CLIMAX ending where CTA starts (or at the song's end).
  // Every ordering in the brief falls out of these three rules.
  storyPlan(songDur) {
    const s = this.storyAssets();
    const blocks = [];
    let hookEnd = 0, tail = songDur;
    if (s.hook) {
      hookEnd = Math.min(this.storyLength(s.hook, songDur), songDur);
      if (hookEnd > 0) blocks.push({ role: 'hook', clip: s.hook, start: 0, end: hookEnd });
    }
    if (s.cta) {
      const start = Math.max(hookEnd, songDur - this.storyLength(s.cta, songDur));
      if (songDur - start > 0) { blocks.push({ role: 'cta', clip: s.cta, start, end: songDur }); tail = start; }
    }
    if (s.result) {
      const start = Math.max(hookEnd, tail - this.storyLength(s.result, songDur));
      if (tail - start > 0) blocks.push({ role: 'result', clip: s.result, start, end: tail });
    }
    return blocks.sort((a, b) => a.start - b.start);
  }

  // Live mode (Q11): no known end, so Hook plays on Start and Result / CTA
  // are fired from the transport, each once per session.
  liveStoryBlocks() {
    const s = this.storyAssets();
    const out = [];
    if (s.hook) out.push({ role: 'hook', clip: s.hook, start: 0, end: this.storyLength(s.hook) });
    this.fired.forEach(f => {
      const a = s[f.role];
      if (a) out.push({ role: f.role, clip: a, start: f.at, end: f.at + this.storyLength(a) });
    });
    return out;
  }

  storyBlocks() {
    if (!this.settings.storyMode) return [];
    const dur = this.songDuration();
    return dur > 0 ? this.storyPlan(dur) : this.liveStoryBlocks();
  }

  storyBlockAt(t) {
    return this.storyBlocks().find(b => t >= b.start && t < b.end) || null;
  }

  fireStory(role) {
    if (this.fired.some(f => f.role === role) || !this.storyAssets()[role]) return false;
    this.fired.push({ role, at: this.clock() });
    this.emit('story');
    return true;
  }

  // Enter (or hold) a story block: a jump cut to the story asset, which is
  // not chosen by the automation. A video block plays once from the
  // matching offset, WITH its own audio (Q9), kept on the master timeline.
  playStory(block) {
    // Entered on the first frame inside the block: record it from the
    // block's own start (D-81), so it sits exactly where it was placed.
    const now = this.clock();
    const t = now >= block.start && now - block.start < 0.1 ? block.start : now;
    const a = block.clip;
    const into = Math.max(0, t - block.start);
    if (!this.story || this.story.role !== block.role || this.story.clip !== a) {
      if (this.story) this.endStory();
      this.pending = null;
      if (this.outgoing) { this.retire(this.outgoing.clip); this.outgoing = null; }
      this.transition = null;
      if (this.current) {
        // Only close a cut that is still open: after a seek it was already
        // closed where playback left it.
        if (this.current.segment.end == null) this.current.segment.end = t;
        if (this.current.clip !== a) this.retire(this.current.clip);
      }
      const r = this.usedRange(a), sp = this.speedOf(a);
      const segment = {
        clipId: a.id, start: t, end: null, inPoint: a.kind === 'video' ? r.start + into * sp : into, transition: 'jump',
        band: this.dominant, beat: this.beatIndex, story: block.role, blendSec: 0, pass: this.pass,
        speed: sp, range: a.kind === 'video' ? [r.start, r.end] : null,
        visual: ClipEngine.visualOf(a),
      };
      this.segments.push(segment);
      this.current = { clip: a, segment };
      this.story = block;
      if (a.kind === 'video' && !this.dry) {
        a.el.loop = false;
        a.el.muted = false;
        a.el.volume = 1;
        ClipEngine.rate(a.el, sp);
        try { a.el.currentTime = segment.inPoint; } catch (e) { /* not seekable yet */ }
        a.el.play().catch(() => {});
      }
      this.emit('cut', segment);
    } else if (a.kind === 'video' && !this.dry && !a.el.ended) {
      // Hold the used part's end; keep in sync with the master time.
      const r = this.usedRange(a), want = Math.min(r.end, r.start + into * this.speedOf(a));
      if (want >= r.end - 0.02) { if (!a.el.paused) a.el.pause(); }
      else if (Math.abs(a.el.currentTime - want) > 0.15) a.el.currentTime = want;
    }
  }

  endStory() {
    const a = this.story && this.story.clip;
    if (a && a.kind === 'video' && !this.dry) {
      a.el.pause();
      a.el.muted = true;
      a.el.volume = 0;
      a.el.loop = true;
      ClipEngine.rate(a.el, 1);
    }
    this.story = null;
  }

  // Importance (stack position) only changes WHICH clip is picked (D-32):
  //  - Sequential: the next clip down the stack, wrapping to the top.
  //  - Random / By band: weighted pick, top of the stack most often.
  //    Never the same clip twice in a row.
  // Over stream (D-88): an image set to "Over video" plays above the video
  // while the base keeps cutting. Only when there are videos to play under
  // it — with none, an Over image behaves as Full frame.
  hasVideos() { return this.regularPool().some(c => c.kind === 'video'); }
  isOver(c) { return !!c && c.kind === 'image' && c.show === 'over' && this.hasVideos(); }
  overFree(t) { return !this.over || this.over.end <= t + 1e-6; }
  overAt(t) { return this.segments.find(s => s.stream === 'over' && s.start <= t && (s.end == null ? Infinity : s.end) > t) || null; }

  // Open an image on the over stream for its hold (beats → seconds on the
  // grid when it drives the edit).
  startOver(clip, atPos, bpm, now) {
    const hold = this.intervalFor(clip, bpm);
    let end = now + MusicalTime.beatsToMs(hold, bpm || 120) / 1000;
    if (atPos != null && this.gridOn()) end = Math.max(now + 0.05, this.grid.timeOfBeat(atPos + hold));
    const seg = { clipId: clip.id, start: now, end, inPoint: 0, transition: 'jump', band: this.dominant, beat: this.beatIndex, stream: 'over', holdBeats: hold, pass: this.pass, blendSec: 0 };
    this.segments.push(seg);
    this.over = seg;
    this.emit('cut', seg);
    return seg;
  }

  // Over-stream fade: 0.15 s at a cut's real start and end (not where a
  // played take split it, D-88).
  static overAlpha(seg, t, f = 0.15) {
    const a = seg.fadeIn === false ? 1 : (t - seg.start) / f;
    const b = seg.fadeOut === false ? 1 : (seg.end - t) / f;
    return Math.max(0, Math.min(1, a, b));
  }

  // A locked Over image: over the video for its block, the base cutting on.
  overStory(block) {
    if (this.over && this.over.story === block.role && this.over.end > this.clock()) return;
    const t = this.clock();
    const start = t >= block.start && t - block.start < 0.1 ? block.start : t;
    const seg = { clipId: block.clip.id, start, end: block.end, inPoint: 0, transition: 'jump', band: this.dominant, beat: this.beatIndex, stream: 'over', story: block.role, pass: this.pass, blendSec: 0 };
    this.segments.push(seg);
    this.over = seg;
    this.emit('cut', seg);
  }

  choose({ videosOnly = false } = {}) {
    let clips = this.regularPool();
    if (videosOnly) clips = clips.filter(c => c.kind === 'video' || (c.kind === 'image' && c.show !== 'over'));
    if (clips.length === 0) return null;
    // Clips that used up their repeats sit out; if every one has, all play
    // again rather than leaving the screen empty (D-93, Proposed).
    const fresh = clips.filter(c => !this.spent(c));
    if (fresh.length) clips = fresh;
    const currentClip = this.current && this.current.clip;
    const s = this.settings;

    if (s.order === 'sequential') {
      const i = clips.indexOf(currentClip);
      return clips[(i + 1) % clips.length];
    }

    let pool = clips;
    if (s.order === 'band') {
      pool = clips.filter(c => c.band === this.dominant);
      if (pool.length === 0) pool = clips.filter(c => c.band === 'any');
      if (pool.length === 0) pool = clips;
    }
    return this.weightedPick(pool, currentClip);
  }

  // Weight = N − rank + 1 within the pool (rank 1 = highest in the stack),
  // so with 3 clips the odds are 3:2:1 (Q15).
  weightedPick(pool, exclude) {
    const cands = pool.length > 1 ? pool.filter(c => c !== exclude) : pool;
    const N = pool.length;
    const weights = cands.map(c => N - pool.indexOf(c));
    let r = Math.random() * weights.reduce((a, b) => a + b, 0);
    for (let i = 0; i < cands.length; i++) {
      r -= weights[i];
      if (r < 0) return cands[i];
    }
    return cands[cands.length - 1];
  }

  prepare(clip, bpm) {
    if (!clip) return null;
    if (!this.dry) this.pickDeck(clip);
    // Images hold for their Pace; in-points don't apply (D-46).
    if (clip.kind === 'image') return { clip, inPoint: 0 };
    // In-points only inside the clip's used part (D-82); a clip that
    // fits bars plays its part from the start.
    const r = this.usedRange(clip), sp = this.speedOf(clip);
    let inPoint = r.start;
    if (clip.pace === 'fit') inPoint = r.start;
    else if (this.settings.inPoint === 'resume') inPoint = clip.lastPos || r.start;
    else if (this.settings.inPoint === 'random') {
      const need = (MusicalTime.beatsToMs(this.intervalFor(clip, bpm), bpm) / 1000) * sp;
      inPoint = r.start + Math.random() * Math.max(0, r.end - r.start - need);
    }
    if (!(inPoint >= r.start && inPoint < r.end)) inPoint = r.start;
    if (!this.dry && !(this.current && this.current.clip.el === clip.el && this.current.clip === clip)) {
      ClipEngine.rate(clip.el, sp);
      try { clip.el.currentTime = inPoint; } catch (e) { /* not seekable yet */ }
      clip.el.play().catch(() => {});
    }
    return { clip, inPoint };
  }

  // atPos: musical position (beats) this cut lands on, or null before the
  // tempo has locked (the clip just goes on screen; no schedule yet).
  cut(bpm, atPos, atTime = null) {
    let next = this.pending || this.prepare(this.choose(), bpm);
    this.pending = null;
    if (next && this.isOver(next.clip)) {
      const at = atTime != null ? atTime : this.clock();
      if (this.overFree(at)) this.startOver(next.clip, atPos, bpm, at);
      next = this.prepare(this.choose({ videosOnly: true }), bpm);
    }
    if (!next) return;
    if (!this.dry && next.clip.el && next.clip.el.paused) next.clip.el.play().catch(() => {});

    const hold = this.intervalFor(next.clip, bpm);
    if (atPos != null) {
      this.segStartPos = atPos;
      this.holdBeats = hold;
      this.nextCutPos = atPos + hold;
    }

    const now = atTime != null ? atTime : this.clock();
    const band = this.dominant;
    const transitionId = this.settings.transitionMode === 'band'
      ? this.bandTransitions[band]
      : this.settings.transitionMode;
    const def = ClipTransitions.get(transitionId);

    // Finish any blend still running before starting a new one.
    if (this.outgoing && this.outgoing.clip !== next.clip) this.retire(this.outgoing.clip);

    if (this.current) {
      if (this.current.segment.end == null) this.current.segment.end = now;
      this.outgoing = this.current;
    }

    const segment = {
      clipId: next.clip.id, start: now, end: null, inPoint: next.inPoint,
      transition: def.id, band, beat: this.beatIndex,
      pace: next.clip.pace, holdBeats: hold, pass: this.pass,
      visual: ClipEngine.visualOf(next.clip),
    };
    if (next.clip.kind === 'video') {
      const r = this.usedRange(next.clip);
      segment.speed = this.speedOf(next.clip);
      segment.range = [r.start, r.end];
      if (!this.dry) ClipEngine.rate(next.clip.el, segment.speed);
    }
    this.segments.push(segment);
    this.current = { clip: next.clip, segment };

    // Blend length scales with tempo; never longer than the incoming shot.
    const lengthMs = Math.min(
      MusicalTime.beatsToMs(def.lengthBeats, bpm),
      MusicalTime.beatsToMs(hold, bpm) * 0.9
    );
    this.transition = lengthMs > 0 && this.outgoing ? { def, startMs: performance.now(), lengthMs } : null;
    segment.blendSec = this.transition ? lengthMs / 1000 : 0;
    if (!this.transition && this.outgoing) {
      if (this.outgoing.clip !== next.clip) this.retire(this.outgoing.clip);
      this.outgoing = null;
    }
    this.emit('cut', segment);
  }

  retire(clip) {
    if (this.dry || !clip || !clip.el) return;
    clip.lastPos = clip.el.currentTime;
    const inUse = (this.current && this.current.clip.el === clip.el) || (this.pending && this.pending.clip.el === clip.el);
    if (!inUse) clip.el.pause();
  }

  // Master-timeline seek (track mode). Everything recorded after the new
  // playhead is discarded and regenerated live from there.
  seekTo(seconds) {
    if (this.story) this.endStory();   // re-entered from the matching offset if the seek lands inside a block
    // Keep the whole record (D-56): only the cut that spans the new
    // playhead is trimmed there. Playing from here overwrites as it goes.
    // The cut on air ends where playback actually was, not at the seek target.
    this.closeOpenSegment(this.lastAdvanceTime);
    this.segments.forEach(s => {
      if (s.start < seconds && (s.end == null || s.end > seconds)) { s.end = seconds; s.fadeOut = false; }
    });
    // Drop cuts trimmed down to nothing.
    this.segments = this.segments.filter(s => s.end == null || s.end > s.start + 0.001 || (this.current && s === this.current.segment));
    this.pass++;
    this.passStart = seconds;
    // The clip on screen carries on from the new playhead: record that as
    // the new pass's first cut, so the list has no hole between the seek
    // and the next beat cut (none comes before BPM locks). A story clip
    // re-enters on its own if the seek lands in its block.
    if (this.current && this.current.clip.story !== 'none' && this.settings.storyMode) {
      this.current = null;
    } else if (this.current) {
      const c = this.current.clip;
      const old = this.current.segment;
      if (old.end != null && old.end <= old.start + 0.001) this.segments = this.segments.filter(s => s !== old);
      const segment = {
        ...this.current.segment, start: seconds, end: null, transition: 'jump', blendSec: 0,
        inPoint: c.kind === 'video' && c.el ? c.el.currentTime : 0, beat: this.beatIndex, pass: this.pass,
      };
      delete segment.story;
      this.segments.push(segment);
      this.current = { clip: c, segment };
      this.outgoing = null;
      this.transition = null;
    }
    const before = this.beats.filter(b => b.time < seconds);
    this.beatIndex = before.length ? before[before.length - 1].index : -1;
    this.lastSeenBeatTime = this.viz.lastBeatTime;
    this.over = null;
    this.nextCutPos = null;   // forces a cut on the next frame
    this.segStartPos = null;
    this.holdBeats = null;
    this.pending = null;
    this.emit('seek', seconds);
  }

  // Punch-in overwrite: anything recorded by an earlier pass that starts
  // inside [passStart, now) has just been played over. A cut that runs past
  // the playhead keeps its remaining part (start and in-point move up), so
  // stopping mid-way leaves the rest of the earlier take intact.
  overwritePlayed(now) {
    this.lastAdvanceTime = now;
    const from = this.passStart;
    if (!(now > from)) return;
    for (let i = this.segments.length - 1; i >= 0; i--) {
      const s = this.segments[i];
      if (s.pass === this.pass || s.start < from || s.start >= now) continue;
      if (s.end != null && s.end <= now + 0.001) this.segments.splice(i, 1);
      else { s.inPoint += (now - s.start) * (s.speed || 1); s.start = now; s.fadeIn = false; }
    }
    for (let i = this.beats.length - 1; i >= 0; i--) {
      const b = this.beats[i];
      if (b.pass !== this.pass && b.time >= from && b.time < now) this.beats.splice(i, 1);
    }
  }

  // Close the live cut at time t (pause, stop, seek, save).
  closeOpenSegment(t) {
    if (this.current && this.current.segment.end == null && t >= this.current.segment.start) {
      this.current.segment.end = t;
    }
  }

  // The edit decision list in time order, every cut closed.
  edl() {
    return this.segments
      .map(s => ({ ...s, end: s.end == null ? Math.max(s.start, this.lastAdvanceTime) : s.end }))
      .filter(s => s.end > s.start)
      .sort((a, b) => a.start - b.start);
  }

  // Leaving clips mode or stopping audio: hold still, keep the recording.
  setActive(active) {
    if (!active) this.pauseAll();
    else if (this.current && this.current.clip.el) this.current.clip.el.play().catch(() => {});
  }

  // ---- rendering -------------------------------------------------------

  draw(p) {
    const drawClip = (clip, { alpha = 1, offsetX = 0, scale = 1 } = {}) => {
      if (!clip || !clip.media) return;
      // Videos and images share the same cover-fit path and transitions.
      const vw = clip.kind === 'image' ? clip.media.width : clip.el.videoWidth;
      const vh = clip.kind === 'image' ? clip.media.height : clip.el.videoHeight;
      if (!vw || !vh) return;
      const cover = Math.max(p.width / vw, p.height / vh) * scale;
      const w = vw * cover, h = vh * cover;
      p.push();
      p.translate(offsetX, 0);
      p.tint(255, Math.max(0, Math.min(1, alpha)) * 255);
      p.image(clip.bridge ? clip.bridge.frame() : clip.media, -w / 2, -h / 2, w, h);
      p.pop();
    };

    if (this.scrubbing && !this.isAdvancing() && this.drawRecordedAt(p, drawClip)) {
      // scrubbing: the recorded cut at the playhead (D-91)
    } else if (!this.current) {
      // Not rolling yet: show the first clip's frame as a preview.
      const first = this.clips.find(c => c.ready);
      if (first) drawClip(first, { alpha: 0.35 });
    } else if (this.transition) {
      const t = (performance.now() - this.transition.startMs) / this.transition.lengthMs;
      if (t >= 1) {
        if (this.outgoing && this.outgoing.clip !== this.current.clip) this.retire(this.outgoing.clip);
        this.outgoing = null;
        this.transition = null;
        drawClip(this.current.clip);
      } else {
        this.transition.def.render(p, t, this.outgoing && this.outgoing.clip, this.current.clip, drawClip);
      }
    } else {
      drawClip(this.current.clip);
    }
    p.noTint();

    // Per-clip visual mode (D-90), between the clip and the over stream.
    if (this.current && this.current.clip.visual && this.current.clip.visual.mode !== 'none') {
      if (!this.vlayer) this.vlayer = new VisualLayer();
      const now = performance.now(), dt = this.vlast ? Math.min(0.1, (now - this.vlast) / 1000) : 1 / 60;
      this.vlast = now;
      this.vlayer.draw(p, this.viz, this.current.clip.visual, this.current.segment, dt);
    }
    if (this.settings.overlayLayers && this.viz.drawReactiveLayers) this.viz.drawReactiveLayers(p);
    this.drawOver(p);
  }

  // While scrubbing: the base cut recorded at the playhead, at the frame
  // the export would show (in + elapsed × speed, wrapped in its range).
  drawRecordedAt(p, drawClip) {
    const t = this.clock();
    const seg = this.segments.find(s => s.stream !== 'over' && s.start <= t && (s.end == null ? Infinity : s.end) > t);
    const clip = seg && this.clipById(seg.clipId);
    if (!clip || !clip.media) return false;
    if (clip.kind === 'video' && clip.el) {
      const dur = this.sourceLength(clip);
      const want = OfflineRenderer.prototype.clipTime(seg, clip, t, dur);
      if (!clip.el.paused) clip.el.pause();
      if (Math.abs(clip.el.currentTime - want) > 0.04 && !clip.el.seeking) { try { clip.el.currentTime = want; } catch (e) { /* not seekable */ } }
    }
    // p5 doesn't refresh a paused, seeked video's texture: draw it through
    // a 2D copy (the same bridge rotated phone video uses, D-54).
    if (clip.kind === 'video' && !clip.bridge) {
      if (!this.scrubBridges) this.scrubBridges = new Map();
      let b = this.scrubBridges.get(clip.el);
      if (!b) { b = VideoOrientation.bridge(this.viz.p5Instance, clip.media); this.scrubBridges.set(clip.el, b); }
      drawClip(Object.assign(Object.create(clip), { bridge: b }));
    } else drawClip(clip);
    return true;
  }

  // The over stream (D-88): the image on air above the video, through its
  // placement, fading in and out over 0.15 s. While editing (paused), the
  // selected Over image shows faintly where it sits, for the drag handle.
  drawOver(p) {
    const t = this.clock();
    const seg = this.overAt(t);
    let clip = seg ? this.clipById(seg.clipId) : null, alpha = 1;
    if (seg && clip) {
      alpha = ClipEngine.overAlpha(seg, t);
    } else {
      const sel = this.clipById(this.selectedId);
      clip = !this.isAdvancing() && this.previewOver && sel && sel.kind === 'image' && sel.show === 'over' ? sel : null;
      alpha = 0.6;
    }
    this.overBox = null;
    if (!clip || !clip.media) return;
    const bp = DisplaySize.bpFor(p.width, p.height);
    const pl = Placement.at(clip.placement || Placement.defaults({ size: 60 }), bp);
    this.overBox = Placement.draw(p, clip.media, pl, p.width, p.height, this.viz.reactInput ? this.viz.reactInput(p) : null, alpha);
    this.overBox && (this.overBox.id = clip.id);
  }

  // Name of whatever is on screen right now (for the viewport HUD).
  nowShowing() {
    if (!this.current) return null;
    return {
      clip: this.current.clip,
      segment: this.current.segment,
      transition: this.transition ? this.transition.def : null,
    };
  }
}

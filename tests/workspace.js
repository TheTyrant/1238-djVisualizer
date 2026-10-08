// Step 3 (v2.4): workspace — band-coloured cards, resizable lanes, compact
// band strip, Auto-Editor panel (D-83 … D-86). Uses the track and six
// coloured image clips made in the page; nothing is played.
const E = (fn, arg) => page.evaluate(fn, arg);

const boot = async () => {
  await E(async () => {
    const sr = 44100, n = sr * 20, L = new Int16Array(n);
    for (let i = 0; i < n; i++) { const t = i / sr, b = (t - 0.25 + 10) % 0.5, down = Math.floor((t - 0.25 + 10) / 0.5) % 4 === 0; L[i] = Math.max(-1, Math.min(1, (b < 0.12 ? (down ? 1 : 0.6) * Math.sin(2 * Math.PI * (50 + 90 * Math.exp(-b * 30)) * b) * Math.exp(-b * 16) : 0) * 0.8)) * 32767; }
    const h = new DataView(new ArrayBuffer(44)); const W = (o, s) => [...s].forEach((c, k) => h.setUint8(o + k, c.charCodeAt(0)));
    W(0, 'RIFF'); h.setUint32(4, 36 + n * 2, true); W(8, 'WAVE'); W(12, 'fmt '); h.setUint32(16, 16, true); h.setUint16(20, 1, true); h.setUint16(22, 1, true);
    h.setUint32(24, sr, true); h.setUint32(28, sr * 2, true); h.setUint16(32, 2, true); h.setUint16(34, 16, true); W(36, 'data'); h.setUint32(40, n * 2, true);
    const png = async (name, col) => { const c = document.createElement('canvas'); c.width = 96; c.height = 54; const g = c.getContext('2d'); g.fillStyle = col; g.fillRect(0, 0, 96, 54); return new File([await new Promise(r => c.toBlob(r, 'image/png'))], name + '.png', { type: 'image/png' }); };
    document.getElementById('audioSourceFile').click();
    await djApp.loadAudioFile(new File([h.buffer, L.buffer], 'ws-120.wav', { type: 'audio/wav' }), { autoplay: false });
    const e = djApp.clipEngine;
    e.addFiles(await Promise.all([['A', '#c33'], ['B', '#3a3'], ['C', '#33c'], ['D', '#999'], ['E', '#c90'], ['F', '#909']].map(([n, c]) => png(n, c))));
    for (let i = 0; i < 50 && !e.assets.every(a => a.ready); i++) await new Promise(r => setTimeout(r, 100));
    const by = (n) => e.assets.find(a => a.name === n).id;
    e.setClipBand(by('A'), 'bass'); e.setClipBand(by('B'), 'mid'); e.setClipBand(by('C'), 'high'); e.setClipBand(by('D'), 'bass'); e.setClipBand(by('E'), 'mid');
    const v = document.getElementById('visualMode'); v.value = 'clips'; v.dispatchEvent(new Event('change'));
    for (let i = 0; i < 100 && djApp.fastPass.state.stage !== 'done'; i++) await new Promise(r => setTimeout(r, 200));
    await new Promise(r => setTimeout(r, 800));
    djApp.fastPass.flush();
  });
};
await E(() => { try { localStorage.clear(); } catch (e) {} });
await page.reload({ waitUntil: 'networkidle0' }); await sleep(1200);
await boot();

// #8 Band-coloured cards, >= 4.5:1 in both skins; Any neutral.
const contrast = async () => E(() => {
  const rgb = (s) => (s.match(/[\d.]+/g) || []).slice(0, 3).map(Number);
  const lum = ([r, g, b]) => { const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); }; return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b); };
  const ratio = (a, b) => { const x = lum(a), y = lum(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };
  const out = {};
  document.querySelectorAll('.bin-card').forEach(c => {
    const meta = c.querySelector('.bin-meta'), name = c.querySelector('.bin-name');
    const cs = getComputedStyle(meta), ns = getComputedStyle(name);
    out[c.dataset.band] = { bg: cs.backgroundColor, ratio: +ratio(rgb(ns.color), rgb(cs.backgroundColor)).toFixed(2) };
  });
  return out;
});
const cLight = await contrast();
await E(() => document.getElementById('themeBtn').click()); await sleep(300);
const cDark = await contrast();
await E(() => document.getElementById('themeBtn').click()); await sleep(300);
const bandsOk = (c) => ['bass', 'mid', 'high'].every(b => c[b] && c[b].ratio >= 4.5) && c.any && !/rgb\((2[0-9]{2}), (5[0-9]|6[0-9]), /.test(c.any.bg);
ok('#8 band-coloured cards: text >= 4.5:1 on every band, light skin', bandsOk(cLight), JSON.stringify(Object.fromEntries(Object.entries(cLight).map(([k, v]) => [k, v.ratio]))));
ok('#8 … and dark skin; Any stays neutral', bandsOk(cDark), JSON.stringify(Object.fromEntries(Object.entries(cDark).map(([k, v]) => [k, v.ratio]))));

// #10 Compact band strip: default, shows exactly the cut list, member tags.
const strip = await E(async () => {
  const t = djApp.timeline; t.view.fit = true; await new Promise(r => setTimeout(r, 200));
  const segs = djApp.clipEngine.segments.filter(s => (s.end == null ? 1e9 : s.end) > s.start);
  const drawn = t.stripDrawn || [];
  const sig = (list) => list.map(s => `${s.clipId}@${s.start.toFixed(3)}`).sort().join(',');
  const tags = djApp.clipEngine.memberTags();
  const e = djApp.clipEngine, by = (n) => e.assets.find(a => a.name === n).id;
  return { dbg: JSON.stringify({ view: t.view, segs: segs.length, W: t.W, track: djApp.isTrackMode(), dur: djApp.trackSource.duration }), compact: !djApp.workspace.state.clipsExpanded, laneH: t.ROWS.clips, same: sig(drawn.map(d => d.seg)) === sig(segs), n: drawn.length, tags: ['A', 'D', 'B', 'E', 'C', 'F'].map(n => tags.get(by(n))) };
});
ok('#10 clip lane is a compact band strip by default and shows exactly the recorded cut list', strip.compact && strip.laneH === 38 && strip.same && strip.n > 10, `${strip.n} cuts drawn, lane ${strip.laneH}px ${strip.dbg}`);
ok('#10 band member tags ranked within the band by stack position', strip.tags.join(' ') === 'B1 B2 M1 M2 H1 A1', strip.tags.join(' '));

// #10 expand toggle, remembered.
await page.click('#clipsExpand'); await sleep(200);
const exp = await E(() => ({ on: djApp.workspace.state.clipsExpanded, h: djApp.timeline.ROWS.clips }));

// #9 Drawers (D-96): dividers on the lines between drawers trade height;
// the one main drag scales them all evenly; nothing scrolls.
const lay = () => E(() => {
  const H = (q) => Math.round(document.querySelector(q).getBoundingClientRect().height);
  const m = document.getElementById('editorMain'), bin = document.getElementById('clipBin').getBoundingClientRect(), ed = document.getElementById('editorPanel').getBoundingClientRect();
  const divs = [...document.querySelectorAll('.drawer-div')].map(d => { const r = d.getBoundingClientRect(); return { key: d.dataset.between, x: r.left + r.width / 2, y: r.top + r.height / 2, pill: !!d.querySelector('.drawer-pill') }; });
  return { R: { ...djApp.timeline.ROWS }, bin: Math.round(bin.height), chMaster: H('.ch-master'), scrolls: m.scrollHeight > m.clientHeight + 1, binBottomGap: Math.round(ed.bottom - bin.bottom), divs, oldGrips: document.querySelectorAll('.lane-grip, #binSplitter, #binGrip').length };
});
const l0 = await lay();
const dMC = l0.divs.find(d => d.key === 'master|clips');
await page.mouse.move(dMC.x, dMC.y); await page.mouse.down(); await page.mouse.move(dMC.x, dMC.y + 20, { steps: 5 }); await page.mouse.up(); await sleep(250);
const l1 = await lay();
const vs = await E(() => { const r = document.getElementById('panelSplitter').getBoundingClientRect(); return { x: r.left + 300, y: r.top + 3 }; });
const ed0 = await E(() => document.getElementById('editorPanel').getBoundingClientRect().height);
await page.mouse.move(vs.x, vs.y); await page.mouse.down(); await page.mouse.move(vs.x, vs.y - 90, { steps: 6 }); await page.mouse.up(); await sleep(300);
const ed1 = await E(() => document.getElementById('editorPanel').getBoundingClientRect().height);
const l2 = await lay();
const saved = await E(() => JSON.parse(localStorage.getItem('bssmnt.layout')));
ok('#10 header toggle expands the clip lane to full size', exp.on && exp.h > 38);
ok('#9 a divider (white line, pill in the middle) on every line between drawers, the Action clips included; no old grips', l0.divs.length === 2 && l0.divs.every(d => d.pill) && l0.divs.map(d => d.key).join() === 'master|clips,clips|bin' && l0.oldGrips === 0, JSON.stringify(l0.divs.map(d => d.key)));
ok('#9 dragging a divider trades height between its two drawers (header follows)', l1.R.master - l0.R.master >= 18 && l0.R.clips - l1.R.clips >= 18 && l1.bin === l0.bin && l1.chMaster === l1.R.master, JSON.stringify({ master: [l0.R.master, l1.R.master], clips: [l0.R.clips, l1.R.clips], bin: [l0.bin, l1.bin] }));
const ratio = (l) => [l.R.master / l.bin, l.R.clips / l.bin].map(v => +v.toFixed(2));
ok('#9 the one main drag grows every drawer evenly; nothing scrolls; the Action clips end at the shelf bottom (no control under the main drag)', ed1 > ed0 + 80 && l2.R.master > l1.R.master && l2.bin > l1.bin && Math.abs(ratio(l2)[0] - ratio(l1)[0]) < 0.05 && Math.abs(ratio(l2)[1] - ratio(l1)[1]) < 0.05 && !l2.scrolls && l2.binBottomGap <= 1, JSON.stringify({ editor: [Math.round(ed0), Math.round(ed1)], ratios: [ratio(l1), ratio(l2)], scrolls: l2.scrolls, gap: l2.binBottomGap }));
ok('#9 the layout is one record of shares, saved', saved && saved.lanes.master > 72 && saved.editor > 0 && saved.clipsExpanded === true, JSON.stringify(saved.lanes));

// Remembered across a reload.
await page.reload({ waitUntil: 'networkidle0' }); await sleep(1500);
const back = await E(() => ({ master: djApp.timeline.ROWS.master, exp: djApp.workspace.state.clipsExpanded, ed: Math.round(document.getElementById('editorPanel').getBoundingClientRect().height) }));
ok('#9 sizes and the expanded lane are remembered after reopening', Math.abs(back.master - l2.R.master) <= 2 && back.exp && Math.abs(back.ed - ed1) <= 1, JSON.stringify(back));

// Double-click a divider resets its two drawers.
await boot();
const l3 = await lay();
const d3 = l3.divs.find(d => d.key === 'master|clips');
await page.mouse.click(d3.x, d3.y, { clickCount: 2 }); await sleep(250);
const reset = await E(() => ({ master: djApp.workspace.state.lanes.master, clips: djApp.workspace.state.lanes.clips }));
ok('#9 double-click on a divider resets its two drawers', reset.master === 72 && reset.clips === 64, JSON.stringify(reset));

// #11 AE panel: Global edit collapsible; Band members; chip selects card.
const ae = await E(async () => {
  djApp.rightbar.open('autoedit');
  const d = document.getElementById('aeGlobal');
  const inside = ['propAutoPace', 'propOrder', 'propTransition', 'propBandMap', 'propInPoint'].every(id => d.contains(document.getElementById(id)));
  d.querySelector('summary').click();
  await new Promise(r => setTimeout(r, 50));
  const closed = !d.open;
  d.querySelector('summary').click();
  const rows = [...document.querySelectorAll('#bandMembers .bm-row')].map(r => `${r.dataset.band}:${r.querySelector('.bm-count').textContent}:${[...r.querySelectorAll('.bm-chip')].map(c => c.textContent).join('/')}`);
  const chip = [...document.querySelectorAll('#bandMembers .bm-chip')].find(c => c.textContent === 'M2');
  chip.click();
  await new Promise(r => setTimeout(r, 100));
  const sel = djApp.clipEngine.clipById(djApp.clipEngine.selectedId);
  return { inside, closed, rows, selected: sel && sel.name, stored: JSON.parse(localStorage.getItem('bssmnt.layout') || '{}').aeGlobalOpen };
});
ok('#11 "Global edit" holds Pace, Clip order, Transition + band map, In-point and collapses (remembered)', ae.inside && ae.closed, JSON.stringify({ inside: ae.inside, closed: ae.closed }));
ok('#11 Band members: count and chips per band; a chip selects its card', ae.rows.join(' ') === 'bass:2:B1/B2 mid:2:M1/M2 high:1:H1 any:1:A1' && ae.selected === 'E', `${ae.rows.join(' ')} · M2 → ${ae.selected}`);

// The band that triggered the cut on air lights up.
const hot = await E(async () => {
  djApp.seekMaster(3); await djApp.toggleAudio(); await new Promise(r => setTimeout(r, 1500));
  const seg = djApp.clipEngine.current && djApp.clipEngine.current.segment;
  await new Promise(r => setTimeout(r, 100));
  const lit = [...document.querySelectorAll('#bandMembers .bm-row.is-hot')].map(r => r.dataset.band);
  await djApp.toggleAudio();
  return { band: seg && seg.band, lit };
});
ok('#11 the band that triggered the current cut is lit', hot.band && hot.lit.length === 1 && hot.lit[0] === hot.band, JSON.stringify(hot));

// #11 By band: Action Editor grouped; drag within a group = rank, between groups = band.
const grp = await E(async () => {
  const e = djApp.clipEngine;
  e.settings.order = 'band';
  djApp.timeline.syncProps();
  const groups = [...document.querySelectorAll('#binCards .bin-group')].map(g => `${g.dataset.band}:${[...g.querySelectorAll('.bin-card')].map(c => e.clipById(+c.dataset.id).name).join('')}`);
  const drag = (card, target, before) => {
    const dt = new DataTransfer();
    card.dispatchEvent(new DragEvent('dragstart', { bubbles: true, dataTransfer: dt }));
    const r = before ? before.getBoundingClientRect() : target.getBoundingClientRect();
    const x = before ? r.left + 2 : r.right - 2, y = r.top + r.height / 2;
    target.dispatchEvent(new DragEvent('dragover', { bubbles: true, cancelable: true, dataTransfer: dt, clientX: x, clientY: y }));
    target.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: dt, clientX: x, clientY: y }));
    card.dispatchEvent(new DragEvent('dragend', { bubbles: true, dataTransfer: dt }));
  };
  const card = (n) => document.querySelector(`#binCards .bin-card[data-id="${e.assets.find(a => a.name === n).id}"]`);
  const group = (b) => document.querySelector(`#binCards .bin-group[data-band="${b}"]`);
  // within bass: D before A
  drag(card('D'), group('bass'), card('A'));
  const rank = e.bandMembers().bass.map(c => c.name).join('');
  // between: F (any) into mid, before E
  drag(card('F'), group('mid'), card('E'));
  const f = e.assets.find(a => a.name === 'F');
  const mid = e.bandMembers().mid.map(c => c.name).join('');
  e.settings.order = 'sequential'; djApp.timeline.syncProps();
  const flat = !document.querySelector('#binCards .bin-group');
  return { groups, rank, band: f.band, mid, flat };
});
ok('#11 Clip order By band groups the Action Editor by band', grp.groups.join(' ') === 'bass:AD mid:BE high:C any:F', grp.groups.join(' '));
ok('#11 drag within a group changes the rank; between groups changes the band', grp.rank === 'DA' && grp.band === 'mid' && grp.mid === 'BFE' && grp.flat, JSON.stringify(grp));

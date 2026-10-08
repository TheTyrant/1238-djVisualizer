// Omar's 2026-10-08 round (D-93, D-94): repeats for images and videos, the
// shelves laid out like 01 File, Ctrl+Space clean view.
const E = (fn, arg) => page.evaluate(fn, arg);

await E(async () => {
  const sr = 44100, n = sr * 30, L = new Int16Array(n);
  for (let i = 0; i < n; i++) { const t = i / sr, b = (t - 0.25 + 10) % 0.5, down = Math.floor((t - 0.25 + 10) / 0.5) % 4 === 0; L[i] = Math.max(-1, Math.min(1, (b < 0.12 ? (down ? 1 : 0.6) * Math.sin(2 * Math.PI * (50 + 90 * Math.exp(-b * 30)) * b) * Math.exp(-b * 16) : 0) * 0.8)) * 32767; }
  const h = new DataView(new ArrayBuffer(44)); const W = (o, s) => [...s].forEach((c, k) => h.setUint8(o + k, c.charCodeAt(0)));
  W(0, 'RIFF'); h.setUint32(4, 36 + n * 2, true); W(8, 'WAVE'); W(12, 'fmt '); h.setUint32(16, 16, true); h.setUint16(20, 1, true); h.setUint16(22, 1, true);
  h.setUint32(24, sr, true); h.setUint32(28, sr * 2, true); h.setUint16(32, 2, true); h.setUint16(34, 16, true); W(36, 'data'); h.setUint32(40, n * 2, true);
  const png = async (name, col) => { const c = document.createElement('canvas'); c.width = 96; c.height = 54; const g = c.getContext('2d'); g.fillStyle = col; g.fillRect(0, 0, 96, 54); return new File([await new Promise(r => c.toBlob(r, 'image/png'))], name + '.png', { type: 'image/png' }); };
  document.getElementById('audioSourceFile').click();
  await djApp.loadAudioFile(new File([h.buffer, L.buffer], 'sh-120.wav', { type: 'audio/wav' }), { autoplay: false });
  const e = djApp.clipEngine;
  e.addFiles([await png('A', '#c33'), await png('B', '#3a3'), await png('C', '#33c')]);
  for (let i = 0; i < 50 && !e.assets.every(a => a.ready); i++) await new Promise(r => setTimeout(r, 100));
  e.assets.forEach(a => { a.show = 'full'; });
  Object.assign(e.settings, { order: 'sequential', timingMode: 'manual', manualCount: 1, manualUnit: 'bar', transitionMode: 'jump' });
  const v = document.getElementById('visualMode'); v.value = 'clips'; v.dispatchEvent(new Event('change'));
  for (let i = 0; i < 100 && djApp.fastPass.state.stage !== 'done'; i++) await new Promise(r => setTimeout(r, 200));
  await new Promise(r => setTimeout(r, 700)); djApp.fastPass.flush();
});

// Repeats: images (and videos) appear at most N times; 0 = no limit.
const rp = await E(async () => {
  const e = djApp.clipEngine, by = (n) => e.assets.find(a => a.name === n);
  const count = () => Object.fromEntries(['A', 'B', 'C'].map(n => [n, e.edl().filter(s => s.clipId === by(n).id).length]));
  const before = count();
  e.setRepeats(by('A').id, 2);
  e.setRepeats(by('B').id, 3);
  await new Promise(r => setTimeout(r, 700)); djApp.fastPass.flush();
  const after = count();
  djApp.sidebar.open('assets'); e.select(by('A').id);
  await new Promise(r => setTimeout(r, 200));
  const ui = { field: document.getElementById('propRepeats') && document.getElementById('propRepeats').value, note: (document.getElementById('propRepeatsNote') || {}).textContent, tag: (document.querySelector(`.bin-card[data-id="${by('A').id}"] .bin-tag-text`) || {}).textContent };
  // every clip used up → they all play again (no empty screen)
  e.setRepeats(by('C').id, 1);
  await new Promise(r => setTimeout(r, 700)); djApp.fastPass.flush();
  const spent = count();
  const lastEnd = e.edl().filter(s => s.stream !== 'over').slice(-1)[0].end;
  const blob = await djApp.project.build();
  djApp.project.dirty = false;
  await djApp.project.open(new File([blob], 'sh.mnt'));
  const saved = ['A', 'B', 'C'].map(n => djApp.clipEngine.assets.find(a => a.name === n).repeats);
  return { before, after, spent, lastEnd, ui, saved };
});
ok('Repeats: an image set to 2 appears twice, one set to 3 three times; unlimited clips fill the rest', rp.after.A === 2 && rp.after.B === 3 && rp.after.C > rp.before.C, JSON.stringify({ before: rp.before, after: rp.after }));
ok('when every clip has used its repeats, they play again rather than leaving the screen empty', Math.abs(rp.lastEnd - 30) < 0.05 && rp.spent.A + rp.spent.B + rp.spent.C > 6, JSON.stringify(rp.spent));
ok('Repeats field, "used" note and ×N on the card; saved with the project', rp.ui.field === '2' && /2 of 2/.test(rp.ui.note) && /×2/.test(rp.ui.tag) && rp.saved.join() === '2,3,1', JSON.stringify(rp.ui) + ' saved ' + rp.saved);

// Shelves laid out like 01 File: a menu list with fold-out rows, left and right.
const sh = await E(() => {
  const panels = ['panel-output', 'panel-input', 'customMediaSection', 'panel-overlays', 'panel-autoedit'];
  return panels.map(id => { const p = document.getElementById(id); return { id, list: !!p.querySelector(':scope > ul.menu-list, :scope ul.menu-list'), folds: p.querySelectorAll('details.menu-sub').length }; });
});
ok('every shelf tab (left and right) is a menu list like 01 File, with fold-out rows', sh.every(p => p.list) && sh.filter(p => p.id !== 'panel-output').every(p => p.folds >= 2), JSON.stringify(sh));
const fold = await E(async () => {
  const d = document.getElementById('menuVoice');
  d.open = false; await new Promise(r => setTimeout(r, 50));
  return JSON.parse(localStorage.getItem('bssmnt.layout')).folds.menuVoice;
});
ok('a folded row stays folded (remembered)', fold === false);

// Ctrl+Space: only the picture; Esc or Ctrl+Space brings the shelves back.
const cv = async () => E(() => ({ clean: document.body.classList.contains('clean-view'), shelves: ['.topbar', '.bottom-area', '#sidebar', '#rightbar'].map(q => getComputedStyle(document.querySelector(q)).display), canvas: Math.round(djApp.visualizer.p5Instance.canvas.getBoundingClientRect().width) }));
await page.keyboard.down('Control'); await page.keyboard.press('Space'); await page.keyboard.up('Control'); await sleep(600);
const c1 = await cv();
await page.keyboard.press('Escape'); await sleep(400);
const c2 = await cv();
await page.keyboard.down('Control'); await page.keyboard.press('Space'); await page.keyboard.up('Control'); await sleep(300);
await page.keyboard.down('Control'); await page.keyboard.press('Space'); await page.keyboard.up('Control'); await sleep(400);
const c3 = await cv();
ok('Ctrl+Space hides every editing shelf (the picture fills the window)', c1.clean && c1.shelves.every(d => d === 'none') && c1.canvas >= 1590, JSON.stringify(c1));
ok('Esc, or Ctrl+Space again, brings the shelves back', !c2.clean && c2.shelves[1] !== 'none' && !c3.clean, JSON.stringify({ c2, c3 }));

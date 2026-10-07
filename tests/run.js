// Headless test runner (no visible windows).
//   node tests/run.js tests/alpha-open.js [url]
// Needs Node, Chrome or Edge installed, and puppeteer-core (any recent
// version: `npm i --no-save puppeteer-core`, or set NODE_PATH to a folder
// that has it). Serve the app first: `node serve.js` (http://127.0.0.1:8765).
// A test file is the body of an async function that receives
// { page, browser, sleep, log, ok, root } and reports lines "[test] PASS …".
const fs = require('fs');
const path = require('path');
const puppeteer = require('puppeteer-core');

const CANDIDATES = [
  process.env.CHROME,
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
].filter(Boolean);

(async () => {
  const [file, url = 'http://127.0.0.1:8765/index.html'] = process.argv.slice(2);
  const exe = CANDIDATES.find(p => fs.existsSync(p));
  if (!exe) throw new Error('Chrome or Edge not found (set CHROME=…)');
  const browser = await puppeteer.launch({
    executablePath: exe, headless: 'new',
    args: ['--autoplay-policy=no-user-gesture-required', '--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', '--enable-webgl', '--ignore-gpu-blocklist', '--window-size=1600,1000'],
    defaultViewport: { width: 1600, height: 1000 },
  });
  let fails = 0, passes = 0;
  const log = (m) => console.log(`[test] ${m}`);
  const ok = (name, cond, detail) => { cond ? passes++ : fails++; log(`${cond ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`); };
  try {
    const page = await browser.newPage();
    page.on('pageerror', e => console.log(`pageerror: ${e.message}`));
    page.on('dialog', d => d.accept());
    await page.goto(url, { waitUntil: 'networkidle0' });
    await new Promise(r => setTimeout(r, 1500));
    const body = fs.readFileSync(path.resolve(file), 'utf8');
    const fn = new Function('ctx', `const { page, browser, sleep, log, ok, root, url } = ctx; return (async () => { ${body} })();`);
    await fn({ page, browser, sleep: (ms) => new Promise(r => setTimeout(r, ms)), log, ok, root: path.resolve(__dirname, '..'), url });
  } finally {
    await browser.close();
  }
  console.log(`[test] ${passes} passed, ${fails} failed`);
  process.exit(fails ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });

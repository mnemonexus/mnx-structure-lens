// Looks at every screen of the add-on in the mock host: screenshots, and the kit's readability audit in 18 looks,
// at full-page size and at a narrow Session Mode panel size. The kit's own `check --screenshots` only measures the
// first screen, and most of this add-on's screens come after a click.
//
//   bun run dev "../Structure Lens" --port 4174        (in the kit folder; never port 1420)
//   node dev/shoot.mjs http://localhost:4174 shots
import { mkdirSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const KIT = process.env.MNX_KIT || resolve(HERE, '..', '..', 'mnx-addon-kit-release');
const { chromium } = createRequire(join(KIT, 'package.json'))('playwright');
const { auditScript } = await import(pathToFileURL(join(KIT, 'tools', 'src', 'contrast.mjs')).href);

const url = process.argv[2] || 'http://localhost:4174';
const out = resolve(process.argv[3] || 'shots');
const only = process.argv[4];
mkdirSync(out, { recursive: true });

const BASE = { mode: 'match', scheme: 'light', accent: null, corners: 8, edges: 'lines', reducedMotion: false, moreColours: true, solidBackdrop: false, lineWidth: 1, lineStrength: 100, shadowStrength: 100 };
const LOOKS = ['light', 'dark'].flatMap((scheme) => [
  { scheme, corners: 0, edges: 'lines' }, { scheme, corners: 16, edges: 'shadows' }, { scheme, corners: 8, edges: 'both' }, { scheme, corners: 8, edges: 'none' },
  { scheme, mode: 'custom', solidBackdrop: true }, { scheme, moreColours: false }, { scheme, reducedMotion: true },
]).map((p) => ({ ...BASE, ...p }));
const SIZES = { page: { width: 900, height: 900 }, panel: { width: 420, height: 800 } };

const catalogue = JSON.parse(readFileSync(join(HERE, '..', 'assets', 'practice', 'catalogue.json'), 'utf8'));
const LABEL = (catalogue.activities.find((a) => a.launch.k === 'label') ?? {}).id;
const FIND = (catalogue.activities.find((a) => a.launch.k === 'find') ?? {}).id;
const TYPED = ['Sigma factor', 'lid', 'rudder', 'exit channel', 'bridge helix', 'clamp', 'active site', 'template strand'];
const typeAll = (n) => TYPED.slice(0, n).map((t, i) => ['fill', `[data-answer=b${i + 1}]`, t]);
// 'wait' takes milliseconds; 'resolve' presses Show me and Next until the summary is open.
const VIEWS = [
  { name: 'home', steps: [['waitFor', '[data-view=home]']] },
  { name: 'label-answer', steps: [['click', `[data-activity=${LABEL}]`], ['waitFor', '[data-answer=b1]'], ['wait', '', 600], ...typeAll(3), ['click', '[data-action=check]'], ['click', '[data-action=hint]'], ['click', '[data-box=b2]']] },
  { name: 'label-bank', steps: [['click', `[data-activity=${LABEL}]`], ['waitFor', '[data-answer=b1]'], ['click', '[data-action=bank]'], ['waitFor', '[data-chip]'], ['click', '[data-chip]'], ['click', '[data-action=zoom-in]']] },
  { name: 'label-review', steps: [['click', `[data-activity=${LABEL}]`], ['waitFor', '[data-answer=b1]'], ...typeAll(3), ['click', '[data-action=finish-answering]'], ['waitFor', '[data-role=extra]'], ['wait', '', 600]] },
  { name: 'find', steps: [['click', `[data-activity=${FIND}]`], ['waitFor', '[data-role=ask]'], ['waitFor', '.sl-viewer canvas'], ['wait', '', 2500]] },
  { name: 'find-hint', steps: [['click', `[data-activity=${FIND}]`], ['waitFor', '[data-role=ask]'], ['waitFor', '.sl-viewer canvas'], ['wait', '', 2000], ['click', '[data-action=hint]'], ['click', '.sl-viewer'], ['wait', '', 400]] },
  { name: 'find-found', steps: [['click', `[data-activity=${FIND}]`], ['waitFor', '[data-role=ask]'], ['waitFor', '.sl-viewer canvas'], ['wait', '', 2000], ['click', '[data-action=show-me]'], ['wait', '', 1000]] },
  { name: 'find-review', steps: [['click', `[data-activity=${FIND}]`], ['waitFor', '[data-role=ask]'], ['waitFor', '.sl-viewer canvas'], ['wait', '', 1500], ['resolve'], ['waitFor', '[data-role=tally]']] },
  { name: 'end-confirm', steps: [['click', `[data-activity=${LABEL}]`], ['waitFor', '[data-answer=b1]'], ['click', '[data-action=end]'], ['waitFor', '[data-action=confirm-end]']] },
];

const browser = await chromium.launch({ executablePath: process.env.MNX_CHROMIUM || undefined });
const problems = [];
for (const [sizeName, size] of Object.entries(SIZES)) {
  for (const view of VIEWS) {
    if (only && !`${sizeName}-${view.name}`.includes(only)) continue;
    const context = await browser.newContext({ viewport: { width: 1360, height: 1000 } });
    const page = await context.newPage();
    page.on('pageerror', (e) => problems.push(`${sizeName}/${view.name}: page error ${e.message}`));
    await page.goto(`${url}?scenario=standalone-list&theme=light`);
    await page.evaluate(() => window.__mnxMock.ready());
    await page.evaluate(() => window.__mnxMock.launch());
    await page.waitForFunction(() => window.__mnxMock.snapshot().currentReady);
    await page.evaluate(({ width, height }) => { const f = document.getElementById('addon-frame'); f.style.width = `${width}px`; f.style.height = `${height}px`; f.style.margin = '0'; f.parentElement.style.alignItems = 'flex-start'; f.parentElement.style.justifyContent = 'flex-start'; }, size);
    const frame = page.frameLocator('#addon-frame');
    try {
      for (const [type, selector, text] of view.steps) {
        if (type === 'click') await frame.locator(selector).first().click({ timeout: 5000 });
        else if (type === 'fill') await frame.locator(selector).first().fill(text, { timeout: 5000 });
        else if (type === 'waitFor') await frame.locator(selector).first().waitFor({ state: 'visible', timeout: 15000 });
        else if (type === 'wait') await page.waitForTimeout(text);
        else if (type === 'resolve') {
          for (let k = 0; k < 6; k++) {
            if (await frame.locator('[data-action=summary]').count()) { await frame.locator('[data-action=summary]').click(); break; }
            if (await frame.locator('[data-action=show-me]').count()) await frame.locator('[data-action=show-me]').click();
            if (await frame.locator('[data-action=next]').count()) await frame.locator('[data-action=next]').click();
          }
        }
      }
    } catch (e) { problems.push(`${sizeName}/${view.name}: ${String(e.message).split('\n')[0]}`); await context.close(); continue; }
    await page.waitForTimeout(400);
    const handle = await (await page.$('#addon-frame')).contentFrame();
    await handle.evaluate(`(() => { const s = document.createElement('style'); s.textContent = '*,*::before,*::after{transition:none!important;animation:none!important}'; document.head.appendChild(s); })()`);
    const found = new Map();
    for (const look of LOOKS) {
      await page.evaluate((patch) => window.__mnxMock.setTheme(patch), look);
      await page.waitForTimeout(100);
      const label = `${look.scheme}${look.mode === 'custom' ? '+custom' : ''}${look.edges !== 'lines' ? `+${look.edges}` : ''}${look.corners === 0 ? '+square' : look.corners === 16 ? '+round' : ''}${look.moreColours ? '' : '+fewer'}${look.reducedMotion ? '+reduced' : ''}`;
      const result = await handle.evaluate(auditScript());
      for (const f of result.failures) {
        const key = `${f.element}|${f.text}`;
        const row = found.get(key) ?? { ...f, looks: [] }; row.looks.push(label); found.set(key, row);
      }
      if (['light+square', 'dark+square', 'dark+custom', 'light+shadows+round'].includes(label)) {
        await page.screenshot({ path: join(out, `${sizeName}-${view.name}-${label}.png`), clip: { x: 0, y: 0, width: size.width + 40, height: Math.min(size.height + 140, 1000) } });
        // The whole document, not just the visible part of the frame.
        const height = await handle.evaluate('document.querySelector(".sl-root")?.scrollHeight ?? document.documentElement.scrollHeight');
        if (height > size.height && label === 'light+square') {
          await page.evaluate(({ width, h }) => { const f = document.getElementById('addon-frame'); f.style.height = `${Math.min(h, 6000)}px`; }, { width: size.width, h: height });
          await page.waitForTimeout(150);
          await page.screenshot({ path: join(out, `${sizeName}-${view.name}-${label}-full.png`), clip: { x: 0, y: 0, width: size.width + 40, height: Math.min(height + 140, 6000) }, fullPage: true });
          await page.evaluate(({ h }) => { document.getElementById('addon-frame').style.height = `${h}px`; }, { h: size.height });
        }
      }
    }
    for (const row of found.values()) problems.push(`${sizeName}/${view.name}: "${row.text}" (${row.element}) ${row.ratio}:1 needs ${row.required}:1 in ${row.looks.length} looks (${row.looks.slice(0, 3).join(', ')})`);
    const state = await page.evaluate(() => window.__mnxMock.snapshot());
    for (const e of state.errors) problems.push(`${sizeName}/${view.name}: add-on error ${e}`);
    console.log(`${sizeName}/${view.name}: done`);
    await context.close();
  }
}
await browser.close();
console.log(problems.length ? `\n${problems.length} problem(s):\n${problems.join('\n')}` : '\nno problems');
process.exitCode = problems.length ? 1 : 0;

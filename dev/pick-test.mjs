// Opens each find activity in the kit's mock host and checks that every target can really be clicked:
// for each target, the viewer is zoomed to it, turned through a ring of orientations, and at each one the residue
// under the target's own picking atom is looked up (what a click there would resolve to). Then one real mouse click
// is made at the best orientation and the add-on's feedback is read. A target that is hit in no orientation is
// reported: it cannot be found by clicking and the activity needs another feature or another view.
//
//   (in the kit folder)  bun run dev "../../Structure Lens" --port 4175
//   node dev/pick-test.mjs http://127.0.0.1:4175 [activity-id ...]
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const KIT = process.env.MNX_KIT || resolve(HERE, '..', '..', 'mnx-addon-kit-release');
const { chromium } = createRequire(join(KIT, 'package.json'))('playwright');
const url = process.argv[2] || 'http://127.0.0.1:4175';
const wanted = process.argv.slice(3);
const catalogue = JSON.parse(readFileSync(join(HERE, '..', 'assets', 'practice', 'catalogue.json'), 'utf8'));
const ids = catalogue.activities.filter((a) => a.launch.k === 'find' && (!wanted.length || wanted.includes(a.id))).map((a) => a.id);

const browser = await chromium.launch({ executablePath: process.env.MNX_CHROMIUM || undefined });
const problems = [];
const rows = [];
for (const id of ids) {
  const context = await browser.newContext({ viewport: { width: 1360, height: 1000 } });
  const page = await context.newPage();
  page.on('pageerror', (e) => problems.push(`${id}: page error ${e.message}`));
  await page.goto(`${url}?scenario=standalone-list&theme=light`);
  await page.evaluate(() => window.__mnxMock.ready());
  await page.evaluate(() => window.__mnxMock.launch());
  await page.waitForFunction(() => window.__mnxMock.snapshot().currentReady);
  await page.evaluate(() => { const f = document.getElementById('addon-frame'); f.style.width = '1000px'; f.style.height = '900px'; f.style.margin = '0'; });
  const frame = page.frameLocator('#addon-frame');
  await frame.locator(`[data-activity="${id}"]`).click();
  const started = Date.now();
  try { await frame.locator('[data-role=ask]').waitFor({ state: 'visible', timeout: 20000 }); } catch { problems.push(`${id}: did not open`); await context.close(); continue; }
  const handle = await (await page.$('#addon-frame')).contentFrame();
  try { await handle.waitForFunction(() => window.__structureLens && window.__structureLens.view, null, { timeout: 90000 }); } catch { problems.push(`${id}: the 3D view did not start`); await context.close(); continue; }
  const loaded = Date.now() - started;
  const report = await handle.evaluate(async () => {
    const { view, targets } = window.__structureLens;
    const out = { atoms: view.atomCount, chains: view.chains.length, targets: [] };
    for (const t of targets) {
      const residues = view.residuesOf(t.select);
      const row = { id: t.id, name: t.name, residues: residues.length, hits: 0, tries: 0, best: null };
      if (!residues.length) { out.targets.push(row); continue; }
      view.focus(t.select);
      await new Promise((r) => setTimeout(r, 700));
      for (const axis of ['y', 'x']) {
        for (let k = 0; k < 12; k++) {
          view.rotate(30, axis);
          // the same ring of positions for every residue of the target: a hit on any of them counts, as it does in a click
          let hit = null;
          for (const r of residues.slice(0, 40)) {
            const at = view.screenOf(r);
            if (!at) continue;
            const got = view.pickAt(at.x, at.y);
            if (got && got.chain === r.chain && got.resi === r.resi) { hit = { at, r }; break; }
          }
          row.tries++;
          if (hit) { row.hits++; row.best ??= hit.at; }
        }
      }
      out.targets.push(row);
    }
    return out;
  });
  for (const t of report.targets) {
    const status = t.residues === 0 ? 'NOT FOUND' : t.hits === 0 ? 'NEVER HIT' : `${t.hits}/${t.tries}`;
    rows.push(`${id} ${t.id} ${t.name}: ${t.residues} residue(s), clickable in ${status}`);
    if (t.residues === 0 || t.hits === 0) problems.push(`${id} ${t.id} ${t.name}: ${status}`);
  }
  // One real click on the first target, to test the event path.
  const real = await handle.evaluate(async () => {
    const { view, targets } = window.__structureLens;
    view.reset();
    await new Promise((r) => setTimeout(r, 300));
    const t = targets[0];
    view.focus(t.select);
    await new Promise((r) => setTimeout(r, 700));
    const rect = document.querySelector('.sl-viewer').getBoundingClientRect();
    for (let k = 0; k < 36; k++) {
      for (const r of view.residuesOf(t.select).slice(0, 40)) {
        const at = view.screenOf(r);
        const got = at && view.pickAt(at.x, at.y);
        if (got && got.chain === r.chain && got.resi === r.resi) return { x: at.x - rect.left, y: at.y - rect.top, ok: true };
      }
      view.rotate(10, 'y');
    }
    return { ok: false };
  });
  if (real.ok) {
    await frame.locator('.sl-viewer').click({ position: { x: real.x, y: real.y } });
    await page.waitForTimeout(300);
    const text = await frame.locator('[data-role=feedback]').innerText();
    rows.push(`${id}: a real click on ${(await frame.locator('[data-role=ask]').innerText())} -> "${text.replace(/\s+/g, ' ').slice(0, 90)}"`);
    if (!/^\W*Yes/.test(text)) problems.push(`${id}: a real click on the first target was not accepted: ${text}`);
  } else problems.push(`${id}: no orientation found for a real click`);
  rows.push(`${id}: ${report.atoms} atoms, ${report.chains} chains, opened in ${(loaded / 1000).toFixed(1)} s`);
  await context.close();
}
await browser.close();
console.log(rows.join('\n'));
console.log(problems.length ? `\n${problems.length} problem(s):\n${problems.join('\n')}` : '\nno problems');
process.exitCode = problems.length ? 1 : 0;

// The kit's mock host cannot launch an add-on as a practice-v1 activity (props.practice), which is how the app
// opens it from Session Mode, the recall queue and the planner. This adds props.practice to the `init` message
// inside the frame and checks that the add-on opens that activity directly (no list, no Back button), shows why it
// was offered, and reports a practice result the host's checks accept. One label activity and one find activity.
//
//   (in the kit folder)  bun run dev "../../Structure Lens" --port 4175
//   node dev/practice-launch.mjs http://127.0.0.1:4175
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const KIT = process.env.MNX_KIT || resolve(HERE, '..', '..', 'mnx-addon-kit-release');
const { chromium } = createRequire(join(KIT, 'package.json'))('playwright');
const url = process.argv[2] || 'http://127.0.0.1:4175';
const catalogue = JSON.parse(readFileSync(join(HERE, '..', 'assets', 'practice', 'catalogue.json'), 'utf8'));
const labelId = (catalogue.activities.find((a) => a.launch.k === 'label') ?? {}).id;
const findId = (catalogue.activities.find((a) => a.launch.k === 'find') ?? {}).id;

const browser = await chromium.launch({ executablePath: process.env.MNX_CHROMIUM || undefined });
const problems = [];
const check = (ok, what) => { console.log(`${ok ? 'ok  ' : 'FAIL'} ${what}`); if (!ok) problems.push(what); };

for (const [kind, activityId] of [['label', labelId], ['find', findId]]) {
  const context = await browser.newContext({ viewport: { width: 1200, height: 900 } });
  const entry = catalogue.activities.find((a) => a.id === activityId);
  await context.addInitScript(({ activityId, launch }) => {
    window.addEventListener('message', (event) => {
      const data = event.data;
      if (data && data.kind === 'init' && data.props && !data.props.kind?.startsWith?.('addon-job')) {
        data.props.practice = { version: 1, activityId, launch, reason: 'it matches what you are studying', timeBudgetSeconds: 600 };
      }
    }, true);
  }, { activityId, launch: entry.launch });
  const page = await context.newPage();
  await page.goto(`${url}?scenario=standalone-list&theme=light`);
  await page.evaluate(() => window.__mnxMock.ready());
  await page.evaluate(() => window.__mnxMock.launch());
  await page.waitForFunction(() => window.__mnxMock.snapshot().currentReady);
  const frame = page.frameLocator('#addon-frame');
  await frame.locator('[data-view=activity]').waitFor({ state: 'visible', timeout: 15000 });
  check(await frame.locator('[data-view=home]').count() === 0, `${kind}: opens the activity, not the list`);
  check(await frame.locator('[data-action=back]').count() === 0, `${kind}: no Back button`);
  check((await frame.locator('[data-role=reason]').innerText()).includes('it matches what you are studying'), `${kind}: shows why it was offered`);
  if (kind === 'label') {
    const n = await frame.locator('[data-answer]').count();
    for (let i = 1; i <= n; i++) await frame.locator(`[data-answer=b${i}]`).fill('not sure');
    await frame.locator('[data-action=finish-answering]').click();
    await frame.locator('[data-role=extra]').first().waitFor({ state: 'visible' });
  } else {
    await frame.locator('[data-role=ask]').waitFor({ state: 'visible' });
    for (let k = 0; k < 6; k++) {
      if (await frame.locator('[data-action=summary]').count()) { await frame.locator('[data-action=summary]').click(); break; }
      await frame.locator('[data-action=show-me]').click();
      if (await frame.locator('[data-action=next]').count()) await frame.locator('[data-action=next]').click();
    }
    await frame.locator('[data-role=tally]').waitFor({ state: 'visible' });
  }
  await frame.locator('[data-action=finish]').click();
  const state = await page.waitForFunction(() => window.__mnxMock.snapshot().results.length > 0).then(() => page.evaluate(() => window.__mnxMock.snapshot()));
  const row = state.results.at(-1);
  check(row.ok, `${kind}: the host's checks pass the result${row.ok ? '' : ` (${row.checks.filter((c) => !c.pass).map((c) => c.rule).join('; ')})`}`);
  check(state.errors.length === 0, `${kind}: no errors`);
  await context.close();
}
await browser.close();
process.exitCode = problems.length ? 1 : 0;

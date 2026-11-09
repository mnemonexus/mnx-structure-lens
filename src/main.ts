/** Structure Lens: name the hidden labels on a lecture figure, or find the feature in a real 3D structure (practice-v1). */
import { getExperienceHost } from '@mnemonexus/addon-sdk';
import { installUi } from '@mnemonexus/addon-ui';
import './style.css';
import { loadActivity, loadCatalogue } from './data';
import { button, empty, h } from './dom';
import { openFind } from './find';
import { openHome } from './home';
import { openLabel } from './label';
import { makeStore } from './store';
import type { Settings } from './shell';
import type { CatalogueEntry, FindActivity, LabelActivity, Launch } from './types';

const host = getExperienceHost();
installUi();
const store = makeStore(host);

const settings = (): Settings => {
  const s = (host.props.settings ?? {}) as Record<string, unknown>;
  return { showHints: s.showHints !== false, labelAnswers: s.labelAnswers === 'pick' ? 'pick' : 'type', lighter: s.lighter === true };
};
host.onUpdate(() => {
  host.root.querySelectorAll<HTMLElement & { settingsChanged?: () => void }>('.sl-root').forEach((node) => node.settingsChanged?.());
});

function fail(message: string) {
  empty(host.root);
  host.root.append(h('div', { class: 'sl-root' }, h('main', { class: 'sl-main' },
    h('div', { class: 'mnx-error', role: 'alert' }, h('p', { class: 'mnx-error__title' }, 'This could not be opened'), h('p', { class: 'mnx-error__text' }, message)),
    button('Close', 'secondary', () => host.exit(), { 'data-action': 'close' }))));
}

async function run() {
  const entries = await loadCatalogue(host);
  const practice = host.props.practice;
  const show = async (entry: CatalogueEntry, onBack?: () => void, reason?: string) => {
    const launch = entry.launch as unknown as Launch;
    const activity = await loadActivity(host, launch.k, launch.a);
    if (!activity) { fail('This activity is not in the pack. The pack may need reinstalling.'); return; }
    const deps = { host, store, settings, onBack, reason };
    if (activity.kind === 'label') await openLabel(host.root, deps, activity as LabelActivity);
    else await openFind(host.root, deps, activity as FindActivity);
  };
  if (practice) {
    const wanted = (practice.launch as { a?: string }).a;
    const entry = entries.find((e) => e.id === practice.activityId) ?? entries.find((e) => e.id === wanted);
    if (!entry) { fail('This activity is not in the pack. The pack may need reinstalling.'); return; }
    await show(entry, undefined, practice.reason || undefined);
    return;
  }
  const home = (): Promise<void> => openHome(host.root, {
    host, store, entries,
    onOpen: (entry) => { show(entry, () => { void home(); }).catch((error) => fail(String((error as Error)?.message ?? error))); },
  });
  await home();
}

run().catch((error) => fail(String((error as Error)?.message ?? error)));

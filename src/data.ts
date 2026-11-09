/** Reading the catalogue, the activities and the figures and structures from the pack's assets. */
import type { ExperienceHost } from '@mnemonexus/addon-sdk';
import type { PracticeCatalogue } from '@mnemonexus/addon-sdk/practice';
import type { Activity, CatalogueEntry, FindActivity, Kind, LabelActivity } from './types';

const decode = (buffer: ArrayBuffer) => new TextDecoder().decode(buffer);

export async function loadCatalogue(host: ExperienceHost): Promise<CatalogueEntry[]> {
  const catalogue = JSON.parse(decode(await host.asset('assets/practice/catalogue.json'))) as PracticeCatalogue;
  return catalogue.activities as CatalogueEntry[];
}

const files = new Map<Kind, Promise<Record<string, Activity>>>();
export async function loadActivity(host: ExperienceHost, kind: Kind, id: string): Promise<Activity | null> {
  let pending = files.get(kind);
  if (!pending) {
    const path = kind === 'label' ? 'assets/content/labels.json' : 'assets/content/structures.json';
    pending = host.asset(path).then((buffer) => (JSON.parse(decode(buffer)) as { activities: Record<string, Activity> }).activities);
    files.set(kind, pending);
    pending.catch(() => files.delete(kind));
  }
  return (await pending)[id] ?? null;
}
export const isLabel = (a: Activity): a is LabelActivity => a.kind === 'label';
export const isFind = (a: Activity): a is FindActivity => a.kind === 'find';

const urls = new Map<string, Promise<string>>();
/** The sandbox only shows images from blob: and data: URLs. */
export function figureUrl(host: ExperienceHost, src: string): Promise<string> {
  let url = urls.get(src);
  if (!url) {
    url = host.asset(src).then((buffer) => URL.createObjectURL(new Blob([buffer], { type: 'image/png' })));
    urls.set(src, url);
    url.catch(() => urls.delete(src));
  }
  return url;
}

const structures = new Map<string, Promise<string>>();
/** The text of one mmCIF file. */
export function structureText(host: ExperienceHost, path: string): Promise<string> {
  let text = structures.get(path);
  if (!text) {
    text = host.asset(path).then(decode);
    structures.set(path, text);
    text.catch(() => structures.delete(path));
  }
  return text;
}

import { ICON_DATA } from './iconPaths';

export interface BrandIcon { name: string; group: string; d: string }
export const ICONS: BrandIcon[] = ICON_DATA.map((row) => { const [group, name, d] = row.split('|'); return { group, name, d }; });
export const ICON_NAMES = new Set(ICONS.map((i) => i.name));
const BY = new Map(ICONS.map((i) => [i.name, i]));
export const iconPath = (name: string): string => BY.get(name)?.d ?? '';
export const ICON_GROUP_IDS = [...new Set(ICONS.map((i) => i.group))];
/** Search by name words ("home roof") inside an optional group. */
export function searchIcons(query: string, group: string): BrandIcon[] {
  const words = query.toLowerCase().split(/[\s-]+/).filter(Boolean);
  return ICONS.filter((i) => (group === 'all' || i.group === group) && words.every((w) => i.name.includes(w)));
}

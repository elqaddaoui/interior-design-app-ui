/** Texts of Backup & Restore and API Health (namespace `bk`). The table is shared with the Super Admin console: see src/lib/backupTexts.ts. */
import { BK } from '@/lib/backupTexts';

type Tree = { [k: string]: string | Tree };
const build = (col: 1 | 2 | 3): Tree => {
  const out: Tree = {};
  for (const [key, row] of Object.entries(BK)) {
    const [group, ...rest] = key.split('.');
    const leaf = rest.join('.');
    const node = (out[group] ||= {}) as Tree;
    node[leaf] = row[col].replace(/\{(\w+)\}/g, '{{$1}}');
  }
  return out;
};
export const backupTexts = { fr: build(1), ar: build(2), dar: build(3) };

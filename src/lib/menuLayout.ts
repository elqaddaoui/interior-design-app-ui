/**
 * Geometry of the admin side menu. The sliding indicator of the animated designs needs the exact top of every row, so the menu is laid out with
 * FIXED heights (row, gap, group header, gap between groups) and the same numbers are used here to compute where the indicator must go.
 * Expanded and collapsed use the SAME geometry (the collapsed rail only hides the labels and shows a hairline in the group header), so
 * collapsing never moves a row vertically and the sidebar width can be animated on its own.
 */
export const MENU_GEO = { row: 44, gap: 2, head: 26, groupGap: 14, wide: 272, rail: 68 } as const;

export function menuPositions(groups: { key: string; items: { key: string }[] }[], geo: { row: number; gap: number; head: number; groupGap: number } = MENU_GEO): { y: Record<string, number>; height: number } {
  const y: Record<string, number> = {};
  let at = 0;
  groups.forEach((g, gi) => {
    at += geo.head;
    g.items.forEach((n, i) => { y[n.key] = at; at += geo.row; if (i < g.items.length - 1) at += geo.gap; });
    if (gi < groups.length - 1) at += geo.groupGap;
  });
  return { y, height: at };
}

/** The menu entry that matches the current path (the dashboard only on the exact path). */
export function activeKey(items: { key: string; href: string }[], path: string): string | undefined {
  const p = path.replace(/\/$/, '') || '/';
  return items.find((n) => (n.href === '/admin' ? p === '/admin' : p === n.href))?.key;
}

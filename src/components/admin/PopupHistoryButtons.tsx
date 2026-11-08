import React from 'react';
import { HistoryPair } from '@/components/admin/HistoryButtons';
import type { PopupApi } from '@/lib/popupHistory';

/** Undo / redo icons for the header of a popup (same pair as the admin bar, scoped to the popup's own steps). */
export function PopupHistoryButtons({ api, prefix = 'popup' }: { api: PopupApi; prefix?: string }) {
  return <HistoryPair prefix={prefix} size="sm" filled={false} undo={{ on: api.canUndo, run: api.undo }} redo={{ on: api.canRedo, run: api.redo }} />;
}

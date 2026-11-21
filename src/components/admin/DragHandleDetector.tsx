/* eslint-disable react-hooks/immutability -- the gesture callbacks run outside render and deliberately write to the mutable holders `last` and `latest` (see DragRow). */
import React, { useMemo } from 'react';
import { Platform } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import { withTiming, type SharedValue } from 'react-native-reanimated';
import type { Reorder } from './DragReorder';

/** The gesture half of a drag handle. Lives in its own file so the gesture library loads on demand (see GestureKit.tsx). */
export interface DragLatest { reorder: Reorder; committed: boolean }
export function DragHandleDetector({ id, reorder, place, reset, lift, tx, last, latest, children }: {
  id: string; reorder: Reorder; place: () => void; reset: () => void; lift: SharedValue<number>; tx: SharedValue<number>;
  last: { x: number; y: number }; latest: DragLatest; children: React.ReactElement;
}) {
  const pan = useMemo(() => {
    const gesture = Gesture.Pan().runOnJS(true).enabled(reorder.enabled).shouldCancelWhenOutside(false).minDistance(Platform.OS === 'web' ? 2 : 0)
      .onStart(() => {
        latest.committed = false;
        last.x = 0; last.y = 0;
        latest.reorder.follow.current = place;
        lift.set(withTiming(1, { duration: 120 }));
        void latest.reorder.begin(id);
      })
      .onUpdate((e) => {
        last.x = e.translationX; last.y = e.translationY;
        tx.set(e.translationX);
        place();
        latest.reorder.update(e.absoluteX, e.absoluteY);
      })
      .onEnd((_e, success) => { latest.committed = success; })
      .onFinalize(() => {
        if (latest.reorder.follow.current === place) latest.reorder.follow.current = null;
        reset();
        // Only a drag that really started has an active state to finish.
        if (latest.reorder.drag?.id === id) latest.reorder.finish(latest.committed);
      });
    // On touch screens the handle waits briefly so a swipe that merely starts on it still scrolls the page.
    return Platform.OS === 'web' ? gesture : gesture.activateAfterLongPress(140);
  }, [reorder.enabled, id, place, reset, lift, tx, last, latest]);
  return <GestureDetector gesture={pan}>{children}</GestureDetector>;
}

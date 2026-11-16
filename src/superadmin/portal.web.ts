import type React from 'react';
import { createPortal } from 'react-dom';

/**
 * Draws `node` on <body>. `position: fixed` is only relative to the screen when no ancestor has a transform; the console's ScrollView
 * (react-native-web) is `translateZ(0)`, which makes IT the reference and sent tooltips far from their button.
 */
export const onBody = (node: React.ReactNode): React.ReactNode => (typeof document !== 'undefined' && node ? createPortal(node, document.body) : node);

import type React from 'react';

/** Native: there is no document to draw on, the node stays where it is. (The web version is portal.web.ts.) */
export const onBody = (node: React.ReactNode): React.ReactNode => node;

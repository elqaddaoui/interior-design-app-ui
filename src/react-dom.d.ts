/** Only what the web tooltip portal needs (src/superadmin/portal.web.ts); the package ships no types and @types/react-dom is not installed. */
declare module 'react-dom' {
  import type { ReactNode } from 'react';
  export function createPortal(children: ReactNode, container: Element): ReactNode;
}

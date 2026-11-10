import React from 'react';
import { Redirect, Slot, usePathname } from 'expo-router';
import { AdminShell } from '@/components/admin/AdminShell';
import { ContextMenuHost } from '@/components/admin/ContextMenu';
import { isAdminLoginPath, loginHref } from '@/lib/loginRoutes';
import { useLocal } from '@/store/useLocal';
import { useIsAdmin } from '@/store/useStore';
import { featureForPath, levelOf, useAccess } from '@/store/useAccess';
import { ForbiddenPage } from '@/components/admin/ForbiddenPage';
import { ReadOnlyProvider } from '@/components/ui/ReadOnly';

/**
 * Admin guard: needs a server session AND an administrator. Without one every /admin/* address leads to /admin/login
 * (which remembers where the person wanted to go); /admin/login itself is shown without the panel.
 */
export default function AdminLayout() {
  const session = useLocal((s) => s.adminSession);
  const isAdmin = useIsAdmin();
  const info = useAccess((s) => s.info);
  const path = usePathname();
  if (isAdminLoginPath(path)) return <Slot />;
  if (!session || !isAdmin) return <Redirect href={loginHref('admin', path) as never} />;
  // A page the plan or role does not include is never rendered (the server refuses its data as well).
  const level = levelOf(info, featureForPath(path));
  const blocked = level === 'none';
  // A view-only page keeps showing everything, but every shared control that would change something switches itself off.
  return <ReadOnlyProvider value={level === 'view'}><AdminShell>{blocked ? <ForbiddenPage /> : <Slot />}</AdminShell><ContextMenuHost /></ReadOnlyProvider>;
}

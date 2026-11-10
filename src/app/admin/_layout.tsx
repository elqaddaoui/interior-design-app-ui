import React from 'react';
import { Redirect, Slot, usePathname } from 'expo-router';
import { AdminShell } from '@/components/admin/AdminShell';
import { ContextMenuHost } from '@/components/admin/ContextMenu';
import { canOpen } from '@/lib/access';
import { pageKeyOf } from '@/lib/adminNav';
import { isAdminLoginPath, loginHref } from '@/lib/loginRoutes';
import { useAdminProfile } from '@/store/useAdminProfile';
import { useLocal } from '@/store/useLocal';
import { useIsAdmin } from '@/store/useStore';

/**
 * Admin guard: needs a server session AND an administrator. Without one every /admin/* address leads to /admin/login
 * (which remembers where the person wanted to go); /admin/login itself is shown without the panel.
 */
export default function AdminLayout() {
  const session = useLocal((s) => s.adminSession);
  const isAdmin = useIsAdmin();
  const path = usePathname();
  const access = useAdminProfile((s) => s.access);
  if (isAdminLoginPath(path)) return <Slot />;
  if (!session || !isAdmin) return <Redirect href={loginHref('admin', path) as never} />;
  // A page the Super Admin did not grant leads back to the dashboard (the server refuses its data anyway).
  const page = pageKeyOf(path);
  if (page && !canOpen(access, page)) return <Redirect href="/admin" />;
  return <><AdminShell><Slot /></AdminShell><ContextMenuHost /></>;
}

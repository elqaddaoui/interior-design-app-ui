import React, { useEffect } from 'react';
import { View } from 'react-native';
import { Redirect, Slot, usePathname } from 'expo-router';
import { SaShell } from '@/components/superadmin/SaShell';
import { PasswordPrompt } from '@/components/superadmin/PasswordPrompt';
import { Spinner } from '@/components/ui/Spinner';
import { SUPER_HOME } from '@/lib/superRoutes';
import { useSuperAdmin } from '@/store/useSuperAdmin';

/**
 * Super Admin guard. /superadmin itself is the sign-in page (and sends a signed-in owner to the dashboard); every other
 * /superadmin/* address needs the Super Admin session and otherwise leads back to /superadmin.
 */
export default function SuperAdminLayout() {
  const status = useSuperAdmin((s) => s.status);
  const path = usePathname().replace(/\/+$/, '') || '/';
  useEffect(() => { void useSuperAdmin.getState().check(); }, []);
  if (status === 'unknown') return <View testID="sa-boot" className="flex-1 bg-ink items-center justify-center"><Spinner size={48} /></View>;
  if (path === SUPER_HOME) return <Slot />;
  if (status !== 'in') return <Redirect href={SUPER_HOME as never} />;
  return <><SaShell><Slot /></SaShell><PasswordPrompt /></>;
}

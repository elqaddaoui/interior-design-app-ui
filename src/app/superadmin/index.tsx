import React from 'react';
import { Redirect } from 'expo-router';
import { SaLogin } from '@/components/superadmin/SaLogin';
import { SUPER_DASH } from '@/lib/superRoutes';
import { useSuperAdmin } from '@/store/useSuperAdmin';

/** /superadmin: the dedicated sign-in page. A signed-in Super Admin goes straight to the dashboard. */
export default function SuperAdminIndex() {
  const status = useSuperAdmin((s) => s.status);
  if (status === 'in') return <Redirect href={SUPER_DASH as never} />;
  return <SaLogin />;
}

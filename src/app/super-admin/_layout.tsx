import React from 'react';
import { Slot } from 'expo-router';
import { SuperShell } from '@/superadmin/Shell';

/** Everything under /super-admin: its own shell, its own session, its own hard-coded style (src/superadmin/tokens.ts). */
export default function SuperAdminLayout() {
  return <SuperShell><Slot /></SuperShell>;
}

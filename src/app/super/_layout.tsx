import React, { useEffect } from 'react';
import { View } from 'react-native';
import { Slot } from 'expo-router';
import { Spinner } from '@/components/ui/Spinner';
import { SuperLogin } from '@/components/super/SuperLogin';
import { SuperShell } from '@/components/super/SuperShell';
import { useSuper } from '@/store/useSuper';

/** Super Admin guard: only a valid /api/super session reaches the pages; everything else sees the Super Admin login. */
export default function SuperLayout() {
  const checked = useSuper((s) => s.checked);
  const signedIn = useSuper((s) => s.signedIn);
  useEffect(() => { void useSuper.getState().check(); }, []);
  if (!checked) return <View className="flex-1 items-center justify-center bg-ink"><Spinner size={28} /></View>;
  if (!signedIn) return <SuperLogin />;
  return <SuperShell><Slot /></SuperShell>;
}

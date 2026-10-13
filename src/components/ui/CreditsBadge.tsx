import React from 'react';
import { Pressable, View } from 'react-native';
import { router } from '@/hooks/useLeaveGuard';
import { Txt } from './Txt';
import { Icon } from './Icon';
import { useMe } from '@/store/useStore';

export function CreditsBadge() {
  const me = useMe();
  return (
    <Pressable testID="credits-badge" onPress={() => router.push('/pro')} className="flex-row items-center gap-1.5 bg-primary rounded-lg px-2.5 h-8 active:opacity-80">
      <Icon name="star-four-points" size={15} tone="onprimary" />
      <Txt className="text-onprimary font-extrabold text-[14px]">{me?.credits ?? 0}</Txt>
    </Pressable>
  );
}

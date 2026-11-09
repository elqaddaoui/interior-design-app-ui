import React from 'react';
import { View } from 'react-native';
import { MediaView } from '@/components/ui/MediaView';
import { Txt } from '@/components/ui/Txt';
import { initialsOf } from '@/lib/adminAccount';

/** Round picture of the signed-in administrator; initials on the soft tint when there is none. */
export function AdminAvatar({ name, uri, size = 34 }: { name: string; uri?: string; size?: number }) {
  if (uri) return <View style={{ width: size, height: size, borderRadius: size / 2, overflow: 'hidden' }}><MediaView uri={uri} style={{ width: size, height: size }} /></View>;
  return <View className="bg-soft items-center justify-center" style={{ width: size, height: size, borderRadius: size / 2 }}><Txt className="font-extrabold" style={{ fontSize: size * 0.38 }}>{initialsOf(name)}</Txt></View>;
}

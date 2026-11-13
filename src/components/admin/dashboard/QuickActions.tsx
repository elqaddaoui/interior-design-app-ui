import React, { useState } from 'react';
import { Pressable, View } from 'react-native';
import { Icon } from '@/components/ui/Icon';
import { Txt } from '@/components/ui/Txt';
import { useRouter } from '@/hooks/useLeaveGuard';
import { useBp } from '@/hooks/useBp';
import { useT } from '@/i18n';
import { Panel } from './Kit';

interface Tile { id: string; icon: string; label: string; badge?: number; hot?: boolean; onPress: () => void }
interface Group { key: string; title: string; tiles: Tile[] }

function TileButton({ tile }: { tile: Tile }) {
  const [hov, setHov] = useState(false);
  const live = !!tile.badge && tile.badge > 0;
  return (
    <Pressable testID={`quick-${tile.id}`} accessibilityRole="button" accessibilityLabel={live ? `${tile.label}: ${tile.badge}` : tile.label} onPress={tile.onPress}
      onHoverIn={() => setHov(true)} onHoverOut={() => setHov(false)}
      className={`flex-row items-center gap-2.5 rounded-2xl px-2.5 h-[52px] border ${hov ? 'bg-surface border-ink' : 'bg-surface2 border-transparent'}`}
      style={{ flexGrow: 1, flexBasis: 138, minWidth: 0, transition: 'background-color .15s ease, border-color .15s ease' } as any}>
      <View className={`w-8 h-8 rounded-xl items-center justify-center ${tile.hot && live ? 'bg-primary' : 'bg-surface'}`}>
        <Icon name={tile.icon} size={17} tone={tile.hot && live ? 'onprimary' : 'fg'} />
      </View>
      <Txt numberOfLines={2} className="flex-1 text-[12.5px] leading-[16px] font-bold">{tile.label}</Txt>
      {live ? <View className={`min-w-[22px] h-[22px] px-1.5 rounded-full items-center justify-center ${tile.hot ? 'bg-danger' : 'bg-ink'}`}><Txt className="text-white text-[11px] font-extrabold" style={tile.hot ? undefined : { color: undefined }}>{tile.badge! > 99 ? '99+' : tile.badge}</Txt></View> : null}
    </Pressable>
  );
}

/**
 * The admin's control centre, three short groups ordered by how often they are needed:
 * what needs handling now (with live counters), what to create, how to run the app.
 * Counters come from the dashboard data; every tile is one tap to the right screen (creation tiles open the empty form).
 */
export function QuickActions({ pending, noCredits, onNoCredits, go }: { pending: number; noCredits: number; onNoCredits: () => void; go: (href: string) => void }) {
  const { t } = useT();
  const { desktop } = useBp();
  const router = useRouter();
  const groups: Group[] = [
    { key: 'handle', title: t('dx.qa.handle'), tiles: [
      { id: 'requests', icon: 'inbox-full-outline', label: t('dx.qa.requests'), badge: pending, hot: true, onPress: () => go('/admin/requests') },
      { id: 'chats', icon: 'message-text-outline', label: t('dx.qa.chats'), onPress: () => go('/admin/chats') },
      { id: 'clients', icon: 'account-group-outline', label: t('dx.qa.clients'), onPress: () => go('/admin/users') },
      { id: 'nocredits', icon: 'battery-alert-variant-outline', label: t('dx.qa.noCredits'), badge: noCredits, onPress: noCredits > 0 ? onNoCredits : () => go('/admin/credits') },
    ] },
    { key: 'create', title: t('dx.qa.create'), tiles: [
      { id: 'addTool', icon: 'plus-circle-outline', label: t('dx.qa.addTool'), onPress: () => go('/admin/tools?add=1') },
      { id: 'addInspiration', icon: 'image-plus-outline', label: t('dx.qa.addInspiration'), onPress: () => go('/admin/inspirations?add=1') },
      { id: 'addStyle', icon: 'palette-swatch-outline', label: t('dx.qa.addStyle'), onPress: () => go('/admin/styles?add=1') },
      { id: 'addPalette', icon: 'invert-colors', label: t('dx.qa.addPalette'), onPress: () => go('/admin/palettes?add=1') },
    ] },
    { key: 'manage', title: t('dx.qa.manage'), tiles: [
      { id: 'models', icon: 'robot-outline', label: t('dx.qa.models'), onPress: () => go('/admin/models') },
      { id: 'credits', icon: 'star-circle-outline', label: t('dx.qa.credits'), onPress: () => go('/admin/credits') },
      { id: 'theme', icon: 'palette-outline', label: t('dx.qa.theme'), onPress: () => go('/admin/theme') },
      { id: 'app', icon: 'open-in-new', label: t('dx.qa.app'), onPress: () => router.push('/') },
    ] },
  ];
  return (
    <Panel testID="dash-quick" title={t('admin.dash.quickTitle')} sub={t('dx.qa.sub')}>
      <View style={{ flexDirection: desktop ? 'row' : 'column', gap: desktop ? 20 : 16 }}>
        {groups.map((g) => (
          <View key={g.key} testID={`quick-group-${g.key}`} style={{ flex: desktop ? 1 : undefined, minWidth: 0, gap: 8 }}>
            <Txt className="text-muted text-[11px] font-extrabold uppercase" style={{ letterSpacing: 0.8 }}>{g.title}</Txt>
            <View className="flex-row flex-wrap" style={{ gap: 8 }}>{g.tiles.map((x) => <TileButton key={x.id} tile={x} />)}</View>
          </View>
        ))}
      </View>
    </Panel>
  );
}

import React, { useEffect, useMemo, useState } from 'react';
import { View } from 'react-native';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { Input } from '@/components/ui/Field';
import { Segmented } from '@/components/ui/Segmented';
import { Toggle } from '@/components/ui/Toggle';
import { Txt } from '@/components/ui/Txt';
import { Notice, codeText } from './bits';
import { formatBytes, type BackupRequest, type BackupType, type Capabilities, type Destination, type Provider } from '@/lib/backupClient';
import { useT } from '@/i18n';

/** Everything a person chooses for a backup: type, database provider, data mode, media, destination (+ token / folder for Drive and Dropbox). */
export function BackupForm({ caps, busy, error, onStart }: { caps: Capabilities; busy: boolean; error: string | null; onStart: (request: BackupRequest) => void }) {
  const { t } = useT();
  const types = caps.types;
  const [type, setType] = useState<BackupType>(types.includes('both') ? 'both' : types[0] ?? 'db');
  const [provider, setProvider] = useState<Provider>(caps.provider.detected === 'supabase' ? 'supabase' : 'neon');
  const [data, setData] = useState<'content' | 'empty'>('content');
  const [media, setMedia] = useState(false);
  const [destination, setDestination] = useState<Destination>('local');
  const [token, setToken] = useState('');
  const [folder, setFolder] = useState('');
  useEffect(() => { if (!types.includes(type)) setType(types[0] ?? 'db'); }, [types, type]);
  const hasDb = type !== 'app';
  const external = destination !== 'local';
  const configured = destination === 'gdrive' ? !!caps.destinations.gdrive?.serverConfigured : destination === 'dropbox' ? !!caps.destinations.dropbox?.serverConfigured : true;
  const modeLabel = useMemo(() => { const k = String(caps.media.mode || 'database'); return t(`bk.mode.${['r2', 'fs', 'app', 'db', 'database', 'mixed'].includes(k) ? k : 'database'}`); }, [caps.media.mode, t]);
  const typeOptions = types.map((k) => ({ key: k, label: t(`bk.type.${k}`) }));
  const submit = () => onStart({
    type, data: hasDb ? data : 'content', media, provider: hasDb ? provider : 'neon', destination,
    ...(external ? { auth: { accessToken: token.trim(), ...(destination === 'gdrive' ? { folderId: folder.trim() } : { folder: folder.trim() }) } } : {}),
  });
  const label = (text: string) => <Txt className="text-[13px] font-bold text-muted mb-1.5 mt-3">{text}</Txt>;
  return (
    <Card testID="bk-form" className="p-4 mb-3">
      {label(t('bk.f.type'))}
      <Segmented testID="bk-type" value={type} options={typeOptions} onChange={setType} />
      {hasDb ? (
        <>
          {label(t('bk.f.provider'))}
          <Segmented testID="bk-provider" value={provider} options={caps.provider.options.map((k) => ({ key: k, label: t(`bk.prov.${k}`) }))} onChange={setProvider} />
          <Txt className="text-muted text-[12px] mt-1.5">{t('bk.prov.detected', { name: caps.provider.detected })}</Txt>
          {label(t('bk.f.data'))}
          <Segmented testID="bk-data" value={data} options={[{ key: 'content', label: t('bk.data.content') }, { key: 'empty', label: t('bk.data.empty') }]} onChange={setData} />
        </>
      ) : null}
      <View className="flex-row items-center justify-between gap-3 mt-4">
        <View className="flex-1" style={{ minWidth: 0 }}>
          <Txt className="font-bold text-[15px]">{t('bk.f.media')}</Txt>
          <Txt className="text-muted text-[12px]">{t('bk.f.mediaHint', { n: caps.media.count, size: formatBytes(caps.media.bytes), mode: modeLabel })}</Txt>
        </View>
        <Toggle testID="bk-media" value={media} onValueChange={setMedia} label={t('bk.f.media')} />
      </View>
      {label(t('bk.f.dest'))}
      <Segmented testID="bk-dest" value={destination} options={[{ key: 'local', label: t('bk.dest.local') }, { key: 'gdrive', label: t('bk.dest.gdrive') }, { key: 'dropbox', label: t('bk.dest.dropbox') }]} onChange={setDestination} />
      {external ? (
        <View className="mt-3">
          {configured ? <Txt testID="bk-server-cfg" className="text-success text-[12px] font-bold mb-2">{t('bk.f.serverCfg')}</Txt> : null}
          <Input testID="bk-token" label={t('bk.f.token')} value={token} onChangeText={setToken} secureTextEntry autoCapitalize="none" autoCorrect={false} />
          <Txt className="text-muted text-[12px] -mt-2 mb-3">{t('bk.f.tokenHint')}</Txt>
          <Input testID="bk-folder" label={t('bk.f.folder')} value={folder} onChangeText={setFolder} autoCapitalize="none" autoCorrect={false} />
        </View>
      ) : null}
      {error ? <View className="mt-3"><Notice tone="danger" testID="bk-error">{codeText(t, 'err', error)}</Notice></View> : null}
      <View className="mt-4">
        <Button testID="bk-start" title={t('bk.f.start')} icon="backup-restore" loading={busy} disabled={!caps.available || (external && !configured && token.trim().length < 12)} onPress={submit} />
      </View>
    </Card>
  );
}

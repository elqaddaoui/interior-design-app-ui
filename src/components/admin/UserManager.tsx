import React, { useMemo, useState } from 'react';
import { Pressable, ScrollView, View } from 'react-native';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { EmptyState } from '@/components/ui/EmptyState';
import { Icon } from '@/components/ui/Icon';
import { Input } from '@/components/ui/Field';
import { ConfirmSheet, Sheet } from '@/components/ui/Sheet';
import { Segmented } from '@/components/ui/Segmented';
import { Toggle } from '@/components/ui/Toggle';
import { Txt } from '@/components/ui/Txt';
import { AdminPage } from '@/components/admin/AdminShell';
import { AdminLoading } from '@/components/admin/AdminLoading';
import { RightClick, sep, type MenuItem } from '@/components/admin/ContextMenu';
import { SearchTarget, useViewState } from '@/hooks/useViewState';
import { useBp } from '@/hooks/useBp';
import { useT } from '@/i18n';
import { useStore } from '@/store/useStore';
import { toast } from '@/store/useToast';
import { applyBulk, isProtected, MAX_CREDITS, nextCredits, type BulkOp, type CreditMode } from '@/lib/userAdmin';
import type { AppUser } from '@/data/types';
import { holdPress, PRESS_HOLD } from '@/lib/noSelect';
import { useLocalSearchParams } from 'expo-router';

type Filter = 'all' | 'active' | 'blocked' | 'admin';
const FILTERS: Filter[] = ['all', 'active', 'blocked', 'admin'];
const PAGE = 30;
const digits = (v: string) => v.replace(/\D/g, '').slice(0, 7);

const initial = (u: AppUser) => (u.name || u.whatsapp || '?').trim().charAt(0).toUpperCase();

function Chip({ label, on, onPress, testID, count }: { label: string; on: boolean; onPress: () => void; testID?: string; count?: number }) {
  return (
    <Pressable testID={testID} accessibilityRole="radio" accessibilityState={{ selected: on }} onPress={onPress} className={`px-3.5 h-9 rounded-full flex-row items-center gap-1.5 ${on ? 'bg-ink' : 'bg-surface2'}`}>
      <Txt className={`text-[13px] font-semibold ${on ? 'text-onink' : ''}`}>{label}</Txt>
      {count != null ? <Txt className={`text-[12px] ${on ? 'text-onink' : 'text-muted'}`}>{count}</Txt> : null}
    </Pressable>
  );
}

function Checkbox({ on, onPress, testID, label }: { on: boolean; onPress: () => void; testID?: string; label: string }) {
  return (
    <Pressable testID={testID} accessibilityRole="checkbox" accessibilityLabel={label} accessibilityState={{ checked: on }} aria-checked={on} onPress={onPress} hitSlop={6} className="w-11 h-11 items-center justify-center">
      <Icon name={on ? 'checkbox-marked' : 'checkbox-blank-outline'} size={24} tone={on ? 'primary' : 'muted'} />
    </Pressable>
  );
}

/** Icon-over-label action: four of them always fit in one row on a 320px phone, so none is ever hidden off-screen. */
function BarAction({ icon, label, onPress, disabled, danger, testID }: { icon: string; label: string; onPress: () => void; disabled?: boolean; danger?: boolean; testID?: string }) {
  return (
    <Pressable testID={testID} accessibilityRole="button" accessibilityLabel={label} accessibilityState={{ disabled: !!disabled }} disabled={disabled} onPress={onPress}
      className="flex-1 h-14 rounded-2xl bg-surface2 items-center justify-center gap-0.5 active:opacity-70" style={{ opacity: disabled ? 0.4 : 1, minWidth: 0 }}>
      <Icon name={icon} size={20} tone={danger ? 'danger' : 'fg'} />
      <Txt className={`text-[11px] font-bold ${danger ? 'text-danger' : ''}`} numberOfLines={1}>{label}</Txt>
    </Pressable>
  );
}

/** The users screen: search, filter, select one or many, then edit credits / block / unblock / delete. */
export function UserManager() {
  const { t, lang } = useT();
  const { desktop } = useBp();
  const { target } = useLocalSearchParams<{ target?: string }>();
  const users = useStore((s) => s.users);
  const adminLoaded = useStore((s) => s.adminLoaded);
  const [query, setQuery] = useViewState('um-search', '');
  const [filter, setFilter] = useViewState<Filter>('um-filter', 'all');
  const [selected, setSelected] = useViewState<string[]>('um-selected', []);
  const [shown, setShown] = useViewState('um-shown', PAGE);
  const [editing, setEditing] = useState<AppUser | null>(null);
  const [creditsOpen, setCreditsOpen] = useState(false);
  const [confirm, setConfirm] = useState<null | { kind: 'block' | 'unblock' | 'delete'; ids: string[]; skipped: number }>(null);
  const [busy, setBusy] = useState(false);

  const needle = query.trim().toLocaleLowerCase();
  const counts = useMemo(() => ({
    all: users.length,
    active: users.filter((u) => u.role === 'user' && !u.blocked).length,
    blocked: users.filter((u) => u.blocked).length,
    admin: users.filter((u) => u.role === 'admin').length,
  }), [users]);
  const rows = useMemo(() => users.filter((u) => {
    if (u.id === target) return true;
    if (filter === 'active' && (u.role !== 'user' || u.blocked)) return false;
    if (filter === 'blocked' && !u.blocked) return false;
    if (filter === 'admin' && u.role !== 'admin') return false;
    return !needle || [u.name, u.whatsapp, u.id].join(' ').toLocaleLowerCase().includes(needle);
  }), [users, filter, needle, target]);
  const visible = rows.slice(0, shown);

  const chosen = users.filter((u) => selected.includes(u.id));
  const chosenOk = chosen.filter((u) => !isProtected(u));
  const allOn = rows.length > 0 && rows.every((u) => selected.includes(u.id));
  const toggle = (id: string) => setSelected((old) => (old.includes(id) ? old.filter((x) => x !== id) : [...old, id]));
  const toggleAll = () => setSelected(allOn ? [] : rows.map((u) => u.id));
  const date = (n: number) => new Date(n).toLocaleDateString(lang === 'fr' ? 'fr-FR' : 'ar-MA');

  const run = async (ids: string[], op: BulkOp, after?: () => void) => {
    if (busy) return;
    setBusy(true);
    try {
      const n = await applyBulk(ids, op);
      setSelected((old) => (op.type === 'delete' ? old.filter((id) => !ids.includes(id)) : old));
      toast(t('admin.um.done', { count: n }));
      after?.();
    } catch {
      toast(t('admin.um.error'));
    } finally { setBusy(false); }
  };

  /** One edit = credits and/or blocked state, applied in order; the sheet closes only when everything worked. */
  const save = async (u: AppUser, patch: { credits: number; blocked: boolean }) => {
    if (busy) return;
    setBusy(true);
    try {
      if (patch.credits !== u.credits) await applyBulk([u.id], { type: 'credits', mode: 'set', amount: patch.credits });
      if (patch.blocked !== !!u.blocked && !isProtected(u)) await applyBulk([u.id], { type: patch.blocked ? 'block' : 'unblock' });
      toast(t('admin.um.saved'));
      setEditing(null);
    } catch { toast(t('admin.um.error')); } finally { setBusy(false); }
  };

  const copyText = (text: string) => {
    try { void (globalThis as any).navigator?.clipboard?.writeText(text); toast(t('ax.copied')); } catch { /* clipboard unavailable */ }
  };
  const menuOf = (u: AppUser): MenuItem[] => {
    const group = selected.includes(u.id) && selected.length > 1;
    const ids = group ? chosenOk.map((x) => x.id) : isProtected(u) ? [] : [u.id];
    const skipped = group ? chosen.length - chosenOk.length : 0;
    return [
      { key: 'edit', label: t('common.edit'), icon: 'pencil-outline', onPress: () => setEditing(u) },
      ...(u.whatsapp ? [{ key: 'copy', label: t('ax.copyNumber'), icon: 'content-copy', onPress: () => copyText(u.whatsapp) } as MenuItem] : []),
      { key: 'select', label: selected.includes(u.id) ? t('ax.deselect') : t('common.select'), icon: selected.includes(u.id) ? 'select-off' : 'checkbox-marked-circle-outline', onPress: () => toggle(u.id) },
      sep('s1'),
      { key: 'block', label: u.blocked && !group ? t('admin.um.unblock') : t('admin.um.block'), icon: u.blocked && !group ? 'account-check-outline' : 'account-cancel-outline', disabled: !ids.length,
        onPress: () => setConfirm({ kind: u.blocked && !group ? 'unblock' : 'block', ids, skipped }) },
      { key: 'delete', label: group ? t('ax.deleteSelected', { count: ids.length }) : t('common.delete'), icon: 'trash-can-outline', danger: true, disabled: !ids.length, onPress: () => setConfirm({ kind: 'delete', ids, skipped }) },
    ];
  };

  const filterLabel: Record<Filter, string> = { all: t('common.all'), active: t('admin.um.active'), blocked: t('admin.um.blocked'), admin: t('admin.enums.admin') };

  const bar = selected.length ? (
    <Card testID="um-bulk-bar" className="p-3 rounded-3xl" style={{ boxShadow: '0 8px 36px rgba(0,0,0,0.2)' } as any}>
      <View className="flex-row items-center gap-2 mb-2">
        <View className="bg-primary rounded-full px-3 py-1"><Txt testID="um-selected-count" className="text-onprimary font-bold">{selected.length}</Txt></View>
        <Txt className="font-bold flex-1">{t('admin.um.selected')}</Txt>
        <Button testID="um-clear" size="sm" variant="ghost" icon="close" title={t('admin.um.clear')} disabled={busy} onPress={() => setSelected([])} />
      </View>
      <View className="flex-row gap-2">
        <BarAction testID="um-bulk-credits" icon="star-four-points-outline" label={t('admin.um.credits')} disabled={busy} onPress={() => setCreditsOpen(true)} />
        <BarAction testID="um-bulk-block" icon="account-cancel-outline" label={t('admin.um.block')} disabled={busy || !chosenOk.length} onPress={() => setConfirm({ kind: 'block', ids: chosenOk.map((u) => u.id), skipped: chosen.length - chosenOk.length })} />
        <BarAction testID="um-bulk-unblock" icon="account-check-outline" label={t('admin.um.unblock')} disabled={busy || !chosenOk.length} onPress={() => setConfirm({ kind: 'unblock', ids: chosenOk.map((u) => u.id), skipped: chosen.length - chosenOk.length })} />
        <BarAction testID="um-bulk-delete" danger icon="trash-can-outline" label={t('common.delete')} disabled={busy || !chosenOk.length} onPress={() => setConfirm({ kind: 'delete', ids: chosenOk.map((u) => u.id), skipped: chosen.length - chosenOk.length })} />
      </View>
    </Card>
  ) : undefined;

  return (
    <AdminPage title={t('admin.nav.users')} floating={bar}>
      <Input testID="users-filter" value={query} onChangeText={setQuery} placeholder={t('admin.um.search')} />
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8, paddingBottom: 12 }}>
        {FILTERS.map((f) => <Chip key={f} testID={`users-role-${f}`} label={filterLabel[f]} count={counts[f]} on={filter === f} onPress={() => { setFilter(f); setShown(PAGE); }} />)}
      </ScrollView>

      {rows.length ? (
        <View className="flex-row items-center mb-1">
          <Checkbox testID="um-select-all" on={allOn} onPress={toggleAll} label={t('admin.um.selectAll')} />
          <Txt className="text-muted text-[13px] flex-1">{allOn ? t('admin.um.clear') : t('admin.um.selectAll')} · {rows.length}</Txt>
        </View>
      ) : null}

      {rows.length ? (
        <Card className="overflow-hidden">
          {visible.map((u, i) => {
            const on = selected.includes(u.id);
            return (
              <SearchTarget key={u.id} id={u.id}><RightClick items={() => menuOf(u)}>
                <Pressable testID={`user-${u.id}`} accessibilityRole="button" onPress={() => (selected.length ? toggle(u.id) : setEditing(u))} onLongPress={holdPress(() => toggle(u.id))} delayLongPress={350} {...PRESS_HOLD}
                  className={`flex-row items-center pe-2 ${i ? 'border-t border-line' : ''} ${on ? 'bg-soft' : ''} ${u.blocked ? 'opacity-70' : ''}`} style={{ minHeight: 68 }}>
                  <Checkbox testID={`select-${u.id}`} on={on} onPress={() => toggle(u.id)} label={t('common.select')} />
                  <View className={`w-10 h-10 rounded-full items-center justify-center me-3 ${u.blocked ? 'bg-danger' : 'bg-primary'}`}>
                    {u.blocked ? <Icon name="account-cancel" size={20} color="#fff" /> : <Txt className="text-onprimary font-extrabold text-[16px]">{initial(u)}</Txt>}
                  </View>
                  <View className="flex-1 py-2" style={{ minWidth: 0 }}>
                    <View className="flex-row items-center gap-2 flex-wrap">
                      <Txt className="font-bold text-[15px]" numberOfLines={1} style={{ flexShrink: 1 }}>{u.name || '—'}</Txt>
                      {u.role === 'admin' ? <View className="bg-ink rounded-full px-2 py-0.5"><Txt className="text-onink text-[10px] font-bold">{t('admin.enums.admin')}</Txt></View> : null}
                      {u.blocked ? <View className="bg-danger rounded-full px-2 py-0.5"><Txt className="text-white text-[10px] font-bold">{t('admin.um.blocked')}</Txt></View> : null}
                    </View>
                    <Txt className="text-muted text-[13px]" numberOfLines={1}>{u.whatsapp || '—'}{desktop ? `  ·  ${date(u.createdAt)}` : ''}</Txt>
                  </View>
                  <View className="flex-row items-center gap-1 bg-surface2 rounded-full px-3 h-8 me-1">
                    <Icon name="star-four-points" size={13} tone="primary" />
                    <Txt testID={`credits-${u.id}`} className="font-extrabold text-[14px]">{u.credits}</Txt>
                  </View>
                  <Pressable testID={`edit-${u.id}`} accessibilityRole="button" accessibilityLabel={t('common.edit')} onPress={() => setEditing(u)} hitSlop={6} className="w-10 h-10 items-center justify-center">
                    <Icon name="pencil-outline" size={20} />
                  </Pressable>
                </Pressable>
              </RightClick></SearchTarget>
            );
          })}
        </Card>
      ) : !adminLoaded ? <AdminLoading /> : <EmptyState icon="account-search-outline" title={t('admin.um.none')} />}

      {rows.length > shown ? <View className="items-center py-3"><Button testID="um-more" variant="soft" size="sm" title={`${t('admin.um.more')} (${rows.length - shown})`} onPress={() => setShown(shown + PAGE)} /></View> : null}
      <View className="h-3" />

      <EditUser user={editing} busy={busy} onClose={() => setEditing(null)} onSave={save}
        onDelete={(u) => { setEditing(null); setConfirm({ kind: 'delete', ids: [u.id], skipped: 0 }); }} />

      <BulkCredits visible={creditsOpen} users={chosen} busy={busy} onClose={() => setCreditsOpen(false)}
        onApply={(mode, amount) => run(selected, { type: 'credits', mode, amount }, () => setCreditsOpen(false))} />

      <ConfirmSheet visible={!!confirm} onClose={() => setConfirm(null)}
        message={`${t(`admin.um.confirm_${confirm?.kind ?? 'block'}`, { count: confirm?.ids.length ?? 0 })}${confirm?.skipped ? `\n${t('admin.um.skipAdmins', { count: confirm.skipped })}` : ''}`}
        confirmLabel={t(confirm?.kind === 'delete' ? 'common.delete' : confirm?.kind === 'unblock' ? 'admin.um.unblock' : 'admin.um.block')} cancelLabel={t('common.cancel')}
        onConfirm={() => confirm && run(confirm.ids, { type: confirm.kind })} />
    </AdminPage>
  );
}

function EditUser({ user, busy, onClose, onSave, onDelete }: { user: AppUser | null; busy: boolean; onClose: () => void; onSave: (u: AppUser, patch: { credits: number; blocked: boolean }) => void; onDelete: (u: AppUser) => void }) {
  const { t } = useT();
  const [credits, setCredits] = useState('0');
  const [blocked, setBlocked] = useState(false);
  const [seen, setSeen] = useState<string | null>(null);
  if (user && seen !== user.id) { setSeen(user.id); setCredits(String(user.credits)); setBlocked(!!user.blocked); }
  if (!user && seen) setSeen(null);
  const amount = parseInt(credits || '0', 10) || 0;
  const step = (d: number) => setCredits(String(Math.min(MAX_CREDITS, Math.max(0, amount + d))));
  const dirty = !!user && (amount !== user.credits || blocked !== !!user.blocked);
  const locked = !!user && isProtected(user);
  return (
    <Sheet visible={!!user} onClose={onClose} title={t('admin.um.editUser')}
      footer={user ? <View className="flex-row gap-2.5"><Button testID="um-edit-cancel" variant="soft" className="flex-1" title={t('common.cancel')} onPress={onClose} /><Button testID="um-edit-save" className="flex-1" title={t('common.save')} disabled={!dirty} loading={busy} onPress={() => onSave(user, { credits: amount, blocked })} /></View> : undefined}>
      {user ? (
        <View>
          <View className="flex-row items-center gap-3 mb-3">
            <View className="w-10 h-10 rounded-full bg-primary items-center justify-center"><Txt className="text-onprimary font-extrabold text-[16px]">{initial(user)}</Txt></View>
            <View className="flex-1" style={{ minWidth: 0 }}>
              <Txt className="font-extrabold text-[15px]" numberOfLines={1}>{user.name || '—'}</Txt>
              <Txt className="text-muted text-[12px]" numberOfLines={1}>{user.whatsapp || '—'}</Txt>
            </View>
          </View>
          <Txt className="text-[13px] font-semibold text-muted mb-1.5">{t('admin.um.credits')}</Txt>
          <View className="flex-row items-center gap-2 mb-3" style={{ direction: 'ltr' } as any}>
            <Pressable testID="um-minus" accessibilityRole="button" accessibilityLabel="-1" onPress={() => step(-1)} className="w-11 h-11 rounded-full bg-surface2 items-center justify-center active:opacity-70"><Icon name="minus" size={20} /></Pressable>
            <View className="flex-1"><Input testID="um-credits-input" value={credits} onChangeText={(v) => setCredits(digits(v))} keyboardType="number-pad" className="text-center font-extrabold" style={{ textAlign: 'center' }} /></View>
            <Pressable testID="um-plus" accessibilityRole="button" accessibilityLabel="+1" onPress={() => step(1)} className="w-11 h-11 rounded-full bg-primary items-center justify-center active:opacity-70"><Icon name="plus" size={20} tone="onprimary" /></Pressable>
          </View>
          <View className="flex-row items-center bg-surface2 rounded-xl px-3 py-2 mb-2" style={{ opacity: locked ? 0.5 : 1 }}>
            <View className="flex-1 pe-3"><Txt className="font-bold">{t('admin.um.blockAccount')}</Txt><Txt className="text-muted text-[12px]">{t('admin.um.blockHint')}</Txt></View>
            <Toggle testID="um-blocked-toggle" value={blocked} disabled={locked} onValueChange={setBlocked} />
          </View>
          {!locked ? <Pressable testID="um-edit-delete" accessibilityRole="button" onPress={() => onDelete(user)} className="mt-2 h-11 rounded-full border border-danger flex-row items-center justify-center gap-2 active:opacity-70"><Icon name="trash-can-outline" size={19} tone="danger" /><Txt className="font-bold text-danger">{t('common.delete')}</Txt></Pressable> : null}
        </View>
      ) : null}
    </Sheet>
  );
}

function BulkCredits({ visible, users, busy, onClose, onApply }: { visible: boolean; users: AppUser[]; busy: boolean; onClose: () => void; onApply: (mode: CreditMode, amount: number) => void }) {
  const { t } = useT();
  const [mode, setMode] = useState<CreditMode>('add');
  const [value, setValue] = useState('1');
  const amount = parseInt(value || '0', 10) || 0;
  const quick = mode === 'set' ? [0, 1, 3, 5, 10] : [1, 3, 5, 10, 20];
  const sample = users.slice(0, 3);
  return (
    <Sheet visible={visible} onClose={onClose} title={`${t('admin.um.editCredits')} · ${users.length}`}
      footer={<View className="flex-row gap-2.5"><Button testID="um-credits-cancel" variant="soft" className="flex-1" title={t('common.cancel')} onPress={onClose} /><Button testID="um-credits-apply" className="flex-1" title={t('admin.um.apply', { count: users.length })} loading={busy} disabled={!users.length || (mode !== 'set' && amount === 0)} onPress={() => onApply(mode, amount)} /></View>}>
      <Segmented compact testID="um-mode" value={mode} onChange={setMode} options={[{ key: 'add', label: t('admin.um.modeAdd') }, { key: 'subtract', label: t('admin.um.modeSubtract') }, { key: 'set', label: t('admin.um.modeSet') }]} />
      <View className="mt-3"><Input testID="um-amount" label={t('admin.credits.amount')} value={value} onChangeText={(v) => setValue(digits(v))} keyboardType="number-pad" /></View>
      <View className="flex-row flex-wrap gap-2 mb-3">
        {quick.map((q) => <Pressable key={q} testID={`um-quick-${q}`} onPress={() => setValue(String(q))} className={`px-3.5 h-8 rounded-full items-center justify-center ${amount === q ? 'bg-primary' : 'bg-surface2'}`}><Txt className={`font-bold ${amount === q ? 'text-onprimary' : ''}`}>{q}</Txt></Pressable>)}
      </View>
      <Txt className="text-[13px] font-semibold text-muted mb-1.5">{t('admin.um.preview')}</Txt>
      <Card className="overflow-hidden">
        {sample.map((u, i) => (
          <View key={u.id} className={`flex-row items-center px-3 py-2 gap-3 ${i ? 'border-t border-line' : ''}`}>
            <Txt className="flex-1 font-semibold" numberOfLines={1} style={{ textAlign: 'auto' }}>{u.name || u.whatsapp || '—'}</Txt>
            <View className="flex-row items-center gap-2" style={{ direction: 'ltr', flexShrink: 0 } as any}>
              <Txt className="text-muted">{u.credits}</Txt>
              <Icon name="arrow-right" size={16} tone="muted" />
              <Txt className="font-extrabold">{nextCredits(u.credits, mode, amount)}</Txt>
            </View>
          </View>
        ))}
        {users.length > sample.length ? <Txt className="text-muted text-[12px] px-3 py-2 border-t border-line">+{users.length - sample.length}</Txt> : null}
      </Card>
    </Sheet>
  );
}

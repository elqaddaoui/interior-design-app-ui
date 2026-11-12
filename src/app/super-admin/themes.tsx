import React, { useState } from 'react';
import { Pressable, View } from 'react-native';
import { sa, saMessage } from '@/superadmin/api';
import { Icon, IconBtn } from '@/superadmin/icons';
import { SA } from '@/superadmin/tokens';
import { tr } from '@/superadmin/i18n';
import { LivePreviews, ViewSwitch, type ViewMode } from '@/superadmin/LivePreviews';
import { ThemePreview } from '@/superadmin/ThemePreview';
import type { StoreTheme, Tenant } from '@/superadmin/types';
import { Badge, Btn, Empty, ErrorLine, Field, Heading, Hint, Loading, Row, Sheet, T, ago, openUrl, useLoad } from '@/superadmin/ui';

/** Pick the stores whose look is copied. Only colours, fonts, texts, tools, tabs and pages are copied: never clients, orders, keys or admins. */
function Pick({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const { data, error: loadError, loading } = useLoad(() => sa<Tenant[]>('/tenants'));
  const [chosen, setChosen] = useState<string[]>([]);
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const stores = (data || []).filter(t => t.kind !== 'demo');
  const toggle = (id: string) => setChosen(list => (list.includes(id) ? list.filter(x => x !== id) : [...list, id]));
  const submit = async () => {
    setBusy(true); setError(null);
    try { await sa('/themes', { method: 'POST', body: { tenantIds: chosen, ...(chosen.length === 1 && name.trim() ? { name: name.trim() } : {}) } }); onDone(); onClose(); }
    catch (e) { setError(saMessage(e)); } finally { setBusy(false); }
  };
  return (
    <Sheet title={tr('Add store themes')} onClose={onClose} testID="sa-theme-pick">
      <Hint>{tr('Choose the stores to copy a look from. Each one becomes a theme you can reuse for new demos. Client data is never copied.')}</Hint>
      <ErrorLine error={loadError || error} />
      {loading && !data ? <Loading /> : !stores.length ? <Empty>{tr('No store yet.')}</Empty> : stores.map(t => {
        const on = chosen.includes(t.id);
        return (
          <Pressable key={t.id} testID="sa-theme-store" accessibilityRole="checkbox" accessibilityState={{ checked: on }} accessibilityLabel={t.name} onPress={() => toggle(t.id)}
            style={{ flexDirection: 'row', alignItems: 'center', gap: SA.space.md, padding: SA.space.md, marginBottom: SA.space.sm, borderRadius: SA.radius.md, borderWidth: 1, borderColor: on ? SA.color.accent : SA.color.line, backgroundColor: on ? SA.color.accentSoft : SA.color.panel, minHeight: 48 }}>
            <View style={{ width: 22, height: 22, borderRadius: 6, borderWidth: 2, borderColor: on ? SA.color.accent : SA.color.muted, backgroundColor: on ? SA.color.accent : 'transparent', alignItems: 'center', justifyContent: 'center' }}>{on ? <Icon name="check" size={16} color={SA.color.onAccent} /> : null}</View>
            <View style={{ flexShrink: 1 }}><T weight="bold" numberOfLines={1}>{t.name}</T><T size="xs" color={SA.color.muted} numberOfLines={1}>{t.path}</T></View>
          </Pressable>
        );
      })}
      {chosen.length === 1 ? <Field label={tr('Theme name (optional)')} value={name} onChangeText={setName} autoCapitalize="words" placeholder={tr('Same as the store')} /> : null}
      <Btn testID="sa-theme-create" icon="plus" label={chosen.length > 1 ? tr('Create {n} themes', { n: chosen.length }) : tr('Create theme')} onPress={submit} busy={busy} disabled={!chosen.length} />
    </Sheet>
  );
}

function Rename({ theme, onClose, onDone }: { theme: StoreTheme; onClose: () => void; onDone: () => void }) {
  const [name, setName] = useState(theme.name);
  const [error, setError] = useState<unknown>(null);
  const go = async () => { try { await sa(`/themes/${theme.id}`, { method: 'PATCH', body: { name } }); onDone(); onClose(); } catch (e) { setError(saMessage(e)); } };
  return (
    <Sheet title={tr('Rename theme')} onClose={onClose}>
      <Field label={tr('Name')} value={name} onChangeText={setName} autoCapitalize="words" />
      <ErrorLine error={error} />
      <Btn label={tr('Save')} onPress={go} disabled={name.trim().length < 2} />
    </Sheet>
  );
}

function Card({ theme, onChanged, onRename, onProblem }: { theme: StoreTheme; onChanged: () => void; onRename: () => void; onProblem: (m: string) => void }) {
  const [busy, setBusy] = useState('');
  const run = async (kind: string, fn: () => Promise<unknown>) => { setBusy(kind); onProblem(''); try { await fn(); onChanged(); } catch (e) { onProblem(saMessage(e)); } finally { setBusy(''); } };
  const [confirm, setConfirm] = useState(false);
  const c = theme.counts;
  return (
    <View testID="sa-theme-card" style={{ backgroundColor: SA.color.panel, borderColor: SA.color.line, borderWidth: 1, borderRadius: SA.radius.lg, padding: SA.space.md, flexGrow: 1, flexBasis: 280, maxWidth: 520, minWidth: 260 }}>
      <ThemePreview theme={theme} />
      <Row style={{ marginTop: SA.space.md, justifyContent: 'space-between', flexWrap: 'nowrap' }}>
        <View style={{ flexShrink: 1 }}><T weight="bold" numberOfLines={1} testID="sa-theme-name">{theme.name}</T>
          <T size="xs" color={SA.color.muted} numberOfLines={1}>{theme.sourceName ? tr('from {name}', { name: theme.sourceName }) : tr('source store deleted')} · {ago(theme.updatedAt)}</T></View>
        <Badge label={theme.preview.themeId || tr('custom')} tone="muted" />
      </Row>
      <T size="xs" color={SA.color.muted} style={{ marginTop: 6 }}>{tr('{tabs} tabs · {tools} tools · {sections} sections · {styles} styles · {plans} plans', { tabs: c.tabs, tools: c.tools, sections: c.sections, styles: c.styles, plans: c.plans })}</T>
      <Row style={{ marginTop: SA.space.md, gap: 6 }}>
        <IconBtn icon="refresh" label={tr('Refresh {name} from its store', { name: theme.name })} disabled={!theme.sourceName || busy === 'refresh'} onPress={() => run('refresh', () => sa(`/themes/${theme.id}/refresh`, { method: 'POST', body: {} }))} />
        <IconBtn icon="pencilOutline" label={tr('Rename {name}', { name: theme.name })} onPress={onRename} />
        {theme.sourceSlug ? <IconBtn icon="openInNew" label={tr('Open the source store')} onPress={() => openUrl(`/${theme.sourceSlug}`)} /> : null}
        <View style={{ marginStart: 'auto' }}>
          {confirm ? <Btn small kind="danger" icon="trashCanOutline" label={tr('Confirm delete')} busy={busy === 'delete'} onPress={() => run('delete', () => sa(`/themes/${theme.id}`, { method: 'DELETE', body: {} }))} />
            : <IconBtn testID="sa-theme-delete" icon="trashCanOutline" label={tr('Delete {name}', { name: theme.name })} tone="danger" onPress={() => setConfirm(true)} />}
        </View>
      </Row>
    </View>
  );
}

/** Store themes: saved looks cloned from chosen stores, reused as the starting point of new demos. */
export default function Themes() {
  const { data, error, loading, reload } = useLoad(() => sa<StoreTheme[]>('/themes'));
  const [adding, setAdding] = useState(false);
  const [renaming, setRenaming] = useState<StoreTheme | null>(null);
  const [problem, setProblem] = useState('');
  const [view, setView] = useState<ViewMode>('list');
  return (
    <View>
      <Heading title={tr('Clone Existing Store')} hint={tr('Saved looks copied from the stores you choose: colours, fonts, texts, tools, the Explore page and more. They never include client data. Pick one when you create a demo.')}
        right={<Row><ViewSwitch value={view} onChange={setView} testID="sa-theme-view" /><Btn testID="sa-theme-add" icon="plus" label={tr('Add themes')} onPress={() => setAdding(true)} /></Row>} />
      <ErrorLine error={error || problem} />
      {loading && !data ? <Loading /> : !data?.length ? <Empty>{tr('No theme yet. Add one from a store you like.')}</Empty> : view === 'live' ? (
        // A theme is a saved copy of a look, so the live page is the store it came from (its latest look); a theme whose store is gone keeps its miniature.
        <LivePreviews testID="sa-theme-live" items={data.map(t => ({
          id: t.id, name: t.name, path: t.sourceSlug ? `/${t.sourceSlug}` : '', badge: <Badge label={t.preview.themeId || tr('custom')} tone="muted" />,
          sub: t.sourceName ? tr('Live page of {name}', { name: t.sourceName }) : tr('Source store deleted: saved look'),
          fallback: <ThemePreview theme={t} height={420} />,
          actions: <>{t.sourceSlug ? <IconBtn icon="openInNew" label={tr('Open {name}', { name: t.sourceName || t.name })} onPress={() => openUrl(`/${t.sourceSlug}`)} /> : null}<IconBtn icon="pencilOutline" label={tr('Rename {name}', { name: t.name })} onPress={() => setRenaming(t)} /></>,
        }))} />
      ) : (
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: SA.space.md }}>
          {data.map(t => <Card key={t.id} theme={t} onChanged={reload} onRename={() => setRenaming(t)} onProblem={setProblem} />)}
        </View>
      )}
      {adding ? <Pick onClose={() => setAdding(false)} onDone={reload} /> : null}
      {renaming ? <Rename theme={renaming} onClose={() => setRenaming(null)} onDone={reload} /> : null}
    </View>
  );
}

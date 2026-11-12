import React, { useState } from 'react';
import { Pressable, View } from 'react-native';
import { sa, saMessage } from '@/superadmin/api';
import { Icon } from '@/superadmin/icons';
import { useSaLang, useSaTheme, useSuper } from '@/superadmin/session';
import { SA_LANGS, tr } from '@/superadmin/i18n';
import { SA, SA_THEMES, type SaTheme } from '@/superadmin/tokens';
import { Badge, Btn, Card, ErrorLine, Field, Heading, Loading, Row, Segmented, T, ago, useLoad } from '@/superadmin/ui';

/** One palette swatch: a miniature of the console in that theme (page, panel, text lines, accent button). Drawn from the theme's own colours. */
function Swatch({ theme, on, onPress }: { theme: SaTheme; on: boolean; onPress: () => void }) {
  const c = theme.color;
  return (
    <Pressable testID={`sa-theme-${theme.id}`} accessibilityRole="radio" accessibilityState={{ checked: on }} accessibilityLabel={`${theme.label}${theme.eyeFriendly ? tr(', eye-friendly') : ''}`} onPress={onPress}
      style={{ flexGrow: 1, flexBasis: 150, minWidth: 140, maxWidth: 220, padding: SA.space.sm, borderRadius: SA.radius.lg, borderWidth: 2, borderColor: on ? SA.color.accent : SA.color.line, backgroundColor: SA.color.panel }}>
      <View style={{ height: 74, borderRadius: SA.radius.md, backgroundColor: c.bg, borderWidth: 1, borderColor: c.line, padding: 8 }}>
        <View style={{ flexDirection: 'row', gap: 6, flex: 1 }}>
          <View style={{ width: 22, borderRadius: 4, backgroundColor: c.panel, borderWidth: 1, borderColor: c.line }} />
          <View style={{ flex: 1, borderRadius: 4, backgroundColor: c.panel, borderWidth: 1, borderColor: c.line, padding: 5, gap: 4 }}>
            <View style={{ height: 5, width: '70%', borderRadius: 3, backgroundColor: c.text }} />
            <View style={{ height: 4, width: '45%', borderRadius: 3, backgroundColor: c.muted }} />
            <View style={{ height: 9, width: 34, borderRadius: 4, backgroundColor: c.accent, marginTop: 'auto' }} />
          </View>
        </View>
      </View>
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: SA.space.sm, gap: 6 }}>
        <View style={{ flexShrink: 1 }}>
          <T size="sm" weight="bold" numberOfLines={1}>{theme.label}</T>
          {theme.eyeFriendly ? <T size="xs" color={SA.color.muted}>{tr('Eye-friendly')}</T> : null}
        </View>
        {on ? <View style={{ width: 20, height: 20, borderRadius: 10, backgroundColor: SA.color.accent, alignItems: 'center', justifyContent: 'center' }}><Icon name="check" size={13} color={SA.color.onAccent} /></View> : null}
      </View>
    </Pressable>
  );
}

function ThemePicker() {
  const theme = useSaTheme(s => s.theme), setTheme = useSaTheme(s => s.setTheme);
  const group = (title: string, hint: string, dark: boolean) => (
    <View style={{ marginBottom: SA.space.lg }}>
      <T size="xs" weight="bold" color={SA.color.muted} style={{ textTransform: 'uppercase', letterSpacing: 0.8 }}>{tr(title)}</T>
      <T size="xs" color={SA.color.muted} style={{ marginBottom: SA.space.sm }}>{tr(hint)}</T>
      <View accessibilityRole="radiogroup" style={{ flexDirection: 'row', flexWrap: 'wrap', gap: SA.space.md }}>
        {SA_THEMES.filter(x => x.dark === dark).map(x => <Swatch key={x.id} theme={x} on={theme === x.id} onPress={() => setTheme(x.id)} />)}
      </View>
    </View>
  );
  return (
    <Card>
      <T size="lg" weight="bold" style={{ marginBottom: 4 }}>{tr('Appearance')}</T>
      <T size="sm" color={SA.color.muted} style={{ marginBottom: SA.space.lg }} testID="sa-theme-info">{tr('Only changes how this console looks, on this device. It is not stored on the server and never touches any store.')}</T>
      {group('Dark', 'High contrast. Graphite, Forest, Ember and Ocean are softer on the eyes at night.', true)}
      {group('Light', 'Bright, high-contrast surfaces for daytime.', false)}
    </Card>
  );
}

/** The console's language: the same three languages as the app (Darija, Arabic, French) plus English. Kept in this browser only. */
function LanguagePicker() {
  const lang = useSaLang(s => s.lang), setLang = useSaLang(s => s.setLang);
  return (
    <Card>
      <T size="lg" weight="bold" style={{ marginBottom: 4 }}>{tr('Language')}</T>
      <T size="sm" color={SA.color.muted} style={{ marginBottom: SA.space.lg }} testID="sa-lang-info">{tr('The language of this console. It is kept in this browser only and never touches any store.')}</T>
      <Segmented testID="sa-lang" value={lang} onChange={setLang} options={SA_LANGS.map(l => ({ value: l.id, label: l.label, testID: `sa-lang-${l.id}` }))} />
    </Card>
  );
}

type Account = { email: string; isDefault: boolean; passwordChangedAt: number | null; lastLoginAt: number | null };

/** Account settings of the platform owner: the sign-in e-mail / user name and the password, stored in the database (table saas_super). */
export default function Settings() {
  const setMe = useSuper(s => s.setMe);
  const { data, error: loadError, loading, reload } = useLoad(() => sa<Account>('/account'));
  const [email, setEmail] = useState<string | null>(null);
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [again, setAgain] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState('');
  const shownEmail = email ?? data?.email ?? '';
  const mismatch = !!next && !!again && next !== again;
  const changesEmail = !!data && shownEmail.trim().toLowerCase() !== data.email;
  const canSave = !!current && (changesEmail || !!next) && !mismatch && (!next || next === again);

  const save = async () => {
    setBusy(true); setError(null); setSaved('');
    try {
      const result = await sa<Account>('/account', { method: 'PATCH', body: { currentPassword: current, ...(changesEmail ? { email: shownEmail } : {}), ...(next ? { newPassword: next } : {}) } });
      setMe({ email: result.email, isDefault: result.isDefault });
      setEmail(null); setCurrent(''); setNext(''); setAgain('');
      setSaved(next ? tr('Saved. Use the new login next time you sign in. Other sessions were signed out.') : tr('Saved. Use the new e-mail next time you sign in.'));
      reload();
    } catch (e) { setError(saMessage(e)); } finally { setBusy(false); }
  };

  return (
    <View>
      <Heading title={tr('Settings')} hint={tr('Your platform login. It is stored in the database, so it follows the app to every deployment.')} />
      <LanguagePicker />
      <ThemePicker />
      <ErrorLine error={loadError} />
      {loading && !data ? <Loading /> : (
        <Card>
          <Row style={{ marginBottom: SA.space.md, justifyContent: 'space-between' }}>
            <T size="lg" weight="bold">{tr('Account')}</T>
            {data?.isDefault ? <Badge tone="warn" label={tr('Factory login')} /> : <Badge tone="ok" label={tr('Custom login')} />}
          </Row>
          <T size="sm" color={SA.color.muted} style={{ marginBottom: SA.space.lg }} testID="sa-account-info">
            {data?.isDefault ? tr('The e-mail and password are still "superadmin". Change them now.') : tr('Password changed {changed}. Last sign-in {last}.', { changed: ago(data?.passwordChangedAt), last: ago(data?.lastLoginAt) })}
          </T>
          <Field label={tr('E-mail or user name')} value={shownEmail} onChangeText={setEmail} testID="sa-set-email" />
          <Field label={tr('Current password')} value={current} onChangeText={setCurrent} secureTextEntry testID="sa-set-current" />
          <Field label={tr('New password (leave empty to keep it)')} value={next} onChangeText={setNext} secureTextEntry testID="sa-set-new" />
          <Field label={tr('Repeat the new password')} value={again} onChangeText={setAgain} secureTextEntry error={mismatch ? tr('The two passwords differ.') : undefined} testID="sa-set-again" />
          <ErrorLine error={error} />
          {saved ? <T size="sm" color={SA.color.ok} testID="sa-set-saved" style={{ marginBottom: SA.space.md }}>{saved}</T> : null}
          <Btn testID="sa-set-save" label={tr('Save changes')} onPress={save} busy={busy} disabled={!canSave} />
        </Card>
      )}
    </View>
  );
}

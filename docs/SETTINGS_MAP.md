# Settings map: who decides what, and where

Every setting of the product has **one audience** (who feels the change) and **one home** (the screen where it is edited).
The single source of truth is `src/lib/settingsMap.ts`; `npm run check:settings` fails if a new `AppSettings` key is not listed there.

## The four audiences

| Audience | Meaning | Where it is edited |
|---|---|---|
| **Clients** | The admin decides, every client sees the result (behaviour, look and feel of the app). | The matching admin page |
| **Tout le monde** (everyone) | Clients **and** the admin panel (brand, theme, fonts). | Branding, Theme, Interface |
| **Admins** | Only people working in the admin panel; clients never see it. | Interface & menus (admin section), Notifications |
| **Personnel** | Each person decides for themself. | The user page `/settings` |

## Before (screenshots in `docs/screenshots/settings/`, files without the `after-` prefix)

* `Interface & menus` was one long page (about 5,000 px on a phone) mixing admin-only switches (admin search, admin menu design, bulk panels, auto-translate) with client-facing ones (app search, WhatsApp chat, loader, bottom bar) and had no hint of who is affected. "Confirm before leaving" appeared twice.
* `campaignCapHours` (minimum delay between automated notifications) existed on the server but had **no screen at all**.
* Nothing told an admin where a setting lives; the admin search only knew content and menu names.
* The user `/settings` page listed language, credits, notifications, about, privacy and the admin entry in one flat list.

## After

1. **Admin > Settings map** (`/admin/settings`, first entry after the dashboard): all 31 settings, grouped by audience, each row showing title, one-line description, audience badge, the screen it lives on, and the live ON/OFF state. Filter by audience, search by words (titles and descriptions, fr/ar/dar). A row opens the right page, scrolls to the control and outlines it for a few seconds.
2. **Interface & menus** is now three labelled sections: *Ce que voient les clients*, *Clients et administration*, *Réservé à l'administration*. Every old control and test id is kept; the duplicate exit row is merged into one card.
3. **Audience badge under the title** of Credits, Performance, Theme, Brand, Page layouts, Animation studio, Assistant and Notifications.
4. **Admin search** finds any setting by name or description and opens its page with the control highlighted.
5. **Notifications** gets the missing "delay between two automations" stepper (0 to 168 h, default 24 h).
6. **User `/settings`** is split into *Mes préférences* (language, notifications, credits) and *L'application* (about, privacy, administration), with a note that the theme and layouts are decided by the team.

## Full map

| Setting | Audience | Edited in | Keys |
|---|---|---|---|
| Recherche dans l’application | Clients | [Interface & menus](/admin/interface) | `appSearchEnabled` |
| Confirmation avant de quitter | Clients | [Interface & menus](/admin/interface) | `exitConfirmationEnabled, exitTitle, exitMessage` |
| Chat style WhatsApp | Clients | [Interface & menus](/admin/interface) | `waChat` |
| Choix Relooking / Rénovation | Clients | [Interface & menus](/admin/interface) | `modeChoice` |
| Écran de chargement | Clients | [Interface & menus](/admin/interface) | `loaderEnabled, loaderStyle, loaderColor, loaderCustomUri, loaderCustomAnim, loaderDelayMs` |
| Barre de navigation des clients | Clients | [Interface & menus](/admin/interface) | `userNavStyle` |
| Disposition des galeries | Clients | [Interface & menus](/admin/interface) | `galleryLayout` |
| Mises en page Accueil / Explorer | Clients | [Mises en page](/admin/layouts) | `layouts` |
| Filtres d’onglets de l’accueil | Clients | [Onglets](/admin/tabs) | `homeTabsVisible` |
| Cartes d’outils et animations | Clients | [Studio d'animation](/admin/studio) | `toolCards` |
| Aperçu vidéo des cartes | Clients | [Performance](/admin/performance) | `toolCards.video` |
| Crédits gratuits par défaut | Clients | [Crédits](/admin/credits) | `defaultFreeCredits` |
| Choix du modèle IA par le client | Clients | [Modèles IA](/admin/models) | `aiModelPicker` |
| Rotation des modèles IA | Clients | [Modèles IA](/admin/models) | `aiRotation` |
| Envoi automatique sur WhatsApp | Clients | [Demandes de rendu](/admin/requests) | `autoSendWhatsApp` |
| Notifications aux clients | Clients | [Notifications](/admin/notifications) | `notifyUsers` |
| Délai entre deux automatisations | Clients | [Notifications](/admin/notifications) | `campaignCapHours` |
| Assistant IA | Clients | [Assistant](/admin/assistant) | `doc:assistant` |
| Marque | Tout le monde | [Marque](/admin/branding) | `doc:branding` |
| Thème et couleurs | Tout le monde | [Thème](/admin/theme) | `doc:theme` |
| Polices | Tout le monde | [Interface & menus](/admin/interface) | `arabicFont, frenchFont` |
| Recherche dans l’administration | Admins | [Interface & menus](/admin/interface) | `adminSearchEnabled` |
| Design du menu admin | Admins | [Interface & menus](/admin/interface) | `adminMenuDesign` |
| Animation du menu admin | Admins | [Interface & menus](/admin/interface) | `adminMenuAnim` |
| Actions groupées | Admins | [Interface & menus](/admin/interface) | `bulkPanels` |
| Traduction automatique des champs | Admins | [Interface & menus](/admin/interface) | `autoTranslate` |
| Notifications des admins | Admins | [Notifications](/admin/notifications) | `notifyAdmins` |
| Langue | Personnel | [Réglages de l’app (/settings)](/settings) | `pref:lang` |
| Mes notifications | Personnel | [Réglages de l’app (/settings)](/settings) | `pref:notifications` |
| Mes crédits | Personnel | [Réglages de l’app (/settings)](/settings) | `user:credits` |
| Mon compte | Personnel | [Réglages de l’app (/settings)](/settings) | `user:session` |

Keys prefixed `doc:` are whole documents (branding, theme, assistant), `pref:` per-person preferences, `user:` the client's own account.
`homeShowAll` is a legacy key kept only so old saved data still loads.

## Adding a setting

1. Add the key to `AppSettings`; 2. add a `SETTINGS_MAP` entry (audience + the admin page that edits it); 3. add `sm.<id>` and `sm.<id>_d` in `src/i18n/locales/settingsmap.ts` (fr, ar, dar); 4. wrap the control in `<SettingAnchor id="<id>">` so the map can outline it. `npm run check:settings` verifies 1 to 3.

Checks: `npm run check:settings` (rules, coverage, texts, links) and `npm run check:settings:browser` (map, filters, search, open + highlight, Interface sections, notification delay, admin search, user page, Arabic/RTL).

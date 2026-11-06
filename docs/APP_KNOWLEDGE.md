<!--
  Curated knowledge of the assistant about the Dwira app (what a CUSTOMER can see and do).
  `npm run build:knowledge` merges this file with facts read from the code (routes, UI texts, error messages) into
  server/knowledge/kb.json, which the server loads. `npm run check:knowledge` fails when kb.json is stale.

  Format: one section per topic.   ## id | Title
          kw: comma separated search words (English, French, Arabic, Darija, Arabizi: users write in all of them)
          then the facts (English; the assistant answers in the user's language).
  Keep it factual. If something is not written here, the assistant says it does not know. Never put secrets, keys,
  server setup or admin-panel internals here: this text can reach every visitor.
-->

## about | What Dwira is
kw: dwira, app, application, what, c'est quoi, kifach, chno, application, تطبيق, شنو, ما هو, dar, interior, design, deco, décoration, ديكور
Dwira is an app (Android, iPhone/iPad through the browser, and web) that redesigns a room with AI. The user takes or chooses a photo of a room, picks a room type and a style, and the AI creates a new decor for that room. It also works without a photo: the user can describe the room and the AI imagines it. The app is available in Moroccan Darija (default), Arabic and French.

## start | How to create a design (step by step)
kw: start, create, design, generate, steps, how, commencer, créer, générer, comment, étapes, bghit, nsayb, kifach, نصاوب, تصميم, كيفاش, بغيت, ابدأ, خطوات, tool, outil, carte
1. On Home, tap a tool card (for example interior design, paint and colours, garden, exterior, floor plan, virtual staging).
2. Photo (always the first step): take a photo with the camera or pick one from the gallery. Sample photos are not available.
3. Room type, then style (the steps shown depend on the tool).
4. Last step: mode, optional colour palette, optional exact colours and optional written instructions.
5. Tap Generate. A progress screen shows the stages; it takes a few seconds and the app must stay open.
6. The result appears with a Before / After comparison.
Leaving the wizard early loses the choices made so far.

## photo | Photo tips and photo problems
kw: photo, picture, camera, gallery, tips, blur, light, permission, image, appareil, galerie, flou, lumière, تصويرة, صورة, كاميرا, كاليري, ضو, تصويرة, tsswira, tswira, camera
Good photo: the whole room, taken from the corner of a wall; good light; not blurry; no people or moving objects. Only the camera or the gallery can be used. If the camera or gallery does not open, the user must allow access to the camera / photos in the phone or browser settings. If a photo cannot be loaded, try another one.

## nophoto | Creating a design without a photo
kw: no photo, without photo, describe, text, description, sans photo, décrire, بلا تصويرة, بدون صورة, وصف, وصف الغرفة, bla tswira
On the first step the user can choose "No photo? Describe the room". The AI then imagines the room from the description (room type, style, materials, colours, size). Example: "modern Moroccan living room of 25 m², big windows, beige zellige, linen sofa".

## mode | Restyle vs Renovation, palette, colours, instructions
kw: mode, restyle, relooking, renovation, rénovation, palette, colors, colours, couleurs, hex, instructions, prompt, ألوان, لون, تجديد, تغيير, ستايل, style, alwan, lon
Mode (may be hidden by the app owner; then every design is a Restyle): Restyle / Relooking follows the current layout of the room closely. Renovation gives the AI more freedom to rethink the room. Palette: optional preset colour palettes (one is "Surprise me"). Exact colours: up to 5 colours applied as given to walls, furniture and textiles; they replace the chosen palette. Instructions: optional text of up to 500 characters, for example "grey corner sofa, light parquet, big plant near the window".

## explore | Explore and inspiration
kw: explore, inspiration, gallery, ideas, use this style, explorer, idées, استكشاف, اكتاشف, إلهام, أفكار, style
The Explore tab shows inspiration photos organised in sections and categories. Opening a photo and tapping "Use this style" starts the matching tool with that picture as a style and mood reference; the user's own room keeps its structure.

## firstfree | Free design, WhatsApp number and first delivery
kw: free, first, gratuit, premier, whatsapp, lead, number, numéro, name, nom, مجاني, أول, واتساب, نمرة, الاسم, bla flous, free design, delivery, livraison
The first design is free (the app owner can change the number of free designs). Before the first generation the app asks for the user's name and WhatsApp number, with the country code (for example +212 6 12 34 56 78). The first free design is delivered to that WhatsApp number: the success screen says the request was sent, and in History the design shows as "Pending WhatsApp" until it is sent (the team may send it manually or the app may send it automatically). The number is only used to send the user's designs.

## credits | Credits, PRO and what happens when credits run out
kw: credits, credit, pro, plan, price, prices, subscription, pay, payment, abonnement, prix, payer, crédits, رصيد, كريدي, سعر, أثمنة, ثمن, بريميوم, كم, شحال, chhal, plans, weekly, monthly, yearly
After the free design, every new design (and every Regenerate) costs 1 credit. The balance is shown in Settings → Credits and in the credits badge. When no credit is left, the app opens the Dwira PRO page, which lists the plans (weekly, monthly, yearly; names and prices are set by the app owner). PRO promises unlimited designs, all AI models, high definition results and priority support on WhatsApp. At the moment the PRO page is a demonstration: no real payment is taken. Credits can also be granted by the team; if credits arrive while the user waits on the PRO page or on a failed generation, the generation resumes by itself. A generation that is retried after an error is never charged twice.

## result | The result screen: compare, save, share, regenerate
kw: result, before, after, save, share, regenerate, download, résultat, avant, après, enregistrer, partager, régénérer, نتيجة, قبل, بعد, حفظ, مشاركة, عاود, نسخ, galerie
The result shows a Before / After slider (drag to compare; hold "Before" to see the original). Buttons: Save (to the phone gallery), Share, Regenerate (a new attempt with the same choices, costs 1 credit) and New design. Every finished design is also kept in History.

## history | History: designs and chats
kw: history, designs, chats, delete, select, historique, supprimer, السجل, التاريخ, مسح, حذف, conversations, محادثات
History has two tabs: Designs (all the user's creations) and Assistants (the chat conversations). Tap Select to choose several items and delete them. A banner may suggest turning on notifications.

## account | Account, login and logging out
kw: account, login, sign in, logout, phone, number, password, otp, compte, connexion, déconnexion, numéro, mot de passe, حساب, دخول, خروج, نمرة, كلمة السر, device, appareil, جهاز, same number
There is no password and no SMS code: the account is created from the name and the WhatsApp number (with country code) entered before the first design. Entering the same number on another device opens the same account, with its credits and history. Settings → Log out signs out of this device. Visitors who have not signed in can already use the assistant chat; their conversations move into their account when they sign in from the same device. If the app says the account is blocked, only the team can unblock it.

## language | Language and appearance
kw: language, langue, darija, arabic, french, arabe, français, rtl, لغة, اللغة, دارجة, عربية, فرنسية, theme, thème, mode sombre, dark
Settings → Language switches between Moroccan Darija (default), Arabic and French. Arabic and Darija are displayed right to left. The look (colours, fonts, name and logo) is chosen by the app owner.

## notifications | Notifications
kw: notifications, notification, push, alert, alerts, ready, prêt, إشعارات, اشعارات, تنبيه, واجد, iphone, ios, safari, install
Settings → Notifications tells the user when a design is ready and when the team answers a chat. The user must be signed in (create the first design first). On the web the browser asks for permission; if it was blocked, allow notifications in the browser or phone settings and reload. On iPhone/iPad: open the Share menu in Safari, choose "Add to Home Screen", open Dwira from the icon, then turn notifications on. The app owner can pause user notifications for everyone.

## assistant | The Dwira assistant chat
kw: assistant, chat, ai, bot, message, voice, vocal, photo, team, human, support, assistant, discussion, équipe, مساعد, شات, محادثة, فريق, فوكال, صوت, ميساج, help, aide, مساعدة, عاون
The Assistant tab is a chat. It answers questions about the app and about decoration (colours, layout, materials, lighting, small budgets), in Darija, Arabic or French. In the chat the user can write, attach photos (the assistant cannot see photos, so it asks the user to describe the room) and send voice notes (the assistant cannot listen: a voice note goes to the Dwira team, who are notified). The team can answer inside the same conversation; their messages are labelled "Dwira team". New chat starts a fresh conversation; History keeps them. Depending on how the app owner set it up, the Assistant tab may instead open a WhatsApp conversation with the team.

## settings | Settings page
kw: settings, réglages, paramètres, about, privacy, version, credits, الإعدادات, إعدادات, parametres, confidentialité, خصوصية
Settings contains: Language, Credits (with the PRO button), Notifications, About, Privacy policy, and Log out (when signed in).

## privacy | Privacy and data
kw: privacy, data, delete, personal, photos, confidentialité, données, supprimer, vie privée, خصوصية, معطيات, بيانات, مسح, حذف
Photos are only used to create the user's designs. The WhatsApp number is only used to send the user's creations. The user can ask the team to delete their data at any time.

## install | Installing the app
kw: install, download, apk, android, ios, iphone, web, browser, installer, télécharger, تحميل, تثبيت, تطبيق, application, نزل
Android: the signed APK is published on the project's GitHub Releases page. iPhone/iPad and computers: use the web version in the browser (on iPhone, "Add to Home Screen" from Safari makes it behave like an app).

## problems | Common problems and what to do
kw: problem, error, issue, not working, bug, failed, fail, retry, erreur, problème, marche pas, échec, مشكل, خطأ, ما خدامش, فشل, عاود, mochkil, machakil, ma khdamch, blocked, bloqué, محظور
- "Render failed. Try again.": tap Retry; a retry of the same generation is not charged twice.
- "No more credits": open Settings → Credits / PRO; the team can also grant credits.
- "The service is temporarily unavailable. Your input is kept.": wait a moment and retry.
- Login error: check the WhatsApp number includes the international country code (for example +212 …).
- Account blocked: contact the team through the assistant chat or WhatsApp.
- Camera / photos not opening: allow the permission in the phone or browser settings.
- Photo cannot be loaded: choose another photo.
- No notification: sign in first, allow notifications in the browser / phone, and on iPhone add the app to the Home Screen.
- The assistant says it could not answer: try again in a moment; the chat keeps the message.
- Wrong language: Settings → Language.

## pricing_unknown | What the assistant does NOT know
kw: refund, remboursement, delivery time, delay, invoice, facture, discount, promo, coupon, partner, هدية, تخفيض, ريمبورسمون
Not part of the app knowledge: refunds, invoices, promotions or discount codes, exact delivery times for WhatsApp deliveries, legal terms beyond the short privacy text, and anything about other companies. For these the assistant must say it does not know and invite the user to leave the question: the Dwira team sees every chat message and can answer in the conversation.

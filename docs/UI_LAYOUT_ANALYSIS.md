# UI/UX layout analysis: Home and Explore

Screenshots of the screens as they were before this work are in `docs/screenshots/` (`home-*.jpg`, `explore-*.jpg`, desktop 1440 px and phone 390 px).
Screenshots of the new demo layouts are in `docs/screenshots/layouts/`.

## 1. What the two screens were

| Screen | Phone | Computer |
| --- | --- | --- |
| Home | One column of full cards (image zone + title + "Essayer"), filter pills on top | 3-column grid of the same cards, top navigation |
| Explore | One white card per section holding a horizontal row of tall category tiles | Same, bigger tiles, arrows on the row |

What works: clear hierarchy, one primary action per card, content-first imagery, consistent radius.
What limits it: every tool has the same weight (no focal point), Home needs a long scroll to compare tools, and Explore always shows the same "row inside a card" pattern, which hides most categories behind a sideways swipe.

## 2. The layout patterns worth copying

The patterns below are the ones used repeatedly by products known for strong UI/UX. They are descriptions of layout structure only: no assets, colours or code were copied.

| Pattern | Used by | Why it works | Best for |
| --- | --- | --- | --- |
| Uniform grid | Airbnb, Stripe | Predictable, easy to scan, equal weight | Many similar items |
| Hero + grid | Apple, Spotify | One clear focal point, then compact items | One product to push, then the rest |
| Bento | Apple, Linear, Vercel | Mixed tile sizes create rhythm and show hierarchy at a glance | Few, visual, high-value items |
| Swim-lanes (rails) | Netflix, Disney+ | Browse many groups with no vertical scrolling | Grouped content (our home tabs) |
| Masonry mosaic | Pinterest, Behance | Variable heights waste no space, invite endless browsing | Pure inspiration |
| Editorial cover + tiles | Medium, The Verge, Apple News | A "story" per section, guides the eye | Curated sections |
| Captioned square tiles | Airbnb, Houzz | Clean, fast to read, caption never fights the photo | Category browsing |

## 3. The 16 demos (8 per screen: 4 classic + 4 "wow")

### Home (tool cards)
1. **Grid** (default). The original layout. Phone 1 column (configurable 1 or 2), computer 3 (2-4).
2. **Hero** (Apple / Spotify). The first tool as a large featured tile, the others as compact tiles in a grid. Phone 2 columns, computer 3.
3. **Bento** (Apple / Linear / Vercel). Tools in blocks of three: one large tile plus two stacked, alternating sides, with a row of three in between on a computer.
4. **Rail** (Netflix / Disney+). One horizontal lane per home tab, with its title; arrows on a computer.

### Explore (inspiration)
1. **Rails** (default). The original layout.
2. **Mosaic** (Pinterest / Behance). Masonry columns with varied heights, filled shortest column first. Phone 2 columns (2-3), computer 4 (3-6).
3. **Editorial** (Medium / The Verge). The first category of each section is a large cover; the others are tiles beside it on a computer and below it on a phone.
4. **Tiles** (Airbnb / Houzz). Square tiles with the caption under the picture. Phone 2 columns, computer 5 (3-6).

### The "wow" demos (motion and depth)
All four per screen are built from one motion kit (`src/components/layouts/Motion.tsx`: 3D coverflow, tilt, float, aurora, story bars). They are still on a low-end device, with reduce-motion, and inside the admin previews (`useMotion()`), so the app's performance rules hold.

Home
5. **Coverflow 3D** (Apple Music / Cover Flow). Tools turn in perspective on a dark stage lit by the blurred picture of the one in front. Drag, arrows, tap a side card, or let it drift by itself.
6. **Stories** (Instagram / Snapchat). A ring per tool, then a full-bleed story with progress bars: tap the sides to move (mirrored in RTL), hold to pause.
7. **Aurora glass** (Apple Vision / Linear / Stripe). Glass tiles levitate over a slowly moving aurora; on a computer they tilt towards the pointer with a light that follows it.
8. **Swipe deck** (Tinder / Apple Wallet). A stack of big cards to throw left or right, the next ones peeking from behind; buttons for previous / next / open.

Explore
5. **Coverflow 3D** (Apple Music). One 3D coverflow per section, the stage tinted by the cover in front.
6. **Polaroids** (Instagram / Pinterest boards). A pinboard of slightly rotated photos with tape; hover or press straightens and lifts one.
7. **Spotlight** (Netflix / Apple TV+). A cinematic stage per section with a slow Ken Burns zoom and large type; a thumbnail strip changes the scene.
8. **Accordion** (Awwwards / Apple). Expanding panels: one category open, the rest folded into slim strips (rows on a computer, stacked on a phone); tap to open, tap again to enter.

## 4. Rules used by all demos

- **Content first.** Every tile is the tool's or category's real picture; the text sits on a bottom gradient (readable on any photo).
- **One primary tap target per tile.** The whole tile is pressable; the "Essayer" badge is a label, not a second target.
- **Same data, different shape.** Demos only change layout. Search, deep links (`?target=`), RTL, themes and the three languages keep working because tiles reuse the same components (`SearchTarget`, `MediaView`, `CardStage`).
- **Device rules.** A computer is a screen of 1024 px and more (the app's existing breakpoint). A demo can be limited to phones, computers or both; a demo that is switched off, or limited to the other device, can never be used there, and the screen falls back to the default layout.
- **Defaults never break.** If nothing is chosen the screens render exactly as before.

## 5. Admin: Page layouts (`/admin/layouts`)

- Pick the screen (Home / Explore) and the preview size (Phone / Computer): each of the 8 demos shows a live preview built from the app's real content.
- Per demo: **Use on Phone**, **Use on Computer**, **Available on** (Phone / Computer / Both), **Enabled**, and **Edit** (spacing, corner radius, columns, tile height; ranges per demo).
- Edits show in the previews at once and in the app after **Save** (stored in `settings.layouts`, with the usual draft / discard / leave-confirmation behaviour).
- Logic is in `src/lib/layouts.ts` (pure), tiles in `src/components/layouts/`.
- The previews are drawn at the real width of a phone / computer and scaled down, always from the physical top-left corner, so they also work in Arabic / Darija (RTL). `npm run check:layouts:wow` proves it for all 32 previews.

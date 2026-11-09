#!/usr/bin/env python3
"""
Regenerates assets/fonts/web/MaterialCommunityIcons.woff2 (the WEB icon font) containing ONLY the glyphs the app can show.

Why: the full font has 7,447 glyphs (~400 KB) and is downloaded before the first screen can paint; the app uses ~170.
Glyph shapes and codepoints are copied unchanged from the official font, so every icon looks exactly the same.
Native builds keep using the full TTF from @expo/vector-icons (this file is web only).

Which names are kept: every quoted string anywhere in src/ or server/seed-content.json that is a real MaterialCommunityIcons name
(this covers ICON_CHOICES, the admin icon picker, and the seed data). Run it again after adding a new icon:
    python3 scripts/subset-icons.py        (needs: pip install fonttools brotli; npm dependencies installed)
    python3 scripts/subset-icons.py --check   (writes nothing; exits 1 when an icon used in src/ is missing from the web font,
                                               i.e. it would render as an EMPTY box on the web: run it before every commit)
"""
import glob, json, re, sys
from fontTools import subset
from fontTools.ttLib import TTFont

ROOT = __file__.rsplit('/scripts/', 1)[0]
GLYPHS = f'{ROOT}/node_modules/@expo/vector-icons/build/vendor/react-native-vector-icons/glyphmaps/MaterialCommunityIcons.json'
SOURCE = f'{ROOT}/node_modules/@expo/vector-icons/build/vendor/react-native-vector-icons/Fonts/MaterialCommunityIcons.ttf'
OUT = f'{ROOT}/assets/fonts/web/MaterialCommunityIcons.woff2'

glyph_map = json.load(open(GLYPHS))
names = set()
for path in glob.glob(f'{ROOT}/src/**/*.ts*', recursive=True) + [f'{ROOT}/server/seed-content.json']:
    for match in re.finditer(r"""['"`]([a-z0-9]+(?:-[a-z0-9]+)*)['"`]""", open(path, encoding='utf8').read()):
        if match.group(1) in glyph_map:
            names.add(match.group(1))
if len(names) < 100:
    sys.exit('refusing to subset: found suspiciously few icon names')

if '--check' in sys.argv:
    have = set(TTFont(OUT).getBestCmap())
    absent = sorted(name for name in names if glyph_map[name] not in have)
    if absent:
        sys.exit(f'icons missing from the web font (run: python3 scripts/subset-icons.py): {", ".join(absent)}')
    print(f'ok: all {len(names)} icons used in src/ are in the web font')
    sys.exit(0)

options = subset.Options()
options.flavor = 'woff2'
options.layout_features = []      # icons use no OpenType features
options.name_IDs = [1, 2]
options.notdef_outline = True
options.glyph_names = False
options.hinting = False
font = subset.load_font(SOURCE, options)
subsetter = subset.Subsetter(options)
subsetter.populate(unicodes=[glyph_map[name] for name in names])
subsetter.subset(font)
subset.save_font(font, OUT, options)

kept = set(TTFont(OUT).getBestCmap())
missing = [name for name in names if glyph_map[name] not in kept]
assert not missing, missing
print(f'kept {len(names)} icons, wrote {OUT}')

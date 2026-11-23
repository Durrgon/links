# https://durrgon.github.io/links/

Social links static page

The header art and round avatar (`images/banner.webp`, `images/avatar.webp`),
plus the favicon and link-preview image, are copied from the Bluesky profile
once a day by `.github/workflows/sync-bluesky.yml` (`scripts/sync_bluesky.py`).
Run it now from the repo's Actions tab ("Sync Bluesky images" → Run workflow),
or locally with `python scripts/sync_bluesky.py`.

## Avatar frame

`python scripts/make_avatar_frame.py` draws `images/avatar-frame.svg` (plain rune
ring, used by the page) and `images/avatar-frame-head.svg` (serpent biting its tail).
Add `--masks` to also write white-on-black masks to `art/frame-masks/`
(`<plain|head>-<shape|stone|lines|runes>.png`, 2048 px, same framing as the SVGs)
for Substance Painter fill layers or Blender.

Lit render in Blender (Steam install), e.g. gold runes on slate:

    "G:/SteamLibrary/steamapps/common/Blender/blender.exe" -b -P scripts/render_frame_blender.py -- --runes gold --stone slate

Options: `--variant plain|head`, `--runes gold|silver|bronze|copper|iron|red`,
`--rune-height` (negative = carved in), `--stone slate|granite|sandstone|basalt`,
`--hdri studio|forest|city|courtyard|interior|night|sunrise|sunset`,
`--sun-azimuth`, `--sun-elevation`, `--sun-strength`, `--size`, `--samples`, `--out`.
Renders go to `art/renders/` (not committed) with a transparent background.

## Rune border

`python scripts/make_rune_border.py [--masks] [--psd]` draws the 9-slice border
(`images/rune-border.svg`, flat) and, with `--masks`, the Blender masks
(`art/frame-masks/border-*.png`). The corner bind rune (ᚾ ᚨ ᛏ) comes from
`art/bind-rune.svg`: edit it in any tool; only its shape is used. `--psd` exports
`art/bind-rune.psd` to edit in Photoshop instead; point `BIND_RUNE_FILE` in the script
at it to use it. The page's border is the Blender render `images/rune-border.webp`
(slice 104); finish every render with
`python scripts/make_rune_border.py --finish <render.png> <out.webp>`, which copies the
top strip to all four sides so their lighting matches. `art/border-playground.html` shows zoomed strips of each variant in
`art/border-variants/`, with sliders.

## Routes

`js/router.js` (loaded in `<head>`) picks the page's route: from
`<meta name="route">` in generated route folders (`/lit/`), or a word in the hash or
query (`#lit`, `?lit`); other words are flags (`/lit/#panel` opens the lighting panel).
Routes and the scripts they load are listed in `ROUTES` there. Without JavaScript
every route is the static page.

Route folders are copies of `index.html` with `<base href="../">`; after editing
`index.html` run `python scripts/build_routes.py` (a GitHub check fails if you forget).
To add a route with its own URL, add it to `ROUTES` in both `js/router.js` and
`scripts/build_routes.py`. Fully separate pages can simply be their own folders.

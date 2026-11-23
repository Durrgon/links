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

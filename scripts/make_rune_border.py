"""Draw images/rune-border.svg: a 9-slice rune band for CSS border-image.

The image is a square: four corner pieces and, between them, one tile of the
stone band on each side (one pass of the inscription, with carved edges). CSS
repeats the side tiles around any box:

    border: 1.1rem solid transparent;
    border-image: url(images/rune-border.svg) 26 round;   /* 26 = BAND; or the Blender
                                                            render: rune-border.webp 104 */

The runes run clockwise round the box with their tops facing outward. Each tile
is seamless (the stone grain is stitched), so any number of repeats joins up.

Usage: python scripts/make_rune_border.py [--masks]   (--masks: Blender masks, see the end)
"""
from pathlib import Path

from make_avatar_frame import RUNES  # same rune shapes as the avatar ring

OUT = Path(__file__).resolve().parent.parent / "images" / "rune-border.svg"

BAND = 26                  # band width = border-image slice
PITCH = 11.5               # spacing between runes along the band
TEXT = "ᚾᚨᛏᛏᚠᛟᛞᛞ:ᛞᚱᚨᚲᛟᚾ:"  # one tile = one pass
TILE = round(PITCH * len(TEXT))   # tile length
S = 2 * BAND + TILE        # whole image

STONE = "#a7adb4"
INK = "#26262a"
GOLD = "#d2a54a"           # rune fill
GOLD_EDGE = "#5a4317"      # dark rim under the gold, so it reads as inlaid
LINE = 1.6
EDGE = 1.4                 # how far the carved edge lines sit inside the band
RUNE_LINE = 2.4            # rune stroke width in the masks
RUNE_OUTLINE = 4.6         # carved dark groove round each rune (lines mask), for contrast when small
DOT_R, DOT_OUTLINE_R = 1.5, 2.6

# Corner mark: a bind rune of ᚾ ᚨ ᛏ (the first three runes of the title) on one
# stave, in the same 6 x 12 box as the runes: ᛏ's arrow on top, ᚨ sharing the
# arrow's right arm plus its second branch below, ᚾ's cross-stroke lower down.
BIND_RUNE = "M3,0V12 M0,3L3,0L6,3 M3,3L6,6 M1,7.5L5,10.5"
BIND_SCALE = 1.45          # 12 * 1.45 = 17.4 of the 26-wide corner


def grain(fid, w, h, raw=False):
    if raw:   # just the grey noise, for the Blender grain map
        return f"""<filter id="{fid}" filterUnits="userSpaceOnUse" x="0" y="0" width="{w}" height="{h}" color-interpolation-filters="sRGB">
      <feTurbulence type="fractalNoise" baseFrequency="0.9" numOctaves="3" seed="7" stitchTiles="stitch" result="noise"/>
      <feColorMatrix in="noise" type="saturate" values="0" result="grey"/>
      <feComponentTransfer in="grey"><feFuncA type="linear" slope="0" intercept="1"/></feComponentTransfer>
    </filter>"""
    funcs = "".join(f'<feFunc{c} type="linear" slope="0.35" intercept="0.75"/>' for c in "RGB")
    return f"""<filter id="{fid}" filterUnits="userSpaceOnUse" x="0" y="0" width="{w}" height="{h}" color-interpolation-filters="sRGB">
      <feTurbulence type="fractalNoise" baseFrequency="0.9" numOctaves="3" seed="7" stitchTiles="stitch" result="noise"/>
      <feColorMatrix in="noise" type="saturate" values="0" result="grey"/>
      <feComponentTransfer in="grey" result="grain">{funcs}<feFuncA type="linear" slope="0" intercept="1"/></feComponentTransfer>
      <feBlend in="SourceGraphic" in2="grain" mode="multiply" result="textured"/>
      <feComposite in="textured" in2="SourceGraphic" operator="in"/>
    </filter>"""


# Colours per mode: the web SVG, or white-on-black masks for Blender.
MODES = {  # mode: (stone, ink, gold, gold edge)
    "web": (STONE, INK, GOLD, GOLD_EDGE),
    "shape": ("#fff", "#fff", "#fff", "#fff"),
    "lines": ("#000", "#fff", "#000", "#000"),
    "runes": ("#000", "#000", "#fff", "#fff"),
    "grain": ("#fff", "none", "none", "none"),   # stone areas only, as raw noise
}


def rune_marks(mode="web"):
    _, ink, gold, gold_edge = MODES[mode]
    flat = mode != "web"           # masks: one stroke, no fake rim
    if mode == "lines":            # the groove round each rune; the rune itself covers its middle
        gold, width, dot_r = ink, RUNE_OUTLINE, DOT_OUTLINE_R
    else:
        width, dot_r = RUNE_LINE, DOT_R
    out = []
    for i, ch in enumerate(TEXT):
        x = (i + 0.5) * PITCH
        if ch == ":":
            for y in (BAND / 2 - 2.5, BAND / 2 + 2.5):
                if flat:
                    out.append(f'<circle cx="{x}" cy="{y}" r="{dot_r}" fill="{gold}"/>')
                else:
                    out.append(f'<circle cx="{x}" cy="{y}" r="1.5" fill="{gold_edge}"/>'
                               f'<circle cx="{x}" cy="{y}" r="1.05" fill="{gold}"/>')
        else:
            t = f'translate({x - 3},{BAND / 2 - 6})'
            if flat:
                out.append(f'<path transform="{t}" d="{RUNES[ch]}" stroke="{gold}" stroke-width="{width}"/>')
            else:
                out.append(f'<path transform="{t}" d="{RUNES[ch]}" stroke="{gold_edge}" stroke-width="2.9"/>'
                           f'<path transform="{t}" d="{RUNES[ch]}" stroke="{gold}" stroke-width="1.5"/>')
    return "\n      ".join(out)


def svg(mode="web", scale=1):
    stone, ink, gold, gold_edge = MODES[mode]
    textured = mode in ("web", "grain")
    tile_fill = f' filter="url(#grain-tile)"' if textured else ""
    corner_fill = f' filter="url(#grain-corner)"' if textured else ""
    tile = f"""<g id="tile">
      <rect width="{TILE}" height="{BAND}" fill="{stone}"{tile_fill}/>
      <path d="M0,{EDGE}H{TILE}M0,{BAND - EDGE}H{TILE}" stroke="{ink}" stroke-width="{LINE}"/>
      <g fill="none" stroke-linecap="round" stroke-linejoin="round">
      {rune_marks(mode)}
      </g>
    </g>"""
    # Corner: outer sides are top and left. The edge lines turn the corner, and the
    # NAT bind rune marks it, turned back upright whichever corner it is in.
    c = BAND / 2
    k = BIND_SCALE

    def corner(turn):
        t = f"rotate({-turn},{c},{c}) translate({c - 3 * k},{c - 6 * k}) scale({k})"
        if mode == "web":
            mark = (f'<path transform="{t}" d="{BIND_RUNE}" stroke="{gold_edge}" stroke-width="{2.9 / k:.2f}"/>'
                    f'<path transform="{t}" d="{BIND_RUNE}" stroke="{gold}" stroke-width="{1.5 / k:.2f}"/>')
        elif mode == "lines":
            mark = f'<path transform="{t}" d="{BIND_RUNE}" stroke="{ink}" stroke-width="{RUNE_OUTLINE / k:.2f}"/>'
        else:
            mark = f'<path transform="{t}" d="{BIND_RUNE}" stroke="{gold}" stroke-width="{RUNE_LINE / k:.2f}"/>'
        return f"""<g>
      <rect width="{BAND}" height="{BAND}" fill="{stone}"{corner_fill}/>
      <path d="M{BAND},{EDGE}H{EDGE}V{BAND}" stroke="{ink}" stroke-width="{LINE}" fill="none" stroke-linejoin="round"/>
      <path d="M{BAND},{BAND - EDGE}H{BAND - EDGE}V{BAND}" stroke="{ink}" stroke-width="{LINE}" fill="none"/>
      <g fill="none" stroke-linecap="round" stroke-linejoin="round">{mark}</g>
    </g>"""

    tile = tile.replace(' id="tile"', "")
    place = [  # (piece, transform); each piece written out in full rather than reused with <use>
        (corner(0), "translate(0,0)"),
        (tile, f"translate({BAND},0)"),
        (corner(90), f"translate({S},0) rotate(90)"),
        (tile, f"translate({S},{BAND}) rotate(90)"),
        (corner(180), f"translate({S},{S}) rotate(180)"),
        (tile, f"translate({S - BAND},{S}) rotate(180)"),
        (corner(270), f"translate(0,{S}) rotate(270)"),
        (tile, f"translate(0,{S - BAND}) rotate(270)"),
    ]
    uses = "\n  ".join(f'<g transform="{t}">{piece}</g>' for piece, t in place)
    background = "" if mode == "web" else f'<rect width="{S}" height="{S}" fill="#000"/>'
    raw = mode == "grain"
    return f"""<svg xmlns="http://www.w3.org/2000/svg" width="{S * scale}" height="{S * scale}" viewBox="0 0 {S} {S}">
  <!-- Generated by scripts/make_rune_border.py: edit that, then rerun it.
       CSS: border-image: url(rune-border.svg) {BAND} round; -->
  <defs>
    {grain("grain-tile", TILE, BAND, raw)}
    {grain("grain-corner", BAND, BAND, raw)}
  </defs>
  {background}
  {uses}
</svg>
"""


MASK_DIR = OUT.parent.parent / "art" / "frame-masks"
MASK_SCALE = 4             # masks are S * 4 pixels square


def write_masks():
    """border-<shape|lines|runes|grain>.png in art/frame-masks/, for render_frame_blender.py."""
    import subprocess
    import tempfile
    MASK_DIR.mkdir(parents=True, exist_ok=True)
    for mode in ("shape", "lines", "runes", "grain"):
        with tempfile.NamedTemporaryFile("w", suffix=".svg", delete=False, encoding="utf-8") as f:
            f.write(svg(mode, MASK_SCALE))
        out = MASK_DIR / f"border-{mode}.png"
        subprocess.run(["magick", "-background", "#000", f.name, "-colorspace", "Gray",
                        "-depth", "8", str(out)], check=True)
        Path(f.name).unlink()
        print("Wrote", out)


if __name__ == "__main__":
    import sys
    OUT.write_text(svg(), encoding="utf-8")
    print("Wrote", OUT, f"({S}x{S}; border-image slice {BAND})")
    if "--masks" in sys.argv:
        write_masks()
        print(f"Render: blender -b -P scripts/render_frame_blender.py -- --variant border --size {S * MASK_SCALE}"
              f"  (then border-image slice {BAND * MASK_SCALE})")

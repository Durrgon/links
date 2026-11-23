"""Draw images/rune-border.svg: a 9-slice rune band for CSS border-image.

The image is a square: four corner pieces and, between them, one tile of the
stone band on each side (one pass of the inscription, with carved edges). CSS
repeats the side tiles around any box:

    border: 1.1rem solid transparent;
    border-image: url(images/rune-border.svg) 26 round;   /* 26 = BAND; or the Blender
                                                            render: rune-border.webp 104 */

The runes run clockwise round the box with their tops facing outward. Each tile
is seamless (the stone grain is stitched), so any number of repeats joins up.

Usage: python scripts/make_rune_border.py [--masks] [--psd]
       --masks: Blender masks (see the end); --psd: export art/bind-rune.psd to edit
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

# Corner mark: the NAT bind rune, read from its own file so it can be edited in any
# tool. Only its shape (alpha) is used; colours, outline and masks are made from it.
# .svg: its viewBox is -10 -10 80 140 around a 60 x 120 rune box (an element with
#       id="guide" is ignored). .psd / .png: an image with that same framing, e.g.
#       one exported with --psd.
ART = Path(__file__).resolve().parent.parent / "art"
BIND_RUNE_FILE = ART / "bind-rune.svg"     # or ART / "bind-rune.psd"
BIND_RUNE_HEIGHT = 17.4    # rune box height in the 26-wide corner
MARK_RIM = 0.7             # web SVG: dark rim round the gold
MARK_OUTLINE = 1.1         # masks: carved groove round the mark (like RUNE_OUTLINE)


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


def bind_rune_art():
    """The bind rune file as SVG markup, placed over the corner's centre."""
    import base64
    import re
    import subprocess
    f = BIND_RUNE_HEIGHT / 120                     # file units -> corner units
    x, y = BAND / 2 - 30 * f - 10 * f, BAND / 2 - 60 * f - 10 * f
    w, h = 80 * f, 140 * f
    path = BIND_RUNE_FILE
    if path.suffix.lower() == ".svg":
        text = path.read_text(encoding="utf-8")
        text = re.sub(r"<!--.*?-->", "", text, flags=re.S)
        text = re.sub(r'<[^<>]*\bid="guide"[^<>]*/>', "", text)          # drop the guide box
        view_box = re.search(r'viewBox="([^"]+)"', text).group(1)
        inner = re.sub(r"^.*?<svg[^>]*>|</svg>\s*$", "", text, flags=re.S)
        return (f'<svg x="{x:g}" y="{y:g}" width="{w:g}" height="{h:g}" viewBox="{view_box}" '
                f'preserveAspectRatio="none" overflow="visible">{inner}</svg>')
    # .psd / .png: flatten to PNG and embed it
    source = f"{path}[0]" if path.suffix.lower() == ".psd" else str(path)
    png = subprocess.run(["magick", source, "png:-"], check=True, capture_output=True).stdout
    data = base64.b64encode(png).decode()
    return (f'<image x="{x:g}" y="{y:g}" width="{w:g}" height="{h:g}" preserveAspectRatio="none" '
            f'href="data:image/png;base64,{data}" xlink:href="data:image/png;base64,{data}"/>')


def mark_filter(mode):
    """Recolours the bind rune from its shape: gold with a dark rim (web), its outline
    widened into the carved groove (lines mask), or plain white (other masks)."""
    _, ink, gold, gold_edge = MODES[mode]
    head = (f'<filter id="mark" filterUnits="userSpaceOnUse" x="0" y="0" width="{BAND}" height="{BAND}" '
            f'color-interpolation-filters="sRGB">')
    solid = lambda colour, src, out: (f'<feFlood flood-color="{colour}"/>'
                                      f'<feComposite in2="{src}" operator="in" result="{out}"/>')
    if mode == "web":
        body = (f'<feMorphology in="SourceAlpha" operator="dilate" radius="{MARK_RIM}" result="rim"/>'
                + solid(gold_edge, "rim", "rimc") + solid(gold, "SourceAlpha", "fill")
                + '<feMerge><feMergeNode in="rimc"/><feMergeNode in="fill"/></feMerge>')
    elif mode == "lines":
        body = (f'<feMorphology in="SourceAlpha" operator="dilate" radius="{MARK_OUTLINE}" result="wide"/>'
                + solid(ink, "wide", "out"))
    else:
        body = solid(gold, "SourceAlpha", "out")
    return head + body + "</filter>"


PSD_LAYERS = {  # element id in bind-rune.svg -> PSD layer name (bottom to top)
    "rune-t": "T - Tiwaz",
    "rune-a": "A - Ansuz",
    "rune-n": "N - Naudiz",
}


def export_psd():
    """art/bind-rune.psd from art/bind-rune.svg (transparent, 4x): one layer per rune
    (PSD_LAYERS), stacked so together they make the bind rune. Elements with other ids
    (or none) are left out, and so is the guide."""
    import re
    import subprocess
    import tempfile
    out = ART / "bind-rune.psd"
    text = (ART / "bind-rune.svg").read_text(encoding="utf-8")
    text = re.sub(r"<!--.*?-->", "", text, flags=re.S)
    text = re.sub(r'<[^<>]*\bid="guide"[^<>]*/>', "", text)
    layers = []
    with tempfile.TemporaryDirectory() as tmp:
        for rune_id, name in PSD_LAYERS.items():
            # keep only this rune's element
            only = re.sub(r'<path\b(?![^>]*\bid="' + rune_id + r'")[^>]*/>', "", text)
            svg_file, png_file = Path(tmp, f"{rune_id}.svg"), Path(tmp, f"{rune_id}.png")
            svg_file.write_text(only, encoding="utf-8")
            subprocess.run(["magick", "-background", "none", "-density", "288", str(svg_file),
                            "-depth", "8", str(png_file)], check=True)
            layers.append((png_file, name))
        # A PSD from ImageMagick: the first image is the merged view, the rest are the layers.
        merged = ["("] + [str(p) for p, _ in layers] + ["-background", "none", "-flatten", ")"]
        named = sum((["(", str(p), "-set", "label", n, ")"] for p, n in layers), [])
        subprocess.run(["magick", *merged, *named, "-depth", "8", str(out)], check=True)
    print("Wrote", out, f"({len(layers)} layers; set BIND_RUNE_FILE to it to use your edits)")


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
    art = bind_rune_art()

    def corner(turn):
        mark = "" if mode == "grain" else (
            f'<g transform="rotate({-turn},{c},{c})"><g filter="url(#mark)">{art}</g></g>')
        return f"""<g>
      <rect width="{BAND}" height="{BAND}" fill="{stone}"{corner_fill}/>
      <path d="M{BAND},{EDGE}H{EDGE}V{BAND}" stroke="{ink}" stroke-width="{LINE}" fill="none" stroke-linejoin="round"/>
      <path d="M{BAND},{BAND - EDGE}H{BAND - EDGE}V{BAND}" stroke="{ink}" stroke-width="{LINE}" fill="none"/>
      {mark}
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
    return f"""<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="{S * scale}" height="{S * scale}" viewBox="0 0 {S} {S}">
  <!-- Generated by scripts/make_rune_border.py: edit that, then rerun it.
       CSS: border-image: url(rune-border.svg) {BAND} round; -->
  <defs>
    {grain("grain-tile", TILE, BAND, raw)}
    {grain("grain-corner", BAND, BAND, raw)}
    {mark_filter(mode)}
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
    if "--psd" in sys.argv:
        export_psd()
    if "--masks" in sys.argv:
        write_masks()
        print(f"Render: blender -b -P scripts/render_frame_blender.py -- --variant border --size {S * MASK_SCALE}"
              f"  (then border-image slice {BAND * MASK_SCALE})")

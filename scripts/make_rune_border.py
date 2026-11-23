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
       python scripts/make_rune_border.py --finish <blender render.png> <out.webp>
         (copies the top strip to all sides so the lighting matches; use for every render)
       --masks: Blender masks (see the end); --psd: export art/bind-rune.psd to edit
"""
from pathlib import Path

from make_avatar_frame import RUNES  # same rune shapes as the avatar ring

# With flat, heavier strokes the parallel branches of ᚨ and ᚠ nearly touch and leave a
# hairline gap, so on the border their second branch sits a little lower.
RUNES = {**RUNES, "ᚨ": "M1,0V12M1,0L5,3M1,4.2L5,7.2", "ᚠ": "M1,0V12M1,4L5,0M1,8.2L5,4.2"}

OUT = Path(__file__).resolve().parent.parent / "images" / "rune-border.svg"

BAND = 26                  # band width = border-image slice
PITCH = 11.5               # spacing between runes along the band
TEXT = "ᚾᚨᛏᛏᚠᛟᛞᛞ:ᛞᚱᚨᚲᛟᚾ:"  # one tile = one pass; the last ":" sits on the seam (see rune_marks)
TILE = round(PITCH * len(TEXT))   # tile length
S = 2 * BAND + TILE        # whole image

STONE = "#a7adb4"
INK = "#26262a"
GOLD = "#d2a54a"           # rune fill
GOLD_EDGE = "#5a4317"      # dark rim under the gold, so it reads as inlaid
LINE = 1.6
EDGE = 1.4                 # how far the carved edge lines sit inside the band
# Runes are drawn as tapered strokes, like chisel cuts: each straight stroke is a filled
# shape, widest in the middle and narrowing to small rounded tips, so strokes just
# overlap where they meet (no spikes from pointed joins, no blobs from round caps).
RUNE_W_MID = 1.7           # stroke width at its middle
RUNE_W_END = 1.2           # stroke width at its ends
RUNE_TIPS = "flat"         # "flat" (chisel-cut ends) or "round"
RUNE_GROOVE = 0.9          # carved dark groove round each rune (lines mask), for contrast when small
DOT_R = 1.4

# Corner mark: the NAT bind rune, read from its own file so it can be edited in any
# tool. Only its shape (alpha) is used; colours, outline and masks are made from it.
# .svg: a 60 x 120 rune box (0,0 to 60,120) with a margin set by its viewBox (an
#       element with id="guide" is ignored). .psd / .png: an image with that same framing, e.g.
#       one exported with --psd.
ART = Path(__file__).resolve().parent.parent / "art"
BIND_RUNE_FILE = ART / "bind-rune.svg"     # or ART / "bind-rune.psd"
BIND_RUNE_HEIGHT = 12     # rune box height: the same as the runes (12)
MARK_RIM = 0.7             # web SVG: dark rim round the gold
MARK_OUTLINE = RUNE_GROOVE # masks: carved groove round the mark


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
    # The SVG's viewBox gives the framing round the 60 x 120 rune box; a .psd/.png
    # is taken to have the same framing (as --psd exports it).
    vb_x, vb_y, vb_w, vb_h = map(float, re.search(
        r'viewBox="([^"]+)"', (ART / "bind-rune.svg").read_text(encoding="utf-8")).group(1).split())
    f = BIND_RUNE_HEIGHT / 120                     # file units -> corner units
    x, y = BAND / 2 + (vb_x - 30) * f, BAND / 2 + (vb_y - 60) * f
    w, h = vb_w * f, vb_h * f
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


def taper(d, w_mid=RUNE_W_MID, w_end=RUNE_W_END):
    """A stroke path made of straight segments (absolute M, L, H, V) as filled, tapered
    shapes: one per segment, straight sides widest in the middle, flat-cut (or rounded)
    tips. Where strokes meet, the join is filled with the hull of their cut ends, so a
    flat-cut apex (like ᛏ's arrow) comes out sharp instead of notched."""
    import math
    import re
    out, x, y = [], 0.0, 0.0
    ends = {}                                              # point -> cut-end corners there
    for cmd, args in re.findall(r"([MLHV])([^MLHV]*)", d):
        nums = [float(n) for n in re.findall(r"-?\d*\.?\d+", args)]
        if cmd == "M":
            x, y = nums[0], nums[1]
            continue
        nx, ny = (nums[0], nums[1]) if cmd == "L" else (nums[0], y) if cmd == "H" else (x, nums[0])
        length = math.hypot(nx - x, ny - y)
        if length:
            ux, uy = (nx - x) / length, (ny - y) / length
            px, py = -uy, ux                               # normal
            he, hm = w_end / 2, w_mid / 2
            mx, my = (x + nx) / 2, (y + ny) / 2
            tip = he * 1.4
            pts = lambda *xy: " ".join(f"{v:.3f}" for v in xy)
            out.append(
                f"M{pts(x + px * he, y + py * he)}"
                f"L{pts(mx + px * hm, my + py * hm)}L{pts(nx + px * he, ny + py * he)}"
                + (f"Q{pts(nx + ux * tip, ny + uy * tip, nx - px * he, ny - py * he)}" if RUNE_TIPS == "round"
                   else f"L{pts(nx - px * he, ny - py * he)}")
                + f"L{pts(mx - px * hm, my - py * hm)}L{pts(x - px * he, y - py * he)}"
                + (f"Q{pts(x - ux * tip, y - uy * tip, x + px * he, y + py * he)}Z" if RUNE_TIPS == "round" else "Z"))
            for (ex, ey) in ((x, y), (nx, ny)):
                ends.setdefault((round(ex, 3), round(ey, 3)), []).extend(
                    [(ex + px * he, ey + py * he), (ex - px * he, ey - py * he)])
        x, y = nx, ny
    for corners in ends.values():
        if len(corners) >= 4:                              # two or more strokes meet here
            hull = convex_hull(corners)[::-1]              # same winding as the strokes, or they cancel
            out.append("M" + "L".join(f"{a:.3f} {b:.3f}" for a, b in hull) + "Z")
    return "".join(out)


def convex_hull(points):
    """Convex hull of 2D points (monotone chain), in order."""
    pts = sorted(set(points))
    if len(pts) < 3:
        return pts
    cross = lambda o, a, b: (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0])
    lower, upper = [], []
    for p in pts:
        while len(lower) >= 2 and cross(lower[-2], lower[-1], p) <= 0:
            lower.pop()
        lower.append(p)
    for p in reversed(pts):
        while len(upper) >= 2 and cross(upper[-2], upper[-1], p) <= 0:
            upper.pop()
        upper.append(p)
    return lower[:-1] + upper[:-1]


def rune_marks(mode="web"):
    """The runes as tapered shapes. Web: gold with a thin dark rim. Masks: white; in the
    lines mask they are widened by RUNE_GROOVE (#groove filter) into the carved groove."""
    _, ink, gold, gold_edge = MODES[mode]
    colour = ink if mode == "lines" else gold
    rim = f' stroke="{gold_edge}" stroke-width="0.6" paint-order="stroke"' if mode == "web" else ""
    out = []
    # The closing ":" sits exactly on the seam, half at each end of the tile, so repeats
    # show one divider between passes and every corner gets a divider on both sides
    # (the halves at the strip ends land in the corner pieces).
    marks = [(0, ":")] + [((i + 1) * PITCH, ch) for i, ch in enumerate(TEXT)]
    for x, ch in marks:
        if ch == ":":
            for y in (BAND / 2 - 2.5, BAND / 2 + 2.5):
                out.append(f'<circle cx="{x}" cy="{y}" r="{DOT_R}" fill="{colour}"{rim}/>')
        else:
            t = f'translate({x - 3},{BAND / 2 - 6})'
            out.append(f'<path transform="{t}" d="{taper(RUNES[ch])}" fill="{colour}"{rim}/>')
    group = "\n      ".join(out)
    return f'<g filter="url(#groove)">{group}</g>' if mode == "lines" else group


def svg(mode="web", scale=1):
    stone, ink, gold, gold_edge = MODES[mode]
    textured = mode in ("web", "grain")
    tile_fill = f' filter="url(#grain-tile)"' if textured else ""
    corner_fill = f' filter="url(#grain-corner)"' if textured else ""
    tile = f"""<g id="tile">
      <rect width="{TILE}" height="{BAND}" fill="{stone}"{tile_fill}/>
      <path d="M0,{EDGE}H{TILE}M0,{BAND - EDGE}H{TILE}" stroke="{ink}" stroke-width="{LINE}"/>
      <g>
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
    place = [  # (piece, transform); each piece written out in full rather than reused with <use>.
        # Corners first: the tiles' half dividers at their ends draw over the corners.
        (corner(0), "translate(0,0)"),
        (corner(90), f"translate({S},0) rotate(90)"),
        (corner(180), f"translate({S},{S}) rotate(180)"),
        (corner(270), f"translate(0,{S}) rotate(270)"),
        (tile, f"translate({BAND},0)"),
        (tile, f"translate({S},{BAND}) rotate(90)"),
        (tile, f"translate({S - BAND},{S}) rotate(180)"),
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
    <filter id="groove" filterUnits="userSpaceOnUse" x="{-PITCH}" y="0" width="{TILE + 2 * PITCH}" height="{BAND}">
      <feMorphology in="SourceGraphic" operator="dilate" radius="{RUNE_GROOVE}"/>
    </filter>
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


def finish_render(render, out):
    """Make a Blender render of the border even on all four sides: the top strip is
    copied, rotated, onto the right, bottom and left strips (a single light from one
    side lights each strip's carving differently, and the metal reflects a different
    part of the sky on each). Corners stay as rendered. Writes WebP (or PNG)."""
    import subprocess
    k = MASK_SCALE
    b, t, s = BAND * k, TILE * k, S * k
    top = ["(", "-clone", "0", "-crop", f"{t}x{b}+{b}+0", "+repage"]
    subprocess.run(["magick", str(render),
                    *top, "-rotate", "90", ")", "-geometry", f"+{s - b}+{b}", "-composite",
                    *top, "-rotate", "180", ")", "-geometry", f"+{b}+{s - b}", "-composite",
                    *top, "-rotate", "270", ")", "-geometry", f"+0+{b}", "-composite",
                    "-define", "webp:alpha-quality=100", "-quality", "90", str(out)], check=True)
    print("Wrote", out)


if __name__ == "__main__":
    import sys
    if "--finish" in sys.argv:     # --finish <render.png> <out.webp>
        i = sys.argv.index("--finish")
        finish_render(Path(sys.argv[i + 1]), Path(sys.argv[i + 2]))
        sys.exit()
    OUT.write_text(svg(), encoding="utf-8")
    print("Wrote", OUT, f"({S}x{S}; border-image slice {BAND})")
    if "--psd" in sys.argv:
        export_psd()
    if "--masks" in sys.argv:
        write_masks()
        print(f"Render: blender -b -P scripts/render_frame_blender.py -- --variant border --size {S * MASK_SCALE}"
              f"  (then border-image slice {BAND * MASK_SCALE})")

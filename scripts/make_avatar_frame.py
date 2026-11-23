"""Draw images/avatar-frame.svg: a runestone-style serpent band around the avatar.

A stone band circles the avatar with a red runic inscription carved along it,
and the serpent's head (after the Urnes-style beasts on Viking-age runestones)
bites its own tapering tail at the top. Runes are drawn as lines, so no runic
font is needed.

Writes both images/avatar-frame.svg (plain ring, used by the page) and
images/avatar-frame-head.svg (the serpent biting its tail).

Usage: python scripts/make_avatar_frame.py   (prints the sizes for css/main.css)
"""
import math
from pathlib import Path

OUT = Path(__file__).resolve().parent.parent / "images" / "avatar-frame.svg"            # plain ring
HEAD_OUT = OUT.with_name("avatar-frame-head.svg")                                     # serpent version

SIZE = 200                 # drawing area, centred on (C, C)
C = SIZE / 2
PAD = 16                   # margin so the head, lappet and shadow are never cut off
R_OUT, R_IN = 97, 71       # band edges; the avatar shows inside R_IN
R_MID = (R_OUT + R_IN) / 2
BAND = R_OUT - R_IN

INK = "#26262a"            # carved outlines and head details
RUNE = "#c0281f"           # runes and word dividers, painted red like the old stones
STONE = "#a7adb4"          # light slate, before the grain darkens it a little
LINE = 1.6                 # outline width
TEXT = "ᚾᚨᛏᛏᚠᛟᛞᛞ:ᛞᚱᚨᚲᛟᚾ:ᚾᚨᛏᛏᚠᛟᛞᛞ:ᛞᚱᚨᚲᛟᚾ"

# Elder Futhark letters as strokes in a 6 x 12 box (x right, y down); ":" is a word divider.
RUNES = {
    "ᚾ": "M3,0V12M1,4L5,7",
    "ᚨ": "M1,0V12M1,0L5,3M1,3L5,6",
    "ᛏ": "M3,0V12M0,3L3,0L6,3",
    "ᚠ": "M1,0V12M1,4L5,0M1,7L5,3",
    "ᛟ": "M3,0L6,4L0,12M3,0L0,4L6,12",
    "ᛞ": "M0,0V12M6,0V12M0,0L6,12M6,0L0,12",
    "ᚱ": "M1,12V0L5,3L1,6L5,12",
    "ᚲ": "M5,2L1,6L5,10",
}

# Local coords for head and tail: +x runs clockwise along the band, the band is
# y in [-13, 13], and -y points outward.

# Plain ring (the one the page uses): closed, no head or tail, half the band width.
PLAIN_BAND = BAND / 2
PLAIN_R_OUT = R_IN + PLAIN_BAND
PLAIN_R_MID = R_IN + PLAIN_BAND / 2
PLAIN_RUNE_SCALE = 0.62            # runes are 12 tall at full size
PLAIN_RUNE_LINE = 1.2              # rune stroke width on the plain ring
PLAIN_REPEATS = 3                  # times the inscription goes round

# Head, at END, pointing clockwise. Urnes-style, drawn with sharp corners: long upper
# jaw with a pointed tip and a hook curling up, short pointed lower jaw, a teardrop
# eye pointed at the back, an angular jaw line, and a lappet ribbon that loops back
# from the crown and crosses over the band.
HEAD = ("M0,-13 C8,-14 14,-18 24,-18 C32,-18 38,-15 44,-11 L58,-6.5 "        # crown and upper jaw
        "L63,-3 L57,0 L46,-1 L32,1 "                                         # pointed snout, into the mouth
        "L44,4.5 L52,6 L56,10.5 L50,11 "                                     # lower jaw and its tip
        "C42,11 30,12 20,12.6 C12,13.2 6,13 0,13")                           # throat back to the band
HEAD_LINES = [
    "M58,-6.5 C60.5,-9 60,-12.5 57,-13.5 L54,-11.5",                       # hook curling up off the snout
    "M32,1 L26,8.5",                                                      # jaw line
    "M2,-13 C4,-6 4,6 2,13",                                              # collar
    "M6,-13.3 C8,-6 8,6 6,13",
]
EYE = "M18,-10 L24,-12.4 C29,-14 34,-13 35,-10 C34,-7.2 29,-6.6 24,-7.8 Z"   # teardrop, point to the back
PUPIL = (30, -10.2)
LAPPET = ("M14,-16 C8,-27 -8,-29 -16,-21 C-22,-14 -21,4 -14,14 "
          "C-11,19 -5.5,20 -5,16 C-4.6,13 -8,12.6 -8.5,15")
RIBBON_OUT, RIBBON_IN = 5.4, 2.2   # ribbon = wide ink line with a narrower stone line on top

# Tail, at START, tapering back (local -x) into the head's mouth.
TAIL = "M0,-13 C-10,-12 -20,-8 -28,-3 C-30.5,-1.5 -30.5,1.5 -28,3 C-20,8 -10,12 0,13"
TAIL_LEN = 30
BITE_AT = 40               # the tail tip sits this far along the head, between the jaws
BITE_ANGLE = 270           # where the bite happens; 270 = top

UNIT = 180 / (math.pi * R_MID)          # degrees per local unit along the band
END = BITE_ANGLE - BITE_AT * UNIT + 360  # head starts BITE_AT before the bite point
START = BITE_ANGLE + TAIL_LEN * UNIT     # tail reaches back to the bite point


def polar(r, deg):
    a = math.radians(deg)
    return C + r * math.cos(a), C + r * math.sin(a)


def long_arc(r, a0, a1):
    """Clockwise arc from a0 to a1 degrees (may exceed 180), as two SVG arc commands."""
    mid = (a0 + a1) / 2
    (x0, y0), (xm, ym), (x1, y1) = polar(r, a0), polar(r, mid), polar(r, a1)
    return f"M{x0:.2f},{y0:.2f}A{r},{r} 0 0 1 {xm:.2f},{ym:.2f}A{r},{r} 0 0 1 {x1:.2f},{y1:.2f}"


def place(deg, r=R_MID):
    """Transform for local coords at angle deg."""
    x, y = polar(r, deg)
    return f"translate({x:.2f},{y:.2f}) rotate({deg + 90:.2f})"


def runes(plain=False):
    r, k = R_MID, 1                    # radius of the rune line, rune scale
    if plain:   # evenly all the way round, with a divider where the text meets itself
        r, k = PLAIN_R_MID, PLAIN_RUNE_SCALE
        text = (TEXT + ":") * PLAIN_REPEATS
        first, step = 270, 360 / len(text)
    else:       # keep clear of the tail and the lappet
        text = TEXT
        first, last = START + 12, END - 17
        step = (last - first) / (len(text) - 1)
    out = []
    for i, ch in enumerate(text):
        t = place(first + i * step, r) + (f" scale({k})" if k != 1 else "")
        if ch == ":":
            out.append(f'<g transform="{t}" fill="{RUNE}" stroke="none">'
                       f'<circle cy="-2.5" r="1.15"/><circle cy="2.5" r="1.15"/></g>')
        else:
            width = f' stroke-width="{PLAIN_RUNE_LINE / k:.2f}"' if k != 1 else ""
            out.append(f'<path transform="{t} translate(-3,-6)" stroke="{RUNE}"{width} d="{RUNES[ch]}"/>')
    return "\n    ".join(out)


def grain_filter(fid, shadow, box=None):
    # userSpaceOnUse over the whole drawing, so the effect never clips the shapes
    # (a bounding-box region leaves out stroke widths and cuts off the band's edges).
    x, y, w, h = box or (-PAD, -PAD, SIZE + 2 * PAD, SIZE + 2 * PAD)
    region = f'filterUnits="userSpaceOnUse" x="{x}" y="{y}" width="{w}" height="{h}"'
    funcs = "".join(f'<feFunc{c} type="linear" slope="0.35" intercept="0.75"/>' for c in "RGB")
    drop = ('\n      <feDropShadow dx="0" dy="1.2" stdDeviation="1.4" flood-color="#000" flood-opacity="0.45"/>'
            if shadow else "")
    return f"""<filter id="{fid}" {region} color-interpolation-filters="sRGB">
      <feTurbulence type="fractalNoise" baseFrequency="0.9" numOctaves="3" seed="7" result="noise"/>
      <feColorMatrix in="noise" type="saturate" values="0" result="grey"/>
      <feComponentTransfer in="grey" result="grain">{funcs}<feFuncA type="linear" slope="0" intercept="1"/></feComponentTransfer>
      <feBlend in="SourceGraphic" in2="grain" mode="multiply" result="textured"/>
      <feComposite in="textured" in2="SourceGraphic" operator="in"/>{drop}
    </filter>"""


def plain_box():
    half = PLAIN_R_OUT + 5               # room for the outline and the shadow
    return C - half, C - half, 2 * half, 2 * half


def plain_svg():
    box = plain_box()
    ink = f'fill="none" stroke="{INK}" stroke-width="{LINE}" stroke-linecap="round" stroke-linejoin="round"'
    return f"""<svg xmlns="http://www.w3.org/2000/svg" viewBox="{' '.join(f'{v:g}' for v in box)}">
  <!-- Generated by scripts/make_avatar_frame.py (plain ring): edit that, then rerun it. -->
  <defs>
    {grain_filter("stone", shadow=True, box=box)}
  </defs>
  <g filter="url(#stone)">
    <circle cx="{C}" cy="{C}" r="{PLAIN_R_MID}" fill="none" stroke="{STONE}" stroke-width="{PLAIN_BAND - LINE / 2}"/>
  </g>
  <g {ink}>
    <circle cx="{C}" cy="{C}" r="{PLAIN_R_OUT}"/>
    <circle cx="{C}" cy="{C}" r="{R_IN}"/>
    {runes(plain=True)}
  </g>
</svg>
"""


def head_svg():
    head, tail = place(END), place(START)
    band = long_arc(R_MID, START, END)
    edges = long_arc(R_OUT, START, END) + " " + long_arc(R_IN, START, END)
    lines = "".join(f'<path d="{d}"/>' for d in HEAD_LINES)
    full = SIZE + 2 * PAD
    ink = f'fill="none" stroke="{INK}" stroke-width="{LINE}" stroke-linecap="round" stroke-linejoin="round"'
    sharp = f'fill="none" stroke="{INK}" stroke-width="{LINE}" stroke-linecap="butt" stroke-linejoin="miter" stroke-miterlimit="8"'
    return f"""<svg xmlns="http://www.w3.org/2000/svg" viewBox="{-PAD} {-PAD} {full} {full}">
  <!-- Generated by scripts/make_avatar_frame.py: edit that, then rerun it. -->
  <defs>
    {grain_filter("stone", shadow=True)}
    {grain_filter("grain", shadow=False)}
  </defs>
  <!-- band and tail, under the head -->
  <g filter="url(#stone)" fill="{STONE}">
    <path d="{band}" fill="none" stroke="{STONE}" stroke-width="{BAND - LINE / 2}"/>
    <g transform="{tail}"><path d="M0.4,-12.6 {TAIL[7:]} L0.4,12.6Z"/></g>
  </g>
  <g {ink}>
    <path d="{edges}"/>
    <g transform="{tail}"><path d="{TAIL}"/></g>
    {runes()}
  </g>
  <!-- head on top, its jaws around the tail -->
  <g filter="url(#stone)" fill="{STONE}">
    <g transform="{head}"><path d="M-0.4,-12.6 {HEAD[7:]} L-0.4,12.6Z"/></g>
  </g>
  <g {sharp}>
    <g transform="{head}"><path d="{HEAD}"/>{lines}<path d="{EYE}"/><circle cx="{PUPIL[0]}" cy="{PUPIL[1]}" r="1.3" fill="{INK}" stroke="none"/></g>
  </g>
  <!-- lappet ribbon looping back over the band -->
  <g fill="none" stroke-linecap="round" stroke-linejoin="round">
    <g transform="{head}"><path d="{LAPPET}" stroke="{INK}" stroke-width="{RIBBON_OUT}"/></g>
    <g filter="url(#grain)"><g transform="{head}"><path d="{LAPPET}" stroke="{STONE}" stroke-width="{RIBBON_IN}"/></g></g>
  </g>
</svg>
"""


AVATAR_REM = 6.213                 # avatar diameter on the page; the frame is sized around it


def css_hint(name, full):
    return (f"{name}: frame {AVATAR_REM * full / (2 * R_IN):.3f}rem, avatar inset "
            f"{(full / 2 - R_IN) / full:.2%}, size {2 * R_IN / full:.2%}")


if __name__ == "__main__":
    OUT.write_text(plain_svg(), encoding="utf-8")
    HEAD_OUT.write_text(head_svg(), encoding="utf-8")
    print("Wrote", OUT, "and", HEAD_OUT)
    print("For css/main.css (.avatar-frame / .avatar):")
    print(" ", css_hint(OUT.name, plain_box()[2]))
    print(" ", css_hint(HEAD_OUT.name, SIZE + 2 * PAD))

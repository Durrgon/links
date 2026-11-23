"""Draw images/avatar-frame.svg: a runestone-style serpent band around the avatar.

A stone band circles the avatar with a red runic inscription carved along it,
and the serpent's head (after the Urnes-style beasts on Viking-age runestones)
bites its own tapering tail at the top. Runes are drawn as lines, so no runic
font is needed.

Usage: python scripts/make_avatar_frame.py   (prints the avatar size for css/main.css)
"""
import math
from pathlib import Path

OUT = Path(__file__).resolve().parent.parent / "images" / "avatar-frame.svg"

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

# Head, at END, pointing clockwise. Urnes-style: long upper jaw ending in a rolled
# lip, short lower jaw, big almond eye with a trailing line, a spiral on the cheek,
# and a lappet ribbon that loops back from the crown and crosses over the band.
HEAD = ("M0,-13 C8,-14 14,-18 24,-18 C32,-18 38,-15 44,-11 L58,-6.5 "        # crown and upper jaw
        "C62,-5 62.5,0.5 58,0 L46,-1 L32,1 "                                 # rolled lip, into the mouth
        "L44,4.5 L52,6 C55.5,7 55.5,11 51,11 "                               # lower jaw and its tip
        "C42,11 30,12 20,12.6 C12,13.2 6,13 0,13")                           # throat back to the band
HEAD_LINES = [
    "M57,-6.6 C61,-9.5 60.5,-14.5 56.5,-14 C53.5,-13.6 54,-10.6 56,-10.6",  # lip curling up
    "M20,-10 L13,-9",                                                     # eye's trailing line
    "M25,-2.5 C20.5,0 19.5,5.5 22.5,8 C25,9.8 28,7.8 26.5,5.5",            # cheek spiral
    "M2,-13 C4,-6 4,6 2,13",                                              # collar
    "M6,-13.3 C8,-6 8,6 6,13",
]
EYE = "M20,-10 C25,-14.5 33,-14 37,-10 C32,-7.5 25,-7.5 20,-10 Z"
PUPIL = (31, -10.4)
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


def runes():
    first, last = START + 12, END - 17   # keep clear of the tail and the lappet
    step = (last - first) / (len(TEXT) - 1)
    out = []
    for i, ch in enumerate(TEXT):
        t = place(first + i * step)
        if ch == ":":
            out.append(f'<g transform="{t}" fill="{RUNE}" stroke="none">'
                       f'<circle cy="-2.5" r="1.15"/><circle cy="2.5" r="1.15"/></g>')
        else:
            out.append(f'<path transform="{t} translate(-3,-6)" stroke="{RUNE}" d="{RUNES[ch]}"/>')
    return "\n    ".join(out)


def grain_filter(fid, shadow):
    # userSpaceOnUse over the whole drawing, so the effect never clips the shapes
    # (a bounding-box region leaves out stroke widths and cuts off the band's edges).
    region = (f'filterUnits="userSpaceOnUse" x="{-PAD}" y="{-PAD}" '
              f'width="{SIZE + 2 * PAD}" height="{SIZE + 2 * PAD}"')
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


def svg():
    head, tail = place(END), place(START)
    band = long_arc(R_MID, START, END)
    edges = long_arc(R_OUT, START, END) + " " + long_arc(R_IN, START, END)
    lines = "".join(f'<path d="{d}"/>' for d in HEAD_LINES)
    full = SIZE + 2 * PAD
    ink = f'fill="none" stroke="{INK}" stroke-width="{LINE}" stroke-linecap="round" stroke-linejoin="round"'
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
  <g {ink}>
    <g transform="{head}"><path d="{HEAD}"/>{lines}<path d="{EYE}"/><circle cx="{PUPIL[0]}" cy="{PUPIL[1]}" r="1.3" fill="{INK}" stroke="none"/></g>
  </g>
  <!-- lappet ribbon looping back over the band -->
  <g fill="none" stroke-linecap="round" stroke-linejoin="round">
    <g transform="{head}"><path d="{LAPPET}" stroke="{INK}" stroke-width="{RIBBON_OUT}"/></g>
    <g filter="url(#grain)"><g transform="{head}"><path d="{LAPPET}" stroke="{STONE}" stroke-width="{RIBBON_IN}"/></g></g>
  </g>
</svg>
"""


if __name__ == "__main__":
    OUT.write_text(svg(), encoding="utf-8")
    full = SIZE + 2 * PAD
    print("Wrote", OUT)
    print(f"For css/main.css: .avatar-frame {{ width/height {9.625 * full / 220:.3f}rem }}, "
          f".avatar {{ left/top {(full / 2 - R_IN) / full:.2%}, width/height {2 * R_IN / full:.2%} }}")

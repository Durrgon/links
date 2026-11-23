"""Pack the frame masks into one RGBA texture per frame, for the live-lit page (js/lit.js).

    R = runes (raised metal)     G = carved lines (edges and grooves round runes)
    B = the band's edge lines    A = shape (everything drawn)

Same framing as the static images, so js/lit.js draws them where the static ring and
border are. The stone grain is made in the shader (in screen space, so the border's
repeats stay seamless).

Make the masks first:
    python scripts/make_avatar_frame.py --masks
    python scripts/make_rune_border.py --masks
Then:  python scripts/make_lit_maps.py
"""
import subprocess
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
MASKS = ROOT / "art" / "frame-masks"
OUT = ROOT / "images" / "lit"

FRAMES = {  # output name: (mask prefix, size in px)
    "ring": ("plain", 1024),
    "border": ("border", 944),
}


def pack(prefix, size, out):
    # the ring has no grooves round its runes, so its lines mask is all edges
    edges = "edges" if (MASKS / f"{prefix}-edges.png").exists() else "lines"
    channels = [MASKS / f"{prefix}-{name}.png" for name in ("runes", "lines", edges, "shape")]
    subprocess.run(["magick", *map(str, channels), "-resize", f"{size}x{size}!",
                    "-channel", "RGBA", "-combine", "-define", "png:color-type=6", str(out)],
                   check=True)
    print("Wrote", out)


if __name__ == "__main__":
    OUT.mkdir(parents=True, exist_ok=True)
    for name, (prefix, size) in FRAMES.items():
        pack(prefix, size, OUT / f"{name}.png")

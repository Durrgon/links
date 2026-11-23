"""Pack the frame masks into one RGBA texture per frame, for the live-lit page (js/lit.js).

    R = runes (raised metal)     G = carved lines (grooves)
    B = stone (band area)        A = shape (everything drawn)

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
    channels = [MASKS / f"{prefix}-{name}.png" for name in ("runes", "lines", "shape", "shape")]
    # The stone mask (B) is the shape without the runes and lines; here simply the shape:
    # the shader lets runes and lines take over where they are set.
    subprocess.run(["magick", *map(str, channels), "-resize", f"{size}x{size}!",
                    "-channel", "RGBA", "-combine", "-define", "png:color-type=6", str(out)],
                   check=True)
    print("Wrote", out)


if __name__ == "__main__":
    OUT.mkdir(parents=True, exist_ok=True)
    for name, (prefix, size) in FRAMES.items():
        pack(prefix, size, OUT / f"{name}.png")

"""Copy the Bluesky avatar and header into images/ so the site matches the profile.

Writes, from the header:  images/banner.webp, images/og-image.jpg
       from the avatar:   images/avatar.webp, images/favicon.png, images/apple-touch-icon.png
Skips the work when images/bluesky.json already names the same two images.

Usage: python scripts/sync_bluesky.py [--force]    (needs Pillow)
"""
import io
import json
import sys
import urllib.parse
import urllib.request
from pathlib import Path

from PIL import Image

HANDLE = "durrgon.bsky.social"
API = "https://public.api.bsky.app/xrpc/app.bsky.actor.getProfile?actor="
ROOT = Path(__file__).resolve().parent.parent
IMAGES = ROOT / "images"
STATE = IMAGES / "bluesky.json"
UA = {"User-Agent": "links-site-sync/1.0"}


def fetch(url: str) -> bytes:
    with urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=30) as r:
        return r.read()


def open_image(url: str) -> Image.Image:
    return Image.open(io.BytesIO(fetch(url))).convert("RGB")


def cover(img: Image.Image, w: int, h: int, y: float = 0.5) -> Image.Image:
    """Scale to fill w x h and crop; y picks the vertical crop point (0 top, 1 bottom)."""
    scale = max(w / img.width, h / img.height)
    img = img.resize((round(img.width * scale), round(img.height * scale)), Image.LANCZOS)
    left = (img.width - w) // 2
    top = round((img.height - h) * y)
    return img.crop((left, top, left + w, top + h))


def main() -> int:
    profile = json.loads(fetch(API + urllib.parse.quote(HANDLE)))
    avatar_url, banner_url = profile.get("avatar"), profile.get("banner")
    if not avatar_url or not banner_url:
        print("Profile has no avatar or no header; leaving images alone.")
        return 1

    # The last path segment is the image's content id: it changes only when the image does.
    state = {"avatar": avatar_url.rsplit("/", 1)[-1], "banner": banner_url.rsplit("/", 1)[-1]}
    if "--force" not in sys.argv and STATE.exists() and json.loads(STATE.read_text()) == state:
        print("Bluesky images unchanged.")
        return 0

    IMAGES.mkdir(exist_ok=True)
    banner = open_image(banner_url)
    if banner.width > 1500:
        banner = banner.resize((1500, round(banner.height * 1500 / banner.width)), Image.LANCZOS)
    banner.save(IMAGES / "banner.webp", quality=80, method=6)
    cover(banner, 1200, 630, y=0.75).save(IMAGES / "og-image.jpg", quality=82, optimize=True)

    avatar = open_image(avatar_url)
    avatar.resize((256, 256), Image.LANCZOS).save(IMAGES / "avatar.webp", quality=82, method=6)
    avatar.resize((180, 180), Image.LANCZOS).save(IMAGES / "apple-touch-icon.png", optimize=True)
    avatar.resize((64, 64), Image.LANCZOS).save(IMAGES / "favicon.png", optimize=True)

    STATE.write_text(json.dumps(state, indent=2) + "\n")
    print("Updated images from Bluesky:", state)
    return 0


if __name__ == "__main__":
    sys.exit(main())

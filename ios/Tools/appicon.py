#!/usr/bin/env python3
"""Render the Warrly app icon ("The Kept Receipt") from one vector definition.

The mark is one filled receipt silhouette plus one stamp dot, drawn on a 32x32
grid.  This script is the source of truth for the PNGs in
``App/Assets.xcassets/AppIcon.appiconset``; re-run it instead of hand-editing a
bitmap.

    python3 Tools/appicon.py                     # write the three 1024 masters
    python3 Tools/appicon.py --previews /tmp/x   # + derived sizes / squircle

Why the appiconset only contains 1024px files
---------------------------------------------
``Contents.json`` uses Xcode's modern "single size" format: one universal
1024 slot per appearance (any / dark / tinted), and the asset compiler derives
every device size itself.  The small renders this script can emit are for
visual review only -- they are deliberately not added to the catalog, because
mixing a hand-made size list with the single-size slots is exactly how an icon
set gets ignored by iOS.

Geometry (32x32 grid)
---------------------
* Receipt body 16x24: x=8..24, y=3..27, one filled path, no stroke.
* Clean top, 1.5 top-corner radii.
* Torn bottom: five asymmetric notches, y=25.7..27.2, max 1.5 deep.
  Ink bounds are 16 x 24.2 (the lowest tooth reaches y=27.2).
* Date dot: r=2.0 at (19.9, 21.6) -- 25% of the body width, low-right.
* Tinted/mono: the dot is a knockout subpath, not a second grey.

Colours are fixed brand values.  Nothing here reads the in-app accent setting.
"""

from __future__ import annotations

import argparse
import hashlib
import math
import os
import sys

try:
    from PIL import Image, ImageDraw
except ImportError:  # pragma: no cover - env hint only
    sys.exit("Pillow is required: python3 -m pip install Pillow")

# ---------------------------------------------------------------- palette ---
CREAM = "#FFF7EE"       # light ground
INK = "#1F1A14"         # receipt on the light ground
CORAL = "#FF6B45"       # stamp on the light ground
DARK_GROUND = "#0E1018"
DARK_RECEIPT = "#F4EBDC"
DARK_CORAL = "#E2573A"  # the light coral, darkened for a dark ground

# Tinted (iOS 18+) is a single-channel glyph on transparent, no ground.  The
# date dot is a knockout, so the system tint shows through it.
TINT_RECEIPT = "#FFFFFF"

# --------------------------------------------------------------- geometry ---
# Exact silhouette from the brand path (viewBox 0 0 32 32):
#   M9.5 3H22.5A1.5 1.5 0 0 1 24 4.5V25.8L23 27.2 ...
#   L8 26.7V4.5A1.5 1.5 0 0 1 9.5 3Z
GRID = 32.0
BODY_L = 8.0
BODY_T, TOP_RADIUS = 3.0, 1.5
TOP_LEFT, TOP_RIGHT = (9.5, BODY_T), (22.5, BODY_T)
# The tear is the bottom edge.  Stored right-to-left, the direction the path
# travels after the right edge; the five upward notches are the odd-indexed
# segments.  Values are the brand path's, unrounded.
TORN_BOTTOM = [
    (24.0, 25.8),
    (23.0, 27.2),
    (21.7, 25.8),
    (20.2, 26.7),
    (18.4, 25.7),
    (16.8, 27.1),
    (15.2, 25.9),
    (13.4, 26.8),
    (11.8, 25.8),
    (10.2, 27.0),
    (8.8, 26.1),
    (8.0, 26.7),
]
DOT_CX, DOT_CY, DOT_R = 19.9, 21.6, 2.0

MASTER = 1024
SUPERSAMPLE = 4  # 4096px canvas for the 1024 master


def hex_rgb(value: str) -> tuple[int, int, int]:
    value = value.lstrip("#")
    return tuple(int(value[i : i + 2], 16) for i in (0, 2, 4))  # type: ignore[return-value]


def _arc(
    cx: float, cy: float, r: float, start_deg: float, end_deg: float, steps: int = 24
) -> list[tuple[float, float]]:
    """Sample a circular arc, excluding its start point."""
    pts: list[tuple[float, float]] = []
    for i in range(1, steps + 1):
        a = math.radians(start_deg + (end_deg - start_deg) * i / steps)
        pts.append((cx + r * math.cos(a), cy + r * math.sin(a)))
    return pts


def receipt_polygon() -> list[tuple[float, float]]:
    """Closed outline in grid units, clockwise on screen.

    Top -> right -> torn bottom -> left.  This is the brand path's own
    direction; the bottom teeth are therefore listed right-to-left.
    """
    pts: list[tuple[float, float]] = [TOP_LEFT, TOP_RIGHT]
    # Top-right corner: (22.5, 3) -> (24, 4.5).
    pts += _arc(TOP_RIGHT[0], BODY_T + TOP_RADIUS, TOP_RADIUS, 270.0, 360.0)
    # Right edge down to (24, 25.8), then the five-notch tear to (8, 26.7).
    pts += TORN_BOTTOM
    # Left edge up to (8, 4.5), then the top-left corner to (9.5, 3).
    pts.append((BODY_L, BODY_T + TOP_RADIUS))
    pts += _arc(TOP_LEFT[0], BODY_T + TOP_RADIUS, TOP_RADIUS, 180.0, 270.0)
    return pts


def _px(points: list[tuple[float, float]], scale: float) -> list[tuple[float, float]]:
    return [(x * scale, y * scale) for x, y in points]


def _draw_rgb(ground: str, receipt: str, dot: str, size: int) -> Image.Image:
    """Opaque master: background painted edge to edge (full bleed)."""
    ss = size * SUPERSAMPLE
    scale = ss / GRID
    img = Image.new("RGB", (ss, ss), hex_rgb(ground))
    draw = ImageDraw.Draw(img)
    draw.polygon(_px(receipt_polygon(), scale), fill=hex_rgb(receipt))
    r = DOT_R * scale
    cx, cy = DOT_CX * scale, DOT_CY * scale
    draw.ellipse((cx - r, cy - r, cx + r, cy + r), fill=hex_rgb(dot))
    return img.resize((size, size), Image.Resampling.BOX)


def _draw_tinted(size: int) -> Image.Image:
    """Single-channel glyph + alpha; no ground, no colour.

    The dot is a knockout (the evenodd subpath in the brand path): alpha is
    punched out, the luminance stays white, so the system's tint shows through
    the stamp instead of a second grey.
    """
    ss = size * SUPERSAMPLE
    scale = ss / GRID
    # Luminance and coverage are downsampled separately so transparent edges
    # do not pick up a dark fringe from the background.
    lum = Image.new("L", (ss, ss), 0)
    alpha = Image.new("L", (ss, ss), 0)
    dl, da = ImageDraw.Draw(lum), ImageDraw.Draw(alpha)
    poly = _px(receipt_polygon(), scale)
    dl.polygon(poly, fill=hex_rgb(TINT_RECEIPT)[0])
    da.polygon(poly, fill=255)
    r = DOT_R * scale
    cx, cy = DOT_CX * scale, DOT_CY * scale
    da.ellipse((cx - r, cy - r, cx + r, cy + r), fill=0)
    lum = lum.resize((size, size), Image.Resampling.BOX)
    alpha = alpha.resize((size, size), Image.Resampling.BOX)
    return Image.merge("LA", (lum, alpha))


def _save_rgb(img: Image.Image, path: str) -> None:
    assert img.mode == "RGB"
    img.save(path, "PNG", optimize=True)


def _squircle_mask(side: int, radius_ratio: float = 0.224) -> Image.Image:
    """Antialiased rounded-rect mask approximating the iOS squircle."""
    ss = side * SUPERSAMPLE
    mask = Image.new("L", (ss, ss), 0)
    radius = radius_ratio * ss
    ImageDraw.Draw(mask).rounded_rectangle((0, 0, ss - 1, ss - 1), radius=radius, fill=255)
    return mask.resize((side, side), Image.Resampling.LANCZOS)


def _composite_squircle(img: Image.Image, out_path: str) -> None:
    side = img.width
    mask = _squircle_mask(side)
    # Neutral "home screen" plate so the crop is visible outside the squircle.
    plate = Image.new("RGB", (side, side), (198, 199, 204))
    plate.paste(img, (0, 0), mask)
    _save_rgb(plate, out_path)


def _dot_pixels(size: int) -> float:
    """Rendered dot diameter in pixels (no snapping in the single-size set)."""
    return 2.0 * DOT_R / GRID * size


def main() -> int:
    here = os.path.dirname(os.path.abspath(__file__))
    default_out = os.path.join(here, "..", "App", "Assets.xcassets", "AppIcon.appiconset")

    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--out", default=os.path.normpath(default_out), help="appiconset directory")
    ap.add_argument("--previews", help="also write review renders (sizes + squircle) here")
    args = ap.parse_args()

    size = MASTER
    os.makedirs(args.out, exist_ok=True)

    variants = {
        "icon-1024.png": _draw_rgb(CREAM, INK, CORAL, size),
        "icon-1024-dark.png": _draw_rgb(DARK_GROUND, DARK_RECEIPT, DARK_CORAL, size),
    }
    tinted = _draw_tinted(size)

    for name, img in variants.items():
        path = os.path.join(args.out, name)
        _save_rgb(img, path)
        print(f"{path}  {img.width}x{img.height} {img.mode}")

    tinted_path = os.path.join(args.out, "icon-1024-tinted.png")
    tinted.save(tinted_path, "PNG", optimize=True)
    print(f"{tinted_path}  {tinted.width}x{tinted.height} {tinted.mode}")

    # Self-checks the reviewer would otherwise have to trust.
    dot_px = (round(DOT_CX * size / GRID), round(DOT_CY * size / GRID))
    receipt_px = (size // 2, size // 2)
    for name, img in variants.items():
        assert img.size == (size, size) and img.mode == "RGB"
        assert img.getpixel((0, 0)) == hex_rgb(CREAM if "dark" not in name else DARK_GROUND)
        assert img.getpixel((size - 1, size - 1)) == img.getpixel((0, 0))
        assert img.getpixel(receipt_px) == hex_rgb(INK if "dark" not in name else DARK_RECEIPT)
        assert img.getpixel(dot_px) == hex_rgb(CORAL if "dark" not in name else DARK_CORAL)
    assert tinted.size == (size, size) and tinted.mode == "LA"
    assert tinted.getpixel((0, 0))[1] == 0, "tinted must have a transparent ground"
    assert tinted.getpixel(receipt_px)[1] == 255, "tinted glyph must be opaque"
    assert tinted.getpixel(dot_px)[1] == 0, "tinted dot must be a knockout"

    print(f"dot diameter: {_dot_pixels(size):.2f}px at {size}px "
          f"({2 * DOT_R / GRID:.2%} of the side)")

    if args.previews:
        os.makedirs(args.previews, exist_ok=True)
        master = variants["icon-1024.png"]
        for side in (180, 120, 87, 80, 76, 60, 58, 40, 29, 20):
            small = master.resize((side, side), Image.Resampling.LANCZOS)
            path = os.path.join(args.previews, f"icon-{side}.png")
            _save_rgb(small, path)
            dia = _dot_pixels(side)
            print(f"{path}  dot {dia:.2f}px" + ("  <-- BELOW 2.5px" if dia < 2.5 else ""))
        _composite_squircle(master, os.path.join(args.previews, "icon-1024-squircle.png"))
        _composite_squircle(
            master.resize((180, 180), Image.Resampling.LANCZOS),
            os.path.join(args.previews, "icon-180-squircle.png"),
        )
        print(os.path.join(args.previews, "icon-1024-squircle.png"))
        print(os.path.join(args.previews, "icon-180-squircle.png"))

    for name in ("icon-1024.png", "icon-1024-dark.png", "icon-1024-tinted.png"):
        path = os.path.join(args.out, name)
        with open(path, "rb") as fh:
            print(f"sha256 {name} {hashlib.sha256(fh.read()).hexdigest()[:16]}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

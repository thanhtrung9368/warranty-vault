#!/usr/bin/env python3
"""Render the Warrly app icon ("W in the tag") from one vector definition.

The mark is a price-tag silhouette -- rounded top corners, a torn zigzag bottom
edge -- with a W cut out of the plate, drawn on a 32x32 grid.  No pennant, no
punched hole, no bevel.  It is the same drawing as ``website/src/lib/brand.ts``
(the full cut).  This script is the source of truth for the PNGs in
``App/Assets.xcassets/AppIcon.appiconset``; re-run it instead of hand-editing a
bitmap.

    python3 Tools/appicon.py                     # write the three 1024 masters
    python3 Tools/appicon.py --previews /tmp/x   # + derived sizes / squircle

Why the appiconset only contains 1024px files
---------------------------------------------
``Contents.json`` uses Xcode's modern "single size" format: one universal
1024 slot per appearance (any / dark / tinted), and the asset compiler derives
every device size itself.  The small renders this script can emit are for
visual review only -- they are deliberately not added to the catalog.

Geometry (32x32 grid)
---------------------
* Plate: x=5..27, y=7..25.4.  The two top corners are a 1.6 radius.  The bottom
  edge is a zigzag: four low points at y=25.4 (x=5, 12.33, 19.67, 27) and three
  tooth tips between them at y=23.0 (x=8.67, 16, 23.33).
* W: a 2.8 stroke with round caps and joins through
  (10.6,11.4) (13.3,18.8) (16,13.4) (18.7,18.8) (21.4,11.4).

The mark is centred on its ink box (x=5..27, y=7..25.4) and drawn at
``GLYPH`` of the canvas width, matching the web app-icon.

Colours are fixed brand values.  Nothing here reads the in-app accent setting.

Tinted (iOS 18+)
----------------
Single-channel luminance + alpha on a transparent ground: the plate is white and
the W is an alpha hole, so the wallpaper shows through the letter.
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
CREAM = "#FFF7EE"       # light ground; also the W's cut-out colour
CORAL = "#FF6B45"       # tag on the light ground
DARK_GROUND = "#0E1018"
DARK_CORAL = "#E2573A"  # the light coral, darkened for a dark ground
TINT_TAG = "#FFFFFF"    # full-strength tint

# --------------------------------------------------------------- geometry ---
GRID = 32.0
MASTER = 1024
SUPERSAMPLE = 4  # 4096px canvas for the 1024 master

# Tag width as a fraction of the canvas edge (22 grid units at 0.84 * 32/22).
GLYPH = 0.84 * 22.0 / GRID

TAG_LEFT, TAG_RIGHT = 5.0, 27.0
TAG_TOP, TAG_LOW, TAG_TIP = 7.0, 25.4, 23.0
TAG_RADIUS = 1.6
TEETH_X = [(5.0, 25.4), (8.67, 23.0), (12.33, 25.4), (16.0, 23.0),
           (19.67, 25.4), (23.33, 23.0), (27.0, 25.4)]   # left -> right

W_POINTS = [(10.6, 11.4), (13.3, 18.8), (16.0, 13.4), (18.7, 18.8), (21.4, 11.4)]
W_STROKE = 2.8

INK_BOX = (TAG_LEFT, TAG_TOP, TAG_RIGHT, TAG_LOW)


def hex_rgb(value: str) -> tuple[int, int, int]:
    value = value.lstrip("#")
    return tuple(int(value[i : i + 2], 16) for i in (0, 2, 4))  # type: ignore[return-value]


def _arc(cx: float, cy: float, r: float, start_deg: float, end_deg: float,
         steps: int = 48) -> list[tuple[float, float]]:
    """Sample a circular arc, excluding its start point and including its end."""
    pts = []
    for i in range(1, steps + 1):
        a = math.radians(start_deg + (end_deg - start_deg) * i / steps)
        pts.append((cx + r * math.cos(a), cy + r * math.sin(a)))
    return pts


def tag_polygon() -> list[tuple[float, float]]:
    """Closed tag outline in grid units, clockwise on screen."""
    r = TAG_RADIUS
    pts: list[tuple[float, float]] = [(TAG_LEFT + r, TAG_TOP), (TAG_RIGHT - r, TAG_TOP)]
    pts += _arc(TAG_RIGHT - r, TAG_TOP + r, r, 270.0, 360.0)   # top-right corner
    pts += list(reversed(TEETH_X))                              # right edge down, zigzag back
    pts += [(TAG_LEFT, TAG_TOP + r)]
    pts += _arc(TAG_LEFT + r, TAG_TOP + r, r, 180.0, 270.0)     # top-left corner
    return pts


def _layout(size: int) -> tuple[float, float, float]:
    """(scale px/unit, offset x, offset y) centring the ink box at GLYPH width."""
    scale = size * GLYPH / (INK_BOX[2] - INK_BOX[0])
    ox = (size - (INK_BOX[2] - INK_BOX[0]) * scale) / 2 - INK_BOX[0] * scale
    oy = (size - (INK_BOX[3] - INK_BOX[1]) * scale) / 2 - INK_BOX[1] * scale
    return scale, ox, oy


def _w_stroke(draw: ImageDraw.ImageDraw, size: int, fill) -> None:
    """Stroke the W with round caps and joins."""
    scale, ox, oy = _layout(size)
    pts = [(x * scale + ox, y * scale + oy) for x, y in W_POINTS]
    r = W_STROKE * scale / 2
    for (x0, y0), (x1, y1) in zip(pts, pts[1:]):
        dx, dy = x1 - x0, y1 - y0
        n = math.hypot(dx, dy)
        nx, ny = -dy / n * r, dx / n * r
        draw.polygon([(x0 + nx, y0 + ny), (x1 + nx, y1 + ny),
                      (x1 - nx, y1 - ny), (x0 - nx, y0 - ny)], fill=fill)
    for x, y in pts:
        draw.ellipse((x - r, y - r, x + r, y + r), fill=fill)


def _plate(draw: ImageDraw.ImageDraw, size: int, fill) -> None:
    scale, ox, oy = _layout(size)
    draw.polygon([(x * scale + ox, y * scale + oy) for x, y in tag_polygon()], fill=fill)


def _draw_rgb(ground: str, tag: str, size: int) -> Image.Image:
    """Opaque master: background painted edge to edge (full bleed)."""
    ss = size * SUPERSAMPLE
    img = Image.new("RGB", (ss, ss), hex_rgb(ground))
    draw = ImageDraw.Draw(img)
    _plate(draw, ss, hex_rgb(tag))
    _w_stroke(draw, ss, hex_rgb(ground))   # the W is the ground showing through
    return img.resize((size, size), Image.Resampling.BOX)


def _draw_tinted(size: int) -> Image.Image:
    """Single-channel glyph + alpha; no ground, no colour.  The W is an alpha hole."""
    ss = size * SUPERSAMPLE
    lum = Image.new("L", (ss, ss), hex_rgb(TINT_TAG)[0])  # white canvas: no dark fringe
    alpha = Image.new("L", (ss, ss), 0)
    da = ImageDraw.Draw(alpha)
    _plate(da, ss, 255)
    _w_stroke(da, ss, 0)
    lum = lum.resize((size, size), Image.Resampling.BOX)
    alpha = alpha.resize((size, size), Image.Resampling.BOX)
    return Image.merge("LA", (lum, alpha))


def _save_rgb(img: Image.Image, path: str) -> None:
    assert img.mode == "RGB"
    img.save(path, "PNG", optimize=True)


def _squircle_mask(side: int, radius_ratio: float = 0.224) -> Image.Image:
    ss = side * SUPERSAMPLE
    mask = Image.new("L", (ss, ss), 0)
    ImageDraw.Draw(mask).rounded_rectangle((0, 0, ss - 1, ss - 1), radius=radius_ratio * ss, fill=255)
    return mask.resize((side, side), Image.Resampling.LANCZOS)


def _composite_squircle(img: Image.Image, out_path: str) -> None:
    side = img.width
    plate = Image.new("RGB", (side, side), (198, 199, 204))
    plate.paste(img, (0, 0), _squircle_mask(side))
    _save_rgb(plate, out_path)


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
        "icon-1024.png": _draw_rgb(CREAM, CORAL, size),
        "icon-1024-dark.png": _draw_rgb(DARK_GROUND, DARK_CORAL, size),
    }
    tinted = _draw_tinted(size)

    for name, img in variants.items():
        path = os.path.join(args.out, name)
        _save_rgb(img, path)
        print(f"{path}  {img.width}x{img.height} {img.mode}")
    tinted_path = os.path.join(args.out, "icon-1024-tinted.png")
    tinted.save(tinted_path, "PNG", optimize=True)
    print(f"{tinted_path}  {tinted.width}x{tinted.height} {tinted.mode}")

    # ------------------------------------------------------------ self-checks ---
    scale, ox, oy = _layout(size)

    def px(x: float, y: float) -> tuple[int, int]:
        return round(x * scale + ox), round(y * scale + oy)

    tag_px = px(8.0, 10.0)      # plate, clear of the W
    w_px = px(13.3, 18.8)       # W's bottom-left vertex: the cut-out
    bg_px = px(16.0, 25.0)      # below a tooth tip: ground
    for name, img in variants.items():
        dark = "dark" in name
        ground = hex_rgb(DARK_GROUND if dark else CREAM)
        body = hex_rgb(DARK_CORAL if dark else CORAL)
        assert img.size == (size, size) and img.mode == "RGB"
        assert img.getpixel((0, 0)) == ground and img.getpixel((size - 1, size - 1)) == ground
        assert img.getpixel(tag_px) == body, (name, "tag", img.getpixel(tag_px))
        assert img.getpixel(w_px) == ground, (name, "W", img.getpixel(w_px))
        assert img.getpixel(bg_px) == ground, (name, "tooth gap", img.getpixel(bg_px))
    assert tinted.mode == "LA" and tinted.getpixel((0, 0))[1] == 0
    assert tinted.getpixel(tag_px) == (hex_rgb(TINT_TAG)[0], 255)
    assert tinted.getpixel(w_px)[1] == 0, "tinted W must be a knockout"

    x0, y0 = px(INK_BOX[0], INK_BOX[1])
    x1, y1 = px(INK_BOX[2], INK_BOX[3])
    print(f"ink bounds at {size}px: x={x0}..{x1}, y={y0}..{y1}  (w {x1 - x0}, h {y1 - y0})")

    if args.previews:
        os.makedirs(args.previews, exist_ok=True)
        for side in (1024, 180, 120, 87, 80, 60, 40, 29, 20):
            for key, img in (("", variants["icon-1024.png"]), ("-dark", variants["icon-1024-dark.png"])):
                out = img if side == size else img.resize((side, side), Image.Resampling.BOX)
                _save_rgb(out, os.path.join(args.previews, f"icon-{side}{key}.png"))
                _composite_squircle(out, os.path.join(args.previews, f"icon-{side}-squircle{key}.png"))

    for name in ("icon-1024.png", "icon-1024-dark.png", "icon-1024-tinted.png"):
        with open(os.path.join(args.out, name), "rb") as fh:
            print(f"sha256 {name} {hashlib.sha256(fh.read()).hexdigest()[:16]}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

#!/usr/bin/env python3
"""Render the Warrly app icon ("The Warranty Tag") from one vector definition.

The mark is a hanging price tag with one punched hole, a V notch in the bottom
edge, and a swallowtail pennant on a pole rising from the tag's shoulder,
drawn on a 32x32 grid.  This script is the source of truth for the PNGs in
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
* Tag body: x=5.4..22.4, y=10.6..28.2.  The top-left is a 4.9-unit bevel,
  the top-right and bottom-left corners are 1.5-unit radii, and the
  bottom-right corner is square.  (The supplied path's arc from (22.4,26.7)
  back to (22.4,26.7) is a zero-length no-op and is recorded below but not
  sampled; drawing a radius the path does not describe would move the edge.)
* V notch: bottom edge from (16.9,28.2) up to (13.9,25.9) and down to
  (10.9,28.2), 2.3 units deep.
* Punch: r=1.6 at (9.97,15.17), an evenodd hole in the tag.
* Flag: pole x=18.9..20.7 from y=2.6 to 14.6, swallowtail pennant
  x=18.9..27.3, y=2.6..8.0, notch apex (25.0,5.3).  The path reaches 4 units
  into the tag only so the two fills overlap; the plate is painted over the
  flag, so that foot is hidden behind the shoulder and the visible pole starts
  at the tag's top edge (y=10.6).  Painting the flag last would leave a coral
  stub sitting inside the ink tag.
* Native ink bounds: x=5.4..27.3, y=2.6..28.2.  The bbox centre is
  (16.35,15.4), so the flag leaves the mark 0.6 units high and 0.35 units
  right of the icon's centre.

Optical centring
----------------
The whole mark -- tag, punch, and flag together; never the parts -- is shifted
by ``MARK_OFFSET`` = (-0.35,+0.6) grid units.  That puts the ink bounds at
x=5.05..26.95, y=3.2..28.8: a 10% top/bottom margin (the recommended safe
zone) and equal 5.05-unit left/right margins.  The downward shift answers the
flag's upward reach; the small left shift answers its rightward pull.  The
effect at 1024 is -11.2 px and +19.2 px.

Colours are fixed brand values.  Nothing here reads the in-app accent setting:
the icon is a static brand asset, not a themed surface.

Tinted (iOS 18+)
----------------
Single-channel luminance + alpha on a transparent ground, drawn as ONE
silhouette: the flag and the tag are both white.  This is the canonical mono
mark, and it is the right answer for the protruding flag — a knockout would
delete the pennant from the home screen, while a second grey would invent a
two-tone hierarchy the mark does not have.  The flag therefore is not
distinguished by luminance: it reads as a pennant because the plate is painted
over the flag (the pole emerges from the shoulder) and because of the negative
gap under the pennant.  Only the punch is an alpha hole, so the wallpaper shows
through it.  The artwork is painted flag-first, plate second, punch third.
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
INK = "#1F1A14"         # tag on the light ground
CORAL = "#FF6B45"       # flag on the light ground
DARK_GROUND = "#0E1018"
DARK_TAG = "#F4EBDC"
DARK_CORAL = "#E2573A"  # the light coral, darkened for a dark ground
TINT_TAG = "#FFFFFF"    # full-strength tint
TINT_FLAG = "#FFFFFF"   # same luminance as the tag: one silhouette, one tint

# --------------------------------------------------------------- geometry ---
GRID = 32.0
MASTER = 1024
SUPERSAMPLE = 4  # 4096px canvas for the 1024 master

# Shift applied to every part of the mark, in grid units.  See "Optical
# centring" above; this is deliberately one offset, not per-part nudging.
MARK_OFFSET = (-0.35, 0.6)

# Tag body, in the direction the brand path travels: top-left -> top-right ->
# right edge -> V notch -> left edge -> bevelled shoulder.
TAG_TOP_LEFT = (10.3, 10.6)
TAG_TOP_RIGHT = (20.9, 10.6)
TAG_TOP_RIGHT_ARC_CENTER = (20.9, 12.1)   # quarter-circle to (22.4,12.1)
TAG_TOP_RADIUS = 1.5
TAG_RIGHT = (22.4, 12.1)
TAG_RIGHT_BOTTOM = (22.4, 28.2)
# The supplied path contains A1.5 1.5 0 0 1 22.4 26.7 at this point: a
# zero-length arc.  It is a no-op, and the bottom-right corner stays square.
TAG_NOTCH_RIGHT = (16.9, 28.2)
TAG_NOTCH_APEX = (13.9, 25.9)
TAG_NOTCH_LEFT = (10.9, 28.2)
TAG_BOTTOM_LEFT = (6.9, 28.2)
TAG_BOTTOM_LEFT_ARC_CENTER = (6.9, 26.7)  # quarter-circle to (5.4,26.7)
TAG_BOTTOM_LEFT_END = (5.4, 26.7)
TAG_LEFT = (5.4, 15.5)
PUNCH_CX, PUNCH_CY, PUNCH_R = 9.97, 15.17, 1.6
FLAG = [
    (18.9, 14.6),  # pole foot, inside the tag's shoulder
    (18.9, 2.6),   # pole top / flag's top-left
    (27.3, 2.6),   # flag's top-right
    (25.0, 5.3),   # swallowtail apex
    (27.3, 8.0),   # flag's bottom-right
    (20.7, 8.0),   # flag's bottom / pole's right edge
    (20.7, 14.6),  # pole's foot, right side
]
FLAG_NOTCH_DEPTH = 27.3 - 25.0


def hex_rgb(value: str) -> tuple[int, int, int]:
    value = value.lstrip("#")
    return tuple(int(value[i : i + 2], 16) for i in (0, 2, 4))  # type: ignore[return-value]


def _arc(
    cx: float, cy: float, r: float, start_deg: float, end_deg: float, steps: int = 48
) -> list[tuple[float, float]]:
    """Sample a circular arc, excluding its start point and including its end."""
    pts: list[tuple[float, float]] = []
    for i in range(1, steps + 1):
        a = math.radians(start_deg + (end_deg - start_deg) * i / steps)
        pts.append((cx + r * math.cos(a), cy + r * math.sin(a)))
    return pts


def tag_polygon() -> list[tuple[float, float]]:
    """Closed tag outline in grid units, clockwise on screen."""
    pts: list[tuple[float, float]] = [TAG_TOP_LEFT, TAG_TOP_RIGHT]
    # Top-right corner: (20.9,10.6) -> (22.4,12.1).
    pts += _arc(*TAG_TOP_RIGHT_ARC_CENTER, TAG_TOP_RADIUS, 270.0, 360.0)
    pts += [TAG_RIGHT, TAG_RIGHT_BOTTOM, TAG_NOTCH_RIGHT, TAG_NOTCH_APEX]
    pts += [TAG_NOTCH_LEFT, TAG_BOTTOM_LEFT]
    # Bottom-left corner: (6.9,28.2) -> (5.4,26.7).
    pts += _arc(*TAG_BOTTOM_LEFT_ARC_CENTER, TAG_TOP_RADIUS, 90.0, 180.0)
    pts += [TAG_BOTTOM_LEFT_END, TAG_LEFT]
    return pts


def flag_polygon() -> list[tuple[float, float]]:
    return list(FLAG)


def _shifted(point: tuple[float, float]) -> tuple[float, float]:
    return (point[0] + MARK_OFFSET[0], point[1] + MARK_OFFSET[1])


def _px(
    points: list[tuple[float, float]], scale: float
) -> list[tuple[float, float]]:
    return [(_shifted(p)[0] * scale, _shifted(p)[1] * scale) for p in points]


def _draw_rgb(ground: str, tag: str, flag: str, size: int) -> Image.Image:
    """Opaque master: background painted edge to edge (full bleed)."""
    ss = size * SUPERSAMPLE
    scale = ss / GRID
    img = Image.new("RGB", (ss, ss), hex_rgb(ground))
    draw = ImageDraw.Draw(img)

    # Flag FIRST, then the plate over it.  The pole reaches 4 units into the
    # tag, so this order hides its foot behind the shoulder; the flag appears
    # to grow out of the tag's top edge.  Flag-last would leave a coral stub
    # sitting inside the tag.
    draw.polygon(_px(flag_polygon(), scale), fill=hex_rgb(flag))
    draw.polygon(_px(tag_polygon(), scale), fill=hex_rgb(tag))

    # evenodd punch: paint the hole back to the ground.  The flag never
    # overlaps it (the pole starts at x=18.9, the hole ends at x=11.57).
    cx, cy = _shifted((PUNCH_CX, PUNCH_CY))
    r = PUNCH_R * scale
    draw.ellipse(
        (cx * scale - r, cy * scale - r, cx * scale + r, cy * scale + r),
        fill=hex_rgb(ground),
    )
    return img.resize((size, size), Image.Resampling.BOX)


def _draw_tinted(size: int) -> Image.Image:
    """Single-channel glyph + alpha; no ground, no colour.

    The flag and the tag are both white, so the mark is one silhouette; only
    the punch is an alpha hole.  Paint order is still flag first, plate second,
    punch third: the plate covers the pole's hidden foot, and the pennant reads
    through the negative gap under it rather than through a second grey.
    """
    ss = size * SUPERSAMPLE
    scale = ss / GRID
    tag_lum = hex_rgb(TINT_TAG)[0]
    flag_lum = hex_rgb(TINT_FLAG)[0]

    # White canvas on purpose: the silhouette is white, so its antialiased
    # outer edge must not pick up a dark fringe from a black canvas.
    lum = Image.new("L", (ss, ss), tag_lum)
    alpha = Image.new("L", (ss, ss), 0)
    dl, da = ImageDraw.Draw(lum), ImageDraw.Draw(alpha)

    flag = _px(flag_polygon(), scale)
    dl.polygon(flag, fill=flag_lum)
    da.polygon(flag, fill=255)

    poly = _px(tag_polygon(), scale)
    dl.polygon(poly, fill=tag_lum)
    da.polygon(poly, fill=255)

    # Punch knockout.  Luminance is irrelevant where alpha is 0.
    cx, cy = _shifted((PUNCH_CX, PUNCH_CY))
    r = PUNCH_R * scale
    da.ellipse(
        (cx * scale - r, cy * scale - r, cx * scale + r, cy * scale + r), fill=0
    )

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
    ImageDraw.Draw(mask).rounded_rectangle(
        (0, 0, ss - 1, ss - 1), radius=radius, fill=255
    )
    return mask.resize((side, side), Image.Resampling.LANCZOS)


def _composite_squircle(img: Image.Image, out_path: str) -> None:
    side = img.width
    mask = _squircle_mask(side)
    # Neutral "home screen" plate so the crop is visible outside the squircle.
    plate = Image.new("RGB", (side, side), (198, 199, 204))
    plate.paste(img, (0, 0), mask)
    _save_rgb(plate, out_path)


def _tinted_preview(glyph: Image.Image, tint: str, ground: str) -> Image.Image:
    """Approximate the system's tinted treatment for review only.

    The real system paint is private; this maps luminance to brightness of the
    chosen tint and keeps the punch's alpha hole transparent.  It is honest
    about separation, not a promise about the exact system colour.
    """
    tint_rgb = hex_rgb(tint)
    ground_rgb = hex_rgb(ground)
    lum, alpha = glyph.split()
    out = Image.new("RGB", glyph.size, ground_rgb)
    # Brightness of the tint follows luminance; alpha follows the glyph.
    tinted = Image.new("RGB", glyph.size, tint_rgb)
    tinted = Image.composite(tinted, Image.new("RGB", glyph.size, (0, 0, 0)), lum)
    # tinted is tint * (lum/255); blend it over the ground using alpha.
    return Image.composite(tinted, out, alpha)


def _analyze(size: int) -> dict[str, float]:
    """Rendered feature sizes in pixels at a given icon side length."""
    unit = size / GRID
    return {
        "punch_diameter": 2 * PUNCH_R * unit,
        "notch_depth": (TAG_NOTCH_RIGHT[0] - TAG_NOTCH_APEX[0]) * unit,
        "notch_width": (TAG_NOTCH_RIGHT[0] - TAG_NOTCH_LEFT[0]) * unit,
        "flag_width": (FLAG[2][0] - FLAG[0][0]) * unit,
        "flag_height": (FLAG[4][1] - FLAG[1][1]) * unit,
        "flag_notch_depth": FLAG_NOTCH_DEPTH * unit,
        "pole_width": (FLAG[5][0] - FLAG[0][0]) * unit,
        "bevel": math.hypot(
            TAG_TOP_LEFT[0] - TAG_LEFT[0], TAG_TOP_LEFT[1] - TAG_LEFT[1]
        )
        * unit,
    }


def _bounds() -> tuple[float, float, float, float]:
    pts = [_shifted(p) for p in tag_polygon() + flag_polygon()]
    xs = [p[0] for p in pts]
    ys = [p[1] for p in pts]
    return min(xs), min(ys), max(xs), max(ys)


def main() -> int:
    here = os.path.dirname(os.path.abspath(__file__))
    default_out = os.path.join(
        here, "..", "App", "Assets.xcassets", "AppIcon.appiconset"
    )

    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument(
        "--out", default=os.path.normpath(default_out), help="appiconset directory"
    )
    ap.add_argument(
        "--previews", help="also write review renders (sizes + squircle) here"
    )
    args = ap.parse_args()

    size = MASTER
    os.makedirs(args.out, exist_ok=True)

    variants = {
        "icon-1024.png": _draw_rgb(CREAM, INK, CORAL, size),
        "icon-1024-dark.png": _draw_rgb(DARK_GROUND, DARK_TAG, DARK_CORAL, size),
    }
    tinted = _draw_tinted(size)

    for name, img in variants.items():
        path = os.path.join(args.out, name)
        _save_rgb(img, path)
        print(f"{path}  {img.width}x{img.height} {img.mode}")

    tinted_path = os.path.join(args.out, "icon-1024-tinted.png")
    tinted.save(tinted_path, "PNG", optimize=True)
    print(f"{tinted_path}  {tinted.width}x{tinted.height} {tinted.mode}")

    # ------------------------------------------------------------ geometry ---
    x0, y0, x1, y1 = _bounds()
    print(
        f"optical offset: ({MARK_OFFSET[0]:+.2f},{MARK_OFFSET[1]:+.2f}) grid units "
        f"({MARK_OFFSET[0] * size / GRID:+.1f}, {MARK_OFFSET[1] * size / GRID:+.1f} px at {size})"
    )
    print(
        f"ink bounds: x={x0:.2f}..{x1:.2f}, y={y0:.2f}..{y1:.2f} grid units; "
        f"centre=({(x0 + x1) / 2:.2f},{(y0 + y1) / 2:.2f})"
    )
    print(
        f"ink bounds at {size}px: "
        f"x={x0 * size / GRID:.1f}..{x1 * size / GRID:.1f}, "
        f"y={y0 * size / GRID:.1f}..{y1 * size / GRID:.1f}"
    )
    for side in (180, 120, 60, 40):
        f = _analyze(side)
        print(
            f"{side}px: punch {f['punch_diameter']:.2f}px, tag V {f['notch_width']:.2f}x"
            f"{f['notch_depth']:.2f}px, flag {f['flag_width']:.2f}x{f['flag_height']:.2f}px, "
            f"swallowtail {f['flag_notch_depth']:.2f}px, pole {f['pole_width']:.2f}px, "
            f"bevel {f['bevel']:.2f}px"
        )

    # ------------------------------------------------------------ self-checks ---
    def grid_px(x: float, y: float) -> tuple[int, int]:
        sx, sy = _shifted((x, y))
        return round(sx * size / GRID), round(sy * size / GRID)

    # Points chosen well inside each region, clear of antialiased edges.
    tag_px = grid_px(14.0, 22.0)
    flag_px = grid_px(23.0, 5.0)
    # The pole's foot is inside the tag and is deliberately hidden by the
    # plate; sample the exposed segment between the pennant and the shoulder,
    # and the hidden foot separately so a flag-last regression cannot pass.
    pole_px = grid_px(19.8, 9.0)
    pole_foot_px = grid_px(19.8, 12.0)
    punch_px = grid_px(PUNCH_CX, PUNCH_CY)

    for name, img in variants.items():
        dark = "dark" in name
        ground = hex_rgb(DARK_GROUND if dark else CREAM)
        body = hex_rgb(DARK_TAG if dark else INK)
        accent = hex_rgb(DARK_CORAL if dark else CORAL)
        assert img.size == (size, size) and img.mode == "RGB"
        assert img.getpixel((0, 0)) == ground
        assert img.getpixel((size - 1, 0)) == ground
        assert img.getpixel((0, size - 1)) == ground
        assert img.getpixel((size - 1, size - 1)) == ground
        assert img.getpixel(tag_px) == body, (name, "tag", img.getpixel(tag_px))
        assert img.getpixel(punch_px) == ground, (name, "punch", img.getpixel(punch_px))
        assert img.getpixel(flag_px) == accent, (name, "flag", img.getpixel(flag_px))
        assert img.getpixel(pole_px) == accent, (name, "pole", img.getpixel(pole_px))
        # The plate is painted over the flag: the pole foot inside the tag must
        # be tag colour, not the accent (the coral-stub regression).
        assert img.getpixel(pole_foot_px) == body, (
            name,
            "pole foot",
            img.getpixel(pole_foot_px),
        )

    assert tinted.size == (size, size) and tinted.mode == "LA"
    assert tinted.getpixel((0, 0))[1] == 0, "tinted must have a transparent ground"
    assert tinted.getpixel((size - 1, size - 1))[1] == 0
    assert tinted.getpixel(tag_px) == (hex_rgb(TINT_TAG)[0], 255)
    assert tinted.getpixel(punch_px)[1] == 0, "tinted punch must be a knockout"
    assert tinted.getpixel(flag_px) == (hex_rgb(TINT_FLAG)[0], 255)
    assert tinted.getpixel(pole_px) == (hex_rgb(TINT_FLAG)[0], 255)
    assert tinted.getpixel(pole_foot_px) == (hex_rgb(TINT_TAG)[0], 255)

    # No alpha channel at all on the two full-bleed masters.
    for name in variants:
        with Image.open(os.path.join(args.out, name)) as check:
            assert check.mode == "RGB" and "A" not in check.getbands()

    print(
        f"punch: r={PUNCH_R} at ({PUNCH_CX},{PUNCH_CY}); "
        f"{_analyze(size)['punch_diameter']:.1f}px at {size}"
    )

    if args.previews:
        os.makedirs(args.previews, exist_ok=True)
        ladder = (1024, 180, 120, 87, 80, 76, 60, 58, 40, 29, 20)
        # Light + dark are RGB; tinted is viewed through an approximate
        # system-tint composite because raw LA on a transparent ground is not
        # a useful review raster.
        tinted_sim_blue = _tinted_preview(tinted, "#5B8DEF", "#C6C7CC")
        tinted_sim_amber = _tinted_preview(tinted, "#F2B84B", "#C6C7CC")
        for side in ladder:
            if side == size:
                light = variants["icon-1024.png"]
                dark = variants["icon-1024-dark.png"]
                blue = tinted_sim_blue
                amber = tinted_sim_amber
            else:
                light = variants["icon-1024.png"].resize(
                    (side, side), Image.Resampling.BOX
                )
                dark = variants["icon-1024-dark.png"].resize(
                    (side, side), Image.Resampling.BOX
                )
                blue = tinted_sim_blue.resize(
                    (side, side), Image.Resampling.BOX
                )
                amber = tinted_sim_amber.resize(
                    (side, side), Image.Resampling.BOX
                )
            _save_rgb(light, os.path.join(args.previews, f"icon-{side}.png"))
            _save_rgb(dark, os.path.join(args.previews, f"icon-{side}-dark.png"))
            _save_rgb(
                blue, os.path.join(args.previews, f"icon-{side}-tinted-sim-blue.png")
            )
            _save_rgb(
                amber, os.path.join(args.previews, f"icon-{side}-tinted-sim-amber.png")
            )
            _composite_squircle(
                light, os.path.join(args.previews, f"icon-{side}-squircle.png")
            )
            _composite_squircle(
                dark, os.path.join(args.previews, f"icon-{side}-squircle-dark.png")
            )
            _composite_squircle(
                blue,
                os.path.join(args.previews, f"icon-{side}-tinted-sim-blue-squircle.png"),
            )
            # Raw tinted asset too, so the actual LA master is in the review
            # set rather than only the simulation.
            tinted.resize((side, side), Image.Resampling.BOX).save(
                os.path.join(args.previews, f"icon-{side}-tinted.png"),
                "PNG",
                optimize=True,
            )
            f = _analyze(side)
            flags = []
            if f["punch_diameter"] < 2.5:
                flags.append("punch<2.5px")
            if f["flag_notch_depth"] < 2.0:
                flags.append("swallowtail<2px")
            if f["pole_width"] < 1.5:
                flags.append("pole<1.5px")
            print(
                f"{os.path.join(args.previews, f'icon-{side}.png')}  "
                f"punch {f['punch_diameter']:.2f}px  "
                f"swallowtail {f['flag_notch_depth']:.2f}px  "
                f"pole {f['pole_width']:.2f}px"
                + (f"  <-- {', '.join(flags)}" if flags else "")
            )

    for name in ("icon-1024.png", "icon-1024-dark.png", "icon-1024-tinted.png"):
        path = os.path.join(args.out, name)
        with open(path, "rb") as fh:
            print(f"sha256 {name} {hashlib.sha256(fh.read()).hexdigest()[:16]}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

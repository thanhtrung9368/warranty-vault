#!/usr/bin/env python3
"""Generate every Android launcher/notification asset from one geometry block.

The silhouette is the ONLY thing that changes when the brand mark is revised.
Everything below the geometry block (safe-circle scale, the 108dp vectors, the
24dp notification badge, the five legacy PNGs and the mask previews) is derived
from it, so a new mark is a one-block edit followed by:

    python3 tools/generate_launcher_icons.py
    cd .. && ./gradlew :app:testDebugUnitTest :app:lintRelease \
        :app:assembleRelease --no-daemon

The preview renders land in app/build/reports/icon-preview/ (git-ignored), and
the script prints the scale arithmetic so a cropped mark cannot slip through.

Geometry is on a 32x32 grid. The numbers below are the final mark: "The
Warranty Tag" — a hanging tag with a bevelled top-left corner, one punched
hole and a V notch in its bottom edge, plus a coral swallowtail pennant on a
pole rising from its shoulder.

TWO CUTS. The full cut is for surfaces >= 24px. The small cut is separately
drawn (thicker strokes, a deeper notch, a larger punch) for surfaces <= 16px.
They are not scaled versions of one another: downscaling the full cut erases
the punch and the V notch at status-bar size. The 24dp notification uses the
small cut because its optical tag is only ~17dp tall.

Why the adaptive foreground is not simply the 32 grid scaled to 108dp:
Android scales adaptive layers 1.5x and masks the icon, so only the middle 72dp
of the 108dp layer is visible. The guaranteed-safe circle is 66dp in diameter
(radius 33). This script finds the largest uniform scale that keeps every ink
pixel inside that circle, with a small antialias margin, and computes it from
the actual outline rather than hard-coding a number.
"""

from __future__ import annotations

import argparse
import math
import re
import sys
from pathlib import Path

try:
    from PIL import Image, ImageDraw
except ImportError:  # pragma: no cover - environment hint only
    sys.exit("Pillow is required: python3 -m pip install Pillow")

# ---------------------------------------------------------------------------
# THE MARK. Everything Android ships is generated from this block.
# ---------------------------------------------------------------------------

GRID = 32.0

# Verbatim path data for the chosen mark, on the 32x32 grid. Tag and flag are
# separate outlines because they are separate colours on the launcher; the
# punch is a subpath of the tag and is knocked out with fillType="evenOdd".
#
# The source outline contains a zero-length arc in each tag path, at
# (22.4 26.7)/(23 26.8). SVG treats an arc whose endpoints coincide as a
# no-op, and Android's native PathParser has historically produced NaN
# geometry for one, so parse_path() drops it. The bottom-right corner is
# therefore square, exactly as the supplied outline renders it.
FULL_CUT = {
    "tag": (
        "M10.3 10.6L20.9 10.6A1.5 1.5 0 0 1 22.4 12.1L22.4 26.7"
        "A1.5 1.5 0 0 1 22.4 26.7L22.4 28.2L16.9 28.2L13.9 25.9L10.9 28.2"
        "L6.9 28.2A1.5 1.5 0 0 1 5.4 26.7L5.4 15.5L10.3 10.6Z"
    ),
    "punch": (
        "M8.37 15.17A1.6 1.6 0 1 0 11.57 15.17"
        "A1.6 1.6 0 1 0 8.37 15.17Z"
    ),
    "flag": (
        "M18.9 14.6L18.9 2.6L27.3 2.6L25 5.3L27.3 8L20.7 8L20.7 14.6"
        "L18.9 14.6Z"
    ),
}

# The small cut is a distinct drawing, not a downscale. Its pole is thicker
# (2.6 vs 1.8), its punch is larger (r=1.9 vs 1.6), its V notch is deeper
# (2.8 vs 2.3) and its flag is a little shorter/wider so it survives 16px.
SMALL_CUT = {
    "tag": (
        "M10.6 10L21.6 10A1.4 1.4 0 0 1 23 11.4L23 26.8"
        "A1.4 1.4 0 0 1 23 26.8L23 28.2L17.5 28.2L14.1 25.4L10.7 28.2"
        "L6.6 28.2A1.4 1.4 0 0 1 5.2 26.8L5.2 15.4L10.6 10Z"
    ),
    "punch": (
        "M8.4 15.1A1.9 1.9 0 1 0 12.2 15.1"
        "A1.9 1.9 0 1 0 8.4 15.1Z"
    ),
    "flag": (
        "M18.3 14.2L18.3 2.6L28 2.6L25.4 5.8L28 9L20.9 9L20.9 14.2"
        "L18.3 14.2Z"
    ),
}

# Fixed brand palette for the launcher. These are deliberately not theme
# colours; the home-screen icon never follows the in-app accent.
CREAM = "#FFF7EE"
INK = "#1F1A14"
CORAL = "#FF6B45"

# Android adaptive-icon geometry. 66/108 is the safe circle; the extra margin
# keeps antialiasing from touching the boundary. 72 is the visible mask
# diameter used by the previews. The rounded-square preview uses the 22.4%
# corner fraction that approximates a squircle.
SAFE_DIAMETER_DP = 66.0
SAFE_RADIUS_DP = SAFE_DIAMETER_DP / 2.0
SAFE_MARGIN_DP = 0.9
MASK_DIAMETER_DP = 72.0
ROUNDED_SQUARE_RADIUS_FRACTION = 0.224

# The notification badge is 24dp. The small cut's ink bbox is fitted to that
# box; the tag ends up ~17dp tall, which is why the full cut is the wrong
# choice there.
NOTIFICATION_SIZE_DP = 24.0
NOTIFICATION_INSET = 1.0

ROOT = Path(__file__).resolve().parent.parent  # android/
RES = ROOT / "app" / "src" / "main" / "res"
PREVIEW = ROOT / "app" / "build" / "reports" / "icon-preview"


# ---------------------------------------------------------------------------
# Path maths
# ---------------------------------------------------------------------------


def parse_path(data: str) -> list[tuple]:
    """Parse the M/L/A/Z subset used above into the op tuples the rest uses.

    A zero-length arc is dropped: it is a no-op in SVG and a known source of
    NaN geometry in Android's PathParser.
    """
    tokens = re.findall(r"[MLAZ]|-?(?:\d+(?:\.\d*)?|\.\d+)", data)
    ops: list[tuple] = []
    current = (0.0, 0.0)
    i = 0
    while i < len(tokens):
        kind = tokens[i]
        i += 1
        if kind == "M":
            current = (float(tokens[i]), float(tokens[i + 1]))
            i += 2
            ops.append(("M", current[0], current[1]))
        elif kind == "L":
            current = (float(tokens[i]), float(tokens[i + 1]))
            i += 2
            ops.append(("L", current[0], current[1]))
        elif kind == "A":
            rx, ry, rot, large_arc, sweep, x, y = (
                float(tokens[i + 0]),
                float(tokens[i + 1]),
                float(tokens[i + 2]),
                int(tokens[i + 3]),
                int(tokens[i + 4]),
                float(tokens[i + 5]),
                float(tokens[i + 6]),
            )
            i += 7
            if (x, y) != current:  # zero-length arc: no-op, do not emit
                ops.append(("A", rx, ry, rot, large_arc, sweep, x, y))
                current = (x, y)
        elif kind == "Z":
            ops.append(("Z",))
        else:  # pragma: no cover - geometry authoring error
            raise ValueError(f"unsupported path command {kind!r}")
    return ops


FULL = {key: parse_path(value) for key, value in FULL_CUT.items()}
SMALL = {key: parse_path(value) for key, value in SMALL_CUT.items()}


def fmt(value: float) -> str:
    """Two decimals, no trailing zeroes: stable, compact path data."""
    text = f"{value:.2f}".rstrip("0").rstrip(".")
    return "0" if text == "-0" else text


def arc_points(
    x1: float,
    y1: float,
    rx: float,
    ry: float,
    rotation: float,
    large_arc: int,
    sweep: int,
    x2: float,
    y2: float,
    steps: int = 48,
) -> list[tuple[float, float]]:
    """Sample an SVG endpoint-parameterised arc, excluding its start point."""
    if rx == 0 or ry == 0 or (x1 == x2 and y1 == y2):
        return [(x2, y2)]
    rx, ry = abs(rx), abs(ry)
    phi = math.radians(rotation)
    cos_phi, sin_phi = math.cos(phi), math.sin(phi)
    dx, dy = (x1 - x2) / 2.0, (y1 - y2) / 2.0
    x1p = cos_phi * dx + sin_phi * dy
    y1p = -sin_phi * dx + cos_phi * dy

    # Scale up the radii if they are too small to span the endpoints.
    lam = (x1p * x1p) / (rx * rx) + (y1p * y1p) / (ry * ry)
    if lam > 1:
        scale = math.sqrt(lam)
        rx *= scale
        ry *= scale

    sign = -1.0 if large_arc == sweep else 1.0
    numerator = rx * rx * ry * ry - rx * rx * y1p * y1p - ry * ry * x1p * x1p
    denominator = rx * rx * y1p * y1p + ry * ry * x1p * x1p
    coef = sign * math.sqrt(max(0.0, numerator / denominator)) if denominator else 0.0
    cxp = coef * (rx * y1p / ry)
    cyp = coef * (-ry * x1p / rx)
    cx = cos_phi * cxp - sin_phi * cyp + (x1 + x2) / 2.0
    cy = sin_phi * cxp + cos_phi * cyp + (y1 + y2) / 2.0

    def angle(ux: float, uy: float, vx: float, vy: float) -> float:
        dot = ux * vx + uy * vy
        norm = math.hypot(ux, uy) * math.hypot(vx, vy)
        a = math.acos(max(-1.0, min(1.0, dot / norm))) if norm else 0.0
        return -a if ux * vy - uy * vx < 0 else a

    theta1 = angle(1.0, 0.0, (x1p - cxp) / rx, (y1p - cyp) / ry)
    delta = angle(
        (x1p - cxp) / rx,
        (y1p - cyp) / ry,
        (-x1p - cxp) / rx,
        (-y1p - cyp) / ry,
    )
    if sweep == 0 and delta > 0:
        delta -= 2 * math.pi
    elif sweep == 1 and delta < 0:
        delta += 2 * math.pi

    out = []
    for i in range(1, steps + 1):
        theta = theta1 + delta * i / steps
        out.append(
            (
                cx + rx * math.cos(theta) * cos_phi - ry * math.sin(theta) * sin_phi,
                cy + rx * math.cos(theta) * sin_phi + ry * math.sin(theta) * cos_phi,
            )
        )
    return out


def flatten_ops(ops: list[tuple]) -> list[tuple[float, float]]:
    """Turn the outline ops into a polygon for raster previews."""
    points: list[tuple[float, float]] = []
    current = (0.0, 0.0)
    first = None
    for op in ops:
        kind = op[0]
        if kind == "M":
            current = (float(op[1]), float(op[2]))
            first = current
            points.append(current)
        elif kind == "L":
            current = (float(op[1]), float(op[2]))
            points.append(current)
        elif kind == "A":
            _, rx, ry, rot, laf, sweep, x, y = op
            points.extend(
                arc_points(current[0], current[1], float(rx), float(ry), float(rot),
                           int(laf), int(sweep), float(x), float(y))
            )
            current = (float(x), float(y))
        elif kind == "Z":
            if first is not None and points and points[-1] != first:
                points.append(first)
        else:  # pragma: no cover - geometry authoring error
            raise ValueError(f"unsupported path op {kind!r}")
    return points


def transform_ops(
    ops: list[tuple], scale: float, ox: float, oy: float, anchor: tuple[float, float]
) -> list[tuple]:
    ax, ay = anchor
    out: list[tuple] = []
    for op in ops:
        kind = op[0]
        if kind in ("M", "L"):
            out.append((kind, ox + (op[1] - ax) * scale, oy + (op[2] - ay) * scale))
        elif kind == "A":
            _, rx, ry, rot, laf, sweep, x, y = op
            out.append(
                (
                    "A",
                    rx * scale,
                    ry * scale,
                    rot,
                    laf,
                    sweep,
                    ox + (x - ax) * scale,
                    oy + (y - ay) * scale,
                )
            )
        else:
            out.append((kind,))
    return out


def to_path_data(ops: list[tuple]) -> str:
    commands: list[str] = []
    for op in ops:
        kind = op[0]
        if kind in ("M", "L"):
            commands.append(f"{kind}{fmt(op[1])},{fmt(op[2])}")
        elif kind == "A":
            _, rx, ry, rot, laf, sweep, x, y = op
            commands.append(f"A{fmt(rx)},{fmt(ry)} {fmt(float(rot))} {laf} {sweep} {fmt(x)},{fmt(y)}")
        elif kind == "Z":
            commands.append("Z")
        else:  # pragma: no cover
            raise ValueError(f"unsupported path op {kind!r}")
    return " ".join(commands)


def ink_bounds(points: list[tuple[float, float]]) -> tuple[float, float, float, float]:
    xs = [p[0] for p in points]
    ys = [p[1] for p in points]
    return min(xs), min(ys), max(xs), max(ys)


def max_ink_radius(points: list[tuple[float, float]], anchor: tuple[float, float]) -> float:
    ax, ay = anchor
    return max(math.hypot(x - ax, y - ay) for x, y in points)


def adaptive_scale(points: list[tuple[float, float]]) -> tuple[float, float, tuple[float, float]]:
    """Largest 0.05-step uniform scale that fits the 66/108 safe circle.

    The anchor is the centre of the mark's actual ink bounds. The previous mark
    could use a nominal body box because its dot sat inside it; this mark's
    flag pushes the box up and right, so the composite ink box is the honest
    centre. The farthest ink point is then the flag's top-right tip.
    """
    left, top, right, bottom = ink_bounds(points)
    anchor = ((left + right) / 2.0, (top + bottom) / 2.0)
    unit_radius = max_ink_radius(points, anchor)
    raw = (SAFE_RADIUS_DP - SAFE_MARGIN_DP) / unit_radius
    scale = math.floor(raw * 20.0) / 20.0
    if scale <= 0:
        raise ValueError("the mark does not fit the adaptive safe circle")
    return scale, unit_radius * scale, anchor


# ---------------------------------------------------------------------------
# Renderers
# ---------------------------------------------------------------------------


def hex_rgb(value: str) -> tuple[int, int, int]:
    value = value.lstrip("#")
    return tuple(int(value[i:i + 2], 16) for i in (0, 2, 4))  # type: ignore[return-value]


def draw_mark(
    draw: ImageDraw.ImageDraw,
    cut: dict[str, list[tuple]],
    scale: float,
    ox: float,
    oy: float,
    anchor: tuple[float, float],
    tag_fill: tuple = (*hex_rgb(INK),),
    flag_fill: tuple = (*hex_rgb(CORAL),),
    punch_fill: tuple = (*hex_rgb(CREAM),),
) -> None:
    """Draw flag, then plate over it, then the punch.

    The flag path runs 4 units down the pole inside the plate; painting the
    plate last makes the pole emerge from behind the shoulder and hides the
    overlap, so there is no coral stub halfway down the tag. Both shapes stay
    separate because they are different colours on the launcher.
    """
    for key, fill in (("flag", flag_fill), ("tag", tag_fill), ("punch", punch_fill)):
        pts = flatten_ops(transform_ops(cut[key], scale, ox, oy, anchor))
        draw.polygon(pts, fill=fill)


def raster_adaptive(scale: float, anchor: tuple[float, float], size: int = 1024) -> Image.Image:
    ss = 4
    px = size * ss
    unit = px / 108.0
    img = Image.new("RGB", (px, px), hex_rgb(CREAM))
    draw_mark(ImageDraw.Draw(img), FULL, scale * unit, 54 * unit, 54 * unit, anchor)
    return img.resize((size, size), Image.Resampling.LANCZOS)


def raster_legacy(scale_factor: float, size: int, anchor: tuple[float, float], origin: tuple[float, float]) -> Image.Image:
    ss = 8
    px = size * ss
    img = Image.new("RGB", (px, px), hex_rgb(CREAM))
    draw_mark(ImageDraw.Draw(img), FULL, scale_factor * ss, origin[0] * ss, origin[1] * ss, anchor)
    return img.resize((size, size), Image.Resampling.LANCZOS)


def mask_circle(size: int) -> Image.Image:
    ss = 4
    px = size * ss
    mask = Image.new("L", (px, px), 0)
    r = MASK_DIAMETER_DP / 2.0 * px / 108.0
    c = px / 2.0
    ImageDraw.Draw(mask).ellipse((c - r, c - r, c + r, c + r), fill=255)
    return mask.resize((size, size), Image.Resampling.LANCZOS)


def mask_rounded_square(size: int) -> Image.Image:
    """22.4% corner radius: the classic rounded-square approximation of a squircle."""
    ss = 4
    px = size * ss
    mask = Image.new("L", (px, px), 0)
    side = MASK_DIAMETER_DP * px / 108.0
    origin = (px - side) / 2.0
    radius = side * ROUNDED_SQUARE_RADIUS_FRACTION
    ImageDraw.Draw(mask).rounded_rectangle(
        (origin, origin, origin + side - 1, origin + side - 1), radius=radius, fill=255
    )
    return mask.resize((size, size), Image.Resampling.LANCZOS)


def mask_squircle(size: int, exponent: float = 4.0) -> Image.Image:
    ss = 4
    px = size * ss
    mask = Image.new("L", (px, px), 0)
    a = MASK_DIAMETER_DP / 2.0 * px / 108.0
    c = px / 2.0
    points = []
    for i in range(720):
        t = 2.0 * math.pi * i / 720.0
        ct, st = math.cos(t), math.sin(t)
        x = a * math.copysign(abs(ct) ** (2.0 / exponent), ct)
        y = a * math.copysign(abs(st) ** (2.0 / exponent), st)
        points.append((c + x, c + y))
    ImageDraw.Draw(mask).polygon(points, fill=255)
    return mask.resize((size, size), Image.Resampling.LANCZOS)


def compose_on_plate(icon: Image.Image, mask: Image.Image) -> Image.Image:
    plate = Image.new("RGB", icon.size, (198, 199, 204))
    plate.paste(icon, (0, 0), mask)
    return plate


def mono_layer(scale: float, anchor: tuple[float, float], size: int, fill: tuple) -> Image.Image:
    """Themed-icon layer: tag with a punched hole + a separate solid flag."""
    ss = 4
    px = size * ss
    unit = px / 108.0
    img = Image.new("RGBA", (px, px), (0, 0, 0, 0))
    draw_mark(
        ImageDraw.Draw(img),
        FULL,
        scale * unit,
        54 * unit,
        54 * unit,
        anchor,
        tag_fill=fill,
        flag_fill=fill,
        punch_fill=(0, 0, 0, 0),
    )
    return img.resize((size, size), Image.Resampling.LANCZOS)


# ---------------------------------------------------------------------------
# Writers
# ---------------------------------------------------------------------------


def foreground_xml(scale: float, anchor: tuple[float, float]) -> str:
    tag = to_path_data(transform_ops(FULL["tag"], scale, 54.0, 54.0, anchor))
    punch = to_path_data(transform_ops(FULL["punch"], scale, 54.0, 54.0, anchor))
    flag = to_path_data(transform_ops(FULL["flag"], scale, 54.0, 54.0, anchor))
    tag_left, tag_top, tag_right, tag_bottom = ink_bounds(flatten_ops(FULL["tag"]))
    tag_w = (tag_right - tag_left) * scale
    tag_h = (tag_bottom - tag_top) * scale
    pts = (
        flatten_ops(transform_ops(FULL["tag"], scale, 54.0, 54.0, anchor))
        + flatten_ops(transform_ops(FULL["flag"], scale, 54.0, 54.0, anchor))
    )
    left, top, right, bottom = ink_bounds(pts)
    radius = max_ink_radius(pts, (54.0, 54.0))
    return f"""<?xml version="1.0" encoding="utf-8"?>
<!-- GENERATED by android/tools/generate_launcher_icons.py. Change the
     geometry block there and re-run; do not hand-edit this file.

     "The Warranty Tag". Tag {fmt(tag_w)} x {fmt(tag_h)} at {fmt(scale)}x on
     the 108dp canvas, anchored on the full-cut ink-bounds centre. Ink bounds
     x={fmt(left)}..{fmt(right)}, y={fmt(top)}..{fmt(bottom)}; farthest ink
     point {fmt(radius)}dp from centre (the flag tip), inside the
     66/108 safe circle (r=33).

     The flag is painted first and the plate over it: the flag path runs 4
     units down the pole inside the plate, so painting the plate last makes the
     pole emerge from behind the shoulder with no coral stub. The punch is part
     of the plate path, knocked out with even-odd. -->
<vector xmlns:android="http://schemas.android.com/apk/res/android"
    android:width="108dp"
    android:height="108dp"
    android:viewportWidth="108"
    android:viewportHeight="108">

    <path
        android:fillColor="@color/ic_launcher_coral"
        android:pathData="{flag}" />

    <path
        android:fillColor="@color/ic_launcher_ink"
        android:fillType="evenOdd"
        android:pathData="{tag} {punch}" />
</vector>
"""


def monochrome_xml(scale: float, anchor: tuple[float, float]) -> str:
    tag = to_path_data(transform_ops(FULL["tag"], scale, 54.0, 54.0, anchor))
    punch = to_path_data(transform_ops(FULL["punch"], scale, 54.0, 54.0, anchor))
    flag = to_path_data(transform_ops(FULL["flag"], scale, 54.0, 54.0, anchor))
    return f"""<?xml version="1.0" encoding="utf-8"?>
<!-- GENERATED from the geometry block in android/tools/generate_launcher_icons.py.

     Android 13+ themed-icon layer: the flag first, then the plate with its
     punch knocked out (even-odd). Both paths are white so there is exactly one
     hole — the punch. The pennant is never knocked out of the plate: it has to
     stay visible where it rises above the tag, so the two shapes are separate
     fills. Painting the plate over the flag also hides the pole's 4-unit
     overlap, so the pole emerges from behind the shoulder with no seam. The
     system supplies the tint and the ground. No background here. -->
<vector xmlns:android="http://schemas.android.com/apk/res/android"
    android:width="108dp"
    android:height="108dp"
    android:viewportWidth="108"
    android:viewportHeight="108">

    <path
        android:fillColor="#FFFFFFFF"
        android:pathData="{flag}" />

    <path
        android:fillColor="#FFFFFFFF"
        android:fillType="evenOdd"
        android:pathData="{tag} {punch}" />
</vector>
"""


def notification_transform(
    cut: dict[str, list[tuple]], size: float, inset: float = NOTIFICATION_INSET
) -> tuple[float, tuple[float, float]]:
    """Fit the cut's ink bbox to the notification box, centred."""
    points = flatten_ops(cut["tag"]) + flatten_ops(cut["flag"])
    left, top, right, bottom = ink_bounds(points)
    scale = size * inset / max(right - left, bottom - top)
    ox = (size - (right - left) * scale) / 2.0 - left * scale
    oy = (size - (bottom - top) * scale) / 2.0 - top * scale
    return scale, (ox, oy)


def notification_xml() -> str:
    size = NOTIFICATION_SIZE_DP
    scale, (ox, oy) = notification_transform(SMALL, size)
    tag = to_path_data(transform_ops(SMALL["tag"], scale, ox, oy, (0.0, 0.0)))
    punch = to_path_data(transform_ops(SMALL["punch"], scale, ox, oy, (0.0, 0.0)))
    flag = to_path_data(transform_ops(SMALL["flag"], scale, ox, oy, (0.0, 0.0)))
    tag_h = (28.2 - 10.0) * scale
    flag_h = (14.2 - 2.6) * scale
    punch_dia = (12.2 - 8.4) * scale
    notch = (28.2 - 25.4) * scale
    return f"""<?xml version="1.0" encoding="utf-8"?>
<!-- GENERATED from the geometry block in android/tools/generate_launcher_icons.py.

     Notification small icon. Android treats this as an alpha mask and replaces
     every colour with the notification tint, so a coloured or mipmap icon
     becomes a white blob. This is the brand's separately drawn SMALL cut
     (the <=16px cut), not a downscale of the full launcher cut: at 24dp the
     tag is {fmt(tag_h)}dp tall, so the full cut's thinner pole, shallower V
     notch and smaller punch would smear. (Measured at 24px: the full cut's V
     notch is 2.16px and its pole 1.69px; the small cut gives 2.63px and
     2.44px.) Scaled so the ink bbox fills the 24dp
     box: tag {fmt(tag_h)}dp, flag {fmt(flag_h)}dp, punch {fmt(punch_dia)}dp,
     V notch {fmt(notch)}dp deep. No third cut was needed: the punch and the
     V notch both survive at 24px, and at 16px the small cut still reads.

     The punch is a true even-odd knockout. The flag is painted first and the
     plate over it, so the pole emerges from behind the shoulder instead of
     ending in a white stub inside the tag. Both paths are white, so there is
     exactly one hole. -->
<vector xmlns:android="http://schemas.android.com/apk/res/android"
    android:width="24dp"
    android:height="24dp"
    android:viewportWidth="24"
    android:viewportHeight="24">

    <path
        android:fillColor="#FFFFFFFF"
        android:pathData="{flag}" />

    <path
        android:fillColor="#FFFFFFFF"
        android:fillType="evenOdd"
        android:pathData="{tag} {punch}" />
</vector>
"""


def adaptive_xml(comment: str) -> str:
    return f"""<?xml version="1.0" encoding="utf-8"?>
<!-- {comment} -->
<adaptive-icon xmlns:android="http://schemas.android.com/apk/res/android">
    <background android:drawable="@color/ic_launcher_background" />
    <foreground android:drawable="@drawable/ic_launcher_foreground" />
    <monochrome android:drawable="@drawable/ic_launcher_monochrome" />
</adaptive-icon>
"""


def write_assets(scale: float, anchor: tuple[float, float]) -> list[Path]:
    written: list[Path] = []

    def write(path: Path, text: str) -> None:
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(text, encoding="utf-8")
        written.append(path)

    write(RES / "drawable" / "ic_launcher_foreground.xml", foreground_xml(scale, anchor))
    write(RES / "drawable" / "ic_launcher_monochrome.xml", monochrome_xml(scale, anchor))
    write(RES / "drawable" / "ic_notification.xml", notification_xml())

    launcher_comment = (
        'Cream ground + "The Warranty Tag". Monochrome layer for Android 13+ '
        "themed icons; generated by android/tools/generate_launcher_icons.py."
    )
    write(RES / "mipmap-anydpi-v26" / "ic_launcher.xml", adaptive_xml(launcher_comment))
    write(
        RES / "mipmap-anydpi-v26" / "ic_launcher_round.xml",
        adaptive_xml(
            "Same layers as ic_launcher: the round mask only changes the crop, and the "
            "mark fits the 66/108 safe circle."
        ),
    )

    # Pre-API-26 fallbacks: full-bleed cream square, no baked-in corners. The
    # 32 grid maps onto the whole bitmap, which is how the iOS full-bleed icon
    # is composed too.
    for density, size in (("mdpi", 48), ("hdpi", 72), ("xhdpi", 96), ("xxhdpi", 144), ("xxxhdpi", 192)):
        # The full 32 grid maps onto the bitmap: anchor and origin are both
        # zero, so body coordinate 6 lands at 6/32 of the icon rather than
        # being shifted by the adaptive anchor.
        img = raster_legacy(size / GRID, size, (0.0, 0.0), (0.0, 0.0))
        path = RES / f"mipmap-{density}" / "ic_launcher.png"
        path.parent.mkdir(parents=True, exist_ok=True)
        img.save(path, "PNG", optimize=True)
        written.append(path)
    return written


def write_previews(scale: float, anchor: tuple[float, float]) -> list[Path]:
    PREVIEW.mkdir(parents=True, exist_ok=True)
    written: list[Path] = []
    icon = raster_adaptive(scale, anchor, 1024)
    icon.save(PREVIEW / "adaptive-unmasked.png")
    written.append(PREVIEW / "adaptive-unmasked.png")

    for name, mask_fn in (
        ("circle", mask_circle),
        ("squircle", mask_squircle),
        ("rounded-square", mask_rounded_square),
    ):
        for size in (1024, 48):
            scaled = icon if size == 1024 else icon.resize((size, size), Image.Resampling.LANCZOS)
            path = PREVIEW / f"mask-{name}-{size}.png"
            compose_on_plate(scaled, mask_fn(size)).save(path)
            written.append(path)

    check = icon.copy()
    draw = ImageDraw.Draw(check)
    safe_r = SAFE_RADIUS_DP * 1024 / 108.0
    draw.ellipse(
        (512 - safe_r, 512 - safe_r, 512 + safe_r, 512 + safe_r),
        outline=(220, 0, 160),
        width=3,
    )
    check.save(PREVIEW / "safe-66-check.png")
    written.append(PREVIEW / "safe-66-check.png")

    # Themed-icon layer on the two grounds the system may pick. The dark render
    # uses white (the standard tint); the light render uses the ink colour so
    # the punch and the V notch are actually visible against a pale plate.
    for label, bg, fill in (
        ("dark", (32, 36, 48, 255), (255, 255, 255, 255)),
        ("light", (245, 242, 236, 255), (*hex_rgb(INK), 255)),
    ):
        mono = mono_layer(scale, anchor, 512, fill)
        plate = Image.new("RGBA", mono.size, bg)
        plate.alpha_composite(mono)
        path = PREVIEW / f"monochrome-on-{label}.png"
        plate.convert("RGB").save(path)
        written.append(path)

    # Notification badge at 1x and 4x, plus the 16px stress size the small cut
    # is designed for. The 1x render is the honest legibility check.
    for size, name in ((24, "24"), (96, "96"), (16, "16")):
        notif = raster_notification(SMALL, size)
        plate = Image.new("RGBA", notif.size, (18, 22, 30, 255))
        plate.alpha_composite(notif)
        path = PREVIEW / f"notification-{name}-on-dark.png"
        plate.convert("RGB").save(path)
        written.append(path)
        if size in (24, 16):
            factor = 10 if size == 24 else 12
            padded = Image.new("RGB", (size + 8, size + 8), (60, 60, 66))
            padded.paste(plate.convert("RGB"), (4, 4))
            zoom = PREVIEW / f"notification-{name}-on-dark-{factor}x.png"
            padded.resize(
                ((size + 8) * factor, (size + 8) * factor), Image.Resampling.NEAREST
            ).save(zoom)
            written.append(zoom)

    return written


def raster_notification(
    cut: dict[str, list[tuple]], size: int, inset: float = NOTIFICATION_INSET
) -> Image.Image:
    """White alpha cut with a transparent punch hole, ink-centered."""
    ss = 8
    px = size * ss
    scale, (ox, oy) = notification_transform(cut, size, inset)
    img = Image.new("RGBA", (px, px), (0, 0, 0, 0))
    draw_mark(
        ImageDraw.Draw(img),
        cut,
        scale * ss,
        ox * ss,
        oy * ss,
        (0.0, 0.0),
        tag_fill=(255, 255, 255, 255),
        flag_fill=(255, 255, 255, 255),
        punch_fill=(0, 0, 0, 0),
    )
    return img.resize((size, size), Image.Resampling.LANCZOS)


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--preview",
        action="store_true",
        help="write only app/build/reports/icon-preview/ and leave res/ untouched",
    )
    args = parser.parse_args()

    points = flatten_ops(FULL["tag"]) + flatten_ops(FULL["flag"])
    scale, radius, anchor = adaptive_scale(points)
    left, top, right, bottom = ink_bounds(points)
    far = max(points, key=lambda p: math.hypot(p[0] - anchor[0], p[1] - anchor[1]))
    unit_radius = max_ink_radius(points, anchor)
    raw = (SAFE_RADIUS_DP - SAFE_MARGIN_DP) / unit_radius
    tag_left, tag_top, tag_right, tag_bottom = ink_bounds(flatten_ops(FULL["tag"]))
    flag_left, flag_top, flag_right, flag_bottom = ink_bounds(flatten_ops(FULL["flag"]))

    print(f"adaptive scale: {scale:.2f}x (safe radius 33dp, margin {SAFE_MARGIN_DP}dp)")
    print(
        f"  ink bounds: x={left:.2f}..{right:.2f}  y={top:.2f}..{bottom:.2f}"
        f"  ({right - left:.2f} x {bottom - top:.2f} units)"
    )
    print(
        f"  anchor: ({anchor[0]:.2f}, {anchor[1]:.2f}) = ink-bounds centre;"
        f" farthest ink point ({far[0]:.2f}, {far[1]:.2f}) = flag tip"
    )
    print(
        f"  arithmetic: unit radius {unit_radius:.4f};"
        f" ({SAFE_RADIUS_DP:.0f} - {SAFE_MARGIN_DP}) / {unit_radius:.4f}"
        f" = {raw:.4f}; snapped down to {scale:.2f}; final radius {radius:.4f}dp"
    )
    print(
        f"  tag: {(tag_right - tag_left) * scale:.2f} x {(tag_bottom - tag_top) * scale:.2f} dp"
        f"   flag: {(flag_right - flag_left) * scale:.2f} x {(flag_bottom - flag_top) * scale:.2f} dp"
    )
    print(
        f"  transformed ink bounds: x={54 + (left - anchor[0]) * scale:.2f}.."
        f"{54 + (right - anchor[0]) * scale:.2f}  y={54 + (top - anchor[1]) * scale:.2f}.."
        f"{54 + (bottom - anchor[1]) * scale:.2f}"
    )
    print(
        f"  at 48dp adaptive: tag {(tag_bottom - tag_top) * scale * 48 / 108:.2f}px,"
        f" punch {3.2 * scale * 48 / 108:.2f}px, notch {2.3 * scale * 48 / 108:.2f}px"
    )
    print(
        f"  at 48px legacy:   tag {(tag_bottom - tag_top) / GRID * 48:.2f}px,"
        f" punch {3.2 / GRID * 48:.2f}px, notch {2.3 / GRID * 48:.2f}px"
    )

    nscale, _ = notification_transform(SMALL, NOTIFICATION_SIZE_DP)
    print(
        f"notification (small cut, 24dp): tag {(28.2 - 10.0) * nscale:.2f}dp,"
        f" flag {(14.2 - 2.6) * nscale:.2f}dp, punch {(12.2 - 8.4) * nscale:.2f}dp,"
        f" V notch {(28.2 - 25.4) * nscale:.2f}dp deep,"
        f" pole {(20.9 - 18.3) * nscale:.2f}dp"
    )

    written = write_previews(scale, anchor)
    if not args.preview:
        written.extend(write_assets(scale, anchor))
    print(f"wrote {len(written)} files")
    for path in written:
        print(f"  {path.relative_to(ROOT)}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

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

Geometry is on a 32x32 grid. The numbers below are the final mark: a 16x24
body with the torn edge at the bottom and the date dot above it.

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
import sys
from pathlib import Path

try:
    from PIL import Image, ImageDraw
except ImportError:  # pragma: no cover - environment hint only
    sys.exit("Pillow is required: python3 -m pip install Pillow")

# ---------------------------------------------------------------------------
# THE MARK. Everything Android ships is generated from this block.
# ---------------------------------------------------------------------------

# Clockwise outline on the 32x32 grid. M/L are points, A is an SVG-style
# elliptical arc (rx, ry, rotation, large-arc-flag, sweep-flag, x, y).
GRID = 32.0
BODY_OPS = [
    ("M", 9.5, 3.0),
    ("L", 22.5, 3.0),
    ("A", 1.5, 1.5, 0.0, 0, 1, 24.0, 4.5),
    ("L", 24.0, 25.8),
    ("L", 23.0, 27.2),
    ("L", 21.7, 25.8),
    ("L", 20.2, 26.7),
    ("L", 18.4, 25.7),
    ("L", 16.8, 27.1),
    ("L", 15.2, 25.9),
    ("L", 13.4, 26.8),
    ("L", 11.8, 25.8),
    ("L", 10.2, 27.0),
    ("L", 8.8, 26.1),
    ("L", 8.0, 26.7),
    ("L", 8.0, 4.5),
    ("A", 1.5, 1.5, 0.0, 0, 1, 9.5, 3.0),
    ("Z",),
]
DOT = (19.9, 21.6, 2.0)  # cx, cy, r
BODY_BOX = (8.0, 3.0, 24.0, 27.0)  # nominal body, not the tear extremes

# Fixed brand palette for the launcher. These are deliberately not theme
# colours; the home-screen icon never follows the in-app accent.
CREAM = "#FFF7EE"
INK = "#1F1A14"
CORAL = "#FF6B45"

# Android adaptive-icon geometry. 66/108 is the safe circle; the extra margin
# keeps antialiasing from touching the boundary. 72 is the visible mask
# diameter used by the previews.
SAFE_DIAMETER_DP = 66.0
SAFE_RADIUS_DP = SAFE_DIAMETER_DP / 2.0
SAFE_MARGIN_DP = 0.9
MASK_DIAMETER_DP = 72.0

ROOT = Path(__file__).resolve().parent.parent  # android/
RES = ROOT / "app" / "src" / "main" / "res"
PREVIEW = ROOT / "app" / "build" / "reports" / "icon-preview"


# ---------------------------------------------------------------------------
# Path maths
# ---------------------------------------------------------------------------


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


def transform_ops(scale: float, ox: float, oy: float, anchor: tuple[float, float]) -> list[tuple]:
    ax, ay = anchor
    out: list[tuple] = []
    for op in BODY_OPS:
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


def dot_path(scale: float, ox: float, oy: float, anchor: tuple[float, float]) -> str:
    ax, ay = anchor
    cx = ox + (DOT[0] - ax) * scale
    cy = oy + (DOT[1] - ay) * scale
    r = DOT[2] * scale
    return (
        f"M{fmt(cx - r)},{fmt(cy)} "
        f"a{fmt(r)},{fmt(r)} 0 1,0 {fmt(2 * r)},0 "
        f"a{fmt(r)},{fmt(r)} 0 1,0 {fmt(-2 * r)},0 Z"
    )


def ink_bounds(points: list[tuple[float, float]]) -> tuple[float, float, float, float]:
    xs = [p[0] for p in points]
    ys = [p[1] for p in points]
    return min(xs), min(ys), max(xs), max(ys)


def max_ink_radius(
    points: list[tuple[float, float]],
    anchor: tuple[float, float],
    dot: tuple[float, float, float] | None = None,
) -> float:
    ax, ay = anchor
    radius = max(math.hypot(x - ax, y - ay) for x, y in points)
    dot_cx, dot_cy, dot_r = DOT if dot is None else dot
    radius = max(radius, math.hypot(dot_cx - ax, dot_cy - ay) + dot_r)
    return radius


def adaptive_scale(points: list[tuple[float, float]]) -> tuple[float, float, tuple[float, float]]:
    """Largest 0.05-step uniform scale that fits the 66/108 safe circle."""
    left, top, right, bottom = BODY_BOX
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
    scale: float,
    ox: float,
    oy: float,
    anchor: tuple[float, float],
    body_fill: tuple[int, int, int] = hex_rgb(INK),
    dot_fill: tuple[int, int, int] = hex_rgb(CORAL),
) -> None:
    pts = transform_ops(scale, ox, oy, anchor)
    draw.polygon(flatten_ops(pts), fill=body_fill)
    ax, ay = anchor
    cx = ox + (DOT[0] - ax) * scale
    cy = oy + (DOT[1] - ay) * scale
    r = DOT[2] * scale
    draw.ellipse((cx - r, cy - r, cx + r, cy + r), fill=dot_fill)


def raster_adaptive(scale: float, anchor: tuple[float, float], size: int = 1024) -> Image.Image:
    ss = 4
    px = size * ss
    unit = px / 108.0
    img = Image.new("RGB", (px, px), hex_rgb(CREAM))
    draw_mark(ImageDraw.Draw(img), scale * unit, 54 * unit, 54 * unit, anchor)
    return img.resize((size, size), Image.Resampling.LANCZOS)


def raster_legacy(scale_factor: float, size: int, anchor: tuple[float, float], origin: tuple[float, float]) -> Image.Image:
    ss = 8
    px = size * ss
    img = Image.new("RGB", (px, px), hex_rgb(CREAM))
    draw_mark(ImageDraw.Draw(img), scale_factor * ss, origin[0] * ss, origin[1] * ss, anchor)
    return img.resize((size, size), Image.Resampling.LANCZOS)


def mask_circle(size: int) -> Image.Image:
    ss = 4
    px = size * ss
    mask = Image.new("L", (px, px), 0)
    r = MASK_DIAMETER_DP / 2.0 * px / 108.0
    c = px / 2.0
    ImageDraw.Draw(mask).ellipse((c - r, c - r, c + r, c + r), fill=255)
    return mask.resize((size, size), Image.Resampling.LANCZOS)


def mask_rounded_square(size: int, radius_dp: float = 12.0) -> Image.Image:
    ss = 4
    px = size * ss
    mask = Image.new("L", (px, px), 0)
    side = MASK_DIAMETER_DP * px / 108.0
    origin = (px - side) / 2.0
    radius = radius_dp * px / 108.0
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


# ---------------------------------------------------------------------------
# Writers
# ---------------------------------------------------------------------------


def foreground_xml(scale: float, anchor: tuple[float, float]) -> str:
    path = to_path_data(transform_ops(scale, 54.0, 54.0, anchor))
    body_w = (BODY_BOX[2] - BODY_BOX[0]) * scale
    body_h = (BODY_BOX[3] - BODY_BOX[1]) * scale
    pts = flatten_ops(transform_ops(scale, 54.0, 54.0, anchor))
    left, top, right, bottom = ink_bounds(pts)
    dot = (
        54.0 + (DOT[0] - anchor[0]) * scale,
        54.0 + (DOT[1] - anchor[1]) * scale,
        DOT[2] * scale,
    )
    radius = max_ink_radius(pts, (54.0, 54.0), dot)
    return f"""<?xml version="1.0" encoding="utf-8"?>
<!-- GENERATED by android/tools/generate_launcher_icons.py. Change the
     geometry block there and re-run; do not hand-edit this file.

     "The Kept Receipt". Body {fmt(body_w)} x {fmt(body_h)} at {fmt(scale)}x on
     the 108dp canvas, anchored on the nominal body centre. Ink bounds
     x={fmt(left)}..{fmt(right)}, y={fmt(top)}..{fmt(bottom)}; farthest ink
     point {fmt(radius)}dp from centre, inside the
     66/108 safe circle (r=33). -->
<vector xmlns:android="http://schemas.android.com/apk/res/android"
    android:width="108dp"
    android:height="108dp"
    android:viewportWidth="108"
    android:viewportHeight="108">

    <path
        android:fillColor="@color/ic_launcher_ink"
        android:pathData="{path}" />

    <path
        android:fillColor="@color/ic_launcher_coral"
        android:pathData="{dot_path(scale, 54.0, 54.0, anchor)}" />
</vector>
"""


def monochrome_xml(scale: float, anchor: tuple[float, float]) -> str:
    body = to_path_data(transform_ops(scale, 54.0, 54.0, anchor))
    hole = dot_path(scale, 54.0, 54.0, anchor)
    return f"""<?xml version="1.0" encoding="utf-8"?>
<!-- GENERATED from the geometry block in android/tools/generate_launcher_icons.py.

     Android 13+ themed-icon layer: the receipt plus the date dot as an
     even-odd knockout. The system tints this layer monochrome, so a second
     solid shape would vanish into the receipt. No background here; the
     themed ground is supplied by the launcher. -->
<vector xmlns:android="http://schemas.android.com/apk/res/android"
    android:width="108dp"
    android:height="108dp"
    android:viewportWidth="108"
    android:viewportHeight="108">

    <path
        android:fillColor="#FFFFFFFF"
        android:fillType="evenOdd"
        android:pathData="{body} {hole}" />
</vector>
"""


def notification_xml(points: list[tuple[float, float]]) -> str:
    size = 24.0
    scale = size * 0.92 / GRID
    left, top, right, bottom = ink_bounds(points)
    offset_x = (size - (right - left) * scale) / 2.0 - left * scale
    offset_y = (size - (bottom - top) * scale) / 2.0 - top * scale
    anchor = (0.0, 0.0)
    body = to_path_data(transform_ops(scale, offset_x, offset_y, anchor))
    hole = dot_path(scale, offset_x, offset_y, anchor)
    return f"""<?xml version="1.0" encoding="utf-8"?>
<!-- GENERATED from the geometry block in android/tools/generate_launcher_icons.py.

     Notification small icon. Android treats this as an alpha mask and replaces
     every colour with the notification tint, so a coloured or mipmap icon
     becomes a white blob. This is the receipt as white-on-transparent with the
     date dot knocked out, at the same 0.92 ink-centred badge scale as
     renderNotificationBadgeSvg() in website/src/lib/brand.ts.

     Silhouette {fmt((right - left) * scale)} x {fmt((bottom - top) * scale)} on the
     24dp box; dot hole diameter {fmt(2 * DOT[2] * scale)}. -->
<vector xmlns:android="http://schemas.android.com/apk/res/android"
    android:width="24dp"
    android:height="24dp"
    android:viewportWidth="24"
    android:viewportHeight="24">

    <path
        android:fillColor="#FFFFFFFF"
        android:fillType="evenOdd"
        android:pathData="{body} {hole}" />
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


def write_assets(scale: float, anchor: tuple[float, float], points: list[tuple[float, float]]) -> list[Path]:
    written: list[Path] = []

    def write(path: Path, text: str) -> None:
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(text, encoding="utf-8")
        written.append(path)

    write(RES / "drawable" / "ic_launcher_foreground.xml", foreground_xml(scale, anchor))
    write(RES / "drawable" / "ic_launcher_monochrome.xml", monochrome_xml(scale, anchor))
    write(RES / "drawable" / "ic_notification.xml", notification_xml(points))

    launcher_comment = (
        'Cream ground + "The Kept Receipt". Monochrome layer for Android 13+ '
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
    for name, mask in (
        ("circle", mask_circle(1024)),
        ("squircle", mask_squircle(1024)),
        ("rounded-square", mask_rounded_square(1024)),
    ):
        path = PREVIEW / f"mask-{name}.png"
        compose_on_plate(icon, mask).save(path)
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

    # Monochrome layer on a dark plate, and the 24dp notification badge at 1x
    # and 4x, so the knockout holes are actually visible to the reviewer.
    mono = Image.new("RGBA", (1024, 1024), (0, 0, 0, 0))
    mono_draw = ImageDraw.Draw(mono)
    mono_draw.polygon(
        flatten_ops(transform_ops(scale * 1024 / 108.0, 512, 512, anchor)),
        fill=(255, 255, 255, 255),
    )
    ax, ay = anchor
    cx = 512 + (DOT[0] - ax) * scale * 1024 / 108.0
    cy = 512 + (DOT[1] - ay) * scale * 1024 / 108.0
    r = DOT[2] * scale * 1024 / 108.0
    mono_draw.ellipse((cx - r, cy - r, cx + r, cy + r), fill=(0, 0, 0, 0))
    mono_plate = Image.new("RGBA", mono.size, (32, 36, 48, 255))
    mono_plate.alpha_composite(mono)
    mono_plate.convert("RGB").resize((108, 108), Image.Resampling.LANCZOS).save(PREVIEW / "monochrome-on-dark.png")
    written.append(PREVIEW / "monochrome-on-dark.png")

    notif = raster_notification(points_for_notification(), 96)
    notif_plate = Image.new("RGBA", notif.size, (18, 22, 30, 255))
    notif_plate.alpha_composite(notif)
    notif_plate.convert("RGB").save(PREVIEW / "notification-96-on-dark.png")
    written.append(PREVIEW / "notification-96-on-dark.png")

    notif_24 = raster_notification(points_for_notification(), 24)
    notif_24_plate = Image.new("RGBA", notif_24.size, (18, 22, 30, 255))
    notif_24_plate.alpha_composite(notif_24)
    notif_24_plate.convert("RGB").resize((240, 240), Image.Resampling.NEAREST).save(
        PREVIEW / "notification-24-on-dark.png"
    )
    written.append(PREVIEW / "notification-24-on-dark.png")

    return written


def points_for_notification() -> list[tuple[float, float]]:
    return flatten_ops(BODY_OPS)


def raster_notification(points: list[tuple[float, float]], size: int) -> Image.Image:
    """White alpha receipt with a transparent dot hole, 0.92 ink-centred."""
    ss = 8
    px = size * ss
    scale = size * 0.92 / GRID
    left, top, right, bottom = ink_bounds(points)
    offset_x = (size - (right - left) * scale) / 2.0 - left * scale
    offset_y = (size - (bottom - top) * scale) / 2.0 - top * scale
    img = Image.new("RGBA", (px, px), (0, 0, 0, 0))
    draw = ImageDraw.Draw(img)
    draw.polygon(
        [(offset_x * ss + x * scale * ss, offset_y * ss + y * scale * ss) for x, y in points],
        fill=(255, 255, 255, 255),
    )
    cx = offset_x + DOT[0] * scale
    cy = offset_y + DOT[1] * scale
    r = DOT[2] * scale
    draw.ellipse(
        ((cx - r) * ss, (cy - r) * ss, (cx + r) * ss, (cy + r) * ss),
        fill=(0, 0, 0, 0),
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

    points = flatten_ops(BODY_OPS)
    scale, radius, anchor = adaptive_scale(points)
    left, top, right, bottom = ink_bounds(flatten_ops(transform_ops(scale, 54, 54, anchor)))

    print(f"adaptive scale: {scale:.2f}x (limit {33.0:.0f}dp, margin {SAFE_MARGIN_DP}dp)")
    print(f"  body: {(BODY_BOX[2] - BODY_BOX[0]) * scale:.2f} x {(BODY_BOX[3] - BODY_BOX[1]) * scale:.2f} dp")
    print(f"  ink bounds: x={left:.2f}..{right:.2f}  y={top:.2f}..{bottom:.2f}")
    print(f"  farthest ink radius: {radius:.2f}dp (safe circle 33.00dp)")
    print(f"  dot: r={DOT[2] * scale:.2f}dp, diameter={2 * DOT[2] * scale:.2f}dp")
    print(f"  visible body width: {(BODY_BOX[2] - BODY_BOX[0]) * scale / 72.0 * 48:.2f}px at 48px icon")

    written = write_previews(scale, anchor)
    if not args.preview:
        written.extend(write_assets(scale, anchor, points))
    print(f"wrote {len(written)} files")
    for path in written:
        print(f"  {path.relative_to(ROOT)}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

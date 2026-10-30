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

Geometry is on a 32x32 grid. The numbers below are the final mark: "W in the
tag" -- a price-tag silhouette (rounded top corners, a torn zigzag bottom edge)
with a W cut out of the plate. No pennant, no punched hole, no bevel. The plate
is coral; the W is the cream ground showing through.

TWO CUTS. The full cut is for surfaces >= 24px. The small cut is separately
drawn (fewer, wider teeth and a heavier W) for
surfaces <= 16px. They are not scaled versions of one another: downscaling the
full cut smears its third tooth at status-bar size. The 24dp
notification uses the small cut because its optical tag is only ~17dp tall.

Why the adaptive foreground is not simply the 32 grid scaled to 108dp:
Android scales adaptive layers 1.5x and masks the icon, so only the middle 72dp
of the 108dp layer is visible. The guaranteed-safe circle is 66dp in diameter
(radius 33). This script finds the largest uniform scale for the tag
that keeps every ink pixel inside that circle, with a small antialias margin,
then verifies the W sits inside it too. Both are computed from the actual
outline rather than hard-coded.
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

# Path data for the chosen mark, on the 32x32 grid, mirroring the full and small
# cuts in website/src/lib/brand.ts.
#
# The W is a stroked OPEN path, not a fill: a filled W at small sizes closes
# into a solid triangle. On the colour foreground it is stroked in the cream
# background colour; on the alpha-only layers (monochrome, notification) the same
# stroke is emitted as a filled outline subpath so it is a real transparent
# hole. Widths are in grid units.
FULL_CUT = {
    # x=5..27, y=7..25.4; three teeth, tips at y=23.0, 2.4 deep.
    "tag": (
        "M6.6 7L25.4 7A1.6 1.6 0 0 1 27 8.6L27 25.4L23.33 23L19.67 25.4"
        "L16 23L12.33 25.4L8.67 23L5 25.4L5 8.6A1.6 1.6 0 0 1 6.6 7Z"
    ),
    # x=9.2..22.8, y=10.0..20.2 with the 2.8 stroke; 2.8 above the tooth tips.
    "letter": "M10.6 11.4L13.3 18.8L16 13.4L18.7 18.8L21.4 11.4",
}

# The small cut is a distinct drawing, not a downscale: two wide teeth (3.0
# deep) and a heavier W (3.4 vs 2.8) so it survives 16px.
SMALL_CUT = {
    "tag": (
        "M6 6.4L26 6.4A1.4 1.4 0 0 1 27.4 7.8L27.4 25.6L21.7 22.6L16 25.6"
        "L10.3 22.6L4.6 25.6L4.6 7.8A1.4 1.4 0 0 1 6 6.4Z"
    ),
    "letter": "M10 11L13.2 19L16 12.6L18.8 19L22 11",
}

FULL_LETTER_WIDTH = 2.8
SMALL_LETTER_WIDTH = 3.4

# Fixed brand palette for the launcher. These are deliberately not theme
# colours; the home-screen icon never follows the in-app accent.
CREAM = "#FFF7EE"
INK = "#1F1A14"  # themed-icon preview only
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

    Absolute and relative commands are both accepted, and M/L may carry
    multiple coordinate pairs (the W is authored as `M…l…`). A zero-length arc
    is dropped: it is a no-op in SVG and a known source of NaN geometry in
    Android's PathParser.
    """
    commands = set("MLAZmlaz")
    tokens = re.findall(r"[MLAZmlaz]|-?(?:\d+(?:\.\d*)?|\.\d+)", data)
    ops: list[tuple] = []
    current = (0.0, 0.0)
    start = (0.0, 0.0)
    i = 0
    while i < len(tokens):
        kind = tokens[i]
        i += 1
        upper = kind.upper()
        relative = kind.islower()
        if upper in ("M", "L"):
            first = upper == "M"
            while i < len(tokens) and tokens[i] not in commands:
                x, y = float(tokens[i]), float(tokens[i + 1])
                i += 2
                if relative:
                    x += current[0]
                    y += current[1]
                if first:
                    ops.append(("M", x, y))
                    start = (x, y)
                    first = False
                else:
                    ops.append(("L", x, y))
                current = (x, y)
        elif upper == "A":
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
            if relative:
                x += current[0]
                y += current[1]
            if (x, y) != current:  # zero-length arc: no-op, do not emit
                ops.append(("A", rx, ry, rot, large_arc, sweep, x, y))
                current = (x, y)
        elif upper == "Z":
            ops.append(("Z",))
            current = start
        else:  # pragma: no cover - geometry authoring error
            raise ValueError(f"unsupported path command {kind!r}")
    return ops


def polyline(ops: list[tuple]) -> list[tuple[float, float]]:
    """The centreline of a stroked path: the M/L points, in order."""
    points: list[tuple[float, float]] = []
    for op in ops:
        if op[0] == "M":
            points.append((float(op[1]), float(op[2])))
        elif op[0] == "L":
            points.append((float(op[1]), float(op[2])))
        else:  # pragma: no cover - the W is authored with M/L only
            raise ValueError(f"a stroked path cannot contain {op[0]!r}")
    return points


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


def transform_points(
    points: list[tuple[float, float]],
    scale: float,
    ox: float,
    oy: float,
    anchor: tuple[float, float],
) -> list[tuple[float, float]]:
    ax, ay = anchor
    return [(ox + (x - ax) * scale, oy + (y - ay) * scale) for x, y in points]


def _unit(x: float, y: float) -> tuple[float, float]:
    length = math.hypot(x, y)
    if length == 0:  # pragma: no cover - geometry authoring error
        raise ValueError("zero-length segment in a stroked path")
    return (x / length, y / length)


def _clean_points(
    points: list[tuple[float, float]], eps: float = 1e-9
) -> list[tuple[float, float]]:
    out = [points[0]]
    for point in points[1:]:
        if math.hypot(point[0] - out[-1][0], point[1] - out[-1][1]) > eps:
            out.append(point)
    return out


def _short_delta(start: float, end: float) -> float:
    """Signed angle from `start` to `end`, in (-pi, pi]."""
    delta = end - start
    while delta <= -math.pi:
        delta += 2.0 * math.pi
    while delta > math.pi:
        delta -= 2.0 * math.pi
    return delta


def _arc_points(
    center: tuple[float, float],
    radius: float,
    start_angle: float,
    delta: float,
    steps: int = 16,
) -> list[tuple[float, float]]:
    """Sample an arc, excluding its starting point and including its end."""
    return [
        (
            center[0] + radius * math.cos(start_angle + delta * i / steps),
            center[1] + radius * math.sin(start_angle + delta * i / steps),
        )
        for i in range(1, steps + 1)
    ]


def _line_intersection(
    p1: tuple[float, float],
    p2: tuple[float, float],
    p3: tuple[float, float],
    p4: tuple[float, float],
) -> tuple[float, float]:
    """Intersection of the infinite lines p1-p2 and p3-p4."""
    x1, y1 = p1
    x2, y2 = p2
    x3, y3 = p3
    x4, y4 = p4
    denominator = (x1 - x2) * (y3 - y4) - (y1 - y2) * (x3 - x4)
    if abs(denominator) < 1e-12:  # pragma: no cover - collinear segments
        return ((x2 + x3) / 2.0, (y2 + y3) / 2.0)
    determinant = x1 * y2 - y1 * x2
    determinant2 = x3 * y4 - y3 * x4
    return (
        (determinant * (x3 - x4) - (x1 - x2) * determinant2) / denominator,
        (determinant * (y3 - y4) - (y1 - y2) * determinant2) / denominator,
    )


def stroke_outline(
    points: list[tuple[float, float]], width: float, steps: int = 16
) -> list[tuple[float, float]]:
    """The closed boundary of a round-capped, round-joined stroke.

    Android's VectorDrawable cannot subtract a stroke from a fill, so the
    alpha-only layers need the W as a filled outline instead of a stroked
    path. The outline is the same geometry: parallel offsets joined by a
    circular arc on the outside of each bend, a semicircle at each end, and a
    mitre (the offset-line intersection) on the inside. Only line segments are
    emitted, sampled densely enough that the biggest chord error is far below
    a pixel at 108dp.
    """
    pts = _clean_points(points)
    if len(pts) < 2:  # pragma: no cover - geometry authoring error
        raise ValueError("a stroked path needs at least two points")
    half = width / 2.0
    directions = [
        _unit(pts[i + 1][0] - pts[i][0], pts[i + 1][1] - pts[i][1])
        for i in range(len(pts) - 1)
    ]
    normals = [(-dy, dx) for dx, dy in directions]

    def side(sign: float) -> list[tuple[float, float]]:
        path = [
            (
                pts[0][0] + sign * normals[0][0] * half,
                pts[0][1] + sign * normals[0][1] * half,
            )
        ]
        for i in range(len(directions) - 1):
            cross = (
                directions[i][0] * directions[i + 1][1]
                - directions[i][1] * directions[i + 1][0]
            )
            vertex = pts[i + 1]
            inner = (cross > 0 and sign > 0) or (cross < 0 and sign < 0)
            if inner:
                path.append(
                    _line_intersection(
                        (
                            pts[i][0] + sign * normals[i][0] * half,
                            pts[i][1] + sign * normals[i][1] * half,
                        ),
                        (
                            pts[i + 1][0] + sign * normals[i][0] * half,
                            pts[i + 1][1] + sign * normals[i][1] * half,
                        ),
                        (
                            pts[i + 1][0] + sign * normals[i + 1][0] * half,
                            pts[i + 1][1] + sign * normals[i + 1][1] * half,
                        ),
                        (
                            pts[i + 2][0] + sign * normals[i + 1][0] * half,
                            pts[i + 2][1] + sign * normals[i + 1][1] * half,
                        ),
                    )
                )
            else:
                start = math.atan2(sign * normals[i][1], sign * normals[i][0])
                end = math.atan2(sign * normals[i + 1][1], sign * normals[i + 1][0])
                path.extend(
                    _arc_points(vertex, half, start, _short_delta(start, end), steps)
                )
        path.append(
            (
                pts[-1][0] + sign * normals[-1][0] * half,
                pts[-1][1] + sign * normals[-1][1] * half,
            )
        )
        return path

    end_angle = math.atan2(normals[-1][1], normals[-1][0])
    start_angle = math.atan2(normals[0][1], normals[0][0])
    boundary = side(1.0)
    boundary.extend(_arc_points(pts[-1], half, end_angle, -math.pi, steps))
    boundary.extend(reversed(side(-1.0)))
    boundary.extend(_arc_points(pts[0], half, start_angle + math.pi, -math.pi, steps))
    boundary = _clean_points(boundary)
    if math.hypot(
        boundary[0][0] - boundary[-1][0], boundary[0][1] - boundary[-1][1]
    ) <= 1e-9:
        boundary.pop()
    return boundary


def to_polygon_path(points: list[tuple[float, float]]) -> str:
    commands = [f"M{fmt(points[0][0])},{fmt(points[0][1])}"]
    commands.extend(f"L{fmt(x)},{fmt(y)}" for x, y in points[1:])
    commands.append("Z")
    return " ".join(commands)


# The W's filled outline, in grid units. The colour foreground strokes the
# centreline; the alpha-only layers need this outline as an even-odd subpath.
FULL_LETTER_OUTLINE = stroke_outline(polyline(FULL["letter"]), FULL_LETTER_WIDTH)
SMALL_LETTER_OUTLINE = stroke_outline(polyline(SMALL["letter"]), SMALL_LETTER_WIDTH)


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

    The anchor is the centre of the mark's actual ink bounds; the farthest ink
    point is then one of the tag's bottom corners.
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
    letter_width: float,
    tag_fill: tuple = (*hex_rgb(CORAL),),
    letter_fill: tuple = (*hex_rgb(CREAM),),
) -> None:
    """Draw the plate, then the W cut-out.

    The W is drawn as the stroked outline. On the colour rasters it is filled
    with the background cream (so it reads as a cut-out); on the alpha-only
    rasters `letter_fill` is transparent, which punches a real hole. Drawing
    the outline rather than a stroked line matches the vector outputs exactly.
    """
    pts = flatten_ops(transform_ops(cut["tag"], scale, ox, oy, anchor))
    draw.polygon(pts, fill=tag_fill)
    draw.polygon(
        transform_points(
            stroke_outline(polyline(cut["letter"]), letter_width), scale, ox, oy, anchor
        ),
        fill=letter_fill,
    )


def raster_adaptive(scale: float, anchor: tuple[float, float], size: int = 1024) -> Image.Image:
    ss = 4
    px = size * ss
    unit = px / 108.0
    img = Image.new("RGB", (px, px), hex_rgb(CREAM))
    draw_mark(
        ImageDraw.Draw(img),
        FULL,
        scale * unit,
        54 * unit,
        54 * unit,
        anchor,
        letter_width=FULL_LETTER_WIDTH,
    )
    return img.resize((size, size), Image.Resampling.LANCZOS)


def raster_legacy(scale_factor: float, size: int, anchor: tuple[float, float], origin: tuple[float, float]) -> Image.Image:
    ss = 8
    px = size * ss
    img = Image.new("RGB", (px, px), hex_rgb(CREAM))
    draw_mark(
        ImageDraw.Draw(img),
        FULL,
        scale_factor * ss,
        origin[0] * ss,
        origin[1] * ss,
        anchor,
        letter_width=FULL_LETTER_WIDTH,
    )
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
    """Themed-icon layer: the tag with the W knocked out."""
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
        letter_width=FULL_LETTER_WIDTH,
        tag_fill=fill,
        letter_fill=(0, 0, 0, 0),
    )
    return img.resize((size, size), Image.Resampling.LANCZOS)


# ---------------------------------------------------------------------------
# Writers
# ---------------------------------------------------------------------------


def foreground_xml(scale: float, anchor: tuple[float, float]) -> str:
    tag = to_path_data(transform_ops(FULL["tag"], scale, 54.0, 54.0, anchor))
    letter = to_path_data(transform_ops(FULL["letter"], scale, 54.0, 54.0, anchor))
    pts = flatten_ops(transform_ops(FULL["tag"], scale, 54.0, 54.0, anchor))
    left, top, right, bottom = ink_bounds(pts)
    radius = max_ink_radius(pts, (54.0, 54.0))
    w_points = transform_points(FULL_LETTER_OUTLINE, scale, 54.0, 54.0, anchor)
    w_left, w_top, w_right, w_bottom = ink_bounds(w_points)
    w_radius = max_ink_radius(w_points, (54.0, 54.0))
    w_width = FULL_LETTER_WIDTH * scale
    return f"""<?xml version="1.0" encoding="utf-8"?>
<!-- GENERATED by android/tools/generate_launcher_icons.py. Change the
     geometry block there and re-run; do not hand-edit this file.

     "W in the tag": a coral price tag (rounded top corners, torn zigzag bottom)
     with a W cut out of it. Tag {fmt(right - left)} x {fmt(bottom - top)}dp at {fmt(scale)}x on the 108dp
     canvas, anchored on the ink-bounds centre. Ink bounds x={fmt(left)}..{fmt(right)},
     y={fmt(top)}..{fmt(bottom)}; farthest ink point {fmt(radius)}dp from centre, inside the
     66/108 safe circle (r=33).

     The W is stroked {fmt(w_width)}dp wide in @color/ic_launcher_background, the
     cream the cut-out reveals. Its ink is x={fmt(w_left)}..{fmt(w_right)},
     y={fmt(w_top)}..{fmt(w_bottom)}; its farthest point is {fmt(w_radius)}dp from centre.
     Round caps and joins. It is a stroked OPEN path (fill none) so it reads as
     a line at list size; a filled W closes into a solid triangle. -->
<vector xmlns:android="http://schemas.android.com/apk/res/android"
    android:width="108dp"
    android:height="108dp"
    android:viewportWidth="108"
    android:viewportHeight="108">

    <path
        android:fillColor="@color/ic_launcher_coral"
        android:pathData="{tag}" />

    <path
        android:fillColor="#00000000"
        android:strokeColor="@color/ic_launcher_background"
        android:strokeWidth="{fmt(w_width)}"
        android:strokeLineCap="round"
        android:strokeLineJoin="round"
        android:pathData="{letter}" />
</vector>
"""


def monochrome_xml(scale: float, anchor: tuple[float, float]) -> str:
    tag = to_path_data(transform_ops(FULL["tag"], scale, 54.0, 54.0, anchor))
    w_hole = to_polygon_path(
        transform_points(FULL_LETTER_OUTLINE, scale, 54.0, 54.0, anchor)
    )
    return f"""<?xml version="1.0" encoding="utf-8"?>
<!-- GENERATED from the geometry block in android/tools/generate_launcher_icons.py.

     Android 13+ themed-icon layer: the plate with the W knocked out (even-odd).
     White; the system uses the alpha as the mask and applies its own tint, so
     the W shows the themed ground.

     The W is a stroked line on the colour foreground, but a transparent
     stroke cannot subtract from an alpha mask, so this layer appends the
     stroke's exact filled outline (round caps/joins and all) to the plate
     path: inside it the even-odd fill is transparent. No background here. -->
<vector xmlns:android="http://schemas.android.com/apk/res/android"
    android:width="108dp"
    android:height="108dp"
    android:viewportWidth="108"
    android:viewportHeight="108">

    <path
        android:fillColor="#FFFFFFFF"
        android:fillType="evenOdd"
        android:pathData="{tag} {w_hole}" />
</vector>
"""


def notification_transform(
    cut: dict[str, list[tuple]], size: float, inset: float = NOTIFICATION_INSET
) -> tuple[float, tuple[float, float]]:
    """Fit the cut's ink bbox to the notification box, centred."""
    left, top, right, bottom = ink_bounds(flatten_ops(cut["tag"]))
    scale = size * inset / max(right - left, bottom - top)
    ox = (size - (right - left) * scale) / 2.0 - left * scale
    oy = (size - (bottom - top) * scale) / 2.0 - top * scale
    return scale, (ox, oy)


def notification_xml() -> str:
    size = NOTIFICATION_SIZE_DP
    scale, (ox, oy) = notification_transform(SMALL, size)
    tag = to_path_data(transform_ops(SMALL["tag"], scale, ox, oy, (0.0, 0.0)))
    w_points = transform_points(SMALL_LETTER_OUTLINE, scale, ox, oy, (0.0, 0.0))
    w_hole = to_polygon_path(w_points)
    tag_h = (25.6 - 6.4) * scale
    tooth = 3.0 * scale
    w_left, w_top, w_right, w_bottom = ink_bounds(w_points)
    w_stroke = SMALL_LETTER_WIDTH * scale
    return f"""<?xml version="1.0" encoding="utf-8"?>
<!-- GENERATED from the geometry block in android/tools/generate_launcher_icons.py.

     Notification small icon. Android treats this as an alpha mask and replaces
     every colour with the notification tint, so a coloured or mipmap icon
     becomes a white blob. This is the brand's separately drawn SMALL cut, not a
     downscale of the full launcher cut: two wide teeth ({fmt(tooth)}dp deep) instead of
     three, and a {fmt(w_stroke)}dp W stroke inking {fmt(w_right - w_left)}x{fmt(w_bottom - w_top)}dp. Scaled so the
     ink bbox fills the 24dp box: tag {fmt(tag_h)}dp tall.

     The W is a true even-odd knockout (its stroked shape is emitted as its
     filled outline, because a transparent stroke cannot erase an alpha mask). -->
<vector xmlns:android="http://schemas.android.com/apk/res/android"
    android:width="24dp"
    android:height="24dp"
    android:viewportWidth="24"
    android:viewportHeight="24">

    <path
        android:fillColor="#FFFFFFFF"
        android:fillType="evenOdd"
        android:pathData="{tag} {w_hole}" />
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


LEGACY_ANCHOR = (16.0, 16.2)  # centre of the full cut's ink box


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
        'Cream ground + "W in the tag". Monochrome layer for Android 13+ '
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
        # Centre the tag's ink box on the bitmap at the web app-icon's size
        # (22 grid units = 0.84 * 22/32 of the edge).
        img = raster_legacy(0.84 * size / GRID, size, LEGACY_ANCHOR, (size / 2.0, size / 2.0))
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

    # The raw 108dp layer at the two sizes the brief asks to read back:
    # 108dp is the drawable itself, 48dp is the Play Store list size.
    for size in (108, 48):
        raw = raster_adaptive(scale, anchor, size)
        path = PREVIEW / f"foreground-{size}.png"
        raw.save(path)
        written.append(path)

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
    # the W is actually visible against a pale plate.
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
    """White alpha cut with the W as a transparent hole, ink-centered."""
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
        letter_width=SMALL_LETTER_WIDTH,
        tag_fill=(255, 255, 255, 255),
        letter_fill=(0, 0, 0, 0),
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

    points = flatten_ops(FULL["tag"])
    scale, radius, anchor = adaptive_scale(points)
    left, top, right, bottom = ink_bounds(points)
    far = max(points, key=lambda p: math.hypot(p[0] - anchor[0], p[1] - anchor[1]))
    unit_radius = max_ink_radius(points, anchor)
    raw = (SAFE_RADIUS_DP - SAFE_MARGIN_DP) / unit_radius

    print(f"adaptive scale: {scale:.2f}x (safe radius 33dp, margin {SAFE_MARGIN_DP}dp)")
    print(
        f"  ink bounds: x={left:.2f}..{right:.2f}  y={top:.2f}..{bottom:.2f}"
        f"  ({right - left:.2f} x {bottom - top:.2f} units)"
    )
    print(
        f"  anchor: ({anchor[0]:.2f}, {anchor[1]:.2f}) = ink-bounds centre;"
        f" farthest ink point ({far[0]:.2f}, {far[1]:.2f})"
    )
    print(
        f"  arithmetic: unit radius {unit_radius:.4f};"
        f" ({SAFE_RADIUS_DP:.0f} - {SAFE_MARGIN_DP}) / {unit_radius:.4f}"
        f" = {raw:.4f}; snapped down to {scale:.2f}; final radius {radius:.4f}dp"
    )
    w_points = transform_points(FULL_LETTER_OUTLINE, scale, 54.0, 54.0, anchor)
    w_left, w_top, w_right, w_bottom = ink_bounds(w_points)
    w_radius = max_ink_radius(w_points, (54.0, 54.0))
    if w_radius > SAFE_RADIUS_DP:
        raise ValueError(
            f"the W reaches {w_radius:.2f}dp from centre; the safe radius is "
            f"{SAFE_RADIUS_DP:.0f}dp"
        )
    print(
        f"  W: {w_right - w_left:.2f} x {w_bottom - w_top:.2f} dp,"
        f" stroke {FULL_LETTER_WIDTH * scale:.2f}dp; ink x={w_left:.2f}..{w_right:.2f}"
        f"  y={w_top:.2f}..{w_bottom:.2f}; farthest {w_radius:.2f}dp from centre"
        f" ({SAFE_RADIUS_DP - w_radius:.2f}dp inside the {SAFE_RADIUS_DP:.0f}dp safe circle)"
    )
    print(
        f"  at 48px drawable:  W {(w_right - w_left) * 48 / 108:.2f}px wide,"
        f" stroke {FULL_LETTER_WIDTH * scale * 48 / 108:.2f}px"
        f"   | at 48dp adaptive icon: W {(w_right - w_left) * 48 / 72:.2f}px wide,"
        f" stroke {FULL_LETTER_WIDTH * scale * 48 / 72:.2f}px"
    )

    nscale, (nox, noy) = notification_transform(SMALL, NOTIFICATION_SIZE_DP)
    nw_points = transform_points(SMALL_LETTER_OUTLINE, nscale, nox, noy, (0.0, 0.0))
    nw_left, nw_top, nw_right, nw_bottom = ink_bounds(nw_points)
    print(
        f"notification (small cut, 24dp): tag {(25.6 - 6.4) * nscale:.2f}dp,"
        f" tooth {3.0 * nscale:.2f}dp deep,"
        f" W {nw_right - nw_left:.2f}x{nw_bottom - nw_top:.2f}dp"
        f" stroke {SMALL_LETTER_WIDTH * nscale:.2f}dp"
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

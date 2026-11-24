#!/usr/bin/env python3
"""App Store 1.0.2 iPhone Duo marketing screenshots, cream/coral serif style.

iPhone Duo slots (App Store Connect "iPhone Duo" tab):
  inner display: 2007x2853  -> opened Duo, regular-width UI = iPad captures
  outer display: 1398x2034  -> folded Duo, compact-width UI  = iPhone captures

Headlines match the 1.0.1 set (Tools/appstore_screenshots_v2.py). The frames
are Duo-specific: duo_inner() draws an opened foldable (continuous body, hinge
seam, display crease), duo_outer() the folded device (stacked halves, hinge
band, fore-edge). The Premium slide is laid out for the Duo aspect instead of
being a scaled iPhone slide.

Usage: python3 Tools/appstore_screenshots_duo.py
"""
import math
from pathlib import Path

from PIL import Image, ImageChops, ImageDraw, ImageFont, ImageFilter

ROOT = Path(__file__).resolve().parents[1]
SRC = ROOT / "artifacts/appstore"
OUT = SRC / "duo"
ICON = ROOT / "ios/App/Assets.xcassets/AppIcon.appiconset/icon-1024.png"

CREAM = "#FAF5EC"
CORAL = "#C97A63"
CORAL_LIGHT = "#E7A08A"
MUTED = "#7C7166"
DARK = "#191722"
BODY = "#211E29"
EDGE = "#4A4357"

GEORGIA_BI = "/System/Library/Fonts/Supplemental/Georgia Bold Italic.ttf"
HELV = "/System/Library/Fonts/HelveticaNeue.ttc"
HELV_B = "/System/Library/Fonts/HelveticaNeue.ttc"

INNER_SIZE = (2007, 2853)
OUTER_SIZE = (1398, 2034)


def font(path, size, index=0):
    try:
        return ImageFont.truetype(path, size, index=index)
    except Exception:
        return ImageFont.truetype("/System/Library/Fonts/Helvetica.ttc", size, index=0)


def fit_font(path, size, text, max_width, index=0):
    f = font(path, size, index)
    while size > 20 and f.getlength(text) > max_width:
        size -= 2
        f = font(path, size, index)
    return f


def rounded_mask(size, radius):
    m = Image.new("L", size, 0)
    ImageDraw.Draw(m).rounded_rectangle(
        [0, 0, size[0] - 1, size[1] - 1], radius=radius, fill=255
    )
    return m


def add_icon(canvas, x, y, size):
    icon = Image.open(ICON).convert("RGBA").resize((size, size), Image.LANCZOS)
    icon.putalpha(rounded_mask((size, size), int(size * 0.22)))
    canvas.alpha_composite(icon, (x, y))


def header(canvas, title, x, y, icon_size, eyebrow_size, title_size, max_width):
    """WARRLY icon + eyebrow + one-line coral serif headline."""
    d = ImageDraw.Draw(canvas)
    d.text(
        (x + icon_size + int(icon_size * 0.34), y),
        "WARRLY",
        font=font(HELV_B, eyebrow_size, index=1),
        fill=MUTED,
    )
    add_icon(canvas, x, y - int(icon_size * 0.36), icon_size)
    d.text(
        (x, y + eyebrow_size + int(eyebrow_size * 1.85)),
        title,
        font=fit_font(GEORGIA_BI, title_size, title, max_width),
        fill=CORAL,
    )


def new_canvas(size):
    c = Image.new("RGBA", size, CREAM)
    overlay = Image.new("RGBA", size, (0, 0, 0, 0))
    ImageDraw.Draw(overlay).ellipse(
        [-size[0] * 0.3, -size[1] * 0.15, size[0] * 1.3, size[1] * 1.15],
        fill=(255, 255, 255, 28),
    )
    return Image.alpha_composite(c, overlay)


def screen_art(source, size):
    """Screenshot cover-fitted into the display, with the warm wash."""
    scr = Image.open(source).convert("RGB")
    sw, sh = size
    scale = max(sw / scr.width, sh / scr.height)
    scr = scr.resize(
        (int(scr.width * scale) + 1, int(scr.height * scale) + 1), Image.LANCZOS
    )
    left = (scr.width - sw) // 2
    top = (scr.height - sh) // 2
    scr = scr.crop((left, top, left + sw, top + sh))
    return Image.blend(scr, Image.new("RGB", (sw, sh), "#F8EFE2"), 0.06)


def crease(screen):
    """Soft fold shading: a narrow specular line beside a narrow shadow groove."""
    w, h = screen.size
    cx = w // 2
    half = max(18, int(w * 0.030))
    ov = Image.new("RGBA", (w, h), (0, 0, 0, 0))
    od = ImageDraw.Draw(ov)
    for i in range(-half, half + 1):
        t = i / half
        shade = 5 * math.exp(-((t / 0.95) ** 2))
        seam = 18 * math.exp(-(((i - half * 0.08) / (half * 0.16)) ** 2))
        spec = 13 * math.exp(-(((i + half * 0.12) / (half * 0.10)) ** 2))
        net = spec - (shade + seam)
        if net > 0.5:
            od.line([(cx + i, 0), (cx + i, h)], fill=(255, 255, 255, int(net)))
        elif net < -0.5:
            od.line([(cx + i, 0), (cx + i, h)], fill=(0, 0, 0, int(-net)))
    return Image.alpha_composite(screen.convert("RGBA"), ov)


def duo_inner(canvas, source, box, bezel=26, radius=58):
    """Opened Duo: one body, seam + hinge caps in the bezel, display crease."""
    x, y, w, h = box
    cx = x + w // 2
    shadow = Image.new("RGBA", (w + 260, h + 260), (0, 0, 0, 0))
    ImageDraw.Draw(shadow).rounded_rectangle(
        [130, 142, w + 130, h + 130], radius=radius + 32, fill=(20, 16, 24, 78)
    )
    shadow = shadow.filter(ImageFilter.GaussianBlur(44))
    canvas.alpha_composite(shadow, (x - 130, y - 130))

    d = ImageDraw.Draw(canvas)
    d.rounded_rectangle([x, y, x + w, y + h], radius=radius, fill=BODY)
    sw, sh = w - 2 * bezel, h - 2 * bezel
    scr = crease(screen_art(source, (sw, sh)))
    mask = rounded_mask((sw, sh), max(12, radius - bezel))
    canvas.paste(scr.convert("RGB"), (x + bezel, y + bezel), mask)
    d.rounded_rectangle(
        [x + bezel, y + bezel, x + bezel + sw, y + bezel + sh],
        radius=max(12, radius - bezel),
        outline="#0B0910",
        width=2,
    )
    # hinge: seam through the top/bottom bezel with caps on it
    seam_w = max(5, int(w * 0.004))
    d.rectangle([cx - seam_w // 2, y, cx + seam_w // 2, y + bezel], fill="#0E0C14")
    d.rectangle(
        [cx - seam_w // 2, y + h - bezel, cx + seam_w // 2, y + h], fill="#0E0C14"
    )
    cap_w, cap_h = max(26, int(w * 0.028)), max(10, int(bezel * 0.60))
    for cy in (y + int(bezel * 0.18), y + h - int(bezel * 0.18) - cap_h):
        d.rounded_rectangle(
            [cx - cap_w // 2, cy, cx + cap_w // 2, cy + cap_h],
            radius=cap_h // 2,
            fill="#3B3546",
            outline="#141119",
        )
    d.rounded_rectangle([x, y, x + w, y + h], radius=radius, outline=EDGE, width=3)


def duo_outer(canvas, source, box, bezel=20, radius=62):
    """Folded Duo: two stacked halves, hinge band on the left, fore-edge."""
    x, y, w, h = box
    total_w, total_h = w + 12, h + 10
    shadow = Image.new("RGBA", (total_w + 240, total_h + 240), (0, 0, 0, 0))
    ImageDraw.Draw(shadow).rounded_rectangle(
        [120, 132, total_w + 120, total_h + 120], radius=radius + 28, fill=(20, 16, 24, 74)
    )
    shadow = shadow.filter(ImageFilter.GaussianBlur(38))
    canvas.alpha_composite(shadow, (x - 120, y - 120))

    d = ImageDraw.Draw(canvas)
    body_mask = rounded_mask((w, h), radius)
    # back half, peeking out on the left and bottom
    d.rounded_rectangle(
        [x - 6, y + 6, x + w - 6, y + h + 4], radius=radius, fill="#171420"
    )
    d.rounded_rectangle(
        [x - 6, y + 6, x + w - 6, y + h + 4], radius=radius, outline="#3A3446", width=2
    )
    # front half
    d.rounded_rectangle([x, y, x + w, y + h], radius=radius, fill=BODY)
    # hinge band hugging the left edge of the front half
    spine = max(14, int(w * 0.026))
    band = Image.new("RGBA", (w, h), (0, 0, 0, 0))
    bd = ImageDraw.Draw(band)
    bd.rectangle([0, 0, spine, h], fill="#2C2736")
    band.putalpha(ImageChops.multiply(band.getchannel("A"), body_mask))
    canvas.alpha_composite(band, (x, y))
    d = ImageDraw.Draw(canvas)
    for dx, tint, width in ((2, "#5A5270", 2), (spine - 3, "#0E0C14", 3)):
        d.line(
            [(x + dx, y + radius), (x + dx, y + h - radius)],
            fill=tint,
            width=width,
        )
    # fore-edge: the two halves meeting on the free edge
    for dx, tint, width in ((w - 13, "#0E0C14", 2), (w - 7, "#0E0C14", 2)):
        d.line(
            [(x + dx, y + radius), (x + dx, y + h - radius)],
            fill=tint,
            width=width,
        )
    d.line(
        [(x + w - 10, y + radius), (x + w - 10, y + h - radius)],
        fill="#4A4357",
        width=1,
    )
    sw, sh = w - 2 * bezel, h - 2 * bezel
    scr = screen_art(source, (sw, sh))
    mask = rounded_mask((sw, sh), max(10, radius - bezel))
    canvas.paste(scr.convert("RGB"), (x + bezel, y + bezel), mask)
    # cover-display camera punch hole
    cr = max(6, int(sw * 0.0115))
    ccx, ccy = x + bezel + sw // 2, y + bezel + int(sh * 0.030)
    d.ellipse([ccx - cr, ccy - cr, ccx + cr, ccy + cr], fill="#08070B")
    d.ellipse([ccx - cr, ccy - cr, ccx + cr, ccy + cr], outline="#3A3446", width=2)
    d.rounded_rectangle(
        [x + bezel, y + bezel, x + bezel + sw, y + bezel + sh],
        radius=max(10, radius - bezel),
        outline="#0B0910",
        width=2,
    )
    d.rounded_rectangle([x, y, x + w, y + h], radius=radius, outline=EDGE, width=2)


def draw_inner(source, title, out, title_size):
    W, H = INNER_SIZE
    c = new_canvas((W, H))
    pad, bezel = 140, 26
    header(c, title, pad, 150, 104, 34, title_size, W - 2 * pad)
    dev_h = H - 512 - 118
    src = Image.open(SRC / source)
    aspect = src.width / src.height
    dev_w = int(aspect * (dev_h - 2 * bezel)) + 2 * bezel
    duo_inner(c, SRC / source, ((W - dev_w) // 2, 512, dev_w, dev_h), bezel=bezel)
    c.convert("RGB").save(out, optimize=True)


def draw_outer(source, title, out, title_size):
    W, H = OUTER_SIZE
    c = new_canvas((W, H))
    pad, bezel = 96, 20
    header(c, title, pad, 100, 76, 26, title_size, W - 2 * pad)
    dev_h = H - 352 - 96
    src = Image.open(SRC / source)
    aspect = src.width / src.height
    dev_w = int(aspect * (dev_h - 2 * bezel)) + 2 * bezel
    duo_outer(c, SRC / source, ((W - dev_w) // 2, 352, dev_w, dev_h), bezel=bezel)
    c.convert("RGB").save(out, optimize=True)


def draw_final(out, size, lang="en"):
    """Premium slide composed for the Duo aspect: feature rows + price card."""
    W, H = size
    c = Image.new("RGBA", (W, H), DARK)
    glow = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    ImageDraw.Draw(glow).ellipse(
        [W * 0.35, H * 0.55, W * 1.25, H * 1.25], fill=(201, 122, 99, 40)
    )
    c = Image.alpha_composite(c, glow.filter(ImageFilter.GaussianBlur(int(W * 0.09))))
    d = ImageDraw.Draw(c)

    pad = int(W * 0.075)
    icon = int(W * 0.085)
    icon_y = int(H * 0.045)
    add_icon(c, pad, icon_y, icon)
    eyebrow = int(W * 0.021)
    d.text(
        (pad + icon + int(icon * 0.34), icon_y + int(icon * 0.24)),
        "WARRLY PREMIUM",
        font=font(HELV_B, eyebrow, 1),
        fill=CORAL_LIGHT,
    )

    if lang == "vi":
        title = "Tất cả.\nKhông giới hạn."
        rows = [
            "Không quảng cáo",
            "200 thiết bị đang dùng · 2.000 tổng",
            "500 đăng ký · 1.000 wishlist",
            "Dùng thử 7 ngày",
        ]
        price1, price2 = "49.000₫ / tháng", "399.000₫ / năm  ·  tiết kiệm 32%"
    else:
        title = "All of it.\nWithout limits."
        rows = [
            "No ads",
            "200 active devices · 2,000 total",
            "500 subscriptions · 1,000 wishlist",
            "7-day free trial",
        ]
        price1, price2 = "49.000₫ / month", "399.000₫ / year  ·  save 32%"

    title_size = int(W * 0.072)
    longest = max(title.split("\n"), key=len)
    while title_size > 40 and font(GEORGIA_BI, title_size).getlength(longest) > W - 2 * pad:
        title_size -= 2
    f = font(GEORGIA_BI, title_size)
    space = int(title_size * 0.10)
    ty = icon_y + icon + int(H * 0.038)
    d.multiline_text((pad, ty), title, font=f, fill="#F5D8CB", spacing=space)
    title_bottom = ty + title_size * 2 + space

    row_h = int(H * 0.072)
    row_gap = int(H * 0.019)
    row_y = max(int(H * 0.35), title_bottom + int(H * 0.05))
    row_text = int(W * 0.027)
    for i, text in enumerate(rows):
        y = row_y + i * (row_h + row_gap)
        d.rounded_rectangle(
            [pad, y, W - pad, y + row_h], radius=int(row_h * 0.34), fill="#221D2E"
        )
        r = int(row_text * 0.62)
        cxr, cyr = pad + int(row_h * 0.62), y + row_h // 2
        d.ellipse([cxr - r, cyr - r, cxr + r, cyr + r], fill=CORAL)
        d.line(
            [
                (cxr - r * 0.40, cyr + r * 0.02),
                (cxr - r * 0.08, cyr + r * 0.34),
                (cxr + r * 0.44, cyr - r * 0.36),
            ],
            fill="#FFF6EF",
            width=max(3, int(r * 0.26)),
            joint="curve",
        )
        d.text(
            (cxr + int(row_h * 0.46), cyr - int(row_text * 0.60)),
            text,
            font=font(HELV, row_text, 0),
            fill="#EFE5DA",
        )

    card_h = int(H * 0.075)
    card_y = H - int(H * 0.09) - card_h
    d.rounded_rectangle(
        [pad, card_y, W - pad, card_y + card_h],
        radius=int(card_h * 0.32),
        fill="#2C2639",
    )
    p1 = int(W * 0.028)
    d.text(
        (pad + int(card_h * 0.28), card_y + int(card_h * 0.18)),
        price1,
        font=font(HELV_B, p1, 1),
        fill="#FFFFFF",
    )
    d.text(
        (pad + int(card_h * 0.28), card_y + int(card_h * 0.56)),
        price2,
        font=font(HELV, int(p1 * 0.80), 0),
        fill="#CDBFAF",
    )
    c.convert("RGB").save(out, optimize=True)


# (slug, headline, inner source [regular width], outer source [compact width])
EN = [
    ("01-dashboard", "Every deadline. One place.",
     "listing-ipad-1-dashboard.png", "listing-1-dashboard.png"),
    ("02-devices", "Your devices, sorted.",
     "listing-ipad-2-devices.png", "listing-2-devices.png"),
    ("03-device-detail", "Know when cover ends.",
     "listing-ipad-3-device-detail.png", "listing-3-device-detail.png"),
    ("04-subscriptions", "Subscriptions, handled.",
     "listing-ipad-4-subscriptions.png", "listing-4-subscriptions.png"),
    ("05-wishlist", "The things worth waiting for.",
     "listing-ipad-5-wishlist.png", "listing-5-wishlist.png"),
    ("06-essentials", "Never run out again.",
     "listing-ipad-5-wishlist.png", "staples-list.png"),
    ("07-price", "Remember what you paid.",
     "listing-ipad-3-device-detail.png", "listing-3-device-detail.png"),
    ("08-essentials-entry", "The little things, handled.",
     "listing-ipad-5-wishlist.png", "staples-wishlist-entry.png"),
    ("09-premium", "Less ads. More room.",
     "listing-ipad-4-subscriptions.png", "premium-monthly.png"),
    ("10-final", "All of it. Without limits.", None, None),
]

VI = [
    ("01-dashboard", "Mọi hạn chót. Một nơi.",
     "listing-vi-ipad-1-dashboard.png", "listing-vi-1-dashboard.png"),
    ("02-devices", "Thiết bị của mày, gọn gàng.",
     "listing-vi-ipad-2-devices.png", "listing-vi-2-devices.png"),
    ("03-device-detail", "Biết rõ ngày hết bảo hành.",
     "listing-vi-ipad-3-device-detail.png", "listing-vi-3-device-detail.png"),
    ("04-subscriptions", "Đăng ký định kỳ, trong tầm tay.",
     "listing-vi-ipad-4-subscriptions.png", "listing-vi-4-subscriptions.png"),
    ("05-wishlist", "Những món đáng để chờ.",
     "listing-vi-ipad-5-wishlist.png", "listing-vi-5-wishlist.png"),
    ("06-essentials", "Không còn hết hàng bất ngờ.",
     "listing-vi-ipad-5-wishlist.png", "staples-list.png"),
    ("07-price", "Nhớ mình đã mua giá bao nhiêu.",
     "listing-vi-ipad-3-device-detail.png", "listing-vi-3-device-detail.png"),
    ("08-essentials-entry", "Mấy món nhỏ, lo xong.",
     "listing-vi-ipad-5-wishlist.png", "staples-wishlist-entry.png"),
    ("09-premium", "Bớt quảng cáo. Thêm chỗ.",
     "listing-vi-ipad-4-subscriptions.png", "premium-monthly.png"),
    ("10-final", "Tất cả. Không giới hạn.", None, None),
]


def uniform_title_size(slides, base, max_width):
    """Largest size at or below base that keeps every headline on one line."""
    size = base
    for _, title, _, _ in slides:
        width = font(GEORGIA_BI, size).getlength(title)
        if width > max_width:
            size = min(size, int(size * max_width / width) - 2)
    return size - size % 2


def montage(folder, prefix, thumb_width=430):
    files = sorted(folder.glob(f"{prefix}-[0-9][0-9]-*.png"))
    cells = []
    for f in files:
        im = Image.open(f).convert("RGB")
        h = int(im.height * thumb_width / im.width)
        cells.append(im.resize((thumb_width, h), Image.LANCZOS))
    cols, pad = 5, 26
    cell_h = max(c.height for c in cells)
    rows = math.ceil(len(cells) / cols)
    sheet = Image.new(
        "RGB",
        (cols * thumb_width + (cols + 1) * pad, rows * cell_h + (rows + 1) * pad),
        "#EFE4D4",
    )
    for i, cell in enumerate(cells):
        r, cidx = divmod(i, cols)
        sheet.paste(cell, (pad + cidx * (thumb_width + pad), pad + r * (cell_h + pad)))
    return sheet


def render(slides, folder, lang, inner_title, outer_title):
    folder.mkdir(parents=True, exist_ok=True)
    for slug, title, inner_src, outer_src in slides:
        if inner_src:
            draw_inner(inner_src, title, folder / f"inner-{slug}.png", inner_title)
        else:
            draw_final(folder / f"inner-{slug}.png", INNER_SIZE, lang)
        if outer_src:
            draw_outer(outer_src, title, folder / f"outer-{slug}.png", outer_title)
        else:
            draw_final(folder / f"outer-{slug}.png", OUTER_SIZE, lang)
        print(lang, slug)
    for name in ("inner", "outer"):
        sheet = montage(folder, name)
        sheet.save(folder / f"montage-{name}.png", optimize=True)
        print("montage", lang, name, sheet.size)


def main():
    for slides, lang in ((EN, "en"), (VI, "vi")):
        folder = OUT if lang == "en" else OUT / "vi"
        inner_title = uniform_title_size(slides, 108, INNER_SIZE[0] - 2 * 140)
        outer_title = uniform_title_size(slides, 74, OUTER_SIZE[0] - 2 * 96)
        print(lang, "title sizes", inner_title, outer_title)
        render(slides, folder, lang, inner_title, outer_title)


if __name__ == "__main__":
    main()

#!/usr/bin/env python3
"""Apple official iPhone Duo frames + Warrly app screens, cream/coral style."""
from pathlib import Path
from PIL import Image, ImageDraw, ImageFont, ImageFilter

ROOT = Path(__file__).resolve().parents[1]
SRC = ROOT / "artifacts/appstore/v2"
OUT = ROOT / "artifacts/appstore/duo-official"
ICON = ROOT / "ios/App/Assets.xcassets/AppIcon.appiconset/icon-1024.png"
DL = Path.home() / "Downloads"

CREAM = "#FAF5EC"
CORAL = "#C97A63"
INK = "#28242F"
MUTED = "#7C7166"
DARK = "#191722"
GEORGIA_BI = "/System/Library/Fonts/Supplemental/Georgia Bold Italic.ttf"
HELV = "/System/Library/Fonts/HelveticaNeue.ttc"
HELV_B = "/System/Library/Fonts/HelveticaNeue.ttc"

OUTER_FRAME = DL / "iPhone Duo - Night Sky - Outer Closed Portrait.png"
INNER_FRAME = DL / "iPhone Duo - Night Sky - Inner Open Portrait.png"
OUTER_SCREEN = (88, 81, 1485, 2112)
INNER_SCREEN = (120, 120, 2126, 2972)
SIZES = {"outer": (1398, 2034), "inner": (2007, 2853)}

def font(path, size, index=0):
    try:
        return ImageFont.truetype(path, size, index=index)
    except Exception:
        return ImageFont.truetype("/System/Library/Fonts/Helvetica.ttc", size)

def wrap(draw, text, f, max_width):
    words, lines, line = text.split(), [], ""
    for w in words:
        test = (line + " " + w).strip()
        if draw.textlength(test, font=f) <= max_width:
            line = test
        else:
            if line: lines.append(line)
            line = w
    if line: lines.append(line)
    return lines

def fit_font(path, size, text, width):
    f = font(path, size)
    while size > 24 and f.getlength(text) > width:
        size -= 2; f = font(path, size)
    return f

def rounded_mask(size, radius):
    m = Image.new("L", size, 0)
    ImageDraw.Draw(m).rounded_rectangle([0,0,size[0]-1,size[1]-1], radius=radius, fill=255)
    return m

def screen_fill(scr, box):
    """Fit the app screen into the cutout; fill side gaps with warm cream."""
    x0,y0,x1,y1 = box; bw,bh = x1-x0+1, y1-y0+1
    im = Image.open(scr).convert("RGB")
    scale = min(bw/im.width, bh/im.height)
    nw,nh = max(1,int(im.width*scale)), max(1,int(im.height*scale))
    im = im.resize((nw,nh), Image.LANCZOS)
    out = Image.new("RGB", (bw,bh), "#F6F1E8")
    out.paste(im, ((bw-nw)//2, (bh-nh)//2))
    return out

def add_frame(canvas, frame_path, box, screen_box, app):
    frame = Image.open(frame_path).convert("RGBA")
    sx0, sy0, sx1, sy1 = screen_box
    ss = screen_fill(app, screen_box)
    mask = rounded_mask(ss.size, max(24, int(frame.width * 0.035)))
    base = Image.new("RGBA", frame.size, (0, 0, 0, 0))
    base.paste(ss, (sx0, sy0), mask)
    base.alpha_composite(frame)
    fw = box[2] - box[0] + 1
    fh = box[3] - box[1] + 1
    base = base.resize((fw, fh), Image.LANCZOS)
    canvas.alpha_composite(base, (box[0], box[1]))


def header(canvas, title, eyebrow, x, y, eyebrow_size, title_size, max_width, line_height):
    d = ImageDraw.Draw(canvas)
    icon = Image.open(ICON).convert("RGBA").resize((72,72), Image.LANCZOS)
    icon.putalpha(rounded_mask((72,72), 16))
    canvas.alpha_composite(icon, (x, y))
    d.text((x+96, y+20), eyebrow, font=font(HELV_B, eyebrow_size, 1), fill=MUTED)
    tf = fit_font(GEORGIA_BI, title_size, title, max_width)
    lines = wrap(d, title, tf, max_width)
    ty = y + eyebrow_size + 54
    d.multiline_text((x, ty), "\n".join(lines), font=tf, fill=CORAL, spacing=line_height-title_size)
    return ty + len(lines)*line_height

def build(slide, device, title, out, lang):
    W,H = SIZES[device]
    c = Image.new("RGBA", (W,H), CREAM)
    d = ImageDraw.Draw(c)
    header(c, title, "WARRLY", 92 if device=="outer" else 150, 96 if device=="outer" else 150,
           24 if device=="outer" else 36, 76 if device=="outer" else 116,
           W-184, 92 if device=="outer" else 138)
    frame = OUTER_FRAME if device=="outer" else INNER_FRAME
    sb = OUTER_SCREEN if device=="outer" else INNER_SCREEN
    if device == "outer":
        fw = 1080; fh = int(2194*1080/1574); x=(W-fw)//2; y=430
    else:
        fw = 1500; fh = int(3093*1500/2247); x=(W-fw)//2; y=560
    box = (x,y,x+fw,y+fh)
    add_frame(c, frame, box, sb, RAW/slide)
    # final frame edge/shadow
    sh = Image.new("RGBA",(fw+120,fh+120),(0,0,0,0))
    ImageDraw.Draw(sh).rounded_rectangle([60,66,fw+60,fh+60], radius=50, fill=(20,16,24,50))
    sh = sh.filter(ImageFilter.GaussianBlur(30))
    c.alpha_composite(sh, (x-60,y-60))
    c.convert("RGB").save(out, optimize=True)

def build_final(device, out, lang):
    W,H = SIZES[device]
    c = Image.new("RGBA",(W,H),DARK); d=ImageDraw.Draw(c)
    # soft coral glow
    glow = Image.new("RGBA",(W,H),(0,0,0,0))
    ImageDraw.Draw(glow).ellipse([W*.35,H*.55,W*1.25,H*1.25], fill=(201,122,99,40))
    glow = glow.filter(ImageFilter.GaussianBlur(160)); c=Image.alpha_composite(c,glow); d=ImageDraw.Draw(c)
    x = 110 if device=="outer" else 150
    icon = Image.open(ICON).convert("RGBA").resize((120 if device=="outer" else 160,)*2, Image.LANCZOS)
    icon.putalpha(rounded_mask(icon.size, 24)); c.alpha_composite(icon,(x,120 if device=="outer" else 160))
    d.text((x+(150 if device=="outer" else 200), (150 if device=="outer" else 190)), "WARRLY PREMIUM", font=font(HELV_B,32 if device=="outer" else 44,1), fill="#E7A08A")
    title = "Tất cả.\nKhông giới hạn." if lang=="vi" else "All of it.\nWithout limits."
    d.multiline_text((x, 300 if device=="outer" else 380), title, font=font(GEORGIA_BI,92 if device=="outer" else 150), fill="#F5D8CB", spacing=10)
    benefits = ("200 thiết bị đang dùng · 2.000 tổng\n500 đăng ký · 1.000 wishlist\nKhông quảng cáo · Dùng thử 7 ngày" if lang=="vi"
                else "200 active devices · 2,000 total\n500 subscriptions · 1,000 wishlist\nNo ads · 7-day free trial")
    d.multiline_text((x, 620 if device=="outer" else 900), benefits, font=font(HELV,36 if device=="outer" else 56,0), fill="#EFE5DA", spacing=18 if device=="outer" else 24)
    c.convert("RGB").save(out, optimize=True)

# raw app captures (not the existing marketing screenshots)
RAW = ROOT / "artifacts/appstore"
EN = [
 ("01-dashboard","Every deadline. One place.","listing-ipad-1-dashboard.png","listing-ipad-1-dashboard.png"),
 ("02-devices","Your devices, sorted.","listing-ipad-2-devices.png","listing-ipad-2-devices.png"),
 ("03-device-detail","Know when cover ends.","listing-ipad-3-device-detail.png","listing-ipad-3-device-detail.png"),
 ("04-subscriptions","Subscriptions, handled.","listing-ipad-4-subscriptions.png","listing-ipad-4-subscriptions.png"),
 ("05-wishlist","The things worth waiting for.","listing-ipad-5-wishlist.png","listing-ipad-5-wishlist.png"),
 ("06-essentials","Never run out again.","listing-ipad-5-wishlist.png","listing-ipad-5-wishlist.png"),
 ("07-price","Remember what you paid.","listing-ipad-3-device-detail.png","listing-ipad-3-device-detail.png"),
 ("08-essentials-entry","The little things, handled.","listing-ipad-5-wishlist.png","listing-ipad-5-wishlist.png"),
 ("09-premium","Less ads. More room.","premium-monthly.png","premium-monthly.png"),
 ("10-final","All of it. Without limits.",None,None),
]
VI = [
 ("01-dashboard","Mọi hạn chót. Một nơi.","listing-vi-ipad-1-dashboard.png","listing-vi-ipad-1-dashboard.png"),
 ("02-devices","Thiết bị của mày, gọn gàng.","listing-vi-ipad-2-devices.png","listing-vi-ipad-2-devices.png"),
 ("03-device-detail","Biết rõ ngày hết bảo hành.","listing-vi-ipad-3-device-detail.png","listing-vi-ipad-3-device-detail.png"),
 ("04-subscriptions","Đăng ký định kỳ, trong tầm tay.","listing-vi-ipad-4-subscriptions.png","listing-vi-ipad-4-subscriptions.png"),
 ("05-wishlist","Những món đáng để chờ.","listing-vi-ipad-5-wishlist.png","listing-vi-ipad-5-wishlist.png"),
 ("06-essentials","Không còn hết hàng bất ngờ.","listing-vi-ipad-5-wishlist.png","listing-ipad-5-wishlist.png"),
 ("07-price","Nhớ mình đã mua giá bao nhiêu.","listing-vi-ipad-3-device-detail.png","listing-ipad-3-device-detail.png"),
 ("08-essentials-entry","Mấy món nhỏ, lo xong.","listing-vi-ipad-5-wishlist.png","listing-ipad-5-wishlist.png"),
 ("09-premium","Bớt quảng cáo. Thêm chỗ.","premium-monthly.png","premium-monthly.png"),
 ("10-final","Tất cả. Không giới hạn.",None,None),
]

for lang, slides in (("en",EN),("vi",VI)):
    for device in ("inner","outer"):
        folder = OUT / (device if lang=="en" else f"vi/{device}")
        folder.mkdir(parents=True, exist_ok=True)
        for slug,title,inner,outer in slides:
            out = folder / f"{slug}.png"
            if slug=="10-final":
                build_final(device, out, lang)
            else:
                build(inner if device=="inner" else outer, device, title, out, lang)
            print(lang, device, out.name)

#!/usr/bin/env python3
"""Render the three login directions as 390 x 844 iPhone frames.

The mark geometry is copied verbatim from `website/src/lib/brand.ts` (CUT_FULL /
CUT_SMALL, `body` + `letter`), so a mockup cannot drift from the app icon, the
web header or `WarrlyMark.swift`. Both cuts are used at the sizes the brand file
prescribes: `full` at >= 24 pt, `small` below that.

Usage:
    python3 render_mockups.py          # writes frames/*.html + gallery.html
    bash render.sh                     # then screenshots them with Chrome
"""

import json
import os

HERE = os.path.dirname(os.path.abspath(__file__))
FRAMES = os.path.join(HERE, "frames")

# ── brand.ts, copied exactly ────────────────────────────────────────────────
CUT_FULL = {
    "cut": "full",
    "body": "M6.6 7L25.4 7A1.6 1.6 0 0 1 27 8.6L27 25.4L23.33 23L19.67 25.4L16 23"
            "L12.33 25.4L8.67 23L5 25.4L5 8.6A1.6 1.6 0 0 1 6.6 7Z",
    "letter": "M10.6 11.4L13.3 18.8L16 13.4L18.7 18.8L21.4 11.4",
    "letterWidth": 2.8,
    "ink": (5, 7, 22, 18.4),
}
CUT_SMALL = {
    "cut": "small",
    "body": "M6 6.4L26 6.4A1.4 1.4 0 0 1 27.4 7.8L27.4 25.6L21.7 22.6L16 25.6"
            "L10.3 22.6L4.6 25.6L4.6 7.8A1.4 1.4 0 0 1 6 6.4Z",
    "letter": "M10 11L13.2 19L16 12.6L18.8 19L22 11",
    "letterWidth": 3.4,
    "ink": (4.6, 6.4, 22.8, 19.2),
}

_counter = [0]


def mark(width, color):
    """The mark at `width` pt of *ink*, using the cut brand.ts picks for that size."""
    g = CUT_FULL if width >= 24 else CUT_SMALL
    x, y, w, h = g["ink"]
    hh = width * h / w
    _counter[0] += 1
    mid = f"wm{_counter[0]}"
    return (
        f'<svg class="mark" width="{width}" height="{hh:.2f}" viewBox="{x} {y} {w} {h}" '
        f'role="img" aria-label="Warrly">'
        f'<defs><mask id="{mid}" maskUnits="userSpaceOnUse" x="0" y="0" width="32" height="32">'
        f'<rect x="0" y="0" width="32" height="32" fill="white"/>'
        f'<path d="{g["letter"]}" fill="none" stroke="black" stroke-width="{g["letterWidth"]}" '
        f'stroke-linecap="round" stroke-linejoin="round"/></mask></defs>'
        f'<path d="{g["body"]}" fill="{color}" mask="url(#{mid})"/>'
        f"</svg>"
    )


EYE = (
    '<svg width="18" height="18" viewBox="0 0 18 18" fill="none">'
    '<path d="M1.6 9C1.6 9 4.3 4.4 9 4.4S16.4 9 16.4 9 13.7 13.6 9 13.6 1.6 9 1.6 9Z" '
    'stroke="currentColor" stroke-width="1.35" stroke-linejoin="round"/>'
    '<circle cx="9" cy="9" r="2.15" stroke="currentColor" stroke-width="1.35"/></svg>'
)

CHEVRON = (
    '<svg width="11" height="18" viewBox="0 0 11 18" fill="none">'
    '<path d="M9 1.5 2 9l7 7.5" stroke="currentColor" stroke-width="2" '
    'stroke-linecap="round" stroke-linejoin="round"/></svg>'
)

STATUS_RIGHT = (
    '<div class="status-right">'
    # cellular
    '<svg width="18" height="12" viewBox="0 0 18 12" aria-hidden="true">'
    '<rect x="0" y="8" width="3" height="4" rx="1" fill="currentColor"/>'
    '<rect x="5" y="5.5" width="3" height="6.5" rx="1" fill="currentColor"/>'
    '<rect x="10" y="3" width="3" height="9" rx="1" fill="currentColor"/>'
    '<rect x="15" y="0" width="3" height="12" rx="1" fill="currentColor"/></svg>'
    # wifi
    '<svg width="16" height="12" viewBox="0 0 16 12" fill="none" aria-hidden="true">'
    '<path d="M1 4.1a10.6 10.6 0 0 1 14 0" stroke="currentColor" stroke-width="1.9" stroke-linecap="round"/>'
    '<path d="M3.6 6.7a7 7 0 0 1 8.8 0" stroke="currentColor" stroke-width="1.9" stroke-linecap="round"/>'
    '<path d="M6.1 9.2a3.4 3.4 0 0 1 3.8 0" stroke="currentColor" stroke-width="1.9" stroke-linecap="round"/></svg>'
    # battery
    '<svg width="27" height="13" viewBox="0 0 27 13" fill="none" aria-hidden="true">'
    '<rect x="0.6" y="0.6" width="23" height="11.8" rx="3.6" stroke="currentColor" '
    'stroke-opacity="0.38" stroke-width="1.1"/>'
    '<rect x="2.3" y="2.3" width="19.6" height="8.4" rx="2.2" fill="currentColor"/>'
    '<path d="M25.2 4.3v4.4c.9-.3 1.4-.9 1.4-2.2s-.5-1.9-1.4-2.2Z" fill="currentColor" '
    'fill-opacity="0.45"/></svg>'
    "</div>"
)

CSS = """
*,*::before,*::after{box-sizing:border-box;margin:0;padding:0}
html,body{width:390px;height:844px;overflow:hidden;background:transparent}
body{
  font-family:-apple-system,BlinkMacSystemFont,"SF Pro Text","SF Pro Display","Helvetica Neue",Arial,sans-serif;
  -webkit-font-smoothing:antialiased;text-rendering:optimizeLegibility;
}
.phone{position:relative;width:390px;height:844px;background:var(--bg);color:var(--label)}
/* status bar */
.status{position:absolute;top:0;left:0;right:0;height:59px;display:flex;align-items:center;
  justify-content:space-between;padding:6px 27px 0;font-size:17px;line-height:22px;
  font-weight:600;letter-spacing:-0.2px;color:var(--label)}
.status-right{display:flex;align-items:center;gap:6px}
.home{position:absolute;bottom:8px;left:50%;transform:translateX(-50%);width:134px;height:5px;
  border-radius:3px;background:var(--home)}
/* content */
.body{position:absolute;left:0;right:0;top:59px;padding:0 16px}
.mark{display:block}
h1{font-size:34px;line-height:41px;font-weight:700;letter-spacing:-0.4px;color:var(--label)}
h2{font-size:28px;line-height:34px;font-weight:700;letter-spacing:-0.3px;color:var(--label)}
.sub{font-size:15px;line-height:20px;font-weight:400;color:var(--label3)}
.acct{font-size:15px;line-height:20px;font-weight:400;color:var(--label3);letter-spacing:-0.1px}
.lbl{font-size:13px;line-height:18px;font-weight:400;color:var(--label3)}
.lblrow{display:flex;align-items:baseline;justify-content:space-between}
.lblrow .ask{font-size:13px;line-height:18px;font-weight:500;color:var(--label2);letter-spacing:-0.05px}
.field{margin-top:8px;height:52px;border-radius:12px;background:var(--field);
  display:flex;align-items:center;gap:12px;padding:0 16px;
  font-size:17px;line-height:22px;letter-spacing:-0.2px;color:var(--label)}
.field .ph{color:var(--label4);letter-spacing:0.5px}
.field .dots{color:var(--label2);letter-spacing:1.6px;font-size:19px}
.field .grow{flex:1 1 auto;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.field .eye{color:var(--label3);display:flex;flex:0 0 auto;margin-right:-2px}
.btn{margin-top:0;height:52px;border-radius:12px;background:var(--brand);color:#fff;
  font-size:17px;line-height:22px;font-weight:600;letter-spacing:-0.2px;
  display:flex;align-items:center;justify-content:center}
.btn-2{height:44px;border-radius:12px;background:var(--fill2);color:var(--label);
  font-size:17px;line-height:22px;font-weight:600;letter-spacing:-0.2px;
  display:flex;align-items:center;justify-content:center}
.linkline{font-size:15px;line-height:20px;color:var(--label3)}
.linkline b{font-weight:600;color:var(--label)}
.linkline-sm{font-size:13px;line-height:18px;color:var(--label3)}
.linkline-sm b{font-weight:600;color:var(--label)}
.hdr{display:flex;align-items:center;gap:7px;font-size:17px;line-height:22px;
  font-weight:600;letter-spacing:-0.2px;color:var(--label)}
.hdr .chev{color:var(--label2);display:flex;margin-left:-2px}
.acct-lg{font-size:20px;line-height:25px;font-weight:600;letter-spacing:-0.3px;color:var(--label)}
.divider{height:0.5px;background:var(--sep);margin:0 0}
.foot{position:absolute;left:16px;right:16px;bottom:42px}
.txtbtn{height:44px;display:flex;align-items:center;justify-content:center;
  font-size:17px;line-height:22px;font-weight:500;letter-spacing:-0.2px;color:var(--label2)}
"""

LIGHT = """
  --bg:#F2F2F7; --field:#FFFFFF; --label:#000000;
  --label2:rgba(60,60,67,0.85); --label3:rgba(60,60,67,0.60); --label4:rgba(60,60,67,0.30);
  --sep:rgba(60,60,67,0.18); --fill2:rgba(120,120,128,0.16); --brand:#FF6B45;
  --home:rgba(0,0,0,0.85);
"""
DARK = """
  --bg:#000000; --field:#1C1C1E; --label:#FFFFFF;
  --label2:rgba(235,235,245,0.85); --label3:rgba(235,235,245,0.60); --label4:rgba(235,235,245,0.30);
  --sep:rgba(84,84,88,0.65); --fill2:rgba(120,120,128,0.32); --brand:#FF8060;
  --home:rgba(255,255,255,0.85);
"""


def page(body_html, foot_html="", dark=False, ax=False):
    theme = DARK if dark else LIGHT
    ax_cls = " ax3" if ax else ""
    return f"""<!doctype html>
<html lang="vi"><head><meta charset="utf-8"><title>Warrly login mockup</title>
<style>{CSS}
:root{{{theme}}}
{"" if not ax else AX_CSS}
</style></head>
<body><div class="phone{ax_cls}">
  <div class="status"><span class="time">9:41</span>{STATUS_RIGHT}</div>
  <div class="body">{body_html}</div>
  {foot_html}
  <div class="home"></div>
</div></body></html>
"""


# The AX3 frame is not a font-size-only change: SwiftUI scales text, not the
# 16 pt gutter. These are the AX3 (Largest) sizes for the roles in play.
AX_CSS = """
.ax3 h1{font-size:46px;line-height:54px;letter-spacing:-0.6px}
.ax3 h2{font-size:38px;line-height:45px}
.ax3 .sub,.ax3 .acct,.ax3 .linkline{font-size:27px;line-height:34px}
.ax3 .lbl,.ax3 .lblrow .ask,.ax3 .linkline-sm{font-size:23px;line-height:29px}
.ax3 .field{height:78px;font-size:33px;line-height:38px;border-radius:16px;padding:0 18px;margin-top:9px}
.ax3 .btn{height:78px;font-size:33px;line-height:38px;border-radius:16px}
.ax3 .btn-2{height:70px;font-size:33px;line-height:38px}
.ax3 .acct-lg{font-size:30px;line-height:37px}
.ax3 .hdr{font-size:27px;line-height:34px}
"""


# ── the frames ─────────────────────────────────────────────────────────────

def d1():
    """Direction 1 — Tờ giấy / The Ledger."""
    return f"""
<div style="padding-top:32px">{mark(28, "var(--brand)")}</div>
<div style="height:32px"></div>
<h1>Đăng nhập</h1>
<div style="height:24px"></div>
<div class="lbl">Email</div>
<div class="field"><span class="grow">typeqa@warrly.test</span></div>
<div style="height:12px"></div>
<div class="lblrow"><span class="lbl">Mật khẩu</span><span class="ask">Quên mật khẩu?</span></div>
<div class="field"><span class="grow dots">••••••••</span><span class="eye">{EYE}</span></div>
<div style="height:24px"></div>
<div class="btn">Đăng nhập</div>
"""


def d2():
    """Direction 2 — Người quen / The Regular."""
    return f"""
<div style="padding-top:32px">{mark(28, "var(--brand)")}</div>
<div style="height:32px"></div>
<h2>Chào mừng quay lại</h2>
<div style="height:8px"></div>
<div class="acct">typeqa@warrly.test · iPhone này</div>
<div style="height:32px"></div>
<div class="btn">Đăng nhập bằng Face ID</div>
<div style="height:8px"></div>
<div class="txtbtn">Dùng mật khẩu</div>
"""


def d3_step1():
    """Direction 3 — Hai nhịp / Two Beats, first beat."""
    return f"""
<div style="padding-top:32px"><h1>Đăng nhập</h1></div>
<div style="height:8px"></div>
<div class="sub">Dùng email của tài khoản.</div>
<div style="height:28px"></div>
<div class="lbl">Email</div>
<div class="field"><span class="grow">typeqa@warrly.test</span></div>
<div style="height:24px"></div>
<div class="btn">Tiếp tục</div>
"""


def d3_step2():
    """Direction 3 — Hai nhịp / Two Beats, second beat."""
    return f"""
<div style="padding-top:12px"><div class="hdr"><span class="chev">{CHEVRON}</span>Đăng nhập</div></div>
<div style="height:28px"></div>
<div class="acct-lg">typeqa@warrly.test</div>
<div style="height:28px"></div>
<div class="lblrow"><span class="lbl">Mật khẩu</span><span class="ask">Quên mật khẩu?</span></div>
<div class="field"><span class="grow dots">••••••••</span><span class="eye">{EYE}</span></div>
<div style="height:24px"></div>
<div class="btn">Đăng nhập</div>
"""


FOOT_REGISTER = '<div class="foot"><div class="linkline">Chưa có tài khoản? <b>Tạo tài khoản</b></div></div>'
FOOT_REGISTER_SM = '<div class="foot"><div class="linkline-sm">Chưa có tài khoản? <b>Tạo tài khoản</b></div></div>'
FOOT_SWITCH = '<div class="foot"><div class="linkline-sm">Không phải bạn? <b>Đổi tài khoản</b></div></div>'

FRAMES_OUT = [
    ("d1-light", d1, FOOT_REGISTER, False, False, "1 · Tờ giấy — light"),
    ("d1-dark", d1, FOOT_REGISTER, True, False, "1 · Tờ giấy — dark"),
    ("d2-light", d2, FOOT_SWITCH, False, False, "2 · Người quen — light"),
    ("d2-dark", d2, FOOT_SWITCH, True, False, "2 · Người quen — dark"),
    ("d3a-light", d3_step1, FOOT_REGISTER_SM, False, False, "3 · Hai nhịp, bước 1 — light"),
    ("d3a-dark", d3_step1, FOOT_REGISTER_SM, True, False, "3 · Hai nhịp, bước 1 — dark"),
    ("d3b-light", d3_step2, "", False, False, "3 · Hai nhịp, bước 2 — light"),
    ("d3b-dark", d3_step2, "", True, False, "3 · Hai nhịp, bước 2 — dark"),
    ("d1-ax3-light", d1, FOOT_REGISTER, False, True, "1 · Tờ giấy — AX3"),
]


def main():
    os.makedirs(FRAMES, exist_ok=True)
    for name, fn, foot, dark, ax, _label in FRAMES_OUT:
        html = page(fn(), foot, dark, ax)
        with open(os.path.join(FRAMES, name + ".html"), "w", encoding="utf-8") as fh:
            fh.write(html)

    # A gallery the owner can open in a browser without the screenshot step.
    cards = []
    for name, _fn, _foot, _dark, _ax, label in FRAMES_OUT:
        cards.append(
            f'<figure><img src="{name}.png" width="390" height="844" alt="{label}">'
            f"<figcaption>{label}</figcaption></figure>"
        )
    # A mark-geometry strip: the two drawn cuts at the sizes brand.ts assigns
    # them, rendered from the same strings the frames use. Nothing in the three
    # directions is below 24 pt, so the small cut appears only here — it is proof
    # that the renderer picks per size instead of scaling one drawing.
    strip = (
        '<div class="strip">'
        + "".join(
            f'<figure>{mark(w, "#FF6B45")}'
            f"<figcaption>{w} pt · {('full' if w >= 24 else 'small')} cut</figcaption></figure>"
            for w in (20, 28, 64)
        )
        + "</div>"
    )

    gallery = f"""<!doctype html><html lang="vi"><head><meta charset="utf-8">
<title>Warrly — login redesign mockups</title>
<style>
body{{margin:0;padding:40px;background:#0B0B0C;color:#EDEDED;
  font-family:-apple-system,BlinkMacSystemFont,"SF Pro Text",Helvetica,Arial,sans-serif}}
h1{{font-size:22px;font-weight:650;margin:0 0 6px}}
h2{{font-size:14px;font-weight:600;margin:0 0 16px;color:#C7C7CC;letter-spacing:.2px}}
p{{font-size:14px;line-height:21px;color:#A9A9AE;max-width:760px;margin:0 0 32px}}
.grid{{display:flex;flex-wrap:wrap;gap:32px}}
figure{{margin:0}}
img{{display:block;border-radius:18px;box-shadow:0 18px 60px rgba(0,0,0,.55)}}
figcaption{{font-size:12px;color:#8E8E93;margin-top:10px;letter-spacing:.2px}}
.strip{{display:flex;gap:48px;align-items:flex-end;margin:0 0 44px;padding:24px 28px;
  background:#161617;border-radius:14px;width:max-content}}
.strip figure{{display:flex;flex-direction:column;align-items:flex-start}}
.strip figcaption{{margin-top:12px}}
</style></head><body>
<h1>Warrly iOS — login, three directions</h1>
<p>390 × 844 pt, rendered from the same tokens as the app
(<code>Theme.swift</code>) and the real mark geometry from
<code>website/src/lib/brand.ts</code>. Vietnamese copy because the app is
bilingual and Vietnamese strings are the longer ones.</p>
<h2>Mark geometry — both drawn cuts</h2>
{strip}
<div class="grid">{"".join(cards)}</div>
</body></html>"""
    with open(os.path.join(HERE, "gallery.html"), "w", encoding="utf-8") as fh:
        fh.write(gallery)
    print(f"wrote {len(FRAMES_OUT)} frames to {FRAMES}")


if __name__ == "__main__":
    main()

"""Compose the BIM2BEM promo video from the frames written by video/capture.mjs.

    python video/compose.py --ffmpeg path/to/ffmpeg --out path/to/BIM2BEM.mp4

Needs Pillow and numpy. Writes the MP4 (1920x1080, 30 fps, H.264) and a thumbnail PNG
next to it. Intermediate files live in video/_work (git-ignored).
"""
import argparse, json, math, subprocess, sys
from pathlib import Path
import numpy as np
from PIL import Image, ImageDraw, ImageFilter, ImageFont

ROOT = Path(__file__).resolve().parent.parent
FR = ROOT / 'video/_work/frames'
W, H, FPS = 1920, 1080, 30
SX, SY, SW, SH = 160, 30, 1600, 900          # where the app screen sits in the frame
XF = 0.3                                      # crossfade, seconds
NAVY, NAVY2, ACCENT, GREEN, WHITE = (9, 22, 38), (16, 38, 66), (106, 168, 255), (92, 184, 72), (255, 255, 255)
FONT_DIR = Path('C:/Windows/Fonts')
def font(name, size): return ImageFont.truetype(str(FONT_DIR / name), size)
F_KICK, F_TITLE, F_SMALL = font('seguisb.ttf', 22), font('segoeuib.ttf', 40), font('segoeui.ttf', 22)
META = json.loads((FR / 'meta.json').read_text())

# ---------------------------------------------------------------------------
# Timeline. src: still name, or a sequence directory; zoom: target rect (x, y, w) in source
# pixels (1920x1080, height follows 16:9); cap: (kicker, title) shown under the screen.
# ---------------------------------------------------------------------------
FULL = (0, 0, 1920)
def R(x, y, w): return (x, y, w)

TIMELINE = [
    # Thumbnail / hook: the tower coloured by simulated heating demand, with the app's charts.
    dict(kind='hero', src='hero_orbit', dur=4.5, reverse=True),
    # The results first
    dict(src='14_dock_energy', dur=2.3, zoom=R(490, 440, 1100), cap=('THE RESULT', 'Monthly heating, cooling and electricity')),
    dict(src='19_cooling_orbit', dur=2.3, cap=('THE RESULT', 'Cooling demand mapped onto all 104 rooms')),
    dict(src='14_dock_hourly_loads', dur=2.1, zoom=R(490, 440, 1100), cap=('THE RESULT', '8,760 hourly loads from EnergyPlus')),
    dict(src='16_env', dur=2.1, zoom=R(0, 230, 1500), cap=('THE RESULT', 'Site climate: wind rose and temperatures')),
    # How it works, from the IFC to the report
    dict(kind='chapter', dur=1.8),
    dict(src='01_start', dur=2.4, click=True, cap=('STEP 1 · BIM', 'Open an IFC file, or try the demo tower')),
    dict(src='03_bim_orbit', dur=2.6, cap=('STEP 1 · BIM', 'Parsed in the browser: architecture, structure, MEP')),
    dict(src='04_location', dur=1.8, click=True, cap=('STEP 2 · SITE', 'Location read from IfcSite')),
    dict(src='05_location_confirm', dur=1.5, click=True, cap=('STEP 2 · SITE', 'Location read from IfcSite')),
    dict(src='06b_weather_data', dur=2.1, zoom=R(0, 70, 1100), cap=('STEP 2 · SITE', 'Weather data fetched automatically (ERA5)')),
    dict(src='07_bem_build', dur=1.8, click=True, cap=('STEP 3 · BIM → BEM', 'One click builds the energy model')),
    dict(src='08_bem_orbit', dur=2.5, cap=('STEP 3 · BIM → BEM', '104 zones, 1,032 surfaces, 351 interzone pairs')),
    dict(src='09_sim_run', dur=1.7, click=True, cap=('STEP 4 · SIMULATE', 'EnergyPlus runs in your browser (WebAssembly)')),
    dict(src='11_sim_done', dur=1.6, zoom=R(700, 384, 1220), cap=('STEP 4 · SIMULATE', 'A full year, 8,760 hours, simulated on your machine')),
    dict(src='12_results', dur=1.8, cap=('STEP 5 · ANALYSE', 'Energy demand and peaks per zone')),
    dict(src='13_display_heating', dur=1.3, cap=('STEP 5 · ANALYSE', 'Results painted onto the 3D model')),
    dict(src='13_display_cooling', dur=1.3, cap=('STEP 5 · ANALYSE', 'Results painted onto the 3D model')),
    dict(src='13_display_co2', dur=1.3, cap=('STEP 5 · ANALYSE', 'Results painted onto the 3D model')),
    dict(src='15_ieq', dur=1.7, cap=('STEP 5 · ANALYSE', 'Indoor environmental quality: PMV/PPD, CO₂, daylight')),
    dict(src='17_reports', dur=2.1, zoom=R(0, 70, 1300), cap=('STEP 6 · REPORT', 'Export IDF, epJSON, CSV and a PDF report')),
    dict(kind='end', dur=4.0),
]

# ---------------------------------------------------------------------------
_cache = {}
def img(path):
    if path not in _cache:
        _cache[path] = Image.open(path).convert('RGB')
    return _cache[path]

def source(clip, t):
    """Source frame for a clip at local time t."""
    src = clip['src']
    if (FR / src).is_dir():
        files = sorted((FR / src).glob('*.jpg'))
        # play the sequence over the clip, never faster than real time
        n = len(files)
        i = min(n - 1, int(t / clip['dur'] * n)) if n / FPS < clip['dur'] else min(n - 1, int(t * FPS))
        return img(files[n - 1 - i] if clip.get('reverse') else files[i])
    return img(FR / f'{src}.jpg')

def ease(x): x = max(0.0, min(1.0, x)); return 4 * x ** 3 if x < 0.5 else 1 - (-2 * x + 2) ** 3 / 2
def lerp(a, b, k): return a + (b - a) * k

def view_rect(clip, t):
    """Crop rect in source pixels: an eased move to the zoom target, or a slow push-in."""
    k = t / clip['dur']
    if clip.get('zoom'):
        x1, y1, w1 = clip['zoom']
        kk = ease(min(1, k / 0.55))
        x, y, w = lerp(0, x1, kk), lerp(0, y1, kk), lerp(1920, w1, kk)
    else:
        w = 1920 * lerp(1.0, 0.965, k)
        x, y = (1920 - w) / 2, (1080 - w * 9 / 16) / 2
    return (x, y, x + w, y + w * 9 / 16)

# Static layers ---------------------------------------------------------------
def make_bg():
    y = np.linspace(0, 1, H)[:, None]; x = np.linspace(0, 1, W)[None, :]
    a = np.array(NAVY, float); b = np.array(NAVY2, float)
    k = np.clip(0.65 * y + 0.35 * x, 0, 1)[..., None]
    arr = a * (1 - k) + b * k
    glow = np.exp(-(((x - 0.85) / 0.35) ** 2 + ((y - 0.05) / 0.4) ** 2))[..., None]
    arr = arr + glow * np.array([20, 40, 80])
    return Image.fromarray(np.clip(arr, 0, 255).astype(np.uint8))

def rounded_mask(w, h, r):
    m = Image.new('L', (w, h), 0); ImageDraw.Draw(m).rounded_rectangle((0, 0, w - 1, h - 1), r, fill=255); return m

BG = make_bg()
SCREEN_MASK = rounded_mask(SW, SH, 14)
SHADOW = Image.new('L', (W, H), 0)
ImageDraw.Draw(SHADOW).rounded_rectangle((SX - 4, SY + 10, SX + SW + 4, SY + SH + 18), 18, fill=150)
SHADOW = SHADOW.filter(ImageFilter.GaussianBlur(22))
BG_SHADOW = Image.composite(Image.new('RGB', (W, H), (0, 0, 0)), BG, SHADOW)
LOGO = Image.open(ROOT / 'assets/logos/bim2bem-logo.png').convert('RGBA')
ICON = Image.open(ROOT / 'assets/logos/bim2bem-icon.png').convert('RGBA')

def brand_badge(frame):
    """Small icon + site address bottom-right, on every screen frame."""
    d = ImageDraw.Draw(frame)
    ic = ICON.resize((44, 44), Image.LANCZOS)
    url = 'isaddiq.github.io/BIM2BEM'
    tw = d.textlength(url, font=F_SMALL)
    x = SX + SW - tw - 56; y = SY + SH + 50
    frame.paste(ic, (int(x), y - 2), ic)
    d.text((x + 54, y + 7), url, font=F_SMALL, fill=(190, 205, 222))

# Cursor ------------------------------------------------------------------------
CURSOR = [(0, 0), (0, 34), (9, 26), (15, 40), (21, 37), (15, 24), (26, 24)]
def draw_cursor(frame, x, y, press):
    layer = Image.new('RGBA', frame.size, (0, 0, 0, 0)); d = ImageDraw.Draw(layer)
    if press > 0:  # click ripple
        r = 14 + 46 * press; a = int(200 * (1 - press))
        d.ellipse((x - r, y - r, x + r, y + r), outline=(31, 95, 191, a), width=5)
        d.ellipse((x - 16, y - 16, x + 16, y + 16), fill=(31, 95, 191, int(90 * (1 - press))))
    s = 1.15
    pts = [(x + px * s, y + py * s) for px, py in CURSOR]
    d.polygon([(px + 2, py + 3) for px, py in pts], fill=(0, 0, 0, 90))
    d.polygon(pts, fill=(255, 255, 255, 255), outline=(15, 25, 40, 255), width=2)
    frame.alpha_composite(layer) if frame.mode == 'RGBA' else frame.paste(layer, (0, 0), layer)

def screen_frame(clip, t):
    frame = BG_SHADOW.copy()
    src = source(clip, t)
    rect = view_rect(clip, t)
    scr = src.resize((SW, SH), Image.LANCZOS, box=rect)
    frame.paste(scr, (SX, SY), SCREEN_MASK)
    brand_badge(frame)
    if clip.get('click') and META.get(clip['src'], {}).get('click'):
        bx, by, bw, bh = META[clip['src']]['click']
        cx, cy = bx + bw / 2, by + bh / 2
        sx = SX + (cx - rect[0]) / (rect[2] - rect[0]) * SW
        sy = SY + (cy - rect[1]) / (rect[3] - rect[1]) * SH
        k = t / clip['dur']
        m = ease(min(1, k / 0.55))
        x, y = lerp(sx + 260, sx, m), lerp(sy + 190, sy, m)
        press = (k - 0.6) / 0.3 if 0.6 <= k <= 0.9 else 0
        draw_cursor(frame, x, y, press)
    return frame

# Captions --------------------------------------------------------------------------
def draw_caption(frame, kicker, title, alpha, rise):
    layer = Image.new('RGBA', frame.size, (0, 0, 0, 0)); d = ImageDraw.Draw(layer)
    x, y = SX + 4, SY + SH + 28 + rise
    a = int(255 * alpha)
    d.rounded_rectangle((x, y + 4, x + 6, y + 82), 3, fill=(*GREEN, a))
    d.text((x + 24, y), kicker, font=F_KICK, fill=(*ACCENT, a))
    d.text((x + 22, y + 28), title, font=F_TITLE, fill=(*WHITE, a))
    frame.paste(layer, (0, 0), layer)

# Cards -----------------------------------------------------------------------------
HERO_BG = (16, 26, 36)   # the dark-theme viewer background, so the render blends in
def _hero_static():
    bg = np.zeros((H, W, 3), float); bg[:] = HERO_BG
    y = np.linspace(0, 1, H)[:, None]; x = np.linspace(0, 1, W)[None, :]
    glow = np.exp(-(((x - 0.52) / 0.3) ** 2 + ((y - 0.5) / 0.45) ** 2))[..., None]
    bg = bg + glow * np.array([6, 14, 28])
    base = Image.fromarray(np.clip(bg, 0, 255).astype(np.uint8))
    # soft mask for the render: fade every edge into the background
    rw, rh = 1300, int(1300 * 1476 / 1944)
    yy = np.linspace(-1, 1, rh)[:, None]; xx = np.linspace(-1, 1, rw)[None, :]
    m = np.clip((1 - np.maximum(np.abs(xx) ** 4, 0) ) * 1.6, 0, 1) * np.clip((1 - np.abs(yy) ** 4) * 1.6, 0, 1)
    mask = Image.fromarray((m * 255).astype(np.uint8))
    def card(name, scale):
        im = Image.open(FR / f'{name}.png').convert('RGBA')
        im = im.resize((int(im.width * scale), int(im.height * scale)), Image.LANCZOS)
        r = rounded_mask(im.width, im.height, 16)
        im.putalpha(Image.fromarray(np.minimum(np.array(im.getchannel('A')), np.array(r))))
        sh = Image.new('L', (im.width + 120, im.height + 120), 0)
        ImageDraw.Draw(sh).rounded_rectangle((60, 72, 60 + im.width, 72 + im.height), 18, fill=170)
        return im, sh.filter(ImageFilter.GaussianBlur(24))
    return base, mask, (rw, rh), card('hero_kpis', 1.0), card('hero_chart_monthly', 0.98)
HERO = None

def hero_frame(clip, t):
    """Opening frame and thumbnail: the tower coloured by results, the app's charts, the title."""
    global HERO
    if HERO is None: HERO = _hero_static()
    base, mask, (rw, rh), (kpi, kpi_sh), (chart, chart_sh) = HERO
    frame = base.copy()
    src = source(clip, t).resize((rw, rh), Image.LANCZOS)
    # model centre (≈ 0.53, 0.56 of the render at the opening angle) at x≈1015, y≈560
    ox, oy = int(1040 - 0.53 * rw), int(560 - 0.56 * rh)
    frame.paste(src, (ox, oy), mask)
    frame = frame.convert('RGBA')
    bob = math.sin(t * 1.6)
    for im, sh, (x, y) in ((kpi, kpi_sh, (1468, 92 + int(5 * bob))), (chart, chart_sh, (1372, 520 - int(5 * bob)))):
        frame.alpha_composite(Image.merge('RGBA', (*Image.new('RGB', sh.size, (0, 0, 0)).split(), sh)), (x - 60, y - 60))
        frame.alpha_composite(im, (x, y))
    d = ImageDraw.Draw(frame)
    ic = ICON.resize((84, 84), Image.LANCZOS)
    frame.alpha_composite(ic, (92, 222))
    d.text((192, 222), 'BIM2BEM', font=font('segoeuib.ttf', 66), fill=WHITE)
    f_h = font('segoeuib.ttf', 58)
    for i, line in enumerate(['From IFC model', 'to energy simulation,', 'in your browser.']):
        d.text((90, 352 + i * 72), line, font=f_h, fill=WHITE if i < 2 else ACCENT)
    x, y = 94, 600
    for c in ['IFC', 'EnergyPlus', 'Comfort & IEQ', 'Weather', 'Open source']:
        tw = d.textlength(c, font=F_KICK)
        if x + tw + 32 > 600: x, y = 94, y + 58
        d.rounded_rectangle((x, y, x + tw + 32, y + 44), 22, fill=(31, 95, 191))
        d.text((x + 16, y + 8), c, font=F_KICK, fill=WHITE)
        x += tw + 44
    d.text((94, y + 86), 'Seoul Exchange Tower · 104 rooms · EnergyPlus 26.2', font=F_SMALL, fill=(150, 168, 188))
    return frame.convert('RGB')

def chapter_frame(clip, t):
    frame = BG.copy(); d = ImageDraw.Draw(frame)
    k = ease(min(1, t / 0.45))
    steps = ['BIM', 'Site & weather', 'BIM → BEM', 'EnergyPlus', 'Results', 'Report']
    f_t = font('segoeuib.ttf', 68)
    title = 'How it works'
    d.text(((W - d.textlength(title, font=f_t)) / 2, 380 - 20 * (1 - k)), title, font=f_t, fill=WHITE)
    fs = font('seguisb.ttf', 30)
    widths = [d.textlength(s, font=fs) + 48 for s in steps]
    gap = 54; total = sum(widths) + gap * (len(steps) - 1)
    x = (W - total) / 2
    for i, (s, w) in enumerate(zip(steps, widths)):
        kk = ease(min(1, max(0, (t - 0.1 - i * 0.08) / 0.35)))
        y = 520 + 16 * (1 - kk)
        col = tuple(int(lerp(c0, c1, kk)) for c0, c1 in zip(NAVY2, (31, 95, 191)))
        d.rounded_rectangle((x, y, x + w, y + 64), 32, fill=col)
        d.text((x + 24, y + 12), s, font=fs, fill=WHITE)
        if i < len(steps) - 1:
            ax = x + w + 14
            d.line((ax, y + 32, ax + gap - 28, y + 32), fill=GREEN, width=4)
            d.polygon([(ax + gap - 26, y + 24), (ax + gap - 16, y + 32), (ax + gap - 26, y + 40)], fill=GREEN)
        x += w + gap
    return frame

def end_frame(clip, t):
    frame = Image.new('RGB', (W, H), (246, 248, 251)); d = ImageDraw.Draw(frame)
    k = ease(min(1, t / 0.6))
    lg = LOGO.resize((int(720 * 0.62), int(592 * 0.62)), Image.LANCZOS)
    frame.paste(lg, ((W - lg.width) // 2, int(150 + 20 * (1 - k))), lg)
    f1, f2, f3 = font('seguisb.ttf', 40), font('segoeui.ttf', 30), font('segoeuib.ttf', 40)
    lines = [('IFC → BEM → EnergyPlus → comfort and IEQ, all in the browser', f1, (18, 32, 46), 570),
             ('Free and open source · files never leave your machine', f2, (58, 73, 89), 632),
             ('isaddiq.github.io/BIM2BEM', f3, (31, 95, 191), 740)]
    for i, (s, f, c, y) in enumerate(lines):
        kk = ease(min(1, max(0, (t - 0.25 - i * 0.15) / 0.4)))
        col = tuple(int(lerp(246, cc, kk)) for cc in c)
        d.text(((W - d.textlength(s, font=f)) / 2, y + 12 * (1 - kk)), s, font=f, fill=col)
    tw = d.textlength(lines[2][0], font=f3)
    kk = ease(min(1, max(0, (t - 0.55) / 0.4)))
    d.rounded_rectangle(((W - tw) / 2 - 34, 728, (W + tw) / 2 + 34, 800), 36, outline=(31, 95, 191), width=int(1 + 2 * kk))
    return frame

RENDER = {'hero': hero_frame, 'chapter': chapter_frame, 'end': end_frame}
def render_clip(clip, t): return RENDER.get(clip.get('kind'), screen_frame)(clip, t)

# Timeline maths ---------------------------------------------------------------------
def layout():
    t = 0
    for i, c in enumerate(TIMELINE):
        c['start'] = t
        t += c['dur'] - (XF if i < len(TIMELINE) - 1 else 0)
    return t

def caption_segments():
    segs = []
    for i, c in enumerate(TIMELINE):
        cap = c.get('cap')
        end = c['start'] + c['dur'] - (XF / 2 if i < len(TIMELINE) - 1 else 0)
        if segs and segs[-1]['cap'] == cap and cap:
            segs[-1]['end'] = end
        else:
            segs.append(dict(cap=cap, start=c['start'] + (XF / 2 if i else 0), end=end))
    return [s for s in segs if s['cap']]

def frame_at(T, segs):
    active = [c for c in TIMELINE if c['start'] <= T < c['start'] + c['dur']]
    a = render_clip(active[0], T - active[0]['start'])
    if len(active) > 1:
        b = render_clip(active[1], T - active[1]['start'])
        a = Image.blend(a, b, ease((T - active[1]['start']) / XF))
    for s in segs:
        if s['start'] <= T < s['end']:
            kin = min(1, (T - s['start']) / 0.3); kout = min(1, (s['end'] - T) / 0.2)
            # the title cross-fades with the next segment when the kicker stays the same
            draw_caption(a, *s['cap'], alpha=ease(min(kin, kout)), rise=int(10 * (1 - ease(kin))))
    return a

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--ffmpeg', required=True); ap.add_argument('--out', required=True)
    ap.add_argument('--preview', type=float, nargs='*', help='write stills at these times instead of a video')
    args = ap.parse_args()
    missing = [c['src'] for c in TIMELINE if 'src' in c and not ((FR / c['src']).is_dir() or (FR / f"{c['src']}.jpg").exists())]
    if missing: sys.exit(f'missing frames: {missing}')
    total = layout(); segs = caption_segments()
    print(f'duration {total:.2f} s')
    out = Path(args.out)
    if args.preview is not None:
        pdir = ROOT / 'video/_work/preview'; pdir.mkdir(parents=True, exist_ok=True)
        for T in args.preview: frame_at(T, segs).save(pdir / f'{T:05.1f}.jpg', quality=90)
        return
    out.parent.mkdir(parents=True, exist_ok=True)
    thumb = frame_at(0, segs); thumb.save(out.with_name(out.stem + '-thumbnail.png'))
    n = int(round(total * FPS))
    cmd = [args.ffmpeg, '-y', '-loglevel', 'error', '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-s', f'{W}x{H}', '-r', str(FPS), '-i', '-',
           '-f', 'lavfi', '-i', 'anullsrc=channel_layout=stereo:sample_rate=48000',
           '-map', '0:v', '-map', '1:a', '-shortest',
           '-c:v', 'libx264', '-preset', 'slow', '-crf', '17', '-pix_fmt', 'yuv420p', '-profile:v', 'high', '-level', '4.1',
           '-c:a', 'aac', '-b:a', '128k', '-movflags', '+faststart', str(out)]
    p = subprocess.Popen(cmd, stdin=subprocess.PIPE)
    for i in range(n):
        p.stdin.write(frame_at(i / FPS, segs).tobytes())
        if i % 60 == 0: print(f'  frame {i}/{n}', flush=True)
    p.stdin.close(); p.wait()
    if p.returncode: sys.exit(p.returncode)
    print(f'wrote {out}')

if __name__ == '__main__':
    main()

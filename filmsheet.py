"""영상 -> 필름 컨택트 시트(아이폰 배경화면 사이즈) 생성기.

AI/API 호출 없이 OpenCV + Pillow + NumPy 만 사용합니다.

CLI 사용 예:
    python filmsheet.py my_video.mp4 -o sheet.png --rows 5 --preset 15promax
"""
from __future__ import annotations

import argparse
import math
import os
import random
from dataclasses import dataclass

import cv2
import numpy as np
from PIL import Image, ImageDraw, ImageFilter, ImageFont

# (width, height) — 아이폰 배경화면 해상도
PRESETS = {
    "15promax": (1290, 2796),  # 14 Pro Max / 15 Plus / 15 Pro Max 등
    "16promax": (1320, 2868),
    "16pro": (1206, 2622),
    "15": (1179, 2556),  # 14 Pro / 15 / 15 Pro
    "13": (1170, 2532),
    "se": (750, 1334),
    # 갤럭시
    "galaxy_s": (1080, 2340),  # S23 / S24 / S25 / S25 Edge 등
    "galaxy_ultra": (1440, 3120),  # S22~S25 Ultra
    "galaxy_a": (1080, 2400),  # A시리즈 / S20 / S21 등
    "galaxy_fold": (1812, 2176),  # Z Fold 내부 화면
    "galaxy_flip": (1080, 2640),  # Z Flip 내부 화면
}

BG = (255, 255, 255)  # 바깥 흰 배경
BASE = (200, 200, 199)  # 필름 베이스 회색 (네거티브)
BASE_DARK = (30, 30, 30)  # 필름 베이스 (반전 끄면 어두운 테두리)
HOLE = (236, 236, 235)  # 스프로킷 구멍
TEXT = (55, 55, 55)
TEXT_DARK = (225, 225, 225)

# 가로폭(W) 대비 비율 — 샘플 시트 비율을 따름
FRAME_W = 0.232
FRAME_H = FRAME_W * 2 / 3
PITCH = 0.245
STRIP_H = 0.228
STRIP_GAP = 0.032

# 행 패턴: (시작 위치 종류, 끝 위치 종류) — 샘플처럼 일부 스트립은 중간에서 끝나거나 시작
ROW_PATTERNS = ["full", "full", "full", "short_end", "short_start"]

_FONT_CANDIDATES = [
    "/System/Library/Fonts/Helvetica.ttc",
    "/System/Library/Fonts/Supplemental/Arial.ttf",
    "C:/Windows/Fonts/arial.ttf",
    "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
    "/usr/share/fonts/opentype/inter/InterDisplay-Medium.otf",
]


def _font(size: int) -> ImageFont.ImageFont:
    for p in _FONT_CANDIDATES:
        if os.path.exists(p):
            try:
                return ImageFont.truetype(p, size)
            except OSError:
                pass
    try:
        return ImageFont.load_default(size)
    except TypeError:  # 아주 오래된 Pillow
        return ImageFont.load_default()


@dataclass
class RowPlan:
    pattern: str
    x0: float  # 스트립 왼쪽 끝 x (캔버스 기준, px)
    x1: float  # 스트립 오른쪽 끝 x
    first_frame_x: float  # 첫 프레임 왼쪽 x
    n_frames: int
    angle: float


def plan_rows(W: int, rows: int, rng: random.Random) -> list[RowPlan]:
    pitch = PITCH * W
    plans: list[RowPlan] = []
    for r in range(rows):
        pattern = ROW_PATTERNS[r % len(ROW_PATTERNS)]
        x0 = -rng.uniform(0.05, 0.9) * pitch - 0.1 * W
        x1 = W + rng.uniform(0.05, 0.6) * pitch + 0.1 * W
        if pattern == "short_end":
            x1 = W * rng.uniform(0.62, 0.78)
        elif pattern == "short_start":
            x0 = W * rng.uniform(0.12, 0.2)
        # 필름 양끝에 프레임이 반쯤 잘려 보이도록 첫 프레임 위치 결정
        first = x0 + 0.03 * W if pattern != "full" else x0 + rng.uniform(-0.15, 0.1) * pitch
        n = max(1, int(math.ceil((x1 - first) / pitch)))
        plans.append(RowPlan(pattern, x0, x1, first, n, rng.uniform(-0.55, 0.6)))
    return plans


def extract_frames(video_path: str, n: int, interval: float | None = None):
    """영상 길이(초)를 기준으로 시간 간격을 계산해 n개의 프레임(BGR)을 뽑는다.

    - interval 이 None  : 간격 = 영상 길이 / n  (영상 전체를 균등하게 커버)
    - interval(초) 지정 : 그 간격으로 뽑되, 영상 길이를 넘으면 자동 간격으로 대체
    반환: (프레임 리스트, 실제 사용한 정보 dict)
    """
    cap = cv2.VideoCapture(video_path)
    if not cap.isOpened():
        raise ValueError("영상을 열 수 없습니다.")
    fps = cap.get(cv2.CAP_PROP_FPS) or 0
    total = int(cap.get(cv2.CAP_PROP_FRAME_COUNT) or 0)
    if fps <= 0 or total <= 0:  # 메타데이터가 없으면 직접 센다
        frames_all = []
        while True:
            ok, f = cap.read()
            if not ok:
                break
            frames_all.append(cv2.resize(f, None, fx=0.5, fy=0.5) if f.shape[1] > 1920 else f)
        cap.release()
        if not frames_all:
            raise ValueError("영상에서 프레임을 읽지 못했습니다.")
        fps = fps if fps > 0 else 30.0
        total = len(frames_all)
        read = lambda idx: frames_all[min(idx, total - 1)]
    else:
        def read(idx):
            cap.set(cv2.CAP_PROP_POS_FRAMES, min(idx, total - 1))
            ok, f = cap.read()
            return f if ok else None

    duration = total / fps
    auto = duration / n
    note = ""
    if interval and interval > 0:
        if interval * n <= duration:
            step = interval
            start = (duration - step * (n - 1)) / 2  # 남는 시간은 앞뒤로 균등 배분
            times = [start + i * step for i in range(n)]
        else:
            step = auto
            note = f"요청한 간격({interval:g}초)×{n}장이 영상 길이({duration:.1f}초)보다 길어 자동 간격으로 바꿨어요."
            times = [(i + 0.5) * step for i in range(n)]
    else:
        step = auto
        times = [(i + 0.5) * step for i in range(n)]

    frames = []
    for t in times:
        f = read(int(round(t * fps)))
        if f is None and frames:
            f = frames[-1]
        if f is not None:
            frames.append(f)
    cap.release()
    if not frames:
        raise ValueError("영상에서 프레임을 읽지 못했습니다.")
    while len(frames) < n:
        frames.append(frames[-1])
    info = {"duration": duration, "interval": step, "frames": n, "note": note}
    return frames[:n], info


def make_frame_image(bgr: np.ndarray, fw: int, fh: int, invert: bool, grayscale: bool,
                     rng: np.random.Generator, py: random.Random) -> Image.Image:
    """영상 프레임 하나를 필름 한 컷 느낌(3:2, 네거티브, 그레인, 먼지)으로 가공."""
    h, w = bgr.shape[:2]
    target = fw / fh
    if w / h > target:  # 가로가 넓으면 좌우 크롭
        nw = int(h * target)
        x = (w - nw) // 2
        bgr = bgr[:, x:x + nw]
    else:
        nh = int(w / target)
        y = (h - nh) // 2
        bgr = bgr[y:y + nh]
    img = cv2.resize(bgr, (fw, fh), interpolation=cv2.INTER_AREA)
    if grayscale:
        img = cv2.cvtColor(cv2.cvtColor(img, cv2.COLOR_BGR2GRAY), cv2.COLOR_GRAY2BGR)
    img = img.astype(np.float32)
    # 대비 늘리기 + 살짝 소프트하게
    lo, hi = np.percentile(img, (1, 99))
    img = np.clip((img - lo) / max(hi - lo, 1) * 255, 0, 255)
    img = cv2.GaussianBlur(img, (0, 0), max(0.6, fw / 600))
    img = np.clip(img, 0, 255)
    if invert:
        img = 255 - img
    # 하이키 느낌(밝게) + 그레인
    img = 255 * (img / 255) ** 0.8
    img += rng.normal(0, 5.5, img.shape[:2])[..., None]
    # 비네팅
    yy, xx = np.mgrid[0:fh, 0:fw]
    d = np.sqrt(((xx - fw / 2) / (fw / 2)) ** 2 + ((yy - fh / 2) / (fh / 2)) ** 2)
    img *= (1 - 0.12 * np.clip(d - 0.4, 0, 1))[..., None]
    out = Image.fromarray(np.clip(img, 0, 255).astype(np.uint8)[..., ::-1])  # BGR->RGB
    # 먼지/스크래치
    dr = ImageDraw.Draw(out)
    for _ in range(py.randint(3, 9)):
        r = py.choice([1, 1, 2])
        x, y = py.randint(0, fw - 1), py.randint(0, fh - 1)
        c = py.choice([(15, 15, 15), (255, 255, 255)])
        dr.ellipse([x - r, y - r, x + r, y + r], fill=c)
    if py.random() < 0.25:
        x = py.randint(0, fw - 1)
        y0 = py.randint(0, fh // 3)
        dr.line([x, y0, x + py.randint(-2, 2), y0 + py.randint(fh // 3, fh)],
                fill=py.choice([(250, 250, 250), (40, 40, 40)]), width=1)
    return out


def build_strip(frames: list[Image.Image], plan: RowPlan, W: int, start_number: int,
                py: random.Random, dark: bool = False) -> Image.Image:
    """스트립 한 줄(RGBA)을 그린다. 좌표는 스트립 레이어 기준."""
    pitch = PITCH * W
    fw, fh = frames[0].size
    sh = int(STRIP_H * W)
    sw = int(plan.x1 - plan.x0)
    base = BASE_DARK if dark else BASE
    text_color = TEXT_DARK if dark else TEXT
    strip = Image.new("RGBA", (sw, sh), base + (255,))
    # 베이스에 은은한 노이즈 / 세로 그라데이션
    arr = np.asarray(strip).astype(np.float32)
    arr[..., :3] += np.random.default_rng(py.randint(0, 10**6)).normal(0, 2.0, (sh, sw, 1))
    grad = np.linspace(-6, 6, sh)[:, None, None]
    arr[..., :3] += grad
    strip = Image.fromarray(np.clip(arr, 0, 255).astype(np.uint8), "RGBA")
    dr = ImageDraw.Draw(strip)

    # 스프로킷 구멍
    hole_w, hole_h = int(0.0165 * W), int(0.0115 * W)
    hole_pitch = 0.0218 * W
    band = (sh - fh) / 2  # 프레임 위/아래 띠 높이
    ys = [band * 0.28, sh - band * 0.28 - hole_h]
    holes = Image.new("RGBA", (sw, sh), (0, 0, 0, 0))
    hd = ImageDraw.Draw(holes)
    x = hole_pitch * 0.5
    while x < sw:
        for y in ys:
            hd.rounded_rectangle([x, y, x + hole_w, y + hole_h], radius=hole_h * 0.38, fill=HOLE + (255,))
        x += hole_pitch
    holes = holes.filter(ImageFilter.GaussianBlur(max(1, W / 1300)))
    strip.alpha_composite(holes)
    dr = ImageDraw.Draw(strip)

    # 프레임 + 번호
    font = _font(max(10, int(0.0098 * W)))
    top_y = int(band)
    for i, fimg in enumerate(frames):
        fx = int(plan.first_frame_x - plan.x0 + i * pitch)
        # 프레임 바깥으로 삐져나가는 부분은 paste가 자동으로 잘라줌
        strip.paste(fimg.convert("RGBA"), (fx, top_y))
        num = start_number + i
        ty = int(top_y - 0.0125 * W)
        dr.text((fx + 0.008 * W, ty), str(num), fill=text_color, font=font)
        dr.text((fx + 0.133 * W, ty), f"{num}A", fill=text_color, font=font)
        if i % 4 == 0:
            dr.text((fx + 0.05 * W, top_y + fh + 0.002 * W), "SAFETY FILM", fill=text_color, font=font)
    return strip


def shadowed(strip: Image.Image, W: int, dark: bool = False) -> Image.Image:
    pad = int(0.03 * W)
    w, h = strip.size
    out = Image.new("RGBA", (w + pad * 2, h + pad * 2), (0, 0, 0, 0))
    mask = Image.new("L", out.size, 0)
    ImageDraw.Draw(mask).rectangle([pad, pad + int(0.004 * W), pad + w, pad + h + int(0.004 * W)], fill=95)
    mask = mask.filter(ImageFilter.GaussianBlur(W / 220))
    shadow = Image.new("RGBA", out.size, (0, 0, 0, 255))
    shadow.putalpha(mask)
    out.alpha_composite(shadow)
    out.alpha_composite(strip, (pad, pad))
    # 가장자리 얇은 밝은 선
    ImageDraw.Draw(out).rectangle([pad, pad, pad + w - 1, pad + h - 1], outline=(70, 70, 70, 255) if dark else (222, 222, 221, 255))
    return out


def render_sheet(video_path: str, size=(1290, 2796), rows: int = 5, invert: bool = True,
                 grayscale: bool = True, seed: int = 7, interval: float | None = None):
    W, H = size
    py = random.Random(seed)
    nrng = np.random.default_rng(seed)
    plans = plan_rows(W, rows, py)

    # 레이아웃이 화면 높이를 넘지 않게 행 수 제한
    strip_h, gap = STRIP_H * W, STRIP_GAP * W
    max_rows = max(1, int((H * 0.92 + gap) // (strip_h + gap)))
    if rows > max_rows:
        raise ValueError(f"이 해상도에서는 줄 수를 최대 {max_rows}까지 쓸 수 있어요.")

    total = sum(p.n_frames for p in plans)
    raw, info = extract_frames(video_path, total, interval)
    fw, fh = int(FRAME_W * W), int(FRAME_H * W)

    canvas = Image.new("RGBA", (W, H), BG + (255,))
    total_h = rows * strip_h + (rows - 1) * gap
    margin = (H - total_h) / 2
    y = margin + max(0.0, min(0.05 * H, margin - 0.02 * H))  # 살짝 아래로 내림(화면 밖으로는 안 나가게)
    n = 0
    for plan in plans:
        imgs = [make_frame_image(raw[n + i], fw, fh, invert, grayscale, nrng, py)
                for i in range(plan.n_frames)]
        strip = build_strip(imgs, plan, W, n + 1, py, dark=not invert)
        layer = shadowed(strip, W, dark=not invert).rotate(plan.angle, resample=Image.BICUBIC, expand=True)
        cx = plan.x0 + strip.width / 2
        cy = y + strip_h / 2
        _paste_clipped(canvas, layer, int(cx - layer.width / 2), int(cy - layer.height / 2))
        n += plan.n_frames
        y += strip_h + gap
    return canvas.convert("RGB"), info


def _paste_clipped(canvas: Image.Image, layer: Image.Image, x: int, y: int) -> None:
    """음수 좌표(화면 밖으로 나가는 스트립)도 안전하게 합성."""
    cw, ch = canvas.size
    sx, sy = max(0, -x), max(0, -y)
    dx, dy = max(0, x), max(0, y)
    w = min(layer.width - sx, cw - dx)
    h = min(layer.height - sy, ch - dy)
    if w <= 0 or h <= 0:
        return
    canvas.alpha_composite(layer.crop((sx, sy, sx + w, sy + h)), (dx, dy))


def main() -> None:
    ap = argparse.ArgumentParser(description="영상 -> 필름 시트(아이폰 배경화면)")
    ap.add_argument("video")
    ap.add_argument("-o", "--output", default="film_sheet.png")
    ap.add_argument("--preset", choices=PRESETS.keys(), default="15promax")
    ap.add_argument("--rows", type=int, default=5)
    ap.add_argument("--seed", type=int, default=7)
    ap.add_argument("--interval", type=float, default=None, help="프레임 간격(초). 생략하면 영상 길이/장수로 자동 계산")
    ap.add_argument("--positive", action="store_true", help="네거티브 반전 끄기")
    ap.add_argument("--color", action="store_true", help="흑백 대신 컬러")
    a = ap.parse_args()
    img, info = render_sheet(a.video, PRESETS[a.preset], a.rows, not a.positive, not a.color, a.seed, a.interval)
    img.save(a.output)
    print(f"saved {a.output} {img.size}")
    print(f"영상 {info['duration']:.1f}초 / {info['frames']}장 / 간격 {info['interval']:.2f}초 {info['note']}")


if __name__ == "__main__":
    main()

// 영상 -> 필름 시트 (브라우저 전용). 서버/AI 없이 Canvas 로만 처리합니다.
'use strict';

const PRESETS = [
  // [key, 라벨, 너비, 높이, 그룹]
  ['15promax', '아이폰 15 Pro Max / 14 Pro Max', 1290, 2796, '아이폰'],
  ['16promax', '아이폰 16 Pro Max', 1320, 2868, '아이폰'],
  ['16pro', '아이폰 16 Pro', 1206, 2622, '아이폰'],
  ['15', '아이폰 15 / 14 Pro', 1179, 2556, '아이폰'],
  ['13', '아이폰 13 / 12', 1170, 2532, '아이폰'],
  ['se', '아이폰 SE', 750, 1334, '아이폰'],
  ['galaxy_s', '갤럭시 S23 / S24 / S25', 1080, 2340, '갤럭시'],
  ['galaxy_ultra', '갤럭시 Ultra', 1440, 3120, '갤럭시'],
  ['galaxy_a', '갤럭시 A시리즈', 1080, 2400, '갤럭시'],
  ['galaxy_fold', '갤럭시 Z Fold (내부)', 1812, 2176, '갤럭시'],
  ['galaxy_flip', '갤럭시 Z Flip (내부)', 1080, 2640, '갤럭시'],
];

const BG = '#ffffff';
const BASE = [200, 200, 199];
const BASE_DARK = [66, 61, 59]; // 반전을 끄면: 갈색 빛 도는 짙은 필름 베이스
const PERF_SCALE = 1.12; // 실제 35mm 퍼포레이션(2.8×1.98mm) 대비 배율
const HOLE = 'rgb(236,236,235)';
const TEXT = 'rgb(55,55,55)';
const FRAME_W = 0.232, FRAME_H = FRAME_W * 2 / 3;
const PITCH = 0.245, STRIP_H = 0.228, STRIP_GAP = 0.032;
const ROW_PATTERNS = ['full', 'full', 'full', 'short_end', 'short_start'];

// ---------- 유틸 ----------
function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const uniform = (r, a, b) => a + (b - a) * r();
const randint = (r, a, b) => a + Math.floor(r() * (b - a + 1));
const gauss = (r) => {
  let u = 0; while (!u) u = r();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * r());
};
const tick = () => new Promise((res) => setTimeout(res, 0));
const mkCanvas = (w, h) => { const c = document.createElement('canvas'); c.width = w; c.height = h; return c; };

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

// ---------- 레이아웃 ----------
function planRows(W, rows, rng) {
  const pitch = PITCH * W, plans = [];
  for (let i = 0; i < rows; i++) {
    const pattern = ROW_PATTERNS[i % ROW_PATTERNS.length];
    let x0 = -uniform(rng, 0.05, 0.9) * pitch - 0.1 * W;
    let x1 = W + uniform(rng, 0.05, 0.6) * pitch + 0.1 * W;
    if (pattern === 'short_end') x1 = W * uniform(rng, 0.62, 0.78);
    else if (pattern === 'short_start') x0 = W * uniform(rng, 0.12, 0.2);
    const first = pattern !== 'full' ? x0 + 0.03 * W : x0 + uniform(rng, -0.15, 0.1) * pitch;
    const n = Math.max(1, Math.ceil((x1 - first) / pitch));
    plans.push({ pattern, x0, x1, firstFrameX: first, n, angle: uniform(rng, -0.55, 0.6) });
  }
  return plans;
}

// ---------- 영상 ----------
function loadVideo(file) {
  return new Promise((resolve, reject) => {
    const v = document.createElement('video');
    v.muted = true; v.playsInline = true; v.preload = 'auto';
    const url = URL.createObjectURL(file);
    const fail = () => { URL.revokeObjectURL(url); reject(new Error('이 브라우저에서는 이 영상을 열 수 없어요. (코덱 미지원일 수 있어요. Safari나 최신 Chrome으로 시도하거나 mp4(H.264)로 변환해 주세요.)')); };
    const timer = setTimeout(fail, 20000);
    v.onloadeddata = () => {
      clearTimeout(timer);
      if (!v.videoWidth || !isFinite(v.duration) || v.duration <= 0) return fail();
      resolve(v);
    };
    v.onerror = () => { clearTimeout(timer); fail(); };
    v.src = url;
    v.load();
  });
}

function seek(v, t) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('영상 탐색 시간이 초과됐어요.')), 10000);
    const done = () => { clearTimeout(timer); v.removeEventListener('seeked', done); setTimeout(resolve, 30); };
    v.addEventListener('seeked', done);
    v.currentTime = t;
  });
}

// 영상 길이를 기준으로 프레임 시각(초)을 계산
function planTimes(duration, n, interval) {
  const auto = duration / n;
  let step = auto, note = '', times;
  if (interval && interval > 0) {
    if (interval * n <= duration) {
      step = interval;
      const start = (duration - step * (n - 1)) / 2;
      times = Array.from({ length: n }, (_, i) => start + i * step);
    } else {
      note = `요청한 간격(${interval}초)×${n}장이 영상 길이(${duration.toFixed(1)}초)보다 길어 자동 간격으로 바꿨어요.`;
    }
  }
  if (!times) times = Array.from({ length: n }, (_, i) => (i + 0.5) * step);
  return { times, info: { duration, interval: step, frames: n, note } };
}

// ---------- 프레임 가공 ----------
function downscaleTo(video, sx, sy, sw, sh, fw, fh) {
  let src = video, cx = sx, cy = sy, cw = sw, ch = sh;
  while (cw / 2 > fw && ch / 2 > fh) { // 절반씩 줄여 앨리어싱 방지
    const w = Math.ceil(cw / 2), h = Math.ceil(ch / 2);
    const c = mkCanvas(w, h);
    c.getContext('2d').drawImage(src, cx, cy, cw, ch, 0, 0, w, h);
    src = c; cx = 0; cy = 0; cw = w; ch = h;
  }
  const out = mkCanvas(fw, fh);
  const ctx = out.getContext('2d', { willReadFrequently: true });
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(src, cx, cy, cw, ch, 0, 0, fw, fh);
  return out;
}

function boxBlur(src, w, h) {
  const tmp = new Float32Array(w * h), out = new Float32Array(w * h);
  for (let y = 0; y < h; y++) {
    const row = y * w;
    for (let x = 0; x < w; x++) {
      tmp[row + x] = (src[row + Math.max(x - 1, 0)] + src[row + x] + src[row + Math.min(x + 1, w - 1)]) / 3;
    }
  }
  for (let y = 0; y < h; y++) {
    const a = Math.max(y - 1, 0) * w, b = y * w, c = Math.min(y + 1, h - 1) * w;
    for (let x = 0; x < w; x++) out[b + x] = (tmp[a + x] + tmp[b + x] + tmp[c + x]) / 3;
  }
  return out;
}

function makeFrameImage(video, fw, fh, invert, gray, rng, film) {
  const vw = video.videoWidth, vh = video.videoHeight, target = fw / fh;
  let sx = 0, sy = 0, sw = vw, sh = vh;
  if (vw / vh > target) { sw = vh * target; sx = (vw - sw) / 2; }
  else { sh = vw / target; sy = (vh - sh) / 2; }
  const c = downscaleTo(video, sx, sy, sw, sh, fw, fh);
  const ctx = c.getContext('2d', { willReadFrequently: true });
  const img = ctx.getImageData(0, 0, fw, fh), d = img.data, n = fw * fh;

  let planes;
  if (gray) {
    const p = new Float32Array(n);
    for (let i = 0; i < n; i++) p[i] = 0.299 * d[i * 4] + 0.587 * d[i * 4 + 1] + 0.114 * d[i * 4 + 2];
    planes = [p];
  } else {
    planes = [0, 1, 2].map((ch) => { const p = new Float32Array(n); for (let i = 0; i < n; i++) p[i] = d[i * 4 + ch]; return p; });
  }
  // 대비 늘리기 (1~99 백분위)
  const hist = new Uint32Array(256);
  for (const p of planes) for (let i = 0; i < n; i++) hist[Math.min(255, Math.max(0, p[i] | 0))]++;
  const total = n * planes.length;
  let acc = 0, lo = 0, hi = 255;
  for (let v = 0; v < 256; v++) { acc += hist[v]; if (acc >= total * 0.01) { lo = v; break; } }
  acc = 0;
  for (let v = 0; v < 256; v++) { acc += hist[v]; if (acc >= total * 0.99) { hi = v; break; } }
  const span = Math.max(hi - lo, 1);
  planes = planes.map((p) => {
    for (let i = 0; i < n; i++) {
      const st = Math.min(255, Math.max(0, (p[i] - lo) / span * 255));
      p[i] = film ? 0.55 * p[i] + 0.45 * st : st; // 포지티브는 대비를 덜 늘림
    }
    return boxBlur(p, fw, fh);
  });
  // 필름 색감(옵션)용 할레이션: 밝은 영역을 번지게 한 평면
  let halo = null;
  if (film) {
    halo = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      const l = gray ? planes[0][i] : (planes[0][i] + planes[1][i] + planes[2][i]) / 3;
      halo[i] = Math.max(0, l - 185);
    }
    for (let k = 0; k < 6; k++) halo = boxBlur(halo, fw, fh);
  }
  const vigK = film ? 0.18 : 0.12;
  const vig = new Float32Array(n);
  for (let y = 0; y < fh; y++) for (let x = 0; x < fw; x++) {
    const dd = Math.hypot((x - fw / 2) / (fw / 2), (y - fh / 2) / (fh / 2));
    vig[y * fw + x] = 1 - vigK * Math.min(1, Math.max(0, dd - 0.4));
  }
  const cl = (v) => Math.min(255, Math.max(0, v));
  const curve = (v) => { const t = cl(v) / 255; return 255 * (t + 0.2 * (t * t * (3 - 2 * t) - t)); };
  const finish = (v, noise, vg) => {
    if (invert) v = 255 - cl(v);
    v = 255 * Math.pow(cl(v) / 255, film ? 0.9 : 0.8) + noise;
    return cl(v * vg);
  };
  for (let i = 0; i < n; i++) {
    const noise = gauss(rng) * (film ? 7.0 : 5.5);
    let r = cl(planes[0][i]), g = gray ? r : cl(planes[1][i]), b = gray ? r : cl(planes[2][i]);
    if (film) { // 채도↓, 부드러운 S커브, 그림자 청록/하이라이트 따뜻함, 할레이션, 블랙 들뜸
      const lum = (r + g + b) / 3;
      if (!gray) { r = lum + (r - lum) * 0.85; g = lum + (g - lum) * 0.85; b = lum + (b - lum) * 0.85; }
      r = curve(r); g = curve(g); b = curve(b);
      if (!gray) {
        const w = lum / 255, sw = (1 - w) * (1 - w), hw = w * w;
        r += -4 * sw + 6 * hw; g += 5 * sw + 2 * hw; b += 4 * sw - 6 * hw;
      }
      const h = halo[i] / 70;
      if (gray) { r += h * 40; g += h * 40; b += h * 40; } else { r += h * 60; g += h * 30; b += h * 8; }
      r = 18 + cl(r) * 214 / 255; g = 18 + cl(g) * 214 / 255; b = 18 + cl(b) * 214 / 255;
    }
    d[i * 4] = finish(r, noise, vig[i]);
    d[i * 4 + 1] = finish(g, noise, vig[i]);
    d[i * 4 + 2] = finish(b, noise, vig[i]);
    d[i * 4 + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);

  // 먼지 / 스크래치
  const dust = randint(rng, 3, 9);
  for (let k = 0; k < dust; k++) {
    const r = rng() < 2 / 3 ? 1 : 2;
    ctx.fillStyle = rng() < 0.5 ? 'rgb(15,15,15)' : '#fff';
    ctx.beginPath(); ctx.arc(randint(rng, 0, fw - 1), randint(rng, 0, fh - 1), r, 0, Math.PI * 2); ctx.fill();
  }
  if (rng() < 0.25) {
    const x = randint(rng, 0, fw - 1), y0 = randint(rng, 0, Math.floor(fh / 3));
    ctx.strokeStyle = rng() < 0.5 ? 'rgb(250,250,250)' : 'rgb(40,40,40)';
    ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(x, y0);
    ctx.lineTo(x + randint(rng, -2, 2), y0 + randint(rng, Math.floor(fh / 3), fh)); ctx.stroke();
  }
  return c;
}

// ---------- 스트립 ----------
// 35mm 규격(필름 폭 35mm, 퍼포 2.8×1.98mm, 피치 4.75mm)을 기준으로 그린다.
function buildStrip(frames, plan, W, startNumber, rng, dark) {
  const pitch = PITCH * W;
  const fw = frames[0].width, fh = frames[0].height;
  const sh = Math.round(STRIP_H * W), sw = Math.round(plan.x1 - plan.x0);
  const mm = STRIP_H * W / 35; // 1mm 의 픽셀 크기
  const strip = mkCanvas(sw, sh), ctx = strip.getContext('2d');
  const baseColor = dark ? BASE_DARK : BASE;

  const base = ctx.createImageData(sw, sh), bd = base.data;
  const g0 = dark ? -8 : -6;
  for (let y = 0; y < sh; y++) {
    const g = g0 + (6 - g0) * (y / Math.max(1, sh - 1));
    for (let x = 0; x < sw; x++) {
      const o = (y * sw + x) * 4, nz = gauss(rng) * 2;
      bd[o] = baseColor[0] + g + nz; bd[o + 1] = baseColor[1] + g + nz; bd[o + 2] = baseColor[2] + g + nz; bd[o + 3] = 255;
    }
  }
  ctx.putImageData(base, 0, 0);

  // 스프로킷 구멍: 프레임 한 칸(피치)당 8개, 실제 비율의 둥근 직사각형
  const hw = 2.8 * mm * PERF_SCALE, hh = 1.98 * mm * PERF_SCALE, hp = pitch / 8;
  const fx0 = plan.firstFrameX - plan.x0;
  const holeCol = dark ? '#ffffff' : HOLE;
  ctx.fillStyle = holeCol; ctx.shadowColor = holeCol; ctx.shadowBlur = Math.max(0.7, W / 2000);
  for (let k = Math.floor(-fx0 / hp) - 1; ; k++) {
    const cx = fx0 + (k + 0.5) * hp;
    if (cx - hw / 2 > sw) break;
    if (cx + hw / 2 < 0) continue;
    for (const cy of [3.0 * mm, sh - 3.0 * mm]) {
      roundRect(ctx, cx - hw / 2, cy - hh / 2, hw, hh, hh * 0.28); ctx.fill();
    }
  }
  ctx.shadowBlur = 0; ctx.shadowColor = 'transparent';

  // 프레임 + 글자
  const fs = Math.max(9, Math.floor(0.009 * W));
  ctx.font = `${dark ? 'bold ' : ''}${fs}px Helvetica, Arial, sans-serif`;
  ctx.textBaseline = 'top';
  const topY = Math.floor((sh - fh) / 2);
  const holeTopEdge = 3.0 * mm - hh / 2; // 가장자리 ~ 구멍 위쪽 (여백)
  const holeBottomEdge = 3.0 * mm + hh / 2;
  frames.forEach((f, i) => {
    const fx = Math.floor(fx0 + i * pitch);
    ctx.drawImage(f, fx, topY);
    const num = startNumber + i;
    if (dark) { // 포지티브: 위 모서리에 검정 인쇄, 아래 모서리 가운데에 주황 번호
      ctx.textAlign = 'left'; ctx.fillStyle = 'rgb(232,226,218)';
      ctx.fillText('SAFETY FILM', fx + 0.01 * W, (holeTopEdge - fs) / 2);
      ctx.textAlign = 'center'; ctx.fillStyle = 'rgb(232,226,218)';
      ctx.fillText(String(num), fx + fw / 2, sh - holeTopEdge + (holeTopEdge - fs) / 2);
      ctx.textAlign = 'left';
    } else { // 네거티브: 프레임 위에 번호, 아래에 SAFETY FILM
      ctx.fillStyle = TEXT;
      const ty = holeBottomEdge + (topY - holeBottomEdge - fs) / 2;
      ctx.fillText(String(num), fx + 0.008 * W, ty);
      ctx.fillText(`${num}A`, fx + 0.133 * W, ty);
      if (i % 4 === 0) {
        const by = topY + fh + ((sh - holeTopEdge - hh) - (topY + fh) - fs) / 2;
        ctx.fillText('SAFETY FILM', fx + 0.05 * W, by);
      }
    }
  });
  return strip;
}

// ---------- 전체 ----------
async function renderSheet(video, opt, onProgress) {
  const { W, H, rows, invert, gray, seed, interval, film } = opt;
  const rng = mulberry32(seed);
  const plans = planRows(W, rows, rng);

  const stripH = STRIP_H * W, gap = STRIP_GAP * W;
  const maxRows = Math.max(1, Math.floor((H * 0.92 + gap) / (stripH + gap)));
  if (rows > maxRows) throw new Error(`이 해상도에서는 줄 수를 최대 ${maxRows}까지 쓸 수 있어요.`);

  const totalFrames = plans.reduce((s, p) => s + p.n, 0);
  const { times, info } = planTimes(video.duration, totalFrames, interval);
  const fw = Math.floor(FRAME_W * W), fh = Math.floor(FRAME_H * W);

  const canvas = mkCanvas(W, H), ctx = canvas.getContext('2d');
  ctx.fillStyle = BG; ctx.fillRect(0, 0, W, H);

  const totalH = rows * stripH + (rows - 1) * gap;
  const margin = (H - totalH) / 2;
  let y = margin + Math.max(0, Math.min(0.05 * H, margin - 0.02 * H)); // 살짝 아래로
  let n = 0;
  for (const plan of plans) {
    const imgs = [];
    for (let i = 0; i < plan.n; i++) {
      await seek(video, Math.min(Math.max(times[n + i], 0), video.duration - 0.05));
      imgs.push(makeFrameImage(video, fw, fh, invert, gray, rng, film));
      onProgress && onProgress((n + i + 1) / totalFrames);
      await tick();
    }
    const strip = buildStrip(imgs, plan, W, n + 1, rng, !invert);
    const cx = plan.x0 + strip.width / 2, cy = y + stripH / 2;
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(plan.angle * Math.PI / 180);
    ctx.shadowColor = 'rgba(0,0,0,0.16)'; ctx.shadowBlur = W / 85; ctx.shadowOffsetY = 0.003 * W;
    ctx.drawImage(strip, -strip.width / 2, -strip.height / 2);
    ctx.shadowColor = 'transparent'; ctx.shadowBlur = 0; ctx.shadowOffsetY = 0;
    ctx.strokeStyle = invert ? 'rgb(222,222,221)' : 'rgb(70,70,70)'; ctx.lineWidth = 1;
    ctx.strokeRect(-strip.width / 2 + 0.5, -strip.height / 2 + 0.5, strip.width - 1, strip.height - 1);
    ctx.restore();
    n += plan.n; y += stripH + gap;
  }
  return { canvas, info };
}

// ---------- UI ----------
document.addEventListener('DOMContentLoaded', () => {
  const $ = (id) => document.getElementById(id);
  const sel = $('preset');
  for (const group of ['아이폰', '갤럭시']) {
    const og = document.createElement('optgroup'); og.label = group;
    PRESETS.filter((p) => p[4] === group).forEach(([k, label, w, h]) => {
      const o = document.createElement('option'); o.value = k; o.textContent = `${label} (${w}×${h})`;
      if (k === '15promax') o.selected = true; og.appendChild(o);
    });
    sel.appendChild(og);
  }

  let lastUrl = null;
  $('form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const file = $('video').files[0];
    const btn = $('go'), status = $('status'), err = $('err');
    err.textContent = ''; $('result').hidden = true;
    if (!file) { err.textContent = '영상을 선택해 주세요.'; return; }
    btn.disabled = true; status.textContent = '영상 여는 중…';
    let video;
    try {
      video = await loadVideo(file);
      const [, , w, h] = PRESETS.find((p) => p[0] === sel.value);
      const iv = parseFloat($('interval').value);
      const { canvas, info } = await renderSheet(video, {
        W: w, H: h,
        rows: Math.max(1, Math.min(6, parseInt($('rows').value, 10) || 5)),
        invert: $('invert').checked, gray: $('gray').checked, film: $('film').checked,
        seed: parseInt($('seed').value, 10) || 7,
        interval: isFinite(iv) ? iv : null,
      }, (p) => { status.textContent = `만드는 중… ${Math.round(p * 100)}%`; });
      status.textContent = 'PNG 만드는 중…';
      const blob = await new Promise((res) => canvas.toBlob(res, 'image/png'));
      if (lastUrl) URL.revokeObjectURL(lastUrl);
      lastUrl = URL.createObjectURL(blob);
      $('preview').src = lastUrl; $('download').href = lastUrl;
      $('info').textContent = `영상 ${info.duration.toFixed(1)}초 · ${info.frames}장 · 간격 ${info.interval.toFixed(2)}초 ${info.note}`;
      $('result').hidden = false; status.textContent = '';
    } catch (ex) {
      err.textContent = ex.message || String(ex); status.textContent = '';
    } finally {
      if (video) URL.revokeObjectURL(video.src);
      btn.disabled = false;
    }
  });
});

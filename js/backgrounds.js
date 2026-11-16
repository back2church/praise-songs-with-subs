// Procedural moving backgrounds. Every theme is a pure function of time, so the
// preview, fullscreen presentation and video export all look identical.

export const PALETTES = {
  ocean: { name: 'Deep blue', base: ['#06162e', '#0b3a5c'], accents: ['#1f7fbf', '#37c2c9', '#5b6ee1'] },
  sunrise: { name: 'Sunrise', base: ['#2a0f2e', '#8a3b2a'], accents: ['#ff9d4d', '#ffcf6b', '#e0567a'] },
  forest: { name: 'Forest', base: ['#07201a', '#14493a'], accents: ['#3fae7a', '#9ad17b', '#2c8f8f'] },
  royal: { name: 'Royal purple', base: ['#150a2e', '#3a1a5e'], accents: ['#8a5cf0', '#d277e8', '#4f7df0'] },
  ember: { name: 'Warm ember', base: ['#1c0b08', '#4a1c12'], accents: ['#e8703a', '#f2b33d', '#b8402e'] },
  slate: { name: 'Calm grey', base: ['#0d1014', '#27303a'], accents: ['#6f8296', '#a8b7c4', '#4d5c6b'] },
};

const TAU = Math.PI * 2;

// Deterministic pseudo-random numbers so particles are stable between frames.
function rand(i, salt = 0) {
  const x = Math.sin(i * 127.1 + salt * 311.7) * 43758.5453;
  return x - Math.floor(x);
}

function rgba(hex, a) {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${n >> 16},${(n >> 8) & 255},${n & 255},${a})`;
}

function base(ctx, W, H, p, t) {
  const g = ctx.createLinearGradient(0, 0, W * (0.3 + 0.2 * Math.sin(t * 0.03)), H);
  g.addColorStop(0, p.base[0]);
  g.addColorStop(1, p.base[1]);
  ctx.globalCompositeOperation = 'source-over';
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, W, H);
}

function glow(ctx, x, y, r, color, alpha) {
  const g = ctx.createRadialGradient(x, y, 0, x, y, r);
  g.addColorStop(0, rgba(color, alpha));
  g.addColorStop(1, rgba(color, 0));
  ctx.fillStyle = g;
  ctx.fillRect(x - r, y - r, r * 2, r * 2);
}

function aurora(ctx, W, H, t, p) {
  base(ctx, W, H, p, t);
  ctx.globalCompositeOperation = 'screen';
  for (let i = 0; i < 6; i++) {
    const sp = 0.02 + rand(i, 1) * 0.03;
    const x = W * (0.5 + 0.45 * Math.sin(t * sp + rand(i, 2) * TAU));
    const y = H * (0.5 + 0.4 * Math.cos(t * sp * 1.3 + rand(i, 3) * TAU));
    const r = Math.max(W, H) * (0.35 + 0.2 * Math.sin(t * 0.05 + i));
    glow(ctx, x, y, r, p.accents[i % p.accents.length], 0.38);
  }
}

function bokeh(ctx, W, H, t, p) {
  base(ctx, W, H, p, t);
  ctx.globalCompositeOperation = 'screen';
  for (let i = 0; i < 46; i++) {
    const depth = 0.3 + rand(i, 1) * 0.7;
    const r = H * 0.035 * depth + H * 0.01;
    const span = H + r * 4;
    const y = H + r * 2 - ((rand(i, 2) * span + t * H * 0.012 * depth) % span);
    const x = W * rand(i, 3) + Math.sin(t * 0.15 * depth + i) * W * 0.02;
    const tw = 0.55 + 0.45 * Math.sin(t * (0.3 + rand(i, 4) * 0.5) + i);
    glow(ctx, x, y, r * 2.2, p.accents[i % p.accents.length], 0.3 * depth * tw);
  }
}

function rays(ctx, W, H, t, p) {
  base(ctx, W, H, p, t);
  ctx.globalCompositeOperation = 'screen';
  const ox = W * (0.5 + 0.08 * Math.sin(t * 0.04)), oy = -H * 0.25, len = H * 1.9;
  for (let i = 0; i < 9; i++) {
    const a = Math.PI / 2 + (i - 4) * 0.2 + 0.1 * Math.sin(t * (0.06 + rand(i, 1) * 0.06) + i * 2);
    const w = 0.035 + 0.035 * rand(i, 2);
    const al = 0.1 + 0.12 * (0.5 + 0.5 * Math.sin(t * (0.12 + rand(i, 3) * 0.12) + i));
    const ex = ox + Math.cos(a) * len, ey = oy + Math.sin(a) * len;
    const g = ctx.createLinearGradient(ox, oy, ex, ey);
    g.addColorStop(0, rgba(p.accents[1], al * 1.6));
    g.addColorStop(1, rgba(p.accents[i % 3], 0));
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.moveTo(ox, oy);
    ctx.lineTo(ox + Math.cos(a - w) * len, oy + Math.sin(a - w) * len);
    ctx.lineTo(ox + Math.cos(a + w) * len, oy + Math.sin(a + w) * len);
    ctx.closePath();
    ctx.fill();
  }
  glow(ctx, ox, 0, H * 0.7, p.accents[1], 0.3);
}

function waves(ctx, W, H, t, p) {
  base(ctx, W, H, p, t);
  ctx.globalCompositeOperation = 'screen';
  glow(ctx, W * 0.5, H * 0.3, H * 0.8, p.accents[1], 0.22);
  for (let i = 0; i < 5; i++) {
    const y0 = H * (0.5 + i * 0.1);
    const amp = H * (0.03 + 0.012 * i);
    const sp = (0.1 + i * 0.03) * (i % 2 ? -1 : 1);
    ctx.beginPath();
    ctx.moveTo(0, H);
    for (let x = 0; x <= W; x += W / 96) {
      const k = (x / W) * TAU;
      ctx.lineTo(x, y0 + Math.sin(k * 1.5 + t * sp + i * 1.7) * amp + Math.sin(k * 3.1 - t * sp * 0.6 + i) * amp * 0.4);
    }
    ctx.lineTo(W, H);
    ctx.closePath();
    const g = ctx.createLinearGradient(0, y0 - amp, 0, H);
    g.addColorStop(0, rgba(p.accents[i % 3], 0.3));
    g.addColorStop(1, rgba(p.accents[i % 3], 0.02));
    ctx.fillStyle = g;
    ctx.fill();
  }
}

function stars(ctx, W, H, t, p) {
  base(ctx, W, H, p, t);
  ctx.globalCompositeOperation = 'screen';
  glow(ctx, W * (0.3 + 0.1 * Math.sin(t * 0.02)), H * 0.7, H * 0.9, p.accents[0], 0.25);
  glow(ctx, W * (0.75 + 0.1 * Math.cos(t * 0.025)), H * 0.25, H * 0.7, p.accents[2], 0.22);
  for (let i = 0; i < 170; i++) {
    const depth = 0.3 + rand(i, 1) * 0.7;
    const x = (rand(i, 2) * W + t * W * 0.004 * depth) % W;
    const y = rand(i, 3) * H;
    const tw = 0.5 + 0.5 * Math.sin(t * (0.5 + rand(i, 4) * 1.5) + i);
    ctx.fillStyle = `rgba(255,255,255,${0.15 + 0.7 * depth * tw})`;
    ctx.beginPath();
    ctx.arc(x, y, H * 0.0016 * (0.5 + depth), 0, TAU);
    ctx.fill();
  }
}

export const THEMES = {
  aurora: { name: 'Aurora glow', draw: aurora },
  bokeh: { name: 'Floating lights', draw: bokeh },
  rays: { name: 'Light rays', draw: rays },
  waves: { name: 'Gentle waves', draw: waves },
  stars: { name: 'Night sky', draw: stars },
};

/** Draw an image or video so it covers the canvas; still images get a slow zoom and pan. */
function drawCover(ctx, W, H, media, t, animate) {
  const mw = media.videoWidth || media.naturalWidth, mh = media.videoHeight || media.naturalHeight;
  if (!mw || !mh) return false;
  let scale = Math.max(W / mw, H / mh), dx = 0, dy = 0;
  if (animate) {
    scale *= 1.12 + 0.06 * Math.sin(t * 0.05);
    dx = Math.sin(t * 0.031) * W * 0.025;
    dy = Math.cos(t * 0.027) * H * 0.025;
  }
  const w = mw * scale, h = mh * scale;
  ctx.drawImage(media, (W - w) / 2 + dx, (H - h) / 2 + dy, w, h);
  return true;
}

/**
 * @param bg { theme, palette, media?: HTMLImageElement|HTMLVideoElement, dim: 0..1 }
 */
export function drawBackground(ctx, W, H, t, bg) {
  ctx.save();
  ctx.globalAlpha = 1;
  ctx.globalCompositeOperation = 'source-over';
  let drawn = false;
  if (bg.media) {
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, W, H);
    drawn = drawCover(ctx, W, H, bg.media, t, !('videoWidth' in bg.media));
  }
  if (!drawn) (THEMES[bg.theme] || THEMES.aurora).draw(ctx, W, H, t, PALETTES[bg.palette] || PALETTES.ocean);
  // Darken and vignette so white lyrics stay readable on any background.
  ctx.globalCompositeOperation = 'source-over';
  ctx.fillStyle = `rgba(0,0,0,${bg.dim})`;
  ctx.fillRect(0, 0, W, H);
  const v = ctx.createRadialGradient(W / 2, H / 2, H * 0.35, W / 2, H / 2, Math.hypot(W, H) / 2);
  v.addColorStop(0, 'rgba(0,0,0,0)');
  v.addColorStop(1, 'rgba(0,0,0,0.45)');
  ctx.fillStyle = v;
  ctx.fillRect(0, 0, W, H);
  ctx.restore();
}

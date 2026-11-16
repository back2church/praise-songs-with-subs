import { activeIndex } from './lyrics.js';
import { drawBackground } from './backgrounds.js';

const FADE_IN = 0.35;
const FADE_OUT = 0.25;
const clamp01 = (x) => Math.min(1, Math.max(0, x));

function wrap(ctx, text, maxWidth) {
  const out = [];
  for (const para of text.split('\n')) {
    let line = '';
    for (const word of para.split(/\s+/).filter(Boolean)) {
      const test = line ? line + ' ' + word : word;
      if (line && ctx.measureText(test).width > maxWidth) {
        out.push(line);
        line = word;
      } else line = test;
    }
    if (line) out.push(line);
  }
  return out;
}

/** Draw centred, wrapped text; shrinks the font if it would need more than maxLines. Returns block height. */
function drawText(ctx, W, H, text, { size, cy, alpha, font, weight = 600, maxLines = 3, anchor = 'middle' }) {
  let lines;
  for (;;) {
    ctx.font = `${weight} ${size}px ${font}`;
    lines = wrap(ctx, text, W * 0.84);
    if (lines.length <= maxLines || size < H * 0.03) break;
    size *= 0.9;
  }
  const lh = size * 1.25;
  const top = anchor === 'top' ? cy : cy - (lines.length * lh) / 2;
  ctx.save();
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.shadowColor = 'rgba(0,0,0,0.55)';
  ctx.shadowBlur = size * 0.22;
  ctx.shadowOffsetY = size * 0.04;
  ctx.fillStyle = `rgba(255,255,255,${alpha})`;
  lines.forEach((l, i) => ctx.fillText(l, W / 2, top + lh * (i + 0.5)));
  ctx.restore();
  return lines.length * lh;
}

/**
 * Draw one complete frame.
 * @param s {
 *   time: media time in seconds, bgTime: animation clock in seconds,
 *   cues, lead: seconds the lyrics run ahead of the audio,
 *   bg: { theme, palette, media, dim },
 *   style: { font, scale, position: 'center'|'lower', showNext, singCue },
 *   title, subtitle
 * }
 */
export function drawFrame(ctx, W, H, s) {
  drawBackground(ctx, W, H, s.bgTime, s.bg);

  const { cues, lead, style } = s;
  const shown = s.time + lead; // lyrics clock runs ahead of the audio
  const idx = activeIndex(cues, shown);
  const size = H * 0.078 * style.scale;
  const cy = style.position === 'lower' ? H * 0.74 : H * 0.5;

  // Title card until the first lyric line arrives.
  if (idx < 0) {
    if (s.title) {
      const firstT = cues.length && cues[0].t != null ? cues[0].t : Infinity;
      const a = Math.min(clamp01(s.time / 0.8), clamp01((firstT - shown) / 0.6));
      const h = drawText(ctx, W, H, s.title, { size: size * 1.15, cy: H * 0.47, alpha: a, font: style.font, weight: 700, maxLines: 2 });
      if (s.subtitle) {
        drawText(ctx, W, H, s.subtitle, { size: size * 0.45, cy: H * 0.47 + h / 2 + size * 0.5, alpha: a * 0.75, font: style.font, weight: 400, maxLines: 2 });
      }
    }
    return;
  }

  const cue = cues[idx];
  const next = cues[idx + 1];
  const nextT = next && next.t != null ? next.t : Infinity;
  const fade = Math.min(clamp01((shown - cue.t) / FADE_IN), clamp01((nextT - shown) / FADE_OUT));
  if (!cue.text) return;

  // The line appears `lead` seconds early, slightly dimmed, and reaches full brightness
  // at the moment it is actually sung – a quiet "now" cue without bouncing balls.
  const sung = style.singCue && lead > 0 ? clamp01(1 - (cue.t - s.time) / 0.3) : 1;
  const h = drawText(ctx, W, H, cue.text, { size, cy, alpha: fade * (0.7 + 0.3 * sung), font: style.font });

  if (style.showNext && next && next.text) {
    drawText(ctx, W, H, next.text, {
      size: size * 0.55, cy: cy + h / 2 + size * 0.45, alpha: fade * 0.38, font: style.font, weight: 500, maxLines: 2, anchor: 'top',
    });
  }
}

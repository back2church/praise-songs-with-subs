import { activeIndex } from './lyrics.js';
import { drawBackground } from './backgrounds.js';
import { wrapText } from './wrap.js';

const FADE_IN = 0.35;
const FADE_OUT = 0.25;
const clamp01 = (x) => Math.min(1, Math.max(0, x));

/** Wrap text at full size (shrinking the font if it needs more than maxLines). */
function layout(ctx, W, H, text, { size, font, weight = 600, maxLines = 3 }) {
  let lines;
  for (;;) {
    ctx.font = `${weight} ${size}px ${font}`;
    lines = wrapText(text, (w) => ctx.measureText(w).width, W * 0.8);
    if (lines.length <= maxLines || size < H * 0.03) break;
    size *= 0.9;
  }
  return { lines, size, font: ctx.font, lh: size * 1.25, height: lines.length * size * 1.25 };
}

/** Paint a layout centred on (W/2, cy), optionally scaled down (so previews wrap exactly like the full line). */
function paintBlock(ctx, W, block, cy, alpha, scale = 1, color = '#ffffff') {
  if (alpha <= 0.003) return;
  ctx.save();
  ctx.translate(W / 2, cy);
  ctx.scale(scale, scale);
  ctx.font = block.font;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  const n = parseInt(color.slice(1), 16);
  const [r, g, b] = [n >> 16, (n >> 8) & 255, n & 255];
  if (0.299 * r + 0.587 * g + 0.114 * b > 110) { // soft shadow keeps light text readable
    ctx.shadowColor = 'rgba(0,0,0,0.55)';
    ctx.shadowBlur = block.size * 0.22 * scale;
    ctx.shadowOffsetY = block.size * 0.04 * scale;
  }
  ctx.fillStyle = `rgba(${r},${g},${b},${Math.min(1, alpha)})`;
  block.lines.forEach((l, i) => ctx.fillText(l, 0, (i + 0.5) * block.lh - block.height / 2));
  ctx.restore();
}

/**
 * A sung line with its optional translation below it.
 * Positions are given for the centre of the main text, so the translation can be
 * faded in or out without the main text moving.
 */
function lineLayout(ctx, W, H, cue, o) {
  const main = layout(ctx, W, H, o.tx(cue.text), { size: o.size, font: o.font });
  const tr = o.showTr && cue.tr ? layout(ctx, W, H, o.tx(cue.tr), { size: o.size * o.trScale, font: o.font, weight: 500 }) : null;
  const gap = tr ? o.size * 0.22 : 0;
  return { main, tr, gap, height: main.height + (tr ? gap + tr.height : 0) };
}

/** Main-text centre for a line whose whole block (text + translation) is centred on cy. */
const mainCentre = (blk, cy) => cy - (blk.height - blk.main.height) / 2;

function paintLine(ctx, W, blk, mainY, alpha, scale, colors, trAlpha = 1) {
  paintBlock(ctx, W, blk.main, mainY, alpha, scale, colors.main);
  if (blk.tr) {
    const y = mainY + (blk.main.height / 2 + blk.gap + blk.tr.height / 2) * scale;
    paintBlock(ctx, W, blk.tr, y, alpha * trAlpha, scale, colors.tr);
  }
}

const PREVIEW_SCALE = 0.6;
const PREVIEW_ALPHA = 0.5;
const HANDOVER = 0.35; // seconds for the next line to move up into place
const LONG_GAP = 15; // a line followed by a longer gap is taken off the screen by itself
const ease = (x) => x * x * (3 - 2 * x);
const lerp = (a, b, k) => a + (b - a) * k;
const hasText = (c) => !!(c && c.t != null && c.text);

/** Seconds a line stays up when nothing follows it for a long time (instrumental, song end). */
export function holdTime(cue, next, lead) {
  const gap = hasNextTime(next) ? next.t - cue.t : Infinity;
  if (gap <= LONG_GAP) return Infinity;
  const words = cue.text.split(/\s+/).length;
  return Math.max(4, Math.min(Math.max(8, words * 0.8 + 3), gap - lead - 1));
}
const hasNextTime = (c) => !!(c && c.t != null);

/**
 * Draw one complete frame.
 *
 * Timing model: a line is on screen for as long as it is sung (until the next line starts).
 * `lead` seconds before a line starts it already appears – below the current line, smaller
 * and dimmer, or in the main position if the screen is empty – so singers can read ahead
 * without losing the end of the line they are still singing.
 *
 * @param s {
 *   time: media time in seconds, bgTime: animation clock in seconds,
 *   cues, lead,
 *   bg: { theme, palette, media, dim },
 *   style: { font, scale, position: 'upper'|'center'|'lower', showNext, singCue, caps, color, showTr, trColor, trScale },
 *   title, subtitle
 * }
 */
export function drawFrame(ctx, W, H, s) {
  drawBackground(ctx, W, H, s.bgTime, s.bg);

  const { cues, lead, style, time: t } = s;
  const size = H * 0.078 * style.scale;
  const cy = { upper: H * 0.3, lower: H * 0.68 }[style.position] ?? H * 0.5;
  const gap = size * 0.35;
  const tx = (text) => (style.caps ? text.toLocaleUpperCase() : text);
  const hex = (c, d) => (/^#[0-9a-f]{6}$/i.test(c || '') ? c : d);
  const colors = { main: hex(style.color, '#ffffff'), tr: hex(style.trColor, '#b8c7e0') };
  const color = colors.main;
  const block = (cue) => lineLayout(ctx, W, H, cue, { size, font: style.font, tx, showTr: style.showTr !== false, trScale: Number(style.trScale) || 0.6 });
  const paint = (c, w, blk, y, alpha, scale = 1) => paintBlock(c, w, blk, y, alpha, scale, color);
  // The next line is previewed below the whole current block (text and translation), without its own translation.
  const previewY = (above, own) => cy + above.height / 2 + gap + (own.main.height * PREVIEW_SCALE) / 2;

  const i = activeIndex(cues, t);
  const cur = cues[i], prev = cues[i - 1], next = cues[i + 1];
  // A line "hands over" to the next one when both are text and follow each other closely.
  const handsOver = (a, b) => hasText(a) && hasText(b) && b.t - a.t <= LONG_GAP;

  // Title card until the first line is announced.
  if (i < 0 && s.title) {
    const firstT = hasNextTime(cues[0]) ? cues[0].t : Infinity;
    const a = Math.min(clamp01(t / 0.8), clamp01((firstT - lead - t) / 0.6));
    const tb = layout(ctx, W, H, tx(s.title), { size: size * 1.15, font: style.font, weight: 700, maxLines: 2 });
    paint(ctx, W, tb, H * 0.47, a);
    if (s.subtitle) {
      const sb = layout(ctx, W, H, s.subtitle, { size: size * 0.45, font: style.font, weight: 400, maxLines: 2 });
      paint(ctx, W, sb, H * 0.47 + tb.height / 2 + size * 0.5, a * 0.75);
    }
  }

  let curBlock = null;
  if (hasText(cur)) {
    curBlock = block(cur);
    const age = t - cur.t;
    // Leave: just before a break cue, or by itself in a long gap.
    const hold = holdTime(cur, next, lead);
    let alpha = clamp01((cur.t + hold - t) / 0.5);
    if (hasNextTime(next) && !next.text) alpha = Math.min(alpha, clamp01((next.t - t) / 0.25));

    if (handsOver(prev, cur)) {
      // Arrive: slide up from the preview position while the previous line fades away;
      // the translation fades in as the line reaches its place.
      const k = ease(clamp01(age / HANDOVER));
      const prevBlock = block(prev);
      // The outgoing translation leaves first and the whole block moves up by its own height,
      // so it never crosses the incoming line.
      paintLine(ctx, W, prevBlock, mainCentre(prevBlock, cy) - k * (size * 0.9 + prevBlock.height - prevBlock.main.height), 1 - k, 1, colors, clamp01(1 - 3 * k));
      paintLine(ctx, W, curBlock, lerp(previewY(prevBlock, curBlock), mainCentre(curBlock, cy), k),
        alpha * lerp(PREVIEW_ALPHA, 1, k), lerp(PREVIEW_SCALE, 1, k), colors, k);
    } else {
      // Arrived on an empty screen (it was announced in place): brighten when it is sung.
      const sung = style.singCue && lead > 0 ? clamp01(age / 0.3) : 1;
      paintLine(ctx, W, curBlock, mainCentre(curBlock, cy), alpha * (lead > 0 ? lerp(0.7, 1, sung) : clamp01(age / 0.3)), 1, colors);
    }
  }

  // Announce the next line `lead` seconds early.
  if (hasText(next)) {
    const until = next.t - t;
    if (handsOver(cur, next)) {
      const window = style.showNext ? Infinity : lead;
      const a = style.showNext ? clamp01((t - cur.t) / 0.4) : clamp01((window - until) / 0.35);
      if (until <= window) paintLine(ctx, W, block(next), previewY(curBlock, block(next)), a * PREVIEW_ALPHA, PREVIEW_SCALE, colors, 0);
    } else if (until <= lead) {
      const nb = block(next);
      paintLine(ctx, W, nb, mainCentre(nb, cy), clamp01((lead - until) / 0.35) * (style.singCue ? 0.7 : 1), 1, colors);
    }
  }
}

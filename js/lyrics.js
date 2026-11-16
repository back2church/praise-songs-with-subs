// Lyrics model: an ordered list of cues { t: seconds | null, text: string }.
// A cue with empty text clears the screen (instrumental break).
// t === null means "not timed yet" (plain text waiting for tap-sync or auto-sync).

const GAP_BLANK = 2; // seconds of silence after a cue's end before we insert a blank cue

export function parseTime(s) {
  const m = String(s).trim().match(/^(?:(\d+):)?(\d+):(\d+(?:[.,]\d+)?)$/);
  if (!m) {
    const n = Number(String(s).trim().replace(',', '.'));
    return Number.isFinite(n) && String(s).trim() !== '' ? n : null;
  }
  return (Number(m[1] || 0) * 3600) + Number(m[2]) * 60 + Number(m[3].replace(',', '.'));
}

export function formatTime(t, digits = 2) {
  if (t == null || !Number.isFinite(t)) return '';
  t = Math.max(0, t);
  const m = Math.floor(t / 60);
  const s = t - m * 60;
  return `${m}:${s.toFixed(digits).padStart(digits ? digits + 3 : 2, '0')}`;
}

/** Turn [{start, end, text}] into cues, inserting blank cues in long gaps. */
export function segmentsToCues(segments) {
  const cues = [];
  segments.forEach((seg, i) => {
    cues.push({ t: seg.start, text: seg.text });
    const next = segments[i + 1];
    if (seg.end != null && (!next || next.start - seg.end > GAP_BLANK)) {
      cues.push({ t: seg.end + 0.5, text: '' });
    }
  });
  return cues;
}

function parseSubtitles(text) {
  const segments = [];
  for (const block of text.replace(/\r/g, '').split(/\n{2,}/)) {
    const lines = block.split('\n');
    const i = lines.findIndex((l) => l.includes('-->'));
    if (i < 0) continue;
    const [a, b] = lines[i].split('-->').map((p) => parseTime(p.trim().split(/\s+/)[0]));
    const body = lines.slice(i + 1).map((l) => l.replace(/<[^>]+>/g, '').trim()).filter(Boolean).join('\n');
    if (a == null || !body) continue;
    segments.push({ start: a, end: b, text: body });
  }
  segments.sort((x, y) => x.start - y.start);
  return segmentsToCues(segments);
}

function parseLrc(text) {
  const cues = [];
  for (const line of text.replace(/\r/g, '').split('\n')) {
    const stamps = [];
    let rest = line.trim();
    for (;;) {
      const m = rest.match(/^\[(\d+:\d+(?:[.:]\d+)?)\]/);
      if (!m) break;
      // [mm:ss:xx] is a rare variant of [mm:ss.xx]
      stamps.push(parseTime(m[1].replace(/^(\d+:\d+):(\d+)$/, '$1.$2')));
      rest = rest.slice(m[0].length);
    }
    for (const t of stamps) if (t != null) cues.push({ t, text: rest.trim() });
  }
  cues.sort((a, b) => a.t - b.t);
  return cues;
}

/** Parse SRT / WebVTT / LRC / plain text. Returns { cues, timed, format }. */
export function parseLyrics(text) {
  text = String(text || '').replace(/^﻿/, '');
  if (/-->/.test(text)) return { cues: parseSubtitles(text), timed: true, format: 'subtitles' };
  if (/^\s*\[\d+:\d+(?:[.:]\d+)?\]/m.test(text)) return { cues: parseLrc(text), timed: true, format: 'lrc' };
  const cues = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean).map((l) => ({ t: null, text: l }));
  return { cues, timed: false, format: 'plain' };
}

/** Meta tags like [ti:Title] from an LRC file. */
export function parseLrcMeta(text) {
  const meta = {};
  for (const m of String(text || '').matchAll(/^\s*\[([a-z]+):([^\]]*)\]\s*$/gim)) meta[m[1].toLowerCase()] = m[2].trim();
  return meta;
}

/** Index of the cue on screen at time t (last cue with cue.t <= t), or -1. */
export function activeIndex(cues, t) {
  let idx = -1;
  for (let i = 0; i < cues.length; i++) {
    if (cues[i].t == null || cues[i].t > t) break;
    idx = i;
  }
  return idx;
}

function lrcStamp(t) {
  const m = Math.floor(t / 60);
  return `[${String(m).padStart(2, '0')}:${(t - m * 60).toFixed(2).padStart(5, '0')}]`;
}

export function toLrc(cues, meta = {}) {
  const head = Object.entries(meta).filter(([, v]) => v).map(([k, v]) => `[${k}:${v}]`);
  const body = cues.filter((c) => c.t != null).map((c) => lrcStamp(c.t) + c.text.replace(/\n/g, ' '));
  return [...head, ...body].join('\n') + '\n';
}

function srtStamp(t) {
  const ms = Math.round(Math.max(0, t) * 1000);
  const p = (n, w = 2) => String(n).padStart(w, '0');
  return `${p(Math.floor(ms / 3600000))}:${p(Math.floor(ms / 60000) % 60)}:${p(Math.floor(ms / 1000) % 60)},${p(ms % 1000, 3)}`;
}

/** SRT with every cue shifted `lead` seconds early, so any player shows lines ahead of the singing. */
export function toSrt(cues, lead = 0, duration = Infinity) {
  const timed = cues.filter((c) => c.t != null);
  const out = [];
  timed.forEach((c, i) => {
    if (!c.text) return;
    const start = Math.max(0, c.t - lead);
    const end = Math.max(start + 0.2, Math.min(i + 1 < timed.length ? timed[i + 1].t - lead : c.t + 6, duration));
    out.push(`${out.length + 1}\n${srtStamp(start)} --> ${srtStamp(end)}\n${c.text}\n`);
  });
  return out.join('\n');
}

// ---------- Auto-sync: align known lyrics to speech-recognition word timestamps ----------

const norm = (w) => w.toLowerCase().normalize('NFKD').replace(/[^\p{L}\p{N}]/gu, '');

function similarity(a, b) {
  if (a === b) return 2;
  if (a.length >= 3 && b.length >= 3 && (a.startsWith(b) || b.startsWith(a))) return 1;
  return -1;
}

/**
 * Align lyric lines (as they are sung, in order) to recognised words [{text, start, end}].
 * Recognition of singing is imperfect, so we only need *some* words per line to match;
 * unmatched lines are interpolated between their neighbours.
 */
export function alignLyrics(lines, words) {
  const tokens = [];
  lines.forEach((line, li) => {
    const parts = line.split(/\s+/).map(norm).filter(Boolean);
    parts.forEach((w, pos) => tokens.push({ w, li, pos, count: parts.length }));
  });
  const rec = words.map((w) => ({ w: norm(w.text), start: w.start, end: w.end })).filter((w) => w.w);
  const n = tokens.length, m = rec.length;
  const lineStart = new Array(lines.length).fill(null);
  const lineEnd = new Array(lines.length).fill(null);

  if (n && m) {
    // Global alignment (Needleman–Wunsch), gap = -1.
    const W = m + 1;
    const score = new Float32Array((n + 1) * W);
    const move = new Uint8Array((n + 1) * W); // 1 diag, 2 up (skip lyric), 3 left (skip recognised)
    for (let i = 1; i <= n; i++) { score[i * W] = -i; move[i * W] = 2; }
    for (let j = 1; j <= m; j++) { score[j] = -j; move[j] = 3; }
    for (let i = 1; i <= n; i++) {
      for (let j = 1; j <= m; j++) {
        const d = score[(i - 1) * W + j - 1] + similarity(tokens[i - 1].w, rec[j - 1].w);
        const u = score[(i - 1) * W + j] - 1;
        const l = score[i * W + j - 1] - 1;
        const best = Math.max(d, u, l);
        score[i * W + j] = best;
        move[i * W + j] = best === d ? 1 : best === u ? 2 : 3;
      }
    }
    for (let i = n, j = m; i > 0 || j > 0;) {
      const mv = move[i * W + j];
      if (mv === 1) {
        const tok = tokens[i - 1], r = rec[j - 1];
        if (similarity(tok.w, r.w) > 0) {
          // Walking backwards, so the last assignment per line is its earliest matched word.
          // Estimate the line start when its first words were not recognised (~0.35 s per word).
          lineStart[tok.li] = r.start - tok.pos * 0.35;
          if (lineEnd[tok.li] == null) lineEnd[tok.li] = r.end + (tok.count - 1 - tok.pos) * 0.35;
        }
        i--; j--;
      } else if (mv === 2) i--;
      else j--;
    }
  }

  // Fill unmatched lines by interpolating between known neighbours.
  const known = lineStart.map((t, i) => (t == null ? -1 : i)).filter((i) => i >= 0);
  if (!known.length) return lines.map((text) => ({ t: null, text }));
  for (let i = 0; i < lines.length; i++) {
    if (lineStart[i] != null) continue;
    const prev = known.filter((k) => k < i).pop();
    const next = known.find((k) => k > i);
    if (prev != null && next != null) {
      lineStart[i] = lineStart[prev] + ((lineStart[next] - lineStart[prev]) * (i - prev)) / (next - prev);
    } else if (prev != null) lineStart[i] = lineStart[prev] + (i - prev) * 4;
    else lineStart[i] = Math.max(0, lineStart[next] - (next - i) * 4);
  }
  // Enforce increasing times.
  for (let i = 0; i < lines.length; i++) {
    lineStart[i] = Math.max(lineStart[i], i ? lineStart[i - 1] + 0.3 : 0);
  }
  const segments = lines.map((text, i) => ({
    text,
    start: lineStart[i],
    end: lineEnd[i] != null && lineEnd[i] > lineStart[i] ? lineEnd[i] : null,
  }));
  return segmentsToCues(segments);
}

/** No lyrics supplied: build lines straight from recognised words, breaking on pauses, punctuation and length. */
export function wordsToCues(words, maxChars = 38, pause = 0.7) {
  const segments = [];
  let cur = null;
  for (const w of words) {
    const text = w.text.trim();
    if (!text) continue;
    const sentenceEnd = cur && cur.text.length >= 15 && /[.,;:!?]$/.test(cur.text);
    if (cur && (sentenceEnd || w.start - cur.end > pause || (cur.text + ' ' + text).length > maxChars)) {
      segments.push(cur);
      cur = null;
    }
    if (!cur) cur = { start: w.start, end: w.end, text };
    else { cur.text += ' ' + text; cur.end = w.end; }
  }
  if (cur) segments.push(cur);
  return segmentsToCues(segments);
}

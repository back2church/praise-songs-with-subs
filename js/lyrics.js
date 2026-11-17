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
export function segmentsToCues(segments, gap = GAP_BLANK, pad = 0.5) {
  const cues = [];
  segments.forEach((seg, i) => {
    cues.push({ t: seg.start, text: seg.text });
    const next = segments[i + 1];
    if (seg.end != null && (!next || next.start - seg.end > gap)) {
      cues.push({ t: seg.end + pad, text: '' });
    }
  });
  return cues;
}

// ---------- Plain lyric sheets: section labels and repeats ----------

const SECTION_WORDS = 'pre[- ]?chorus|chorus|refrain|verse|vers|strophe|bridge|brücke|intro|outro|tag|ending|interlude|instrumental|zwischenspiel|coda|hook';
const TIMES = String.raw`(?:[(\[]\s*)?(?:x\s*(\d+)|(\d+)\s*x)(?:\s*[)\]])?`;
const SECTION_RE = new RegExp(String.raw`^(?:\[\s*([^\]]+?)\s*\]|((?:${SECTION_WORDS})\s*\d*))\s*:?\s*(?:${TIMES})?$`, 'i');
const LINE_TIMES_RE = new RegExp(String.raw`\s+${TIMES}$`, 'i');
const times = (a, b) => Math.min(8, Math.max(1, Number(a || b || 1)));

/**
 * Expand a lyric sheet into the lines as they are sung:
 *  - "Chorus" / "[Chorus]" / "Verse 2:" label the lines that follow (labels are not shown)
 *  - the same label again, with no lines under it, repeats that section
 *  - "x2" / "(2x)" after a label or at the end of a line repeats it
 */
export function expandSections(text) {
  const out = [];
  const sections = new Map();
  let open = null; // { name, times, lines }
  const close = () => {
    if (!open) return;
    if (open.lines.length) {
      sections.set(open.name, open.lines);
      for (let k = 1; k < open.times; k++) out.push(...open.lines);
    } else if (sections.has(open.name)) {
      for (let k = 0; k < open.times; k++) out.push(...sections.get(open.name));
    }
    open = null;
  };
  for (const raw of String(text).split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) { close(); continue; }
    const h = line.match(SECTION_RE);
    if (h) {
      close();
      open = { name: (h[1] || h[2]).trim().toLowerCase().replace(/\s+/g, ' '), times: times(h[3], h[4]), lines: [] };
      continue;
    }
    const r = line.match(LINE_TIMES_RE);
    const body = r ? line.slice(0, r.index).trim() : line;
    for (let k = 0; k < (r ? times(r[1], r[2]) : 1); k++) {
      out.push(body);
      if (open) open.lines.push(body);
    }
  }
  close();
  return out;
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
  const cues = expandSections(text).map((l) => ({ t: null, text: l }));
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

/** SRT where every line appears `lead` seconds early and stays until the next line is sung (lines overlap). */
export function toSrt(cues, lead = 0, duration = Infinity) {
  const timed = cues.filter((c) => c.t != null);
  const out = [];
  timed.forEach((c, i) => {
    if (!c.text) return;
    const start = Math.max(0, c.t - lead);
    const end = Math.max(start + 0.2, Math.min(i + 1 < timed.length ? timed[i + 1].t : c.t + 6, duration));
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

const JUMP = 5; // cost of jumping to another line (repeat of a chorus, or skipping an unsung verse)

/**
 * Align lyric lines to recognised words [{text, start, end}] and return timed cues.
 *
 * The lyric sheet usually lists the chorus once while the song repeats it, so the
 * alignment may jump from the end of any line to the start of any other line. Lines
 * the singer comes back to are emitted again; every lyric line is emitted at least once.
 * Recognition of singing is imperfect: lines without matched words are interpolated.
 */
export function alignLyrics(lines, words) {
  const untimed = () => lines.map((text) => ({ t: null, text }));
  const tokens = [];
  const bounds = [0]; // token positions where a line starts / ends
  lines.forEach((line, li) => {
    let parts = line.split(/\s+/).map(norm).filter(Boolean);
    if (!parts.length) parts = ['\u0000']; // never matches, keeps the line in the path
    parts.forEach((w, pos) => tokens.push({ w, li, pos, count: parts.length }));
    bounds.push(tokens.length);
  });
  const rec = words.map((w) => ({ w: norm(w.text), start: w.start, end: w.end })).filter((w) => w.w);
  const n = tokens.length, m = rec.length;
  if (!n || !m) return untimed();

  // score[i][j]: best alignment that has just consumed lyric token i and recognised word j.
  const W = m + 1;
  const at = (i, j) => i * W + j;
  const score = new Float32Array((n + 1) * W);
  const move = new Uint8Array((n + 1) * W); // 1 match, 2 skip lyric word, 3 skip recognised word, 4 jump
  const jumpFrom = new Int32Array(bounds.length * W);
  const boundIndex = new Map(bounds.map((b, k) => [b, k]));
  for (let j = 0; j <= m; j++) {
    for (let i = 0; i <= n; i++) {
      if (!i && !j) continue;
      let best = -Infinity, mv = 0;
      if (i && j) { best = score[at(i - 1, j - 1)] + similarity(tokens[i - 1].w, rec[j - 1].w); mv = 1; }
      if (i && score[at(i - 1, j)] - 1 > best) { best = score[at(i - 1, j)] - 1; mv = 2; }
      if (j && score[at(i, j - 1)] - 1 > best) { best = score[at(i, j - 1)] - 1; mv = 3; }
      score[at(i, j)] = best;
      move[at(i, j)] = mv;
    }
    if (!j) continue;
    // Jump from the best line end to any line start, then let skips continue from there.
    let from = bounds[1];
    for (const b of bounds.slice(1)) if (score[at(b, j)] > score[at(from, j)]) from = b;
    const jumped = score[at(from, j)] - JUMP;
    bounds.forEach((b, k) => {
      if (b === n || jumped <= score[at(b, j)]) return;
      score[at(b, j)] = jumped;
      move[at(b, j)] = 4;
      jumpFrom[k * W + j] = from;
    });
    for (let i = 1; i <= n; i++) {
      if (score[at(i - 1, j)] - 1 > score[at(i, j)]) { score[at(i, j)] = score[at(i - 1, j)] - 1; move[at(i, j)] = 2; }
    }
  }

  // Trace back from the best end state (the song may end on a repeated chorus).
  let i = 0;
  for (let k = 1; k <= n; k++) if (score[at(k, m)] >= score[at(i, m)]) i = k;
  const steps = [];
  for (let j = m; i > 0 || j > 0;) {
    const mv = move[at(i, j)];
    if (mv === 1) {
      steps.push({ tok: i - 1, word: similarity(tokens[i - 1].w, rec[j - 1].w) > 0 ? j - 1 : null });
      i--; j--;
    } else if (mv === 2) { steps.push({ tok: i - 1, word: null }); i--; }
    else if (mv === 3) j--;
    else { steps.push({ jump: true }); i = jumpFrom[boundIndex.get(i) * W + j]; }
  }
  steps.reverse();

  // Group the path into visits of whole lines; a new "pass" starts after every jump.
  const visits = [];
  let cur = null, pass = 0;
  for (const s of steps) {
    if (s.jump) { pass++; cur = null; continue; }
    const tok = tokens[s.tok];
    if (!cur || cur.li !== tok.li) { cur = { li: tok.li, pass, start: null, end: null, matched: 0 }; visits.push(cur); }
    if (s.word != null) {
      const r = rec[s.word];
      // Estimate the line start when its first words were not recognised (~0.35 s per word).
      if (cur.start == null) cur.start = r.start - tok.pos * 0.35;
      cur.end = r.end + (tok.count - 1 - tok.pos) * 0.35;
      cur.matched++;
    }
  }
  if (!visits.some((v) => v.matched)) return untimed();

  // Keep every first visit; keep a repeated visit only when it was clearly heard.
  const passMatched = new Map();
  for (const v of visits) passMatched.set(v.pass, (passMatched.get(v.pass) || 0) + v.matched);
  const seen = new Set();
  let kept = visits.filter((v, k) => {
    const first = !seen.has(v.li);
    seen.add(v.li);
    if (first) return true;
    if (passMatched.get(v.pass) < 3) return false;
    const samePass = (u) => u.pass === v.pass && u.matched;
    return v.matched > 0 || (visits.slice(0, k).some(samePass) && visits.slice(k + 1).some(samePass));
  });

  // Lines the path never reached (not sung, or not understood) are still shown, after their predecessor.
  for (let li = 0; li < lines.length; li++) {
    if (seen.has(li)) continue;
    const prev = kept.findIndex((v) => v.li === li - 1);
    kept.splice(prev + 1, 0, { li, start: null, end: null, matched: 0 });
    seen.add(li);
  }

  // Fill unmatched entries by interpolating between known neighbours, then force increasing times.
  const known = kept.map((v, k) => (v.start == null ? -1 : k)).filter((k) => k >= 0);
  kept.forEach((v, k) => {
    if (v.start != null) return;
    const prev = known.filter((x) => x < k).pop();
    const next = known.find((x) => x > k);
    if (prev != null && next != null) v.start = kept[prev].start + ((kept[next].start - kept[prev].start) * (k - prev)) / (next - prev);
    else if (prev != null) v.start = kept[prev].start + (k - prev) * 4;
    else v.start = Math.max(0, kept[next].start - (next - k) * 4);
  });
  kept.forEach((v, k) => { v.start = Math.max(v.start, k ? kept[k - 1].start + 0.3 : 0); });

  // Sung notes are often held longer than the recogniser reports, so only clear the
  // screen in clearly instrumental gaps.
  return segmentsToCues(kept.map((v) => ({
    text: lines[v.li],
    start: v.start,
    end: v.end != null && v.end > v.start ? v.end : null,
  })), 5, 1.5);
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

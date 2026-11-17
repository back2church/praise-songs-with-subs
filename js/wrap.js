// Line breaking for lyrics: balanced lines that prefer to break between phrases
// ("…, / and …") instead of filling the first line and leaving one word over.

const AFTER_PUNCT = /[,;:.!?…–—]["'”’)]?$/;
// Words that like to start a line …
const STARTERS = new Set(('and or but for nor so yet that who whom whose which when where while because if as than until though '
  + 'und oder aber denn dass weil wenn als wie wo der die das dem den des doch bis ob damit').split(' '));
// … and words that should not be left at the end of one.
const WEAK_ENDS = new Set(('a an the of to in on at by with from my your his her our their thy and or '
  + 'ein eine einen einem einer der die das dem den des von zu zum zur im in an am auf mit bei mein dein sein unser euer und oder').split(' '));
const bare = (w) => w.toLowerCase().replace(/[^\p{L}\p{N}]/gu, '');

/**
 * Split words into lines no wider than maxWidth.
 * @param words string[]
 * @param widths number[] rendered width of each word
 * @param space width of a space
 * @returns string[] lines
 */
export function breakLines(words, widths, space, maxWidth) {
  const n = words.length;
  const prefix = [0];
  for (const w of widths) prefix.push(prefix[prefix.length - 1] + w);
  const width = (i, j) => prefix[j] - prefix[i] + (j - i - 1) * space; // words i..j-1
  const total = width(0, n);
  if (total <= maxWidth || n < 2) return [words.join(' ')];

  // Quality of breaking between word j-1 and word j (lower is better).
  const breakCost = (j) => {
    if (AFTER_PUNCT.test(words[j - 1])) return -0.12;
    if (STARTERS.has(bare(words[j]))) return -0.05;
    if (WEAK_ENDS.has(bare(words[j - 1]))) return 0.08;
    return 0;
  };

  for (let count = Math.max(2, Math.ceil(total / maxWidth)); count <= n; count++) {
    const target = total / count;
    // best[k][j]: lowest cost of putting the first j words on k lines
    const best = Array.from({ length: count + 1 }, () => new Array(n + 1).fill(Infinity));
    const from = Array.from({ length: count + 1 }, () => new Array(n + 1).fill(0));
    best[0][0] = 0;
    for (let k = 1; k <= count; k++) {
      for (let j = k; j <= n; j++) {
        for (let i = k - 1; i < j; i++) {
          const w = width(i, j);
          if (w > maxWidth && j - i > 1) continue; // a single over-long word is allowed
          const cost = best[k - 1][i] + ((w - target) / target) ** 2 + (i ? breakCost(i) : 0);
          if (cost < best[k][j]) { best[k][j] = cost; from[k][j] = i; }
        }
      }
    }
    if (best[count][n] === Infinity) continue;
    const lines = [];
    for (let k = count, j = n; k > 0; k--) {
      const i = from[k][j];
      lines.unshift(words.slice(i, j).join(' '));
      j = i;
    }
    return lines;
  }
  return words;
}

/** Wrap text using a measuring function; "|" or a newline forces a break. */
export function wrapText(text, measure, maxWidth) {
  const out = [];
  const space = measure(' ');
  for (const para of text.split(/\s*[|\n]\s*/)) {
    const words = para.split(/\s+/).filter(Boolean);
    if (words.length) out.push(...breakLines(words, words.map(measure), space, maxWidth));
  }
  return out;
}

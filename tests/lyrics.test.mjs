import test from 'node:test';
import assert from 'node:assert/strict';
import { expandSections, parseLyrics, parseTime, formatTime, activeIndex, toLrc, toSrt, alignLyrics, wordsToCues, parseLrcMeta } from '../js/lyrics.js';

test('parseTime / formatTime', () => {
  assert.equal(parseTime('1:02.50'), 62.5);
  assert.equal(parseTime('00:01:02,500'), 62.5);
  assert.equal(parseTime('12.3'), 12.3);
  assert.equal(parseTime('abc'), null);
  assert.equal(formatTime(62.5), '1:02.50');
  assert.equal(formatTime(5, 0), '0:05');
});

test('plain text gives untimed cues and skips blank lines', () => {
  const { cues, timed } = parseLyrics('Line one\n\n  Line two  \n');
  assert.equal(timed, false);
  assert.deepEqual(cues, [{ t: null, text: 'Line one' }, { t: null, text: 'Line two' }]);
});

test('LRC with meta, repeated stamps and blank cue', () => {
  const src = '[ti:My Song]\n[00:10.00][00:30.00]Chorus\n[00:20.50]Verse\n[00:25.00]\n';
  const { cues, timed } = parseLyrics(src);
  assert.equal(timed, true);
  assert.deepEqual(cues.map((c) => [c.t, c.text]), [[10, 'Chorus'], [20.5, 'Verse'], [25, ''], [30, 'Chorus']]);
  assert.equal(parseLrcMeta(src).ti, 'My Song');
});

test('SRT / VTT: multi-line text, blank cue after long gap', () => {
  const src = 'WEBVTT\n\n1\n00:00:05,000 --> 00:00:08,000\nFirst\nline\n\n2\n00:00:08.200 --> 00:00:11.000\n<i>Second</i>\n\n3\n00:00:30,000 --> 00:00:33,000\nThird\n';
  const { cues } = parseLyrics(src);
  assert.deepEqual(cues.map((c) => [c.t, c.text]), [[5, 'First\nline'], [8.2, 'Second'], [11.5, ''], [30, 'Third'], [33.5, '']]);
});

test('activeIndex ignores untimed cues', () => {
  const cues = [{ t: 1, text: 'a' }, { t: 5, text: 'b' }, { t: null, text: 'c' }];
  assert.equal(activeIndex(cues, 0.5), -1);
  assert.equal(activeIndex(cues, 1), 0);
  assert.equal(activeIndex(cues, 99), 1);
});

test('LRC round trip and SRT export with lead', () => {
  const cues = [{ t: 10, text: 'One' }, { t: 14, text: '' }, { t: 20, text: 'Two' }];
  assert.deepEqual(parseLyrics(toLrc(cues, { ti: 'T' })).cues, cues);
  const srt = toSrt(cues, 1.5, 24);
  assert.match(srt, /1\n00:00:08,500 --> 00:00:14,000\nOne/);
  assert.match(srt, /2\n00:00:18,500 --> 00:00:24,000\nTwo/);
});

test('alignLyrics tolerates misheard and missing words', () => {
  const lines = ['Amazing grace how sweet the sound', 'That saved a wretch like me', 'I once was lost but now am found', 'Was blind but now I see'];
  const heard = 'amazing grace how sweet the sound that saved a wrench like me oh I once was lost but now found was blind but now I see';
  const starts = { 0: 10, 6: 16, 12: 22, 20: 40 }; // index of heard word -> time ("oh" at 22 is an ad-lib)
  let t = 0;
  const words = heard.split(' ').map((text, i) => {
    if (starts[i] != null) t = starts[i];
    const w = { text, start: t, end: t + 0.4 };
    t += 0.5;
    return w;
  });
  const cues = alignLyrics(lines, words);
  const sung = cues.filter((c) => c.text);
  assert.deepEqual(sung.map((c) => c.text), lines);
  [10, 16, 22.5, 40].forEach((want, i) => assert.ok(Math.abs(sung[i].t - want) < 0.6, `line ${i} at ${sung[i].t}, want ~${want}`));
  // long instrumental gap before the last line clears the screen
  assert.equal(cues[cues.indexOf(sung[3]) - 1].text, '');
});

test('alignLyrics interpolates lines that were not recognised at all', () => {
  const words = [{ text: 'first', start: 5, end: 5.5 }, { text: 'third', start: 15, end: 15.5 }];
  const cues = alignLyrics(['first', 'zzz', 'third'], words).filter((c) => c.text);
  assert.deepEqual(cues.map((c) => c.t), [5, 10, 15]);
});

test('alignLyrics reports failure with untimed cues', () => {
  const cues = alignLyrics(['hello world'], [{ text: 'xyz', start: 1, end: 2 }]);
  assert.deepEqual(cues, [{ t: null, text: 'hello world' }]);
});

test('wordsToCues breaks on pauses and length', () => {
  const words = [
    { text: ' Holy', start: 1, end: 1.4 }, { text: ' holy', start: 1.5, end: 1.9 },
    { text: ' LORD', start: 3, end: 3.5 },
  ];
  const cues = wordsToCues(words).filter((c) => c.text);
  assert.deepEqual(cues.map((c) => [c.t, c.text]), [[1, 'Holy holy'], [3, 'LORD']]);
});

test('section labels, repeated sections and x2', () => {
  const sheet = `Verse 1
v1 a
v1 b

[Chorus]
c a
c b x2

Verse 2:
v2 a

Chorus

Bridge (x2)
b a

chorus x2`;
  assert.deepEqual(expandSections(sheet), [
    'v1 a', 'v1 b', 'c a', 'c b', 'c b', 'v2 a', 'c a', 'c b', 'c b', 'b a', 'b a',
    'c a', 'c b', 'c b', 'c a', 'c b', 'c b',
  ]);
  assert.equal(parseLyrics(sheet).cues.length, 17);
});

function sing(parts) { // [[startTime, 'words words'], ...] -> recognised words
  const words = [];
  for (const [start, text] of parts) text.split(' ').forEach((w, k) => words.push({ text: w, start: start + k * 0.5, end: start + k * 0.5 + 0.4 }));
  return words;
}

test('alignLyrics repeats a chorus that is written once but sung three times', () => {
  const lines = [
    'Amazing grace how sweet the sound', 'That saved a wretch like me',
    'Praise the LORD oh my soul', 'Worship His holy name',
    'Through many dangers toils and snares', 'I have already come',
  ];
  const [v1a, v1b, c1, c2, v2a, v2b] = lines;
  const words = sing([[10, v1a], [15, v1b], [20, c1], [25, c2], [30, v2a], [35, v2b], [40, c1], [45, c2], [50, c1], [55, c2]]);
  const cues = alignLyrics(lines, words).filter((c) => c.text);
  assert.deepEqual(cues.map((c) => c.text), [v1a, v1b, c1, c2, v2a, v2b, c1, c2, c1, c2]);
  assert.deepEqual(cues.map((c) => Math.round(c.t)), [10, 15, 20, 25, 30, 35, 40, 45, 50, 55]);
});

test('alignLyrics jumps forward to a later verse after a repeated chorus and keeps unsung lines', () => {
  const lines = ['first verse line one here', 'chorus of praise we sing', 'second verse line two there', 'never sung closing words today'];
  const [v1, c, v2, x] = lines;
  const words = sing([[5, v1], [10, c], [15, c], [20, v2], [25, c]]);
  const cues = alignLyrics(lines, words).filter((k) => k.text);
  assert.deepEqual(cues.slice(0, 4).map((k) => [k.text, Math.round(k.t)]), [[v1, 5], [c, 10], [c, 15], [v2, 20]]);
  assert.equal(cues.filter((k) => k.text === c).length, 3);
  assert.equal(cues.filter((k) => k.text === x).length, 1);
});

test('alignLyrics does not invent repeats from a few stray words', () => {
  const lines = ['holy holy holy', 'LORD GOD almighty'];
  const words = sing([[5, 'holy holy holy'], [10, 'LORD GOD almighty'], [20, 'yeah oh holy yeah']]);
  assert.deepEqual(alignLyrics(lines, words).filter((c) => c.text).map((c) => c.text), lines);
});

import { breakLines, wrapText } from '../js/wrap.js';
const measure = (w) => w.length; // 1 unit per character

test('wrapping balances lines and breaks between phrases', () => {
  assert.deepEqual(wrapText('Short line', measure, 30), ['Short line']);
  // greedy filling would leave "Thee" alone on the second line
  const two = wrapText('Early in the morning our song shall rise to Thee', measure, 44);
  assert.equal(two.length, 2);
  assert.ok(Math.abs(two[0].length - two[1].length) <= 8, two.join(' / '));
  // prefers the comma over a perfectly even split
  assert.deepEqual(wrapText('Holy, holy, holy, merciful and mighty', measure, 30), ['Holy, holy, holy,', 'merciful and mighty']);
  // does not end a line on "the"
  assert.ok(!/ (the|of|to)$/i.test(wrapText('We lift our voices to the King of all the earth', measure, 30)[0]));
  // manual break with |
  assert.deepEqual(wrapText('Holy | holy holy', measure, 30), ['Holy', 'holy holy']);
  // never wider than allowed
  for (const l of wrapText('GOD in three Persons blessed Trinity forever and ever amen amen', measure, 20)) assert.ok(l.length <= 20, l);
  assert.deepEqual(breakLines(['Supercalifragilistic'], [20], 1, 10), ['Supercalifragilistic']);
});

import { listSections, retimeFrom } from '../js/lyrics.js';

test('listSections: labelled sections once each, unlabelled stanzas named by first words', () => {
  const secs = listSections('Verse 1\nv1 a\nv1 b\n\n[Chorus]\nc a x2\n\nChorus\n\nlast stanza with many words here\nend');
  assert.deepEqual(secs.map((s) => s.label), ['Verse 1', 'Chorus', '“last stanza with many …”']);
  assert.deepEqual(secs[1].lines, ['c a', 'c a']);
  assert.deepEqual(listSections('[00:01.00]timed'), []);
});

test('retimeFrom moves the line and every later line by the same amount', () => {
  const cues = [{ t: 1, text: 'a' }, { t: 5, text: 'b' }, { t: 8, text: '' }, { t: 12, text: 'c' }, { t: null, text: 'd' }];
  assert.equal(retimeFrom(cues, 1, 6.5), 1.5);
  assert.deepEqual(cues.map((c) => c.t), [1, 6.5, 9.5, 13.5, null]);
  retimeFrom(cues, 1, 0); // never negative
  assert.deepEqual(cues.map((c) => c.t), [1, 0, 3, 7, null]);
});

test('a break with the same time as the line before it does not hide that line', () => {
  const cues = [{ t: 10, text: 'JESUS ich bin ganz DEIN' }, { t: 10, text: '' }, { t: 14, text: 'Öffne die Himmel' }];
  assert.equal(activeIndex(cues, 11), 0);
  assert.equal(activeIndex(cues, 14), 2);
  const later = [{ t: 10, text: 'a' }, { t: 12, text: '' }];
  assert.equal(activeIndex(later, 13), 1);
});

import { splitTranslation, pairTranslation, applyTranslations } from '../js/lyrics.js';

test('inline translations with //', () => {
  assert.deepEqual(splitTranslation('Öffne die Himmel // Open the heavens'), { text: 'Öffne die Himmel', tr: 'Open the heavens' });
  assert.deepEqual(splitTranslation('no translation'), { text: 'no translation' });
  assert.deepEqual(splitTranslation('http://example.com'), { text: 'http://example.com' });
  const { cues } = parseLyrics('Chorus\nÖffne die Himmel // Open the heavens\n\nChorus');
  assert.deepEqual(cues.map((c) => [c.text, c.tr]), [['Öffne die Himmel', 'Open the heavens'], ['Öffne die Himmel', 'Open the heavens']]);
  assert.ok(!('tr' in parseLyrics('plain').cues[0]));
});

test('translation box is paired line by line, with labels and repeats', () => {
  const de = 'Strophe 1\nJESUS ich bin ganz DEIN\nÖffne die Himmel\n\nRefrain\nWeite das Tor\n\nRefrain';
  const en = 'Verse 1\nJESUS I am all Yours\nOpen the heavens\n\nChorus\nWiden the gate\n\nChorus';
  const { map, lyricsCount, translationCount } = pairTranslation(de, en);
  assert.equal(lyricsCount, 4); assert.equal(translationCount, 4);
  const cues = [{ t: 1, text: 'JESUS ich bin ganz DEIN' }, { t: 3, text: '' }, { t: 5, text: 'Weite das Tor' }, { t: 9, text: 'Weite das Tor' }];
  assert.equal(applyTranslations(cues, map), 3);
  assert.deepEqual(cues.map((c) => c.tr), ['JESUS I am all Yours', undefined, 'Widen the gate', 'Widen the gate']);
});

test('LRC and SRT keep translations', () => {
  const cues = [{ t: 2, text: 'Öffne die Himmel', tr: 'Open the heavens' }, { t: 6, text: 'Weite das Tor' }];
  assert.deepEqual(parseLyrics(toLrc(cues)).cues, cues);
  assert.match(toSrt(cues), /Öffne die Himmel\nOpen the heavens\n/);
});

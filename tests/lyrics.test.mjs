import test from 'node:test';
import assert from 'node:assert/strict';
import { parseLyrics, parseTime, formatTime, activeIndex, toLrc, toSrt, alignLyrics, wordsToCues, parseLrcMeta } from '../js/lyrics.js';

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
  assert.match(srt, /1\n00:00:08,500 --> 00:00:12,500\nOne/);
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

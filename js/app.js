import { parseLyrics, parseLrcMeta, listSections, retimeFrom, splitTranslation, pairTranslation, applyTranslations, translationsOf, parseTime, formatTime, activeIndex, toLrc, toSrt, alignLyrics, wordsToCues } from './lyrics.js';
import { THEMES, PALETTES, customPalette } from './backgrounds.js';
import { drawFrame } from './renderer.js';

const $ = (id) => document.getElementById(id);
const media = $('media');
const canvas = $('canvas');
const ctx = canvas.getContext('2d');
const stage = $('stage');

const state = {
  cues: [],
  file: null,
  hasVideo: false,
  bgMedia: null, // user-supplied background image / video
  tap: null, // { index } while tap-sync is running
  recorder: null,
  busy: false, // auto-sync running
  sections: [], // sections of the lyric sheet, for inserting repeats while tapping
};

// ---------- Settings (remembered between visits) ----------

const LOOK = ['showTr', 'trColor', 'trScale', 'lead', 'theme', 'palette', 'position', 'font', 'scale', 'dim', 'singCue', 'showNext', 'caps', 'textColor', 'bgColor', 'customA', 'customB'];
const SETTINGS = [...LOOK, 'ripple', 'language', 'model', 'resolution'];

for (const [key, t] of Object.entries(THEMES)) $('theme').add(new Option(t.name, key));
for (const [key, p] of Object.entries(PALETTES)) $('palette').add(new Option(p.name, key));
$('palette').add(new Option('Own colours…', 'custom'));

function readStore(key) {
  try { return JSON.parse(localStorage.getItem(key) || '{}') || {}; } catch { return {}; } // storage unavailable
}

function applySettings(saved, ids) {
  for (const id of ids) {
    const el = $(id);
    if (!(id in saved)) continue;
    if (el.type === 'checkbox') el.checked = !!saved[id];
    else if (el.tagName !== 'SELECT' || [...el.options].some((o) => o.value === saved[id])) el.value = saved[id];
  }
}

const loadSettings = () => applySettings(readStore('psws-settings'), SETTINGS);
const currentValues = (ids) => Object.fromEntries(ids.map((id) => [id, $(id).type === 'checkbox' ? $(id).checked : $(id).value]));

function saveSettings() {
  try { localStorage.setItem('psws-settings', JSON.stringify(currentValues(SETTINGS))); } catch { /* storage unavailable */ }
}

loadSettings();
for (const id of SETTINGS) $(id).addEventListener('input', () => { saveSettings(); refresh(); });

// ---------- Templates: named sets of the "Look" settings, kept in this browser ----------

function renderTemplates(selected = '') {
  const sel = $('template');
  sel.length = 1;
  for (const name of Object.keys(readStore('psws-templates')).sort()) sel.add(new Option(name, name));
  sel.value = selected;
  $('templateDelete').disabled = !sel.value;
}

$('template').addEventListener('change', () => {
  const tpl = readStore('psws-templates')[$('template').value];
  if (tpl) { applySettings(tpl, LOOK); saveSettings(); }
  $('templateDelete').disabled = !$('template').value;
  refresh();
});

$('templateSave').addEventListener('click', () => {
  const name = (prompt('Name for this template (an existing name is overwritten):', $('template').value || '') || '').trim();
  if (!name) return;
  const all = readStore('psws-templates');
  all[name] = currentValues(LOOK);
  try { localStorage.setItem('psws-templates', JSON.stringify(all)); } catch { return setStatus('Templates cannot be saved in this browser (storage is blocked).', true); }
  renderTemplates(name);
});

$('templateDelete').addEventListener('click', () => {
  const all = readStore('psws-templates');
  delete all[$('template').value];
  try { localStorage.setItem('psws-templates', JSON.stringify(all)); } catch { /* storage unavailable */ }
  renderTemplates();
});

renderTemplates();

// ---------- Helpers ----------

function setStatus(text, error = false) {
  const el = $('status');
  el.hidden = !text;
  el.textContent = text || '';
  el.classList.toggle('error', error);
}

function download(blob, name) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 10000);
}

function baseName() {
  const raw = $('title').value.trim() || (state.file ? state.file.name.replace(/\.[^.]+$/, '') : 'worship-song');
  return raw.replace(/[\\/:*?"<>|]+/g, ' ').trim() || 'worship-song';
}

const timedCount = () => state.cues.filter((c) => c.t != null).length;

/** Keep timed cues in time order, untimed ones after them in their original order. */
function sortCues() {
  const timed = state.cues.filter((c) => c.t != null).sort((a, b) => a.t - b.t);
  state.cues = [...timed, ...state.cues.filter((c) => c.t == null)];
}

function refresh() {
  const hasMedia = !!state.file;
  const hasTimed = timedCount() > 0;
  const rec = !!state.recorder;
  $('leadValue').textContent = `${Number($('lead').value).toFixed(1)} s`;
  $('play').disabled = $('seek').disabled = !hasMedia || rec;
  $('tapSync').disabled = !hasMedia || !state.cues.length || rec || state.busy;
  $('autoSync').disabled = !hasMedia || rec || state.busy || !!state.tap;
  $('present').disabled = !hasMedia || rec;
  $('record').disabled = !hasMedia || !!state.tap || state.busy;
  $('saveLrc').disabled = $('saveSrt').disabled = !hasTimed;
  $('tapSync').textContent = state.tap ? 'Stop tapping' : 'Tap along';
  $('tapSync').classList.toggle('active', !!state.tap);
  $('record').textContent = rec ? 'Stop & save' : 'Export video';
  $('record').classList.toggle('active', rec);
  $('tapHelp').hidden = !state.tap;
  $('recBadge').hidden = !rec;
  $('bgClear').hidden = !state.bgMedia;
  $('play').textContent = media.paused ? '▶' : '❚❚';
  const plain = $('theme').value === 'solid' && !state.bgMedia;
  $('bgColorLabel').style.visibility = plain ? 'visible' : 'hidden';
  $('palette').disabled = $('dim').disabled = plain;
  $('customColors').hidden = plain || $('palette').value !== 'custom';
}

// ---------- Song ----------

$('mediaFile').addEventListener('change', (e) => {
  const file = e.target.files[0];
  if (!file) return;
  stopTap();
  state.file = file;
  $('mediaName').textContent = file.name;
  if (media.src) URL.revokeObjectURL(media.src);
  media.src = URL.createObjectURL(file);
  media.load();
});

media.addEventListener('loadedmetadata', () => {
  state.hasVideo = media.videoWidth > 0;
  $('seek').max = media.duration || 1;
  const opt = [...$('theme').options].find((o) => o.value === 'source');
  if (state.hasVideo && !opt) $('theme').add(new Option('Video from the song file', 'source'));
  if (!state.hasVideo && opt) { if ($('theme').value === 'source') $('theme').value = 'aurora'; opt.remove(); }
  refresh();
});
media.addEventListener('error', () => {
  if (state.file) setStatus(`This browser cannot play “${state.file.name}”. Try MP3, M4A, WAV or MP4.`, true);
});
for (const ev of ['play', 'pause', 'ended']) media.addEventListener(ev, refresh);

function togglePlay() {
  if (!state.file || state.recorder) return;
  if (media.paused) media.play(); else media.pause();
}
$('play').addEventListener('click', togglePlay);
$('seek').addEventListener('input', () => { media.currentTime = Number($('seek').value); });

// ---------- Lyrics ----------

$('lyricsFile').addEventListener('change', async (e) => {
  const file = e.target.files[0];
  if (!file) return;
  $('lyricsText').value = await file.text();
  e.target.value = '';
  applyLyrics();
});
$('applyLyrics').addEventListener('click', applyLyrics);

function applyLyrics() {
  const text = $('lyricsText').value;
  const { cues, timed } = parseLyrics(text);
  if (!cues.length) return setStatus('No lyrics found – paste some text first.', true);
  if (timedCount() && !timed && !confirm('Replace the current lyrics and their timing?')) return;
  stopTap();
  state.cues = cues;
  state.sections = timed ? [] : listSections(text);
  applyTranslationText(false);
  const meta = parseLrcMeta(text);
  if (meta.ti && !$('title').value) $('title').value = meta.ti;
  if (meta.ar && !$('subtitle').value) $('subtitle').value = meta.ar;
  setStatus(timed ? `${cues.filter((c) => c.text).length} timed lines loaded.` : `${cues.length} lines loaded (repeats written out). Now set the timing: tap along or auto-sync.`);
  renderCues();
  refresh();
}

// ---------- Translation ----------

/** Match the translation box line by line to the lyrics box and put each translation on its line. */
function applyTranslationText(rerender = true) {
  const trText = $('trText').value;
  if (!trText.trim()) { $('trInfo').textContent = ''; return; }
  const { map, lyricsCount, translationCount } = pairTranslation($('lyricsText').value, trText);
  const matched = applyTranslations(state.cues, map);
  const total = state.cues.filter((c) => c.text).length;
  $('trInfo').textContent = lyricsCount === translationCount
    ? `${matched} of ${total} lines have a translation.`
    : `Lyrics have ${lyricsCount} lines, the translation ${translationCount}: check that they line up. ${matched} of ${total} lines matched.`;
  if (rerender) renderCues();
}

let trTimer = 0;
$('trText').addEventListener('input', () => {
  clearTimeout(trTimer);
  trTimer = setTimeout(() => applyTranslationText(), 300);
});

// ---------- Cue list ----------

let shownCurrent = -2;

function renderCues() {
  const hasTranslations = state.cues.some((c) => c.tr) || !!$('trText').value.trim();
  const list = $('cueList');
  list.textContent = '';
  shownCurrent = -2;
  state.cues.forEach((cue, i) => {
    const li = document.createElement('li');
    const time = Object.assign(document.createElement('input'), { className: 'time', value: formatTime(cue.t), placeholder: '–:––', title: 'Start time' });
    const text = Object.assign(document.createElement('input'), { value: cue.text, placeholder: '(break – empty screen)' });
    const tr = Object.assign(document.createElement('input'), { className: 'tr', value: cue.tr || '', placeholder: cue.text ? 'translation' : '' });
    tr.setAttribute('aria-label', `Translation of line ${i + 1}`);
    tr.hidden = !cue.text || !hasTranslations;
    tr.addEventListener('input', () => { cue.tr = tr.value.trim() || undefined; });
    const texts = document.createElement('div');
    texts.className = 'texts';
    texts.append(text, tr);
    const del = Object.assign(document.createElement('button'), { textContent: '×', title: 'Delete line' });
    const stamp = Object.assign(document.createElement('button'), { textContent: '⏱', className: 'stamp', title: 'Set to the current song position' });
    time.setAttribute('aria-label', `Start time of line ${i + 1}`);
    text.setAttribute('aria-label', `Text of line ${i + 1}`);
    // Clicking anywhere on a line jumps the song to it.
    li.addEventListener('click', (e) => {
      if (e.target !== del && e.target !== stamp && cue.t != null && state.file && !state.recorder && !state.tap) media.currentTime = cue.t;
    });
    time.addEventListener('change', () => {
      const t = time.value.trim() === '' ? null : parseTime(time.value);
      if (t == null) cue.t = null;
      else setCueTime(cue, t);
      sortCues();
      renderCues();
      refresh();
    });
    stamp.addEventListener('click', () => {
      if (!state.file || state.tap) return;
      setCueTime(cue, media.currentTime);
      sortCues();
      renderCues();
      refresh();
    });
    text.addEventListener('input', () => { cue.text = text.value; });
    del.addEventListener('click', () => {
      state.cues.splice(state.cues.indexOf(cue), 1);
      renderCues();
      refresh();
    });
    li.append(time, texts, stamp, del);
    list.append(li);
  });
}

/** Set one line's start; with "move following lines" on, later lines keep their spacing. */
function setCueTime(cue, t) {
  const i = state.cues.indexOf(cue);
  // Breaks only end the line before them, so moving one never moves the rest of the song.
  if (!$('ripple').checked || cue.t == null || !cue.text) { cue.t = Math.max(0, t); return; }
  const d = retimeFrom(state.cues, i, t);
  if (Math.abs(d) >= 0.05) setStatus(`Line ${i + 1} and all lines after it moved ${d > 0 ? 'later' : 'earlier'} by ${Math.abs(d).toFixed(2)} s.`);
}

/**
 * Add a line or break at the current song position. If the song sits at (or just after)
 * the start of a line – e.g. after clicking that line – the new cue goes after it instead,
 * so it never takes that line's place.
 */
function addCue(text) {
  let t = state.file ? media.currentTime : null;
  let note = '';
  if (t != null) {
    const i = activeIndex(state.cues, t + 0.001);
    const cur = state.cues[i];
    if (cur && t - cur.t < 0.5) {
      const next = state.cues.slice(i + 1).find((c) => c.t != null);
      const words = cur.text ? cur.text.split(/\s+/).length : 0;
      t = cur.t + Math.max(2, words * 0.6 + 1);
      if (next) t = Math.min(t, cur.t + (next.t - cur.t) / 2);
      note = ` after “${cur.text || 'break'}”`;
    }
    while (state.cues.some((c) => c.t != null && Math.abs(c.t - t) < 0.05)) t += 0.1;
  }
  const cue = { t, text };
  state.cues.push(cue);
  sortCues();
  renderCues();
  refresh();
  if (t != null) {
    setStatus(`${text ? 'Line' : 'Break'} added at ${formatTime(t)}${note}. To place it exactly: play to the spot, pause and click ⏱ on it.`);
    $('cueList').children[state.cues.indexOf(cue)]?.scrollIntoView({ block: 'nearest' });
  }
}
$('addCue').addEventListener('click', () => addCue('New line'));
$('addBlank').addEventListener('click', () => addCue(''));

document.querySelectorAll('[data-shift]').forEach((b) => b.addEventListener('click', () => {
  const d = Number(b.dataset.shift);
  for (const c of state.cues) if (c.t != null) c.t = Math.max(0, c.t + d);
  renderCues();
}));

function highlight(current) {
  const want = state.tap ? state.tap.index : current;
  if (want === shownCurrent) return;
  shownCurrent = want;
  [...$('cueList').children].forEach((li, i) => {
    li.classList.toggle('current', !state.tap && i === want);
    li.classList.toggle('tap', !!state.tap && i === want);
  });
  const li = $('cueList').children[want];
  if (li && !$('cueList').contains(document.activeElement)) li.scrollIntoView({ block: 'nearest' });
}

// ---------- Tap-sync ----------

function startTap() {
  let index = state.cues.findIndex((c) => c.t == null);
  if (index < 0) {
    if (!confirm('All lines are timed already. Clear the timing and tap again from the start?')) return;
    state.cues = state.cues.filter((c) => c.text).map((c) => ({ t: null, text: c.text }));
    index = 0;
  }
  if (document.activeElement) document.activeElement.blur();
  state.tap = { index };
  renderTapSections();
  media.currentTime = index > 0 ? Math.max(0, state.cues[index - 1].t - 3) : 0;
  media.play();
  renderCues();
  refresh();
}

function renderTapSections() {
  const box = $('tapSectionButtons');
  box.textContent = '';
  const secs = (state.sections || []).slice(0, 9);
  $('tapSections').hidden = !secs.length;
  secs.forEach((sec, k) => {
    const b = document.createElement('button');
    b.title = sec.lines.join(' / ');
    b.append(Object.assign(document.createElement('kbd'), { textContent: String(k + 1) }), sec.label);
    b.addEventListener('mousedown', (e) => e.preventDefault()); // keep keyboard focus off the button
    b.addEventListener('click', () => { insertSection(k); renderCues(); });
    box.append(b);
  });
}

/** Insert a section's lines (untimed) before the line that is due to be tapped next. */
function insertSection(k) {
  const sec = state.sections[k];
  if (!state.tap || !sec) return;
  const known = translationsOf(state.cues);
  state.cues.splice(state.tap.index, 0, ...sec.lines.map((line) => {
    const c = { t: null, ...splitTranslation(line) };
    if (!c.tr && known.has(c.text)) c.tr = known.get(c.text);
    if (!c.tr) delete c.tr;
    return c;
  }));
  setStatus(`${sec.label} inserted – tap its first line when it starts.`);
}

function stopTap() {
  if (!state.tap) return;
  state.tap = null;
  $('tapNext').hidden = true;
  renderCues();
  refresh();
}

function tapKey(e) {
  const tap = state.tap;
  const now = media.currentTime;
  const atEnd = tap.index >= state.cues.length;
  if (e.key === ' ' || e.key === 'Enter') {
    if (atEnd) return e.preventDefault();
    state.cues[tap.index].t = now;
    tap.index++;
  } else if (e.key.toLowerCase() === 'b') {
    state.cues.splice(tap.index, 0, { t: now, text: '' });
    tap.index++;
  } else if (e.key.toLowerCase() === 's') {
    if (atEnd) return e.preventDefault();
    state.cues.splice(tap.index, 1); // this line is not sung here
  } else if (/^[1-9]$/.test(e.key) && state.sections?.[Number(e.key) - 1]) {
    insertSection(Number(e.key) - 1);
  } else if (e.key === 'Backspace') {
    if (tap.index > 0) {
      tap.index--;
      if (state.cues[tap.index].text) state.cues[tap.index].t = null;
      else state.cues.splice(tap.index, 1);
      media.currentTime = Math.max(0, (tap.index > 0 ? state.cues[tap.index - 1].t : 0) - 2);
    }
  } else if (e.key === 'Escape') {
    media.pause();
    setStatus(atEnd ? 'All lines timed. Play it back and fine-tune with ⏱ or by editing a time.' : 'Tapping stopped. Press “Tap along” to continue from the first untimed line.');
    return stopTap();
  } else return;
  e.preventDefault();
  if (tap.index >= state.cues.length && !(state.sections || []).length) {
    stopTap();
    setStatus('All lines timed. Play it back and fine-tune with ⏱ or by editing a time.');
  } else {
    if (tap.index >= state.cues.length) setStatus('All lines tapped. If the song goes on, insert a section; otherwise press Esc to finish.');
    renderCues();
  }
}

$('tapSync').addEventListener('click', () => (state.tap ? (media.pause(), stopTap()) : startTap()));

document.addEventListener('keydown', (e) => {
  if (state.tap) return tapKey(e);
  if (e.key === ' ' && !/^(INPUT|TEXTAREA|SELECT|BUTTON|SUMMARY)$/.test(e.target.tagName)) {
    e.preventDefault();
    togglePlay();
  }
});

// ---------- Auto-sync (speech recognition in the browser) ----------

let worker = null;

async function decodeAudio(file) {
  const ac = new AudioContext({ sampleRate: 16000 });
  try {
    const buf = await ac.decodeAudioData(await file.arrayBuffer());
    const mono = new Float32Array(buf.length);
    for (let ch = 0; ch < buf.numberOfChannels; ch++) {
      const data = buf.getChannelData(ch);
      for (let i = 0; i < data.length; i++) mono[i] += data[i] / buf.numberOfChannels;
    }
    return mono;
  } finally {
    ac.close();
  }
}

$('autoSync').addEventListener('click', async () => {
  const lines = state.cues.filter((c) => c.text.trim()).map((c) => c.text);
  if (timedCount() && !confirm('Replace the current timing with an automatic one?')) return;
  state.busy = true;
  refresh();
  try {
    setStatus('Reading the audio…');
    const audio = await decodeAudio(state.file);
    worker ||= new Worker(new URL('./transcribe-worker.js', import.meta.url), { type: 'module' });
    const words = await new Promise((resolve, reject) => {
      worker.onmessage = ({ data }) => {
        if (data.type === 'status') setStatus(data.text);
        else if (data.type === 'done') resolve(data.words);
        else reject(new Error(data.text));
      };
      worker.onerror = (err) => reject(new Error(err.message || 'The speech model could not be loaded (internet needed the first time).'));
      worker.postMessage({ audio, model: $('model').value, language: $('language').value }, [audio.buffer]);
    });
    if (!words.length) throw new Error('No singing was recognised in this file.');
    if (lines.length) {
      const cues = alignLyrics(lines, words);
      if (cues.every((c) => c.t == null)) throw new Error('The lyrics do not seem to match what is sung. Check the text or use “Tap along”.');
      applyTranslations(cues, translationsOf(state.cues));
      state.cues = cues;
      const extra = cues.filter((c) => c.text).length - lines.length;
      setStatus(`Timing found${extra > 0 ? `, including ${extra} repeated line${extra > 1 ? 's' : ''} that the sheet lists only once` : ''}. Play it back to check – every time can be edited.`);
    } else {
      state.cues = wordsToCues(words);
      $('lyricsText').value = state.cues.filter((c) => c.text).map((c) => c.text).join('\n');
      setStatus('Lyrics written from the recording. Please proofread – sung words are often misheard.');
    }
    renderCues();
  } catch (err) {
    setStatus(`Auto-sync failed: ${err.message}`, true);
  } finally {
    state.busy = false;
    refresh();
  }
});

// ---------- Background ----------

function clearBg() {
  if (!state.bgMedia) return;
  if (state.bgMedia.pause) state.bgMedia.pause();
  URL.revokeObjectURL(state.bgMedia.src);
  state.bgMedia = null;
}

$('bgFile').addEventListener('change', (e) => {
  const file = e.target.files[0];
  e.target.value = '';
  if (!file) return;
  clearBg();
  const url = URL.createObjectURL(file);
  if (file.type.startsWith('video/')) {
    const v = Object.assign(document.createElement('video'), { src: url, muted: true, loop: true, playsInline: true });
    v.play().catch(() => {});
    state.bgMedia = v;
  } else {
    state.bgMedia = Object.assign(new Image(), { src: url });
  }
  refresh();
});
$('bgClear').addEventListener('click', () => { clearBg(); refresh(); });

// ---------- Present ----------

let idleTimer = 0;
$('present').addEventListener('click', async () => {
  await stage.requestFullscreen?.().catch(() => {});
  media.play();
});
stage.addEventListener('mousemove', () => {
  stage.classList.remove('idle');
  clearTimeout(idleTimer);
  idleTimer = setTimeout(() => stage.classList.add('idle'), 2000);
});
stage.addEventListener('click', () => { if (document.fullscreenElement === stage) togglePlay(); });

// ---------- Export ----------

let audioGraph = null;
function audioStream() {
  if (!audioGraph) {
    const actx = new AudioContext();
    const source = actx.createMediaElementSource(media);
    const dest = actx.createMediaStreamDestination();
    source.connect(actx.destination); // keep hearing the song
    source.connect(dest);
    audioGraph = { actx, dest };
  }
  audioGraph.actx.resume();
  return audioGraph.dest.stream;
}

const MIME_TYPES = ['video/mp4;codecs=avc1.640028,mp4a.40.2', 'video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm', 'video/mp4'];

async function startRecording() {
  const mimeType = window.MediaRecorder && MIME_TYPES.find((m) => MediaRecorder.isTypeSupported(m));
  if (!mimeType) return setStatus('This browser cannot record video. Please use a current Chrome, Edge or Firefox.', true);
  stopTap();
  const [w, h] = $('resolution').value.split('x').map(Number);
  canvas.width = w;
  canvas.height = h;

  media.pause();
  media.currentTime = 0;
  await new Promise((r) => media.addEventListener('seeked', r, { once: true }));
  if (state.bgMedia?.play) state.bgMedia.currentTime = 0;

  const stream = canvas.captureStream(30);
  for (const track of audioStream().getAudioTracks()) stream.addTrack(track);
  const recorder = new MediaRecorder(stream, { mimeType, videoBitsPerSecond: h >= 1080 ? 8e6 : 5e6, audioBitsPerSecond: 192000 });
  const chunks = [];
  recorder.ondataavailable = (e) => { if (e.data.size) chunks.push(e.data); };
  recorder.onstop = () => {
    stream.getVideoTracks().forEach((t) => t.stop());
    media.removeEventListener('ended', finish);
    media.pause();
    state.recorder = null;
    const ext = mimeType.startsWith('video/mp4') ? 'mp4' : 'webm';
    download(new Blob(chunks, { type: mimeType.split(';')[0] }), `${baseName()}.${ext}`);
    setStatus(`Video saved as ${baseName()}.${ext}.`);
    refresh();
  };
  const finish = () => setTimeout(() => recorder.state !== 'inactive' && recorder.stop(), 400);
  media.addEventListener('ended', finish);
  state.recorder = recorder;
  recorder.start(1000);
  await media.play();
  setStatus('Recording… keep this tab visible until the song has finished.');
  refresh();
}

$('record').addEventListener('click', () => {
  if (state.recorder) state.recorder.stop();
  else startRecording().catch((err) => setStatus(`Export failed: ${err.message}`, true));
});

$('saveLrc').addEventListener('click', () => {
  download(new Blob([toLrc(state.cues, { ti: $('title').value.trim(), ar: $('subtitle').value.trim() })], { type: 'text/plain' }), `${baseName()}.lrc`);
});
$('saveSrt').addEventListener('click', () => {
  download(new Blob([toSrt(state.cues, Number($('lead').value), media.duration || Infinity)], { type: 'text/plain' }), `${baseName()}.srt`);
});

// ---------- Render loop ----------

function frame() {
  const time = state.file ? media.currentTime : 0;
  const lead = state.tap ? 0 : Number($('lead').value); // while tapping, show lines exactly as stamped
  const useSource = $('theme').value === 'source' && state.hasVideo;
  drawFrame(ctx, canvas.width, canvas.height, {
    time,
    bgTime: performance.now() / 1000,
    cues: state.cues,
    lead,
    bg: { theme: $('theme').value, palette: $('palette').value, color: $('bgColor').value, custom: $('palette').value === 'custom' ? customPalette($('customA').value, $('customB').value) : null, media: state.bgMedia || (useSource ? media : null), dim: Number($('dim').value) },
    style: { font: $('font').value, scale: Number($('scale').value), position: $('position').value, showNext: $('showNext').checked, singCue: $('singCue').checked, caps: $('caps').checked, color: $('textColor').value, showTr: $('showTr').checked, trColor: $('trColor').value, trScale: Number($('trScale').value) },
    title: $('title').value.trim(),
    subtitle: $('subtitle').value.trim(),
  });

  if (state.file) {
    if (document.activeElement !== $('seek')) $('seek').value = time;
    $('clock').textContent = `${formatTime(time, 0)} / ${formatTime(media.duration || 0, 0)}`;
  }
  highlight(activeIndex(state.cues, time));
  if (state.tap) {
    const cue = state.cues[state.tap.index];
    $('tapNext').hidden = false;
    $('tapNext').innerHTML = '';
    if (cue) $('tapNext').append('Space when you hear: ', Object.assign(document.createElement('b'), { textContent: cue.text || '(break)' }));
    else $('tapNext').append('End of the lyrics – insert a section (1–9) or press ', Object.assign(document.createElement('b'), { textContent: 'Esc' }), ' to finish.');
  }
  requestAnimationFrame(frame);
}

// Fonts used only on the canvas are not fetched by the browser on their own: load the chosen one.
function loadFont() {
  const family = $('font').value.split(',')[0].trim();
  for (const w of [400, 500, 600, 700]) document.fonts?.load(`${w} 40px ${family}`).catch(() => {});
}
$('font').addEventListener('change', loadFont);
$('template').addEventListener('change', loadFont);
loadFont();
refresh();
requestAnimationFrame(frame);

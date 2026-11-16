import { parseLyrics, parseLrcMeta, parseTime, formatTime, activeIndex, toLrc, toSrt, alignLyrics, wordsToCues } from './lyrics.js';
import { THEMES, PALETTES } from './backgrounds.js';
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
};

// ---------- Settings (remembered between visits) ----------

const SETTINGS = ['lead', 'theme', 'palette', 'position', 'font', 'scale', 'dim', 'singCue', 'showNext', 'language', 'model', 'resolution'];

for (const [key, t] of Object.entries(THEMES)) $('theme').add(new Option(t.name, key));
for (const [key, p] of Object.entries(PALETTES)) $('palette').add(new Option(p.name, key));

function loadSettings() {
  let saved = {};
  try { saved = JSON.parse(localStorage.getItem('psws-settings') || '{}'); } catch { /* storage unavailable */ }
  for (const id of SETTINGS) {
    const el = $(id);
    if (!(id in saved)) continue;
    if (el.type === 'checkbox') el.checked = !!saved[id];
    else if (el.tagName !== 'SELECT' || [...el.options].some((o) => o.value === saved[id])) el.value = saved[id];
  }
}

function saveSettings() {
  const out = {};
  for (const id of SETTINGS) out[id] = $(id).type === 'checkbox' ? $(id).checked : $(id).value;
  try { localStorage.setItem('psws-settings', JSON.stringify(out)); } catch { /* storage unavailable */ }
}

loadSettings();
for (const id of SETTINGS) $(id).addEventListener('input', () => { saveSettings(); refresh(); });

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
  const meta = parseLrcMeta(text);
  if (meta.ti && !$('title').value) $('title').value = meta.ti;
  if (meta.ar && !$('subtitle').value) $('subtitle').value = meta.ar;
  setStatus(timed ? `${cues.filter((c) => c.text).length} timed lines loaded.` : `${cues.length} lines loaded. Now set the timing: tap along or auto-sync.`);
  renderCues();
  refresh();
}

// ---------- Cue list ----------

let shownCurrent = -2;

function renderCues() {
  const list = $('cueList');
  list.textContent = '';
  shownCurrent = -2;
  state.cues.forEach((cue, i) => {
    const li = document.createElement('li');
    const time = Object.assign(document.createElement('input'), { className: 'time', value: formatTime(cue.t), placeholder: '–:––', title: 'Start time (click to jump there)' });
    const text = Object.assign(document.createElement('input'), { value: cue.text, placeholder: '(break – empty screen)' });
    const del = Object.assign(document.createElement('button'), { textContent: '×', title: 'Delete line' });
    time.setAttribute('aria-label', `Start time of line ${i + 1}`);
    text.setAttribute('aria-label', `Text of line ${i + 1}`);
    time.addEventListener('click', () => { if (cue.t != null && !state.recorder) media.currentTime = cue.t; });
    time.addEventListener('change', () => {
      cue.t = time.value.trim() === '' ? null : parseTime(time.value);
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
    li.append(time, text, del);
    list.append(li);
  });
}

function addCue(text) {
  const t = state.file ? media.currentTime : null;
  state.cues.push({ t, text });
  sortCues();
  renderCues();
  refresh();
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
  media.currentTime = index > 0 ? Math.max(0, state.cues[index - 1].t - 3) : 0;
  media.play();
  renderCues();
  refresh();
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
  if (e.key === ' ' || e.key === 'Enter') {
    state.cues[tap.index].t = now;
    tap.index++;
  } else if (e.key.toLowerCase() === 'b') {
    state.cues.splice(tap.index, 0, { t: now, text: '' });
    tap.index++;
  } else if (e.key === 'Backspace') {
    if (tap.index > 0) {
      tap.index--;
      if (state.cues[tap.index].text) state.cues[tap.index].t = null;
      else state.cues.splice(tap.index, 1);
      media.currentTime = Math.max(0, (tap.index > 0 ? state.cues[tap.index - 1].t : 0) - 2);
    }
  } else if (e.key === 'Escape') {
    media.pause();
    return stopTap();
  } else return;
  e.preventDefault();
  if (tap.index >= state.cues.length) {
    stopTap();
    setStatus('All lines timed. Play it back and fine-tune with the “Shift all” buttons or by editing a time.');
  } else renderCues();
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
      state.cues = cues;
      setStatus('Timing found. Play it back to check – every time can be edited, or re-tap single passages.');
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
    bg: { theme: $('theme').value, palette: $('palette').value, media: state.bgMedia || (useSource ? media : null), dim: Number($('dim').value) },
    style: { font: $('font').value, scale: Number($('scale').value), position: $('position').value, showNext: $('showNext').checked, singCue: $('singCue').checked },
    title: $('title').value.trim(),
    subtitle: $('subtitle').value.trim(),
  });

  if (state.file) {
    if (document.activeElement !== $('seek')) $('seek').value = time;
    $('clock').textContent = `${formatTime(time, 0)} / ${formatTime(media.duration || 0, 0)}`;
  }
  highlight(activeIndex(state.cues, time + lead));
  if (state.tap) {
    const cue = state.cues[state.tap.index];
    $('tapNext').hidden = false;
    $('tapNext').innerHTML = '';
    $('tapNext').append('Space when you hear: ', Object.assign(document.createElement('b'), { textContent: cue ? cue.text || '(break)' : '' }));
  }
  requestAnimationFrame(frame);
}

refresh();
requestAnimationFrame(frame);

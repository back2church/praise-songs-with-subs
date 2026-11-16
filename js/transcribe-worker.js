// Runs Whisper speech recognition fully in the browser (no upload of the song).
// The model is downloaded once from the Hugging Face hub and cached by the browser.
import { pipeline } from 'https://cdn.jsdelivr.net/npm/@huggingface/transformers@3.8.1';

let cached = { model: null, pipe: null };

self.onmessage = async ({ data }) => {
  const { audio, model, language } = data;
  try {
    if (cached.model !== model) {
      const options = {
        progress_callback: (p) => {
          if (p.status === 'progress' && p.file && p.file.endsWith('.onnx')) {
            self.postMessage({ type: 'status', text: `Downloading speech model… ${Math.round(p.progress)}%` });
          }
        },
      };
      // WebGPU is much faster where available; otherwise run on the CPU (WebAssembly).
      let gpu = false;
      try { gpu = !!(navigator.gpu && (await navigator.gpu.requestAdapter())); } catch { /* no WebGPU */ }
      let pipe;
      if (gpu) {
        try {
          pipe = await pipeline('automatic-speech-recognition', model, { ...options, device: 'webgpu', dtype: { encoder_model: 'fp32', decoder_model_merged: 'q4' } });
        } catch { /* fall back to CPU below */ }
      }
      pipe ||= await pipeline('automatic-speech-recognition', model, { ...options, device: 'wasm', dtype: 'q8' });
      cached = { model, pipe };
    }
    self.postMessage({ type: 'status', text: 'Listening to the song… this can take a few minutes.' });
    const result = await cached.pipe(audio, {
      return_timestamps: 'word',
      chunk_length_s: 30,
      stride_length_s: 5,
      language: language || 'english',
      task: 'transcribe',
    });
    const words = (result.chunks || [])
      .filter((c) => c.timestamp && c.timestamp[0] != null)
      .map((c) => ({ text: c.text.trim(), start: c.timestamp[0], end: c.timestamp[1] ?? c.timestamp[0] + 0.3 }));
    self.postMessage({ type: 'done', words });
  } catch (err) {
    self.postMessage({ type: 'error', text: String(err && err.message ? err.message : err) });
  }
};

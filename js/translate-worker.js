// Machine translation fully in the browser (Opus-MT, Apache-2.0). Lyrics are not uploaded.
// Each language direction's model (~106 MB) is downloaded once and cached by the browser.
import { pipeline } from 'https://cdn.jsdelivr.net/npm/@huggingface/transformers@3.8.1';

const MODELS = { 'de-en': 'Xenova/opus-mt-de-en', 'en-de': 'Xenova/opus-mt-en-de' };
const pipes = new Map();

self.onmessage = async ({ data }) => {
  const { lines, direction } = data;
  try {
    const model = MODELS[direction];
    if (!model) throw new Error(`Unsupported direction ${direction}`);
    if (!pipes.has(model)) {
      pipes.set(model, await pipeline('translation', model, {
        dtype: 'q8',
        device: 'wasm',
        progress_callback: (p) => {
          if (p.status === 'progress' && p.file && p.file.endsWith('.onnx')) {
            self.postMessage({ type: 'status', text: `Downloading translation model… ${Math.round(p.progress)}%` });
          }
        },
      }));
    }
    const pipe = pipes.get(model);
    const out = [];
    for (let i = 0; i < lines.length; i += 8) {
      self.postMessage({ type: 'status', text: `Translating… ${i} of ${lines.length} lines` });
      const res = await pipe(lines.slice(i, i + 8), { max_new_tokens: 128 });
      out.push(...res.map((r) => r.translation_text.trim()));
    }
    self.postMessage({ type: 'done', lines: out });
  } catch (err) {
    self.postMessage({ type: 'error', text: String(err && err.message ? err.message : err) });
  }
};

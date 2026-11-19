const mirror = 'https://cdn.jsdmirror.com/gh/Aurxs/zzz-signal-lab@4abaf92cc95abe831cbae545fa1b7e8253394f15/dist/ocr/';
const core = 'tesseract-core-lstm.wasm.js';
const model = 'chi_sim.traineddata.gz';
const localModel = new URL(model, self.location.href).href;
const nativeFetch = self.fetch.bind(self);

async function fromMirror(file, integrity) {
  const response = await nativeFetch(mirror + file, {
    integrity, signal: AbortSignal.timeout?.(8000), credentials: 'omit'
  });
  if (!response.ok) throw Error('OCR mirror returned ' + response.status);
  return response;
}

// Tesseract requests the model only after it has checked its IndexedDB cache.
self.fetch = async (url, options) => {
  if (url !== localModel) return nativeFetch(url, options);
  try {
    return await fromMirror(model, 'sha256-QoP6WxQSWswmIoI/L5a7V+HRN0+lOiYWS8GD0dVj34Q=');
  } catch {
    return nativeFetch(url, options);
  }
};

// Delay the initial load message until the verified core is available.
self.addEventListener('message', async event => {
  event.stopImmediatePropagation();
  let coreURL;
  try {
    const response = await fromMirror(core, 'sha256-7vX4svjiDhUGgLIK2uxKYLq6/uOtvoqUWDyB/uRuhoA=');
    coreURL = URL.createObjectURL(await response.blob());
    importScripts(coreURL);
  } catch {
    // Tesseract's configured corePath loads the bundled copy on first use.
  } finally {
    if (coreURL) URL.revokeObjectURL(coreURL);
  }
  self.dispatchEvent(new MessageEvent('message', {data:event.data}));
}, {once:true});

importScripts('./worker.min.js');

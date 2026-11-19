const assetPath = '/gh/Aurxs/zzz-signal-lab@4abaf92cc95abe831cbae545fa1b7e8253394f15/dist/ocr/';
const primaryMirror = 'https://cdn.jsdmirror.com';
const backupMirror = 'https://jsd.onmicrosoft.cn';
const core = 'tesseract-core-lstm.wasm.js';
const model = 'chi_sim.traineddata.gz';
const localModel = new URL(model, self.location.href).href;
const nativeFetch = self.fetch.bind(self);

async function fromMirrors(file, integrity) {
  const requests = new AbortController();
  const deadline = setTimeout(() => requests.abort(), 8000);
  async function download(host) {
    const response = await nativeFetch(host + assetPath + file, {
      integrity, signal: requests.signal, credentials: 'omit'
    });
    if (!response.ok) throw Error('OCR mirror returned ' + response.status);
    return response.blob();
  }
  const preferred = download(primaryMirror);
  let timer;
  // Both mirrors share the original eight-second budget before using the site.
  const fallback = new Promise(resolve => {
    timer = setTimeout(resolve, 2000);
    preferred.catch(resolve);
  }).then(() => download(backupMirror));
  try {
    return await Promise.any([preferred, fallback]);
  } finally {
    clearTimeout(timer);
    clearTimeout(deadline);
    requests.abort();
  }
}

// Tesseract requests the model only after it has checked its IndexedDB cache.
self.fetch = async (url, options) => {
  if (url !== localModel) return nativeFetch(url, options);
  try {
    return new Response(await fromMirrors(model, 'sha256-QoP6WxQSWswmIoI/L5a7V+HRN0+lOiYWS8GD0dVj34Q='));
  } catch {
    return nativeFetch(url, options);
  }
};

// Delay the initial load message until the verified core is available.
self.addEventListener('message', async event => {
  event.stopImmediatePropagation();
  let coreURL;
  try {
    const blob = await fromMirrors(core, 'sha256-7vX4svjiDhUGgLIK2uxKYLq6/uOtvoqUWDyB/uRuhoA=');
    coreURL = URL.createObjectURL(blob);
    importScripts(coreURL);
  } catch {
    // Tesseract's configured corePath loads the bundled copy on first use.
  } finally {
    if (coreURL) URL.revokeObjectURL(coreURL);
  }
  self.dispatchEvent(new MessageEvent('message', {data:event.data}));
}, {once:true});

importScripts('./worker.min.js');

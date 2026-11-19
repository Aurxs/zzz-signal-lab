import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { Worker } from "node:worker_threads";
import { once } from "node:events";
import { convolveDiscrete, convolveFeatured } from "../dist/convolution.mjs";

const params = { agent: [.006, 74, 90, .5], engine: [.01, 65, 80, .75] };

function referenceCycle(pool) {
  const [base, soft, hard, win] = params[pool];
  const s = new Float64Array(hard + 1);
  let previousSurvivors = 1;
  for (let k = 1; k <= hard; k++) {
    const next = k === hard ? 1 : Math.min(1, base + .06 * Math.max(0, k - soft + 1));
    s[k] = previousSurvivors * next;
    previousSurvivors *= 1 - next;
  }
  const cycle = new Float64Array(2 * hard + 1);
  for (let k = 1; k < cycle.length; k++) {
    cycle[k] = win * (s[k] || 0);
    for (let j = Math.max(1, k - hard); j <= Math.min(hard, k - 1); j++) {
      cycle[k] += (1 - win) * s[j] * s[k - j];
    }
  }
  return cycle;
}

function directFold(one, count) {
  let previous = Float64Array.of(1);
  for (let n = 1; n <= count; n++) {
    const next = new Float64Array(previous.length + one.length - 1);
    for (let k = n - 1; k < previous.length; k++) {
      for (let j = 1; j < one.length; j++) next[k + j] += previous[k] * one[j];
    }
    previous = next;
  }
  return { first: 0, weights: previous };
}

function moments({ first, weights }) {
  const mass = weights.reduce((a, p) => a + p, 0);
  const mean = weights.reduce((a, p, i) => a + p * (first + i), 0) / mass;
  const variance = weights.reduce((a, p, i) => a + p * (first + i - mean) ** 2, 0) / mass;
  return { mass, mean, variance };
}

function compare(a, b, tolerance) {
  let l1 = 0, cdfError = 0, maxCdfError = 0;
  const end = Math.max(a.first + a.weights.length, b.first + b.weights.length);
  for (let k = Math.min(a.first, b.first); k < end; k++) {
    const delta = (a.weights[k - a.first] || 0) - (b.weights[k - b.first] || 0);
    l1 += Math.abs(delta);
    cdfError += delta;
    maxCdfError = Math.max(maxCdfError, Math.abs(cdfError));
  }
  assert(l1 < tolerance, 'L1 discrepancy ' + l1);
  assert(maxCdfError < tolerance, 'CDF discrepancy ' + maxCdfError);
  return { l1, maxCdfError };
}

async function cached(pool, n) {
  const group = Math.floor((n - 1) / 10);
  const buffer = await readFile(new URL('../dist/model-data/' + pool + '-' + group + '.bin', import.meta.url));
  let offset = 0;
  for (let index = 0; index <= (n - 1) % 10; index++) {
    const first = buffer.readUInt32LE(offset), length = buffer.readUInt32LE(offset + 4);
    offset += 8;
    if (index === (n - 1) % 10) {
      const weights = Float64Array.from({ length }, (_, i) => buffer.readFloatLE(offset + 4 * i));
      return { first, weights };
    }
    offset += length * 4;
  }
}

for (const pool of Object.keys(params)) {
  const one = referenceCycle(pool);
  const base = moments({ first: 0, weights: one });
  for (const n of [1, 2, 19, 58, 100]) {
    compare(convolveFeatured(pool, n), await cached(pool, n), 4e-8); // Float32 table precision
  }
  const exact = directFold(one, 101);
  const fft = convolveFeatured(pool, 101);
  const { l1, maxCdfError } = compare(fft, exact, 5e-12);
  const { mean, variance } = moments(exact);
  for (const sigmas of [-5, -3, -1, 0, 1, 3, 5]) {
    const k = Math.floor(mean + sigmas * Math.sqrt(variance));
    const a = fft.weights[k - fft.first] || 0, b = exact.weights[k];
    assert(Math.abs(a - b) < 1e-14);
  }
  console.log(pool, "101 vs direct: L1", l1, "max CDF error", maxCdfError);
  for (const n of [102, 1000, 10000, 100000]) {
    const start = performance.now();
    const distribution = convolveFeatured(pool, n);
    const ms = Math.round(performance.now() - start);
    const { weights, first } = distribution;
    const { mass, mean, variance } = moments(distribution);
    assert(weights.every(p => Number.isFinite(p) && p >= 0));
    assert(Math.abs(mass - 1) < 1e-11);
    assert(Math.abs(mean / n - base.mean) < 1e-8);
    assert(Math.abs(variance / n / base.variance - 1) < 1e-9);
    const end = first + weights.length - 1;
    const radius = Math.min(first === n ? Infinity : n * base.mean - first + 1,
      end === n * (one.length - 1) ? Infinity : end - n * base.mean + 1);
    assert(2 * Math.exp(-2 * radius ** 2 / (n * (one.length - 2) ** 2)) <= 1e-16);
    console.log(pool, n, weights.length, "PMF points,", ms, "ms");
  }
}

// Reflection checks the modulo-to-total decoding even when the mean is near an endpoint.
for (const n of [1, 11, 101, 100000]) {
  const probabilities = [.8, .03, .06, .11];
  const f = convolveDiscrete(probabilities, 1, n);
  const r = convolveDiscrete(probabilities.toReversed(), 1, n);
  compare(f, { first: 5 * n - (r.first + r.weights.length - 1), weights: r.weights.toReversed() }, 1e-11);
}
const symmetric = convolveDiscrete([.5, .5], 0, 100000);
compare(symmetric, {first: 100000 - symmetric.first - symmetric.weights.length + 1,
  weights: symmetric.weights.toReversed()}, 1e-11);
assert.throws(() => convolveFeatured("unknown", 101));
for (const n of [0, 1.1, Infinity, 100001]) assert.throws(() => convolveFeatured("agent", n));

const workerUrl = new URL("../dist/probability-worker.mjs", import.meta.url).href;
const worker = new Worker(`
  const { parentPort } = require("node:worker_threads");
  global.self = { postMessage: (data, transfer) => parentPort.postMessage(data, transfer) };
  import(${JSON.stringify(workerUrl)}).then(() => {
    parentPort.on("message", data => self.onmessage({data}));
  });
`, { eval: true, execArgv: [] });
for (const n of [101, 100001]) {
  const result = once(worker, "message");
  worker.postMessage({ pool: "engine", count: n });
  const [response] = await result;
  if (n === 101) compare(response, convolveFeatured("engine", n), 1e-15);
  else assert.match(response.error, /整数/u);
}
await worker.terminate();
console.log("Passed cached and independent direct reference, tails, moments, Hoeffding bound, symmetry and worker transfer.");

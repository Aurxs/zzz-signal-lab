// The bounds below distinguish mathematical circular aliasing from roundoff.
// Hoeffding: P(|S - nμ| >= r) <= 2 exp(-2 r² / (n (b-a)²)).
const FOLD_BUDGET = 1e-16;
const LOG_FILTER = Math.log(1e-23);
const TAU = 2 * Math.PI;

const pools = Object.freeze({
  agent: { base: 0.006, soft: 74, hard: 90, win: 0.5 },
  engine: { base: 0.01, soft: 65, hard: 80, win: 0.75 }
});

function featuredCycle({ base, soft, hard, win }) {
  // Output index 0 means one pull. A failed featured roll needs two S ranks.
  const s = new Float64Array(hard);
  let remaining = 1;
  for (let i = 0; i < hard; i++) {
    const pull = i + 1;
    const hazard = pull === hard ? 1 : Math.min(1, base + 0.06 * Math.max(0, pull - soft + 1));
    s[i] = remaining * hazard;
    remaining *= 1 - hazard;
  }
  const cycle = new Float64Array(2 * hard);
  for (let i = 0; i < hard; i++) {
    cycle[i] += win * s[i];
    for (let j = 0; j < hard; j++) cycle[i + j + 1] += (1 - win) * s[i] * s[j];
  }
  return cycle;
}

function transform(real, imag, cosine, sine, inverse) {
  const n = real.length;
  for (let i = 1, j = 0; i < n; i++) {
    let mask = n >> 1;
    while (j & mask) {
      j ^= mask;
      mask >>= 1;
    }
    j ^= mask;
    if (i < j) {
      [real[i], real[j]] = [real[j], real[i]];
      [imag[i], imag[j]] = [imag[j], imag[i]];
    }
  }
  for (let size = 2; size <= n; size *= 2) {
    const half = size / 2, stride = n / size;
    for (let start = 0; start < n; start += size) {
      for (let j = 0, k = 0; j < half; j++, k += stride) {
        const a = start + j, b = a + half;
        const x = cosine[k], y = inverse ? sine[k] : -sine[k];
        const t = x * real[b] - y * imag[b], u = x * imag[b] + y * real[b];
        real[b] = real[a] - t;
        imag[b] = imag[a] - u;
        real[a] += t;
        imag[a] += u;
      }
    }
  }
}

// firstPull is the integer cost of sample[0]. The sample describes one cycle.
// Exported separately so tests can validate reflected and analytic PMFs.
export function convolveDiscrete(sample, firstPull, count) {
  if (!Number.isSafeInteger(count) || count < 1 || count > 100000) {
    throw new RangeError("限定 UP 数量须为 1 至 100000 的整数。");
  }
  const width = sample.length - 1;
  const norm = sample.reduce((sum, p) => sum + p, 0);
  const base = Float64Array.from(sample, p => p / norm);
  const mean = base.reduce((sum, p, i) => sum + (firstPull + i) * p, 0);
  // Centering reduces phase error for large powers of the characteristic function.
  const anchor = Math.round(mean);
  const support = count * width + 1;
  const radius = Math.ceil(width * Math.sqrt(count * Math.log(2 / FOLD_BUDGET) / 2));
  const period = 2 ** Math.ceil(Math.log2(Math.min(support, 2 * radius + 3)));
  const outputSize = Math.min(period, support);
  const physicalMin = firstPull * count;
  const physicalMax = physicalMin + support - 1;
  const centeredStart = Math.floor(count * mean - (outputSize - 1) / 2);
  const first = Math.max(physicalMin, Math.min(physicalMax - outputSize + 1, centeredStart));
  if (period === 1) return { first, weights: Float64Array.of(1) };

  const mask = period - 1;
  const real = new Float64Array(period), imag = new Float64Array(period);
  const half = period / 2;
  const cosine = new Float64Array(half), sine = new Float64Array(half);
  for (let k = 0; k < half; k++) {
    const angle = TAU * k / period;
    cosine[k] = Math.cos(angle);
    sine[k] = Math.sin(angle);
  }
  for (let i = 0; i < base.length; i++) real[(firstPull + i - anchor) & mask] = base[i];
  transform(real, imag, cosine, sine, false);

  // The preliminary FFT finds frequencies with material surviving magnitude.
  // At these frequencies evaluate Re(phi)-1 directly to avoid magnifying tiny
  // errors near phi=1 by count. DC is exactly one. Hermitian pairs are mirrored.
  real[0] = 1;
  imag[0] = 0;
  const keepSquared = Math.exp(2 * LOG_FILTER / count);
  for (let k = 1; k <= half; k++) {
    let x = 0, y = 0;
    const estimate = real[k] ** 2 + imag[k] ** 2;
    if (estimate >= keepSquared) {
      const omega = -TAU * k / period;
      let delta = 0, imaginary = 0;
      for (let i = 0; i < base.length; i++) {
        const theta = omega * (firstPull + i - anchor);
        const sh = Math.sin(theta / 2);
        delta -= 2 * base[i] * sh * sh;
        imaginary += base[i] * Math.sin(theta);
      }
      const logRadius = Math.abs(delta) < 0.2
        ? Math.log1p(2 * delta + delta * delta + imaginary * imaginary) / 2
        : Math.log(Math.hypot(1 + delta, imaginary));
      const radiusN = Math.exp(count * logRadius);
      const phaseN = count * Math.atan2(imaginary, 1 + delta);
      x = radiusN * Math.cos(phaseN);
      y = radiusN * Math.sin(phaseN);
    }
    real[k] = x;
    imag[k] = k === half ? 0 : y;
    if (k < half) {
      real[period - k] = x;
      imag[period - k] = -y;
    }
  }
  transform(real, imag, cosine, sine, true);

  const weights = new Float64Array(outputSize);
  const shift = first - count * anchor;
  let mass = 0;
  for (let i = 0; i < outputSize; i++) {
    // The exact PMF is nonnegative. Discard negative inverse-transform noise.
    weights[i] = Math.max(0, real[(shift + i) & mask] / period);
    mass += weights[i];
  }
  for (let i = 0; i < outputSize; i++) weights[i] /= mass;
  return { first, weights };
}

export function convolveFeatured(pool, count) {
  if (!Object.hasOwn(pools, pool)) throw new RangeError("请选择受支持的调频频道。");
  return convolveDiscrete(featuredCycle(pools[pool]), 1, count);
}

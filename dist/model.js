(() => {
  "use strict";
  const maxAverage = Object.freeze({ agent: 180, engine: 160 });
  const source = "https://hoyobuild.com/en/zzz/tools/wish-simulator";
  const folder = new URL("model-data/", document.currentScript.src);
  const maxCount = 100000;
  const store = import(new URL('../probability-store.mjs', folder));
  const workerFile = new URL('../probability-worker.mjs',folder);
  function computeLarge(pool, count) {
    if (typeof Worker === 'undefined') {
      return import(new URL('../convolution.mjs', folder)).then(m => m.convolveFeatured(pool,count));
    }
    return new Promise((resolve,reject) => {
      const worker = new Worker(workerFile, {type:'module'});
      worker.onmessage = ({data}) => {
        worker.terminate();
        if (data.error) reject(new Error(data.error));
        else resolve(data);
      };
      worker.onerror = () => {
        worker.terminate();
        reject(new Error('概率表计算中断，请重试。'));
      };
      worker.postMessage({pool,count});
    });
  }

  async function loadTables(pool, group) {
    const key = pool + "-" + group;
    return (await store).getTable('group:'+key, async () => {
      const response = await fetch(new URL(key + ".bin", folder));
      if (!response.ok) throw new Error("概率表加载失败，请重试。");
      const payload = new DataView(await response.arrayBuffer());
      const tables = [];
      let offset = 0;
      for (let i = 0; i < 10; i++) {
        const first = payload.getUint32(offset, true);
        const size = payload.getUint32(offset + 4, true);
        offset += 8;
        const weights = new Float32Array(size);
        for (let j = 0; j < size; j++, offset += 4) {
          weights[j] = payload.getFloat32(offset, true);
        }
        tables.push({ first, weights });
      }
      return tables;
    });
  }

  async function analyze(pool, count, average) {
    if (!Object.hasOwn(maxAverage, pool)) throw new Error("请选择受支持的调频频道。");
    if (!Number.isInteger(count) || count < 1 || count > maxCount) {
      throw new Error("限定 UP 数量须为 1 至 100,000 的整数。");
    }
    const limit = maxAverage[pool];
    if (!Number.isFinite(average) || average < 1 || average > limit) {
      throw new Error("平均每 UP 抽数须在 1 至 " + limit + " 之间。");
    }
    const total = Math.round(count * average);
    const group = Math.floor((count - 1) / 10);
    const {first, weights} = count <= 100
      ? (await loadTables(pool, group))[(count - 1) % 10]
      : await (await store).getTable('count:'+pool+':'+count, () => computeLarge(pool,count));
    let mass = 0;
    let scoreMass = 0;
    let weighted = 0;
    for (let i = 0; i < weights.length; i++) {
      const pull = first + i, weight = weights[i];
      mass += weight;
      weighted += pull * weight;
      if (pull > total) scoreMass += weight;
      else if (pull === total) scoreMass += weight / 2;
    }
    // Keep both tails, but devote most of the plot to the central 98% of records.
    let cumulative = 0;
    let lower, upper, median;
    for (let i = 0; i < weights.length; i++) {
      cumulative += weights[i];
      const pull = first + i;
      if (lower === undefined && cumulative >= mass * .01) lower = pull;
      if (median === undefined && cumulative >= mass * .5) median = pull;
      if (cumulative >= mass * .99) {
        upper = pull;
        break;
      }
    }

    const bins = [];
    let index = 0;
    function addBin(low, high, tail = false) {
      let probability = 0;
      while (index < weights.length && first + index <= high) {
        probability += weights[index++];
      }
      bins.push({
        low: low / count, high: high / count, probability: probability / mass,
        current: low <= total && total <= high, tail
      });
    }

    const last = count * limit;
    const middleSize = upper - lower + 1;
    const centralBins = Math.min(middleSize, 24 - Number(lower > count) - Number(upper < last));
    if (lower > count) addBin(count, lower - 1, true);
    for (let i = 0; i < centralBins; i++) {
      const low = lower + Math.floor(i * middleSize / centralBins);
      const high = lower + Math.floor((i + 1) * middleSize / centralBins) - 1;
      addBin(low, high);
    }
    if (upper < last) addBin(upper + 1, last, true);
    return {
      pool, count, total, average: total / count, enteredAverage: average,
      mean: weighted / mass / count, median: median / count,
      percentile: Math.min(100, Math.max(0, 100 * scoreMass / mass)), bins
    };
  }

  window.LuckModel = Object.freeze({ analyze, source, maxAverage, maxCount });
})();

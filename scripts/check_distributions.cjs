const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const path = require("node:path");
const { pathToFileURL } = require("node:url");

global.window = global;
global.document = { currentScript: { src: pathToFileURL(path.join(__dirname, "../dist/model.js")).href } };
global.fetch = async url => new Response(await fs.readFile(url));
require("../dist/model.js");

async function check() {
  for (const [pool, topPercentile, expectedMean] of [
    ["agent", 99.85, 93.44599806], ["engine", 99.625, 62.36623164]
  ]) {
    const best = await LuckModel.analyze(pool, 1, 1);
    assert(Math.abs(best.percentile - topPercentile) < 1e-6);
    for (let n = 1; n <= 100; n++) {
      const result = await LuckModel.analyze(pool, n, expectedMean);
      assert.equal(result.bins.length, 24);
      assert.equal(result.bins.filter(bin => bin.current).length, 1);
      assert(Math.abs(result.bins.reduce((a, bin) => a + bin.probability, 0) - 1) < 1e-12);
      assert(Math.abs(result.mean - expectedMean) < 1e-6);
      const bin = result.bins.find(bin => bin.current);
      assert(bin.low <= result.average && result.average <= bin.high);
      const first = result.bins[0], last = result.bins.at(-1);
      assert.equal(first.low, 1);
      assert.equal(last.high, LuckModel.maxAverage[pool]);
      for (const tail of [first, last]) {
        if (tail.tail) assert(tail.probability <= .01000001);
      }
      for (let i = 1; i < result.bins.length; i++) {
        assert.equal(Math.round((result.bins[i].low - result.bins[i-1].high) * n), 1);
      }
      const rare = await LuckModel.analyze(pool, n, last.high);
      assert(rare.bins.at(-1).current);
      const less = await LuckModel.analyze(pool, n, result.average - 1 / n);
      assert(less.percentile >= result.percentile);
    }
    const worst = await LuckModel.analyze(pool, 1, LuckModel.maxAverage[pool]);
    assert(worst.percentile < 0.001);
    await assert.rejects(LuckModel.analyze(pool, 0, 10));
    await assert.rejects(LuckModel.analyze(pool, 100001, 10));
    await assert.rejects(LuckModel.analyze(pool, 1, 181));
  }
  console.log("Passed 200 table checks, median score ordering, analytical single-pull ties and domain checks.");
}
check().catch(error => { console.error(error); process.exitCode = 1; });

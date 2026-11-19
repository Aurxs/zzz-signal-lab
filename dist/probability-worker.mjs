import { convolveFeatured } from "./convolution.mjs";

self.onmessage = ({ data }) => {
  try {
    const { first, weights } = convolveFeatured(data.pool, data.count);
    self.postMessage({ first, weights }, [weights.buffer]);
  } catch (error) {
    self.postMessage({ error: error.message || "概率分布计算失败。" });
  }
};

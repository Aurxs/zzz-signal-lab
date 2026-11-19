"""Rebuild the probability tables with Python 3 and NumPy."""
from pathlib import Path
import struct
import numpy as np

DEST = Path(__file__).resolve().parents[1] / "dist" / "model-data"
POOLS = {"agent": (.006, 74, 90, .50), "engine": (.010, 65, 80, .75)}
CHUNK = 10


def featured_pmf(base, first_soft, hard, win):
    # Index k is the number of pulls, including the S-rank itself.
    hazard = np.array([
        min(1., base + max(0, i - first_soft + 1) * .06)
        for i in range(1, hard + 1)
    ])
    hazard[-1] = 1.
    survival = np.cumprod(np.r_[1., 1. - hazard[:-1]])
    s_rank = np.r_[0., hazard * survival]
    featured = (1. - win) * np.convolve(s_rank, s_rank)
    featured[:len(s_rank)] += win * s_rank
    return featured


def generate(pool, params):
    one = featured_pmf(*params)
    expected = np.dot(np.arange(len(one)), one)
    folded = np.array([1.])
    assert np.isclose(one[1], params[0] * params[3])
    buffer = bytearray()
    for n in range(1, 101):
        # Positive direct convolution keeps the rare tails free from FFT noise.
        folded = np.convolve(folded, one)
        assert abs(folded.sum() - 1.) < 1e-12
        assert abs(np.dot(np.arange(len(folded)), folded) / n - expected) < 1e-8
        data = folded.astype("<f4")
        start, end = np.flatnonzero(data)[[0, -1]]
        packed = data[start:end + 1]
        assert abs(packed.sum(dtype=np.float64) - 1.) < 1e-7
        buffer.extend(struct.pack("<II", int(start), len(packed)))
        buffer.extend(packed.tobytes())
        if n % CHUNK == 0:
            (DEST / f"{pool}-{n // CHUNK - 1}.bin").write_bytes(buffer)
            buffer.clear()
    print(f"{pool}: mean {expected:.8f}, 100 tables")


if __name__ == "__main__":
    DEST.mkdir(exist_ok=True, parents=True)
    for name, params in POOLS.items():
        generate(name, params)

const PULL_LIMIT = { agent: 180, engine: 160 };
const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const MAX_REQUEST_BYTES = 512;

function json(body, status = 200, headers = {}) {
  return Response.json(body, { status, headers: { 'cache-control': 'no-store', ...headers } });
}

async function readBody(request) {
  if (Number(request.headers.get('content-length')) > MAX_REQUEST_BYTES) {
    throw new RangeError();
  }
  const reader = request.body?.getReader();
  if (!reader) throw new SyntaxError();
  const bytes = new Uint8Array(MAX_REQUEST_BYTES);
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (size + value.length > bytes.length) {
      await reader.cancel();
      throw new RangeError();
    }
    bytes.set(value, size);
    size += value.length;
  }
  return JSON.parse(new TextDecoder().decode(bytes.subarray(0, size)));
}

function valid(record) {
  if (!record || typeof record !== 'object') return false;
  const { pool, count, total, device } = record;
  return typeof pool === 'string' && Object.hasOwn(PULL_LIMIT, pool)
    && Number.isInteger(count) && count >= 1 && count <= 100000
    && Number.isInteger(total) && total >= count && total <= PULL_LIMIT[pool] * count
    && typeof device === 'string' && UUID_V4.test(device);
}

async function upsertAndRank(db, { pool, count, total, device }) {
  const bytes = new TextEncoder().encode(pool + ':' + device.toLowerCase());
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes));
  const key = Array.from(digest, b => b.toString(16).padStart(2, '0')).join('');
  const write = db.prepare(`
    INSERT INTO samples (pool, device_hash, up_count, pulls) VALUES (?, ?, ?, ?)
    ON CONFLICT (pool, device_hash) DO UPDATE
      SET up_count = excluded.up_count, pulls = excluded.pulls
  `).bind(pool, key, count, total);
  const rank = db.prepare(`
    SELECT count(*) AS size,
           100.0 * sum(CASE WHEN pulls > ? THEN 1.0 WHEN pulls = ? THEN 0.5 ELSE 0 END)
               / count(*) AS percentile
    FROM samples WHERE pool = ? AND up_count = ?
  `).bind(total, total, pool, count);
  const results = await db.batch([write, rank]);
  return results[1].results[0];
}

export async function onRequest({ request, env }) {
  if (request.method !== 'GET' && request.method !== 'POST') {
    return json({ error: 'method_not_allowed' }, 405, { allow: 'GET, POST' });
  }
  if (!env.DB) return json({ available: false }, 503);
  if (request.method === 'GET') {
    try {
      await env.DB.prepare('SELECT 1 FROM samples LIMIT 1').first();
      return json({ available: true });
    } catch {
      return json({ available: false }, 503);
    }
  }
  const origin = request.headers.get('origin');
  if (origin && origin !== new URL(request.url).origin) {
    return json({ error: 'origin_mismatch' }, 403);
  }
  if (request.headers.get('content-type')?.split(';')[0].trim().toLowerCase() !== 'application/json') {
    return json({ error: 'json_required' }, 415);
  }
  let record;
  try {
    record = await readBody(request);
  } catch (error) {
    return error instanceof RangeError ? json({ error: 'too_large' }, 413) : json({ error: 'invalid_json' }, 400);
  }
  if (!valid(record)) return json({ error: 'invalid_sample' }, 422);
  try {
    return json(await upsertAndRank(env.DB, record));
  } catch {
    return json({ error: 'samples_unavailable' }, 503);
  }
}

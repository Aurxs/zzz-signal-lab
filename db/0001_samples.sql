CREATE TABLE samples (
    pool TEXT NOT NULL CHECK (pool IN ('agent', 'engine')),
    device_hash TEXT NOT NULL CHECK (length(device_hash) = 64),
    up_count INTEGER NOT NULL CHECK (up_count BETWEEN 1 AND 100),
    pulls INTEGER NOT NULL CHECK (
        pulls >= up_count AND
        pulls <= up_count * CASE WHEN pool = 'agent' THEN 180 ELSE 160 END
    ),
    PRIMARY KEY (pool, device_hash)
) WITHOUT ROWID;

CREATE INDEX samples_by_group ON samples (pool, up_count, pulls);

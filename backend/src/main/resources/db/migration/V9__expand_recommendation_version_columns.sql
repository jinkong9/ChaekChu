-- Model and index version identifiers are opaque deployment labels, not short enum codes.
-- Current GMS/scale labels exceed the original VARCHAR(30), preventing snapshots from persisting.
ALTER TABLE recommendations
    ALTER COLUMN feature_version TYPE VARCHAR(128),
    ALTER COLUMN index_version TYPE VARCHAR(128);

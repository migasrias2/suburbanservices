-- The 5 MB cap was sized for newly-captured photos, which are downscaled to
-- 1280px/q0.7 and land well under 1 MB. Some legacy rows predate compression
-- and decode to ~7 MB, so the backfill was rejecting them.
-- Raise the ceiling to accommodate the historic data; it does not loosen
-- anything for new uploads, which never approach it.
update storage.buckets
set file_size_limit = 15728640  -- 15 MB
where id = 'task-photos';

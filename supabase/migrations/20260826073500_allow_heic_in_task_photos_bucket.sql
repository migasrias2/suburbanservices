-- iPhones that had HEIC capture enabled produced data URLs the bucket rejected,
-- stalling every backfill batch that contained one. New uploads are always
-- canvas-encoded JPEG, so this only widens what the historic data can land as.
update storage.buckets
set allowed_mime_types = array['image/jpeg','image/webp','image/png','image/heic','image/heif']
where id = 'task-photos';

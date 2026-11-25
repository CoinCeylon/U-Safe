-- Community key metadata (M065).
-- The key material itself is never stored in plaintext: the UGC copy lives in
-- universities.community_key_wrapped_for_ugc and the student delivery copy in
-- universities.community_key_wrapped_for_delivery (wrapped under
-- COMMUNITY_DELIVERY_SECRET).
ALTER TABLE universities ADD COLUMN community_key_created_at TEXT;
ALTER TABLE universities ADD COLUMN community_key_academic_year TEXT;

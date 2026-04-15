-- Detach the stray `humanfirst-3-session-course-reference_9_3_2026`
-- ContentSource from Secret Garden 1001's subject. It leaked in from another
-- Abacus Academy course via the shared domain subject (see #169).
--
-- Run on the VM:
--   psql "$DATABASE_URL" -f scripts/cleanup-secret-garden-1001.sql
--
-- Inspect first (dry-run) then uncomment the DELETE.

-- Dry-run: show every SubjectSource row that could be the stray.
SELECT
  ss.id              AS subject_source_id,
  ss."subjectId",
  ss."sourceId",
  s.name             AS source_name,
  s."documentType",
  sub.slug           AS subject_slug,
  ss."createdAt"
FROM "SubjectSource" ss
JOIN "ContentSource" s   ON s.id   = ss."sourceId"
JOIN "Subject"       sub ON sub.id = ss."subjectId"
JOIN "PlaybookSubject" ps ON ps."subjectId" = sub.id
WHERE ps."playbookId" = '3e666268-f64e-40b4-b8b7-8dfcfe05c8d3'
  AND s."documentType" = 'COURSE_REFERENCE'
ORDER BY ss."createdAt" DESC;

-- After eyeballing the above, delete the stray by id:
-- DELETE FROM "SubjectSource" WHERE id = '<stray-id-from-above>';

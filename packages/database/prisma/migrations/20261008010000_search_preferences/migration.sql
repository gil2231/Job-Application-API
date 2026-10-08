-- One free-text box of job search preferences replaces the recommendation keyword list.
-- NULL means the user hasn't written any yet (the default list applies).
ALTER TABLE "MasterProfile" ADD COLUMN "searchPreferences" TEXT;

UPDATE "MasterProfile"
SET "searchPreferences" = array_to_string("recommendationKeywords", ', ')
WHERE cardinality("recommendationKeywords") > 0;

ALTER TABLE "MasterProfile" DROP COLUMN "recommendationKeywords";

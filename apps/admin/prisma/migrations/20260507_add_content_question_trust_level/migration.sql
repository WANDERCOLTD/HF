-- #276 Slice 3: provenance signal for ContentQuestion rows.
-- AI_ASSISTED is the default for generator-output MCQs; higher tiers
-- (EXPERT_CURATED, ACCREDITED_MATERIAL, REGULATORY_STANDARD) for educator-
-- imported question banks. Surfaces a trust badge in the curriculum admin
-- UI; future pre-test queries can gate on this when an educator wants only
-- verified items.
--
-- Additive nullable column with default — safe; existing rows stay null
-- until reset/regenerate, at which point the generator stamps AI_ASSISTED.
ALTER TABLE "ContentQuestion" ADD COLUMN "trustLevel" "ContentTrustLevel" DEFAULT 'AI_ASSISTED';

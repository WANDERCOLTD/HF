-- Add config JSON field to Domain for community-specific settings (communityKind, hubPattern)
ALTER TABLE "Domain" ADD COLUMN "config" JSONB;

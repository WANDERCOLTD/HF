#!/usr/bin/env tsx
/**
 * Teardown — deletes everything `seed-load-test-data.ts` created.
 * Idempotent: safe to run multiple times. Reads last-seed.json manifest.
 */
import { PrismaClient } from '@prisma/client';

const args = process.argv.slice(2);
const envArg = args.find((a) => a.startsWith('--env='))?.split('=')[1];

if (envArg !== 'staging') {
  console.error('error: --env=staging is required.');
  process.exit(2);
}

const url = process.env.DATABASE_URL || '';
if (!url.includes('hf_staging') && !url.includes('hf_dev')) {
  console.error('error: DATABASE_URL does not point at hf_staging (or transitional hf_dev).');
  process.exit(2);
}

const prisma = new PrismaClient();

async function main() {
  const fs = await import('node:fs/promises');
  const path = await import('node:path');
  const manifestPath = path.resolve(__dirname, 'last-seed.json');
  let manifest: { callers: { id: string; name: string }[] } | null = null;

  try {
    const raw = await fs.readFile(manifestPath, 'utf8');
    manifest = JSON.parse(raw);
  } catch {
    // No manifest — fall back to name-pattern delete
    console.log('No last-seed.json manifest; falling back to name pattern "loadtest-%"');
  }

  if (manifest) {
    const ids = manifest.callers.map((c) => c.id);
    const r = await prisma.callerIdentity.deleteMany({ where: { id: { in: ids } } });
    console.log(`Deleted ${r.count} callers from manifest.`);
  } else {
    const r = await prisma.callerIdentity.deleteMany({ where: { name: { startsWith: 'loadtest-' } } });
    console.log(`Deleted ${r.count} callers by name pattern.`);
  }

  // Best-effort manifest cleanup
  try {
    await fs.unlink(manifestPath);
  } catch {
    /* OK if not present */
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());

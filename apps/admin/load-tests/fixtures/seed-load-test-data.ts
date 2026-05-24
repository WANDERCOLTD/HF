#!/usr/bin/env tsx
/**
 * Seed N test callers on the target env via direct Prisma.
 *
 * Hard-guarded with --env=staging. Refuses pilot/prod.
 *
 * Output: prints the created caller IDs (write the first to .env.load-test
 * as LOAD_TEST_CALLER_ID).
 */
import { PrismaClient } from '@prisma/client';

const args = process.argv.slice(2);
const envArg = args.find((a) => a.startsWith('--env='))?.split('=')[1];
const callersArg = Number(args.find((a) => a.startsWith('--callers='))?.split('=')[1] ?? '10');

if (envArg !== 'staging') {
  console.error('error: --env=staging is required. (pilot/prod refused — load tests stage-only)');
  process.exit(2);
}

const url = process.env.DATABASE_URL || '';
if (!url.includes('hf_staging') && !url.includes('hf_dev')) {
  console.error('error: DATABASE_URL does not point at hf_staging (or transitional hf_dev). got:', url.replace(/:[^:@]+@/, ':***@'));
  process.exit(2);
}

const prisma = new PrismaClient();

async function main() {
  console.log(`Seeding ${callersArg} load-test callers on staging…`);
  const created: { id: string; name: string }[] = [];
  for (let i = 0; i < callersArg; i++) {
    const name = `loadtest-${Date.now()}-${i}`;
    const caller = await prisma.callerIdentity.create({
      data: {
        name,
        email: `${name}@load-test.local`,
        // Minimal fields — load tests don't need playbook enrollment for the
        // Phase 1A scenarios (health + webhook). Pipeline/extraction scenarios
        // in Phase 1B will need richer setup.
      },
      select: { id: true, name: true },
    });
    created.push(caller);
  }
  console.log(`\nCreated ${created.length} callers. Set LOAD_TEST_CALLER_ID in .env.load-test:\n`);
  console.log(`LOAD_TEST_CALLER_ID=${created[0].id}\n`);
  console.log(`All IDs (for teardown reference — saved to fixtures/last-seed.json):`);
  console.log(JSON.stringify(created, null, 2));

  // Save manifest for idempotent teardown
  const fs = await import('node:fs/promises');
  const path = await import('node:path');
  const manifestPath = path.resolve(__dirname, 'last-seed.json');
  await fs.writeFile(
    manifestPath,
    JSON.stringify({ env: envArg, createdAt: new Date().toISOString(), callers: created }, null, 2),
  );
  console.log(`\nManifest: ${manifestPath}`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());

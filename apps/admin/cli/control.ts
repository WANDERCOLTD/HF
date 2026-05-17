#!/usr/bin/env node
/**
 * HumanFirst Control CLI
 *
 * A command-line interface for managing the HumanFirst Admin application
 *
 * Usage:
 *   npx tsx cli/control.ts <command> [options]
 *   npm run ctl <command> [options]
 *   cd cli && npx run control.ts (also works)
 */

import { Command } from 'commander';
import { execSync, spawn, ChildProcess } from 'child_process';
import * as readline from 'readline';
import * as path from 'path';
import { fileURLToPath } from 'url';

const program = new Command();

// Get the correct working directory (apps/admin, not cli/)
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ADMIN_ROOT = path.resolve(__dirname, '..');

// Colors for terminal output
const colors = {
  reset: '\x1b[0m',
  bright: '\x1b[1m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  red: '\x1b[31m',
  cyan: '\x1b[36m',
};

function log(message: string, color = colors.reset) {
  console.log(`${color}${message}${colors.reset}`);
}

function success(message: string) {
  log(`✅ ${message}`, colors.green);
}

function error(message: string) {
  log(`❌ ${message}`, colors.red);
}

function info(message: string) {
  log(`ℹ️  ${message}`, colors.blue);
}

function warn(message: string) {
  log(`⚠️  ${message}`, colors.yellow);
}

function exec(command: string, description?: string) {
  if (description) {
    info(description);
  }

  try {
    const output = execSync(command, {
      stdio: 'inherit',
      cwd: ADMIN_ROOT, // Always run from apps/admin directory
    });
    return { success: true, output };
  } catch (e: any) {
    error(`Command failed: ${command}`);
    return { success: false, error: e };
  }
}

// ============================================================================
// MIGRATION COMMANDS
// ============================================================================

program
  .command('migrate')
  .description('Run database migrations')
  .option('-t, --test', 'Run tests after migration')
  .option('-s, --seed', 'Seed database after migration')
  .option('--reset', 'Reset database before migration (destructive!)')
  .action(async (options) => {
    log('\n🔄 Database Migration\n', colors.bright);

    // Reset if requested
    if (options.reset) {
      warn('This will DELETE all data! Are you sure?');
      const confirmed = await confirm('Continue?');
      if (!confirmed) {
        info('Migration cancelled');
        return;
      }

      exec('npx prisma migrate reset --force', 'Resetting database...');
    }

    // Run migrations
    const result = exec('npx prisma migrate deploy', 'Running migrations...');

    if (!result.success) {
      error('Migration failed!');
      process.exit(1);
    }

    success('Migrations completed successfully');

    // Seed if requested
    if (options.seed) {
      exec('npx tsx prisma/seed-mabel.ts', 'Seeding database...');
    }

    // Run tests if requested
    if (options.test) {
      log('\n🧪 Running Tests\n', colors.bright);

      info('1/3: Unit tests...');
      exec('npm run test');

      info('2/3: Integration tests...');
      await runTestsWithServer(
        'npm run test:integration',
        'Running integration tests...'
      );

      info('3/3: E2E tests...');
      await runTestsWithServer('npm run test:e2e', 'Running E2E tests...');
    }

    success('Migration complete!');
  });

program
  .command('migrate:create')
  .description('Create a new migration')
  .argument('<name>', 'Migration name')
  .action((name) => {
    exec(`npx prisma migrate dev --name ${name}`, 'Creating migration...');
  });

program
  .command('migrate:status')
  .description('Check migration status')
  .action(() => {
    exec('npx prisma migrate status', 'Checking migration status...');
  });

// ============================================================================
// TEST COMMANDS
// ============================================================================

program
  .command('test')
  .description('Run tests')
  .option('-u, --unit', 'Run unit tests only')
  .option('-i, --integration', 'Run integration tests only')
  .option('-e, --e2e', 'Run E2E tests only')
  .option('-c, --coverage', 'Generate coverage report')
  .option('-w, --watch', 'Run in watch mode')
  .action(async (options) => {
    log('\n🧪 Running Tests\n', colors.bright);

    if (options.watch) {
      exec('npm run test:watch', 'Starting test watcher...');
      return;
    }

    let result = true;

    if (options.unit) {
      const cmd = options.coverage ? 'npm run test:coverage' : 'npm run test';
      const testResult = exec(cmd, 'Running unit tests...');
      result = testResult.success;
    } else if (options.integration) {
      result = await runTestsWithServer(
        'npm run test:integration',
        'Running integration tests...'
      );
    } else if (options.e2e) {
      result = await runTestsWithServer('npm run test:e2e', 'Running E2E tests...');
    } else {
      // Run all tests (unit, integration, E2E)
      log('Running full test suite...\n', colors.bright);

      // 1. Unit tests (no server needed)
      info('1/3: Unit tests...');
      const unitResult = exec('npm run test');
      if (!unitResult.success) {
        error('Unit tests failed!');
        process.exit(1);
      }

      // 2. Integration tests (with server)
      info('2/3: Integration tests...');
      const integrationResult = await runTestsWithServer(
        'npm run test:integration',
        'Running integration tests with dev server...'
      );
      if (!integrationResult) {
        error('Integration tests failed!');
        process.exit(1);
      }

      // 3. E2E tests (with server)
      info('3/3: E2E tests...');
      const e2eResult = await runTestsWithServer(
        'npm run test:e2e',
        'Running E2E tests with dev server...'
      );
      if (!e2eResult) {
        error('E2E tests failed!');
        process.exit(1);
      }

      result = true;
    }

    if (result) {
      success('Tests complete!');
    } else {
      error('Tests failed!');
      process.exit(1);
    }
  });

program
  .command('test:ui')
  .description('Run E2E tests in UI mode')
  .action(() => {
    exec('npm run test:e2e:ui', 'Opening Playwright UI...');
  });

program
  .command('test:e2e:list')
  .description('List all E2E tests')
  .action(() => {
    exec('npx playwright test --list', 'Listing all E2E tests...');
  });

program
  .command('test:e2e:report')
  .description('Show last E2E test report')
  .action(() => {
    exec('npx playwright show-report', 'Opening Playwright report...');
  });

program
  .command('test:e2e:debug')
  .description('Run E2E tests in debug mode')
  .action(() => {
    exec('npm run test:e2e:debug', 'Running E2E tests in debug mode...');
  });

program
  .command('test:e2e:file')
  .description('Run specific E2E test file')
  .argument('<file>', 'Test file path (e.g., tests/auth/login.spec.ts)')
  .action((file) => {
    exec(`npx playwright test ${file}`, `Running ${file}...`);
  });

program
  .command('test:e2e:project')
  .description('Run E2E tests for specific project')
  .argument('<project>', 'Project name (authenticated, unauthenticated, mobile, legacy)')
  .action((project) => {
    exec(`npx playwright test --project=${project}`, `Running ${project} project tests...`);
  });

// ============================================================================
// DATABASE COMMANDS
// ============================================================================

program
  .command('db:reset')
  .description('Reset database (destructive!)')
  .option('-s, --seed', 'Seed after reset')
  .action(async (options) => {
    warn('⚠️  This will DELETE all data!');
    const confirmed = await confirm('Are you sure?');

    if (!confirmed) {
      info('Reset cancelled');
      return;
    }

    exec('npx tsx prisma/reset.ts', 'Resetting database...');

    if (options.seed) {
      exec('npx tsx prisma/seed-mabel.ts', 'Seeding database...');
    }

    success('Database reset complete!');
  });

program
  .command('db:seed')
  .description('Seed database with test data')
  .option('--all', 'Seed ALL data (Mabel + WNF + Voice) - DEFAULT')
  .option('--mabel', 'Seed with Mabel data (full reset)')
  .option('--wnf', 'Seed WNF domain only (adds to existing)')
  .option('--safe', 'Seed SAFE data')
  .option('--master', 'Run master seed (parameters only)')
  .option('--transcripts', 'Import WNF transcripts only')
  .action((options) => {
    if (options.mabel) {
      exec('npx tsx prisma/seed-mabel.ts', 'Seeding with Mabel data (full reset)...');
    } else if (options.wnf) {
      exec('npx tsx prisma/seed-wnf.ts', 'Seeding WNF domain...');
    } else if (options.safe) {
      exec('npx tsx prisma/seed-safe.ts', 'Seeding SAFE data...');
    } else if (options.master) {
      exec('npx tsx prisma/seed-master.ts', 'Running master seed (parameters)...');
    } else if (options.transcripts) {
      exec('npx tsx prisma/seed-wnf-transcripts.ts', 'Importing WNF transcripts...');
    } else {
      // Default: Seed ALL (Mabel + WNF)
      log('\n🌱 Seeding ALL data (Mabel + WNF domains)\n', colors.bright);
      exec('npx tsx prisma/seed-mabel.ts', 'Step 1/2: Seeding Mabel (full reset + base data)...');
      exec('npx tsx prisma/seed-wnf.ts', 'Step 2/2: Adding WNF domain + playbook...');
    }

    success('Database seeded!');
  });

program
  .command('db:studio')
  .description('Open Prisma Studio')
  .action(() => {
    exec('npx prisma studio', 'Opening Prisma Studio...');
  });

// ============================================================================
// DEV COMMANDS
// ============================================================================

program
  .command('dev')
  .description('Start development server')
  .option('-d, --docker', 'Start with Docker')
  .action((options) => {
    if (options.docker) {
      exec('./scripts/dev-start.sh docker', 'Starting with Docker...');
    } else {
      exec('npm run dev', 'Starting development server...');
    }
  });

program
  .command('dev:x')
  .description('Kill all Next processes, clear cache, restart dev')
  .action(() => {
    log('\n🔥 devX — Hard Restart\n', colors.bright);
    exec('pkill -9 -f "next dev" || true && pkill -9 -f "next-server" || true && lsof -ti:3000 2>/dev/null | xargs kill -9 2>/dev/null || true', 'Killing existing processes...');
    exec('rm -rf .next', 'Clearing .next cache...');
    exec('npm run dev', 'Starting dev server...');
  });

program
  .command('dev:t')
  .description('Quick test run (vitest run)')
  .action(() => {
    log('\n🧪 devT — Quick Test\n', colors.bright);
    exec('npx vitest run', 'Running vitest...');
  });

program
  .command('dev:d')
  .description('Data reset only (wipe DB + reload, keep server running)')
  .action(() => {
    log('\n🔄 devD — Data Reset\n', colors.bright);
    exec('./scripts/dev-d.sh', 'Resetting data...');
  });

program
  .command('dev:s')
  .description('Spec reload + ngrok tunnel (keep caller data)')
  .action(() => {
    log('\n🌱 devS — Spec Reload\n', colors.bright);
    exec('./scripts/dev-s.sh', 'Reloading specs...');
  });

program
  .command('dev:zzz')
  .description('Nuclear reset — wipe DB + cache + restart + seed + ngrok')
  .action(() => {
    log('\n💣 devZZZ — Nuclear Reset\n', colors.bright);
    exec('./scripts/dev-zzz.sh', 'Running nuclear reset...');
  });

program
  .command('dev:stop')
  .description('Stop development server')
  .action(() => {
    exec('./scripts/dev-start.sh stop', 'Stopping development server...');
  });

program
  .command('dev:status')
  .description('Check development server status')
  .action(() => {
    exec('./scripts/dev-start.sh status', 'Checking status...');
  });

// ============================================================================
// BUILD & DEPLOY COMMANDS
// ============================================================================

program
  .command('build')
  .description('Build application for production')
  .action(() => {
    log('\n🏗️  Building Application\n', colors.bright);

    const result = exec('npm run build', 'Building...');

    if (result.success) {
      success('Build complete!');
    } else {
      error('Build failed!');
      process.exit(1);
    }
  });

program
  .command('build:test')
  .description('Build and run tests')
  .action(async () => {
    log('\n🏗️  Build & Test Pipeline\n', colors.bright);

    // 1. Run tests
    info('Step 1/2: Running tests...');

    // Unit tests
    let result = exec('npm run test');
    if (!result.success) {
      error('Unit tests failed!');
      process.exit(1);
    }

    // Integration tests
    const integrationResult = await runTestsWithServer(
      'npm run test:integration',
      'Running integration tests...'
    );
    if (!integrationResult) {
      error('Integration tests failed!');
      process.exit(1);
    }

    // E2E tests
    const e2eResult = await runTestsWithServer(
      'npm run test:e2e',
      'Running E2E tests...'
    );
    if (!e2eResult) {
      error('E2E tests failed!');
      process.exit(1);
    }

    // 2. Build
    info('Step 2/2: Building application...');
    result = exec('npm run build');
    if (!result.success) {
      error('Build failed!');
      process.exit(1);
    }

    success('✅ Build & Test pipeline complete!');
  });

// ============================================================================
// TOOLS & GENERATORS
// ============================================================================

program
  .command('snap')
  .description('Capture demo screenshots with Playwright')
  .option('-d, --demo <id>', 'Capture specific demo only')
  .option('-b, --base-url <url>', 'Base URL (default: http://localhost:3000)')
  .action((options) => {
    const args: string[] = [];
    if (options.demo) args.push('--demo', options.demo);
    if (options.baseUrl) args.push('--base-url', options.baseUrl);
    exec(`npx tsx scripts/capture-demo-screenshots.ts ${args.join(' ')}`, 'Capturing demo screenshots...');
  });

program
  .command('registry')
  .description('Generate and validate spec registry')
  .option('-v, --validate-only', 'Validate without generating')
  .action((options) => {
    if (options.validateOnly) {
      exec('npm run registry:validate', 'Validating registry...');
    } else {
      exec('npm run registry:generate', 'Generating registry...');
      exec('npm run registry:validate', 'Validating registry...');
    }
    success('Registry up to date!');
  });

program
  .command('docs')
  .description('Generate or check documentation')
  .option('-a, --api', 'Generate API docs')
  .option('-c, --check', 'Check API docs (no write)')
  .option('-H, --health', 'Run doc health check')
  .action((options) => {
    if (options.health) {
      exec('npm run docs:health', 'Running doc health check...');
    } else if (options.check) {
      exec('npm run docs:api:check', 'Checking API docs...');
    } else if (options.api) {
      exec('npm run docs:api', 'Generating API docs...');
    } else {
      exec('npm run docs:api', 'Generating API docs...');
      exec('npm run docs:health', 'Running doc health check...');
    }
  });

program
  .command('bootstrap')
  .description('Bootstrap admin user')
  .action(() => {
    exec('npm run bootstrap-admin', 'Bootstrapping admin user...');
  });

program
  .command('cleanup')
  .description('Clean up orphaned slugs')
  .action(() => {
    exec('npm run cleanup:orphaned-slugs', 'Cleaning up orphaned slugs...');
  });

// ============================================================================
// UTILITY COMMANDS
// ============================================================================

program
  .command('lint')
  .description('Run linter')
  .option('-f, --fix', 'Auto-fix issues')
  .action((options) => {
    const cmd = options.fix ? 'npm run lint -- --fix' : 'npm run lint';
    exec(cmd, 'Running linter...');
  });

program
  .command('check')
  .description('Run all checks (lint + type check + tests + FK consistency)')
  .action(async () => {
    log('\n🔍 Running All Checks\n', colors.bright);

    info('1/5: Linting...');
    exec('npm run lint');

    info('2/5: Type checking...');
    exec('npx tsc --noEmit');

    info('3/5: Unit tests...');
    exec('npm run test');

    info('4/5: Integration tests...');
    await runTestsWithServer(
      'npm run test:integration',
      'Running integration tests...'
    );

    info('5/5: FK consistency (slug-scope #407 guard)...');
    exec('npx tsx scripts/check-fk-consistency.ts');

    success('All checks passed!');
  });

program
  .command('ok')
  .description('Quick health check: git, types, MCP servers, and dev status')
  .action(async () => {
    log('\n🏥 Health Check\n', colors.bright);

    // Git status
    info('Checking git status...');
    try {
      const branch = execSync('git rev-parse --abbrev-ref HEAD', {
        cwd: path.resolve(ADMIN_ROOT, '..', '..'),
        encoding: 'utf-8'
      }).trim();
      const status = execSync('git status --porcelain', {
        cwd: path.resolve(ADMIN_ROOT, '..', '..'),
        encoding: 'utf-8'
      });
      const uncommitted = status.split('\n').filter(l => l).length;
      success(`Branch: ${branch} (${uncommitted} uncommitted files)`);
    } catch (e) {
      warn('Could not check git status');
    }

    // TypeScript
    info('Type checking...');
    try {
      execSync('npx tsc --noEmit', {
        stdio: 'pipe',
        cwd: ADMIN_ROOT
      });
      success('TypeScript: Clean');
    } catch (e) {
      error('TypeScript: Type errors found');
    }

    // MCP Servers
    info('Checking MCP servers...');
    try {
      const mcpOutput = execSync('claude mcp list', {
        stdio: 'pipe',
        encoding: 'utf-8',
        cwd: path.resolve(ADMIN_ROOT, '..', '..')
      });
      const connected = mcpOutput.match(/✓ Connected/g) || [];
      const failed = mcpOutput.match(/✗ Failed/g) || [];

      if (failed.length === 0) {
        success(`MCP Servers: ${connected.length} connected`);
      } else {
        warn(`MCP Servers: ${connected.length} connected, ${failed.length} failed`);
      }
    } catch (e) {
      warn('Claude Code not accessible (MCP servers may still work)');
    }

    // Port check
    info('Checking dev server status...');
    try {
      execSync('lsof -ti:3000 > /dev/null 2>&1', { stdio: 'pipe' });
      success('Dev server: Running on :3000');
    } catch (e) {
      warn('Dev server: Not running');
    }

    log('');
    success('Health check complete!');
    info('To start developing: npm run dev');
    info('To run full checks: npm run ctl check');
  });

program
  .command('clean')
  .description('Clean build artifacts and node_modules')
  .action(async () => {
    warn('This will delete .next, node_modules, and coverage');
    const confirmed = await confirm('Continue?');

    if (!confirmed) {
      info('Clean cancelled');
      return;
    }

    exec('rm -rf .next node_modules coverage playwright-report test-results', 'Cleaning...');
    success('Clean complete! Run `npm install` to reinstall dependencies.');
  });

// ============================================================================
// INTERACTIVE MENU
// ============================================================================

program
  .command('menu')
  .description('Interactive menu (default)')
  .action(async () => {
    await showInteractiveMenu();
  });

async function showInteractiveMenu() {
  while (true) {
    console.clear();
    log('╔═══════════════════════════════════════════════════════════════╗', colors.cyan);
    log('║           HumanFirst Admin - Control Panel                   ║', colors.cyan);
    log('╚═══════════════════════════════════════════════════════════════╝', colors.cyan);
    log('');
    log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━', colors.cyan);
    log('  🌱 SEED WORKFLOW (recommended order)', colors.bright);
    log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━', colors.cyan);
    log('');
    log('  1. Clear data          - Wipe database clean');
    log('  2. Upload BDD specs    - Load specs from docs-archive/bdd-specs/ (compiles promptTemplate)');
    log('  3. Upload transcripts  - Import VAPI call transcripts');
    log('  4. SEED ALL            - Full reset: clear + specs + transcripts', colors.green);
    log('');
    log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━', colors.cyan);
    log('  🚀 DEVELOPMENT', colors.bright);
    log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━', colors.cyan);
    log('');
    log('  5. Start server        - npm run dev');
    log('  6. Prisma Studio       - Database browser');
    log('  7. Build               - Production build');
    log('');
    log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━', colors.cyan);
    log('  🧪 TESTING', colors.bright);
    log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━', colors.cyan);
    log('');
    log('  8. Run all tests       - Unit + Integration + E2E');
    log('  9. Run unit tests      - Vitest unit tests');
    log('');
    log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━', colors.cyan);
    log('  🎭 E2E TESTING (Playwright)', colors.bright);
    log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━', colors.cyan);
    log('');
    log('  a. E2E tests           - Run all E2E tests');
    log('  b. E2E UI mode         - Interactive Playwright UI');
    log('  c. E2E debug           - Debug mode with inspector');
    log('  d. E2E list            - List all E2E tests');
    log('  e. E2E report          - View last test report');
    log('');
    log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━', colors.cyan);
    log('  🔧 TOOLS & GENERATORS', colors.bright);
    log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━', colors.cyan);
    log('');
    log('  f. Snap screenshots    - Capture demo screenshots (Playwright)');
    log('  g. Registry            - Generate + validate spec registry');
    log('  h. API docs            - Generate API documentation');
    log('  i. Doc health          - Check documentation health');
    log('  j. Bootstrap admin     - Create admin user');
    log('  k. Cleanup slugs       - Remove orphaned slugs');
    log('');
    log('  0. Exit');
    log('');

    const choice = await prompt('Select an option: ');

    switch (choice) {
      // ========================================
      // SEED WORKFLOW
      // ========================================
      case '1':
        // Clear data
        log('\n🗑️  Clearing all data...\n', colors.bright);
        exec('npx tsx prisma/reset.ts', 'Wiping database...');
        success('Database cleared!');
        await pressEnterToContinue();
        break;

      case '2':
        // Upload BDD specs (compile promptTemplate)
        log('\n📋 Loading BDD specs from docs-archive/bdd-specs/\n', colors.bright);
        log('   This will:', colors.yellow);
        log('   • Parse all .spec.json files');
        log('   • Create Parameters, ScoringAnchors, PromptSlugs');
        log('   • Compile promptTemplate for each spec');
        log('');
        exec('npx tsx prisma/seed-from-specs.ts', 'Loading and compiling specs...');
        success('BDD specs loaded and compiled!');
        await pressEnterToContinue();
        break;

      case '3':
        // Upload transcripts
        log('\n📞 Importing VAPI transcripts\n', colors.bright);
        exec('npx tsx prisma/seed-wnf-transcripts.ts', 'Importing transcripts...');
        success('Transcripts imported!');
        await pressEnterToContinue();
        break;

      case '4':
        // SEED ALL - Full workflow
        log('\n🌱 FULL SEED: Clear → Specs → Transcripts → Domains\n', colors.bright);
        log('━'.repeat(50));
        log('Step 1/2: Running seed-mabel.ts (clears, loads specs, imports transcripts)');
        exec('npx tsx prisma/seed-mabel.ts');
        log('');
        log('Step 2/2: Adding WNF domain + playbook');
        exec('npx tsx prisma/seed-wnf.ts');
        log('━'.repeat(50));
        success('Full seed complete!');
        await pressEnterToContinue();
        break;

      // ========================================
      // DEVELOPMENT
      // ========================================
      case '5':
        log('\n🚀 Starting development server...\n', colors.bright);
        exec('npm run dev');
        break;

      case '6':
        exec('npx prisma studio', 'Opening Prisma Studio...');
        break;

      case '7':
        exec('npm run build', 'Building for production...');
        await pressEnterToContinue();
        break;

      // ========================================
      // TESTING
      // ========================================
      case '8':
        log('\n🧪 Running All Tests\n', colors.bright);
        exec('npm run test', 'Running unit tests...');
        await runTestsWithServer(
          'npm run test:integration',
          'Running integration tests...'
        );
        await runTestsWithServer('npm run test:e2e', 'Running E2E tests...');
        await pressEnterToContinue();
        break;

      case '9':
        exec('npm run test', 'Running unit tests...');
        await pressEnterToContinue();
        break;

      // ========================================
      // E2E TESTING (Playwright)
      // ========================================
      case 'a':
        log('\n🎭 Running E2E Tests\n', colors.bright);
        await runTestsWithServer('npm run test:e2e', 'Running all E2E tests...');
        await pressEnterToContinue();
        break;

      case 'b':
        log('\n🎭 Opening Playwright UI\n', colors.bright);
        exec('npm run test:e2e:ui');
        break;

      case 'c':
        log('\n🎭 E2E Debug Mode\n', colors.bright);
        exec('npm run test:e2e:debug');
        break;

      case 'd':
        log('\n📋 Listing E2E Tests\n', colors.bright);
        exec('npx playwright test --list');
        await pressEnterToContinue();
        break;

      case 'e':
        log('\n📊 Opening Last Test Report\n', colors.bright);
        exec('npx playwright show-report');
        break;

      // ========================================
      // TOOLS & GENERATORS
      // ========================================
      case 'f':
        log('\n📸 Capturing Demo Screenshots\n', colors.bright);
        exec('npm run snap', 'Running Playwright screenshot capture...');
        await pressEnterToContinue();
        break;

      case 'g':
        log('\n📦 Spec Registry\n', colors.bright);
        exec('npm run registry:generate', 'Generating registry...');
        exec('npm run registry:validate', 'Validating registry...');
        await pressEnterToContinue();
        break;

      case 'h':
        log('\n📝 API Documentation\n', colors.bright);
        exec('npm run docs:api', 'Generating API docs...');
        await pressEnterToContinue();
        break;

      case 'i':
        log('\n🏥 Doc Health Check\n', colors.bright);
        exec('npm run docs:health', 'Running doc health check...');
        await pressEnterToContinue();
        break;

      case 'j':
        log('\n👤 Bootstrap Admin\n', colors.bright);
        exec('npm run bootstrap-admin', 'Creating admin user...');
        await pressEnterToContinue();
        break;

      case 'k':
        log('\n🧹 Cleanup Orphaned Slugs\n', colors.bright);
        exec('npm run cleanup:orphaned-slugs', 'Cleaning up...');
        await pressEnterToContinue();
        break;

      case '0':
        log('\nGoodbye! 👋\n', colors.green);
        process.exit(0);

      default:
        error('Invalid option');
        await pressEnterToContinue();
    }
  }
}

// ============================================================================
// SNAPSHOT COMMANDS
// ============================================================================

program
  .command('snapshot:take')
  .description('Take a database snapshot')
  .argument('<name>', 'Snapshot name (alphanumeric, hyphens, underscores)')
  .option('--with-learners', 'Include learner data (callers, calls, memories)')
  .option('--description <desc>', 'Optional description')
  .action(async (name: string, options: { withLearners?: boolean; description?: string }) => {
    log('\n📸 TAKE DATABASE SNAPSHOT\n', colors.bright);

    try {
      const { takeSnapshot, isValidSnapshotName } = await import('../lib/snapshots/index.js');

      if (!isValidSnapshotName(name)) {
        error('Invalid name. Use alphanumeric characters, hyphens, and underscores.');
        process.exit(1);
      }

      const layers = options.withLearners ? '0-3 (with learners)' : '0-2 (structure only)';
      info(`Snapshot: ${name}`);
      info(`Layers: ${layers}`);
      if (options.description) info(`Description: ${options.description}`);
      log('');

      const metadata = await takeSnapshot(
        {
          name,
          description: options.description,
          withLearners: options.withLearners,
        },
        async (progress) => {
          if (progress.phase === 'writing') {
            info('Writing snapshot file...');
          } else if (progress.table) {
            const pct = Math.round((progress.index / progress.total) * 100);
            log(`  [${pct}%] ${progress.table}`, colors.cyan);
          }
        }
      );

      log('');
      success(`Snapshot "${name}" saved!`);
      info(`Total rows: ${metadata.totalRows.toLocaleString()}`);
      info(`Tables: ${Object.keys(metadata.stats).length}`);

      // Show top tables by row count
      const sorted = Object.entries(metadata.stats)
        .filter(([, count]) => count > 0)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 10);
      if (sorted.length > 0) {
        log('\nTop tables:', colors.bright);
        for (const [table, count] of sorted) {
          log(`  ${table}: ${count.toLocaleString()}`, colors.cyan);
        }
      }
      log('');
    } catch (err: any) {
      error(err.message || 'Failed to take snapshot');
      process.exit(1);
    }
  });

program
  .command('snapshot:list')
  .description('List all saved snapshots')
  .action(async () => {
    log('\n📋 DATABASE SNAPSHOTS\n', colors.bright);

    try {
      const { listSnapshots } = await import('../lib/snapshots/index.js');
      const snapshots = await listSnapshots();

      if (snapshots.length === 0) {
        info('No snapshots found.');
        info('Take one with: npm run ctl snapshot:take <name>');
        log('');
        return;
      }

      for (const snap of snapshots) {
        const date = new Date(snap.metadata.createdAt).toLocaleString();
        const size = formatBytes(snap.fileSize);
        const layers = snap.metadata.withLearners ? 'L0-3' : 'L0-2';
        const rows = snap.metadata.totalRows.toLocaleString();

        log(`  ${snap.name}`, colors.bright);
        log(`    Created: ${date} | Size: ${size} | Layers: ${layers} | Rows: ${rows}`, colors.cyan);
        if (snap.metadata.description) {
          log(`    ${snap.metadata.description}`, colors.reset);
        }
        log('');
      }
    } catch (err: any) {
      error(err.message || 'Failed to list snapshots');
      process.exit(1);
    }
  });

program
  .command('snapshot:restore')
  .description('Restore database from a snapshot (DESTRUCTIVE)')
  .argument('<name>', 'Snapshot name to restore')
  .option('--dry-run', 'Show what would change without modifying data')
  .option('-y, --yes', 'Skip confirmation prompt')
  .action(async (name: string, options: { dryRun?: boolean; yes?: boolean }) => {
    log('\n🔄 RESTORE DATABASE SNAPSHOT\n', colors.bright);

    try {
      const { restoreSnapshot, getSnapshot } = await import('../lib/snapshots/index.js');

      const snap = await getSnapshot(name);
      if (!snap) {
        error(`Snapshot "${name}" not found.`);
        process.exit(1);
      }

      const date = new Date(snap.metadata.createdAt).toLocaleString();
      const layers = snap.metadata.withLearners ? 'L0-3 (with learners)' : 'L0-2 (structure only)';
      info(`Snapshot: ${snap.name}`);
      info(`Created: ${date}`);
      info(`Layers: ${layers}`);
      info(`Rows: ${snap.metadata.totalRows.toLocaleString()}`);
      if (snap.metadata.description) info(`Description: ${snap.metadata.description}`);

      if (options.dryRun) {
        log('\n--- DRY RUN ---\n', colors.yellow);
        const result = await restoreSnapshot({ name, dryRun: true });
        info(`Would clear ${result.tablesCleared.length} tables`);
        info(`Would insert data into ${Object.keys(result.tablesInserted).length} tables:`);
        for (const [table, count] of Object.entries(result.tablesInserted)) {
          log(`  ${table}: ${count.toLocaleString()} rows`, colors.cyan);
        }
        log('');
        return;
      }

      if (!options.yes) {
        warn('⚠️  This will REPLACE all data in the affected layers!');
        warn('This action cannot be undone.\n');
        const confirmed = await confirm(`Restore snapshot "${name}"?`);
        if (!confirmed) {
          info('Restore cancelled.');
          return;
        }
      }

      log('');
      const result = await restoreSnapshot({ name }, async (progress) => {
        if (progress.table) {
          const pct = Math.round((progress.index / progress.total) * 100);
          const phase = progress.phase === 'clearing' ? '🗑️  Clearing' : '📥 Inserting';
          log(`  ${phase} [${pct}%] ${progress.table}`, colors.cyan);
        }
      });

      log('');
      success(`Snapshot "${name}" restored!`);
      info(`Tables cleared: ${result.tablesCleared.length}`);
      const totalInserted = Object.values(result.tablesInserted).reduce((a, b) => a + b, 0);
      info(`Rows inserted: ${totalInserted.toLocaleString()}`);

      if (result.errors.length > 0) {
        warn(`Warnings: ${result.errors.join(', ')}`);
      }

      log('\n⚠️  Derived tables (CallerMemorySummary, CallerTarget, etc.) need regeneration.', colors.yellow);
      log('');
    } catch (err: any) {
      error(err.message || 'Failed to restore snapshot');
      process.exit(1);
    }
  });

program
  .command('snapshot:delete')
  .description('Delete a saved snapshot')
  .argument('<name>', 'Snapshot name to delete')
  .action(async (name: string) => {
    log('\n🗑️  DELETE SNAPSHOT\n', colors.bright);

    try {
      const { deleteSnapshot, getSnapshot } = await import('../lib/snapshots/index.js');

      const snap = await getSnapshot(name);
      if (!snap) {
        error(`Snapshot "${name}" not found.`);
        process.exit(1);
      }

      const confirmed = await confirm(`Delete snapshot "${name}"?`);
      if (!confirmed) {
        info('Delete cancelled.');
        return;
      }

      const deleted = await deleteSnapshot(name);
      if (deleted) {
        success(`Snapshot "${name}" deleted.`);
      } else {
        error('Failed to delete snapshot.');
      }
      log('');
    } catch (err: any) {
      error(err.message || 'Failed to delete snapshot');
      process.exit(1);
    }
  });

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

// ============================================================================
// UTILITY FUNCTIONS
// ============================================================================

function prompt(question: string): Promise<string> {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer);
    });
  });
}

async function confirm(question: string): Promise<boolean> {
  const answer = await prompt(`${question} (y/N): `);
  return answer.toLowerCase() === 'y' || answer.toLowerCase() === 'yes';
}

async function pressEnterToContinue() {
  await prompt('\nPress Enter to continue...');
}

/**
 * Start dev server in background
 */
function startDevServer(): ChildProcess {
  info('Starting dev server...');
  const server = spawn('npm', ['run', 'dev'], {
    detached: false,
    stdio: 'ignore',
    cwd: ADMIN_ROOT, // Always run from apps/admin directory
  });

  return server;
}

/**
 * Wait for server to be ready
 */
async function waitForServer(): Promise<boolean> {
  info('Waiting for server to be ready...');
  try {
    execSync('npx wait-on http://localhost:3000 -t 60000', {
      stdio: 'ignore',
      cwd: ADMIN_ROOT,
    });
    success('Server is ready!');
    return true;
  } catch (e) {
    error('Server failed to start within timeout');
    return false;
  }
}

/**
 * Stop dev server
 */
function stopDevServer(server: ChildProcess) {
  if (server && !server.killed) {
    info('Stopping dev server...');
    server.kill();
    // Also kill any lingering processes on port 3000
    try {
      execSync('lsof -ti:3000 | xargs kill -9 2>/dev/null || true', {
        stdio: 'ignore',
        cwd: ADMIN_ROOT,
      });
    } catch (e) {
      // Ignore errors - process might already be dead
    }
  }
}

/**
 * Run tests with automatic server management
 */
async function runTestsWithServer(
  testCommand: string,
  description: string
): Promise<boolean> {
  let server: ChildProcess | null = null;

  try {
    // Start server
    server = startDevServer();

    // Wait for server to be ready
    const serverReady = await waitForServer();
    if (!serverReady) {
      return false;
    }

    // Run tests
    info(description);
    const result = exec(testCommand);

    return result.success;
  } finally {
    // Always stop server
    if (server) {
      stopDevServer(server);
    }
  }
}

// ============================================================================
// MAIN
// ============================================================================

program
  .name('hf-control')
  .description('HumanFirst Admin Control CLI')
  .version('1.0.0');

// If no command provided, show interactive menu
if (process.argv.length === 2) {
  showInteractiveMenu();
} else {
  program.parse(process.argv);
}

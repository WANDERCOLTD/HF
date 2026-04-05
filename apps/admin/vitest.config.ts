import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import tsconfigPaths from 'vite-tsconfig-paths';

export default defineConfig({
  plugins: [react(), tsconfigPaths()],
  test: {
    globals: true,
    environment: 'jsdom',
    include: ['**/*.test.ts', '**/*.test.tsx', '**/*.spec.ts', '**/*.spec.tsx'],
    exclude: ['node_modules', '.next', 'tests/integration/**', 'e2e/**'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html'],
      include: [
        'lib/**/*.ts',
        'app/**/*.tsx',
        'app/api/**/*.ts',
      ],
      exclude: [
        'lib/prisma.ts',
        'lib/**/*.test.ts',
        'lib/**/*.spec.ts',
      ],
    },
    // Mock Prisma by default
    setupFiles: ['./tests/setup.ts'],
  },
});

import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'node',
    setupFiles: ['./vitest.setup.ts'],
    include: [
      'server/src/**/*.test.ts',
      'src/shared/**/*.test.ts',
      'src/utils/**/*.test.ts',
      'src/components/**/*.test.ts',
      'src/components/**/*.test.tsx',
      'src/features/**/*.test.ts',
      'src/features/**/*.test.tsx',
    ],
    environmentMatchGlobs: [
      ['**/*.test.tsx', 'jsdom'],
    ],
    passWithNoTests: true,
  },
});

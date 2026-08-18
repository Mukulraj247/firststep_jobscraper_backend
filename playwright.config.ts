import { defineConfig, devices } from '@playwright/test';

const previewBaseURL = 'http://127.0.0.1:4173';
const baseURL = process.env.PLAYWRIGHT_BASE_URL?.trim() || previewBaseURL;
const useExternalServer = Boolean(process.env.PLAYWRIGHT_BASE_URL?.trim());

/**
 * Smoke E2E against the production Vite bundle (`vite preview`) or PLAYWRIGHT_BASE_URL.
 * Run `npm run build` first when using the built-in preview webServer.
 */
export default defineConfig({
  testDir: 'e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: 'list',
  use: {
    ...devices['Desktop Chrome'],
    baseURL,
    trace: 'on-first-retry',
  },
  ...(useExternalServer
    ? {}
    : {
        webServer: {
          command: 'npm run preview -- --host 127.0.0.1 --port 4173 --strictPort',
          url: previewBaseURL,
          reuseExistingServer: !process.env.CI,
          timeout: 120_000,
        },
      }),
});

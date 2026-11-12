import { defineConfig, devices } from '@playwright/test';

/** Chromium's fake microphone (a beep) stands in for a voice, and permission is granted. */
const mic = {
  launchOptions: {
    args: [
      '--use-fake-ui-for-media-stream',
      '--use-fake-device-for-media-stream',
      '--autoplay-policy=no-user-gesture-required',
    ],
  },
  permissions: ['microphone'],
};

export default defineConfig({
  testDir: 'tests/e2e',
  timeout: 90_000,
  fullyParallel: true,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? 'github' : 'list',
  use: { baseURL: 'http://localhost:4173', trace: 'off' },
  webServer: {
    command: 'pnpm build && pnpm preview --port 4173 --strictPort',
    port: 4173,
    reuseExistingServer: !process.env.CI,
  },
  projects: [
    { name: 'phone', use: { ...devices['Pixel 7'], ...mic } },
    { name: 'desktop', use: { ...devices['Desktop Chrome'], ...mic } },
  ],
});

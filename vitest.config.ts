import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    globals: true,
    environment: 'node',
    clearMocks: true,
    restoreMocks: true,
    mockReset: true,
    testTimeout: 30_000,
  },
});

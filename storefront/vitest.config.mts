import { defineConfig } from 'vitest/config';

// Unit tests only — pure functions with no Saleor/Stripe/Shippo running.
// The Playwright scripts in tools/ cover the real, live-stack end-to-end
// paths; this suite exists for the logic underneath them that never needs a
// network to be right or wrong.
export default defineConfig({
  resolve: { tsconfigPaths: true },
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
});

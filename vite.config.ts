import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

// Served from https://wgmatar.github.io/guess-the-eval/, so every asset URL is prefixed.
export default defineConfig({
  base: '/guess-the-eval/',
  plugins: [react()],
  test: {
    environment: 'node',
    include: ['src/**/*.test.{ts,tsx}'],
  },
});

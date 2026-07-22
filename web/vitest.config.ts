import { defineConfig, mergeConfig } from 'vitest/config';
import viteConfig from './vite.config';

// Vitest configuration: jsdom environment for component tests, global test
// APIs (describe/it/expect) so test files stay concise, and a setup file that
// boots the MSW server and registers jest-dom matchers (architecture §6).
export default mergeConfig(
  viteConfig,
  defineConfig({
    test: {
      globals: true,
      environment: 'jsdom',
      setupFiles: ['./src/test/setup.ts'],
      css: true,
      include: ['src/**/*.test.{ts,tsx}'],
    },
  }),
);

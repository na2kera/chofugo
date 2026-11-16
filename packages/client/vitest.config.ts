import { defineConfig } from 'vitest/config';

// 関数のテストだけ。Cloudflare のプラグインは読み込まない（vite.config.ts を使わない）。
export default defineConfig({
  test: {
    include: ['src/**/*.test.ts'],
    environment: 'node',
  },
});

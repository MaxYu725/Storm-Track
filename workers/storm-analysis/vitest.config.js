import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { cloudflareTest, readD1Migrations } from '@cloudflare/vitest-pool-workers';
import { defineConfig } from 'vitest/config';

const root = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  plugins: [
    cloudflareTest(async () => ({
      wrangler: { configPath: path.join(root, 'wrangler.jsonc') },
      miniflare: {
        // Test-local bindings take precedence over Wrangler config. Keep the
        // authorization domains explicitly disabled so CI process.env secrets
        // can never leak into the isolated Miniflare integration harness.
        bindings: {
          BACKFILL_TOKEN: '',
          ANALYSIS_ADMIN_TOKEN: '',
          TEST_MIGRATIONS: await readD1Migrations(path.join(root, 'schema'))
        }
      }
    }))
  ],
  test: {
    setupFiles: [path.join(root, 'test/apply-migrations.js')],
    include: [path.join(root, 'test/**/*.test.js')]
  }
});

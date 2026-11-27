import { defineConfig } from 'vitest/config';

// The crypto suites hash and encrypt multi-megabyte buffers. On a loaded
// machine the default 5-second timeout and parallel workers can time out even
// when the code is correct, so run one file at a time with generous limits.
export default defineConfig({
  test: {
    testTimeout: 120_000,
    hookTimeout: 120_000,
    maxWorkers: 1,
    minWorkers: 1,
    fileParallelism: false,
  },
});

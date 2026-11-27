import { defineConfig } from 'vitest/config';

// The crypto suites hash and encrypt multi-megabyte buffers. On a loaded
// machine the default 5-second timeout and one-fork-per-file startup can time
// out even when the code is correct, so give them room and cap parallelism.
export default defineConfig({
  test: {
    testTimeout: 60_000,
    hookTimeout: 60_000,
    maxWorkers: 2,
  },
});

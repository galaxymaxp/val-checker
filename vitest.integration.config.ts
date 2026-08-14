import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    tsconfigPaths: true,
  },
  test: {
    environment: "node",
    fileParallelism: false,
    include: ["tests/**/*.integration.test.{ts,tsx}"],
    setupFiles: ["./vitest.setup.ts"],
    testTimeout: 15_000,
  },
});

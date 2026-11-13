import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  test: {
    include: ["tests/**/*.test.ts"],
    fileParallelism: false,
    testTimeout: 30000,
    env: {
      DATABASE_URL: process.env.TEST_DATABASE_URL ?? "postgres://postgres@127.0.0.1:54329/pac_test",
      AI_MOCK: "1",
    },
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "src"),
      "server-only": path.resolve(__dirname, "tests/server-only-stub.ts"),
    },
  },
});

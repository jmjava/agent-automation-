import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["harness/**/*.test.ts", "harnesses/**/*.test.ts", "harnesses/**/*.eval.ts"],
    environment: "node",
    globals: false,
  },
});

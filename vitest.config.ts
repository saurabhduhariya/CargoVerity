import { fileURLToPath } from "node:url";

import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
      "server-only": fileURLToPath(new URL("./node_modules/server-only/empty.js", import.meta.url)),
    },
  },
  test: {
    include: process.env.RUN_INTEGRATION_TESTS === "1"
      ? ["tests/unit/**/*.test.ts", "tests/integration/**/*.test.ts"]
      : ["tests/unit/**/*.test.ts"],
  },
});

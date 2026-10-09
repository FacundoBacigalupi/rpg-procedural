import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["src/**/*.test.ts", "test/**/*.test.ts"],
    environment: "node",
    // Las vidas completas son pesadas: pocos workers a la vez evita que los tiempos
    // límite salten por contención de CPU (y cuida la PC).
    maxWorkers: 6,
    testTimeout: 300_000,
  },
});

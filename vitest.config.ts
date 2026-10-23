import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["src/**/*.test.ts", "test/**/*.test.ts"],
    environment: "node",
    // La PC se apaga bajo carga (i9-13900K): un solo worker y un solo vitest en toda la máquina
    // (el candado de `heavy-lock.ts` hace esperar a las demás instancias, también entre worktrees).
    // En el CI de GitHub (`CI=true`) no hay ese riesgo: los archivos corren en paralelo.
    ...(process.env["CI"] ? {} : { maxWorkers: 1, fileParallelism: false }),
    globalSetup: ["./vitest.global-setup.ts"],
    testTimeout: 300_000,
  },
});

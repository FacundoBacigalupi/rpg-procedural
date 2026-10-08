// Reglas de dependencia de docs/ARCHITECTURE.md §3:
// core ← worldgen ← sim ← game ← llm / persistence ← ui / tools
const test = ".test.ts$";

/** @type {import('dependency-cruiser').IConfiguration} */
module.exports = {
  forbidden: [
    {
      name: "no-circular",
      severity: "error",
      comment: "Sin ciclos: los efectos cruzados pasan por el scheduler (ARCHITECTURE §3).",
      from: {},
      to: { circular: true },
    },
    {
      name: "core-is-leaf",
      severity: "error",
      comment: "core no depende de ninguna otra capa.",
      from: { path: "^src/core/" },
      to: { path: "^src/", pathNot: "^src/core/" },
    },
    {
      name: "worldgen-layer",
      severity: "error",
      comment: "worldgen solo lee core.",
      from: { path: "^src/worldgen/" },
      to: { path: "^src/", pathNot: ["^src/core/", "^src/worldgen/"] },
    },
    {
      name: "sim-layer",
      severity: "error",
      comment: "sim no importa game, llm, persistence, ui ni tools (regla 3 de CLAUDE.md).",
      from: { path: "^src/sim/" },
      to: { path: "^src/", pathNot: ["^src/core/", "^src/worldgen/", "^src/sim/"] },
    },
    {
      name: "game-layer",
      severity: "error",
      comment: "game usa llm y persistence solo por interfaces inyectadas.",
      from: { path: "^src/game/" },
      to: { path: "^src/(llm|persistence|ui|tools)/" },
    },
    {
      name: "llm-layer",
      severity: "error",
      from: { path: "^src/llm/" },
      to: { path: "^src/(persistence|ui|tools)/" },
    },
    {
      name: "persistence-layer",
      severity: "error",
      from: { path: "^src/persistence/" },
      to: { path: "^src/(llm|ui|tools)/" },
    },
    {
      name: "pure-no-node-builtins",
      severity: "error",
      comment: "core, worldgen y sim son puros: sin IO ni APIs de Node.",
      from: { path: "^src/(core|worldgen|sim)/", pathNot: test },
      to: { dependencyTypes: ["core"] },
    },
    {
      name: "sim-systems-via-index",
      severity: "error",
      comment: "Un sistema de sim/ lee a otro solo desde su index.ts (ARCHITECTURE §2).",
      from: { path: "^src/sim/([^/]+)/" },
      to: { path: "^src/sim/[^/]+/", pathNot: ["^src/sim/$1/", "^src/sim/[^/]+/index.ts$"] },
    },
    {
      name: "families-isolated",
      severity: "error",
      comment:
        "Nada fuera de families/ importa una familia concreta; solo el registro families/index.ts.",
      from: { pathNot: "^src/sim/families/" },
      to: { path: "^src/sim/families/[^/]+/" },
    },
    {
      name: "families-not-each-other",
      severity: "error",
      comment: "Una familia no importa a otra.",
      from: { path: "^src/sim/families/([^/]+)/" },
      to: { path: "^src/sim/families/", pathNot: "^src/sim/families/$1/" },
    },
    {
      name: "no-dev-deps-in-src",
      severity: "error",
      comment: "Las herramientas de test no entran al código del juego.",
      from: { path: "^src/", pathNot: test },
      to: { dependencyTypes: ["npm-dev"] },
    },
    {
      name: "not-to-unresolvable",
      severity: "error",
      from: {},
      to: { couldNotResolve: true },
    },
  ],
  options: {
    doNotFollow: { path: "node_modules" },
    tsConfig: { fileName: "tsconfig.json" },
    tsPreCompilationDeps: true,
    enhancedResolveOptions: {
      exportsFields: ["exports"],
      conditionNames: ["import", "require", "node", "default", "types"],
      extensions: [".ts", ".tsx", ".js", ".json"],
    },
  },
};

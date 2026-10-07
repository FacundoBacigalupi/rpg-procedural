// Capa base: ids, tipos centrales, rng, tiempo, ledger, serialización canónica (ARCHITECTURE §2).
// Pura: sin IO, sin reloj, sin Math.random ni trascendentes del motor.
export * from "./ids/index.ts";
export * from "./ledger/index.ts";
export * from "./time/index.ts";
export * from "./types/index.ts";

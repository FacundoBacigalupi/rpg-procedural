// La simulación en curso: una carpeta por sistema, cada una con su index.ts (ARCHITECTURE §2).
// Pura: sin IO, sin reloj, sin Math.random; los efectos cruzados pasan por el scheduler.
export * from "./scheduler/index.ts";
export * from "./world/index.ts";

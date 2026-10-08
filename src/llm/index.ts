// Proveedores, trabajos, parser (con la gramática sin red), narrador con su pedido, validador y
// plantillas, y verbalizador (narration.md). Nunca decide resultados: traduce texto a intenciones
// y narra lo ya resuelto, desde `PlayerView`.
export * from "./client.ts";
export * from "./config.ts";
export * from "./continuity.ts";
export * from "./grammar.ts";
export * from "./jobs.ts";
export * from "./mock.ts";
export * from "./narration.ts";
export * from "./narrator.ts";
export * from "./parser.ts";
export * from "./templates.ts";
export * from "./validate.ts";
export * from "./voice.ts";

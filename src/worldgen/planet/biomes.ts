// Biomas (planet-gen §4, etapa 4): Whittaker sobre temperatura media y lluvia, con la altura y el
// agua como condiciones aparte. La tabla vive en `content/biomes/` (contenido, no lógica): cada
// bioma dice dónde vale (tierra, mar, lago), sus rangos y una prioridad; gana el de mayor
// prioridad que contenga a la celda, y el contenido tiene que cubrir todo el espacio.

import { contentId, defineContent, z } from "../../core/index.ts";

/** Intervalo [min, max): un extremo ausente es abierto. */
const Range = z
  .strictObject({ min: z.number().optional(), max: z.number().optional() })
  .refine((r) => r.min === undefined || r.max === undefined || r.min < r.max, "min ≥ max");

export const Biome = z.strictObject({
  id: contentId,
  /** Nombre para mostrar (docs y mapas en español). */
  name: z.string().min(1),
  where: z.enum(["land", "ocean", "lake"]),
  /** °C de media anual. */
  temperature: Range.optional(),
  /** mm por año. */
  precipitation: Range.optional(),
  /** Metros sobre el nivel del mar (negativo: profundidad). */
  elevation: Range.optional(),
  priority: z.number().int(),
  color: z.string().regex(/^#[0-9a-f]{6}$/, "color #rrggbb"),
  /** Biomasa relativa [0, 1]: alimenta la esencia biótica y la comida. */
  productivity: z.number().min(0).max(1),
  /** Qué tan bien viven mortales sin técnica especial [0, 1]. */
  habitability: z.number().min(0).max(1),
});
export type Biome = z.infer<typeof Biome>;

export const BIOMES = defineContent("biomes", Biome);

export interface BiomeInput {
  readonly where: Biome["where"];
  readonly temperature: number;
  readonly precipitation: number;
  readonly elevation: number;
}

type Range = z.infer<typeof Range>;

function inRange(r: Range | undefined, v: number): boolean {
  if (!r) return true;
  return (r.min === undefined || v >= r.min) && (r.max === undefined || v < r.max);
}

/** Los biomas en orden de decisión: prioridad mayor primero; empate, id. */
export function biomeOrder(biomes: readonly Biome[]): Biome[] {
  return [...biomes].sort(
    (a, b) => b.priority - a.priority || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
  );
}

/** El bioma de una celda. `ordered` sale de `biomeOrder`. Tira si el contenido no la cubre. */
export function classifyBiome(ordered: readonly Biome[], x: BiomeInput): Biome {
  for (const b of ordered) {
    if (b.where !== x.where) continue;
    if (!inRange(b.temperature, x.temperature)) continue;
    if (!inRange(b.precipitation, x.precipitation)) continue;
    if (!inRange(b.elevation, x.elevation)) continue;
    return b;
  }
  throw new RangeError(
    `ningún bioma cubre ${x.where} T=${x.temperature} P=${x.precipitation} h=${x.elevation}`,
  );
}

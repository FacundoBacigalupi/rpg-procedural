// Relaciones multidimensionales (npc-psychology §6, Fase 2): lo que A siente por B, en diez
// dimensiones continuas, asimétrico (B puede sentir otra cosa por A). Las dimensiones pueden
// contradecir al vínculo: un padre al que se teme y no se quiere. La relación con el jugador no es
// especial. Cada cambio cita el evento que lo causó (`history`); no hay deriva aleatoria.
//
// El decaimiento es perezoso: se calcula al leer (`current`) desde el último toque, así no hace
// falta un proceso por par ni importa cuándo se lea. Hacia la línea base de cada dimensión, o el
// piso que pone un vínculo (los padres no dejan de conocerse por no verse). Todavía nadie llama a
// `applyDeltas` desde una interpretación (appraisal): es lo que sigue.

import {
  type AgentId,
  contentId,
  defineContent,
  type EventId,
  exp,
  LN2,
  type Tick,
  z,
} from "../../core/index.ts";
import { table } from "../world/index.ts";

export const DIMENSIONS = [
  "trust",
  "respect",
  "affection",
  "fear",
  "attraction",
  "gratitude",
  "jealousy",
  "resentment",
  "familiarity",
  "dependency",
] as const;
export type Dimension = (typeof DIMENSIONS)[number];

/** Las que van de -1 (desconfianza, desprecio, aversión) a 1; el resto de 0 a 1. */
export const BIPOLAR: ReadonlySet<Dimension> = new Set(["trust", "respect", "affection"]);

const Dims = z.partialRecord(z.enum(DIMENSIONS), z.number().min(-1).max(1));

export const DimensionDef = z.strictObject({
  id: z.enum(DIMENSIONS),
  name: z.string().min(1),
  /** Hacia dónde decae sin contacto ni vínculo. */
  baseline: z.number().min(-1).max(1),
  /** Días de mundo para recorrer la mitad del camino hacia la base. */
  halfLifeDays: z.number().positive(),
  /** Un esquema que la hace durar más: el que es de rencores guarda el resentimiento. */
  slowedBy: z.strictObject({ schema: contentId, factor: z.number().min(0) }).optional(),
});
export type DimensionDef = z.infer<typeof DimensionDef>;
export const RELATION_DIMS = defineContent("relation-dims", DimensionDef);

/** Cómo es un vínculo desde quien lo tiene hacia el otro (`parent` es "el otro es mi hijo"). */
export const BondDef = z.strictObject({
  id: contentId,
  name: z.string().min(1),
  /** Lo que suma a la base al nacer la relación. */
  initial: Dims,
  /** Debajo de esto la dimensión no decae mientras dure el vínculo. */
  floor: Dims,
});
export type BondDef = z.infer<typeof BondDef>;
export const RELATION_BONDS = defineContent("relation-bonds", BondDef);

export type Vector = Readonly<Record<Dimension, number>>;

export interface Relationship {
  readonly dims: Vector;
  /** Ids de `BondDef`, derivados del parentesco y de los compromisos (ordenados). */
  readonly bonds: readonly string[];
  /** Los eventos que la moldearon, del más viejo al más nuevo (los últimos `MAX_HISTORY`). */
  readonly history: readonly EventId[];
  /** Hasta cuándo está al día `dims` (el decaimiento corre desde acá). */
  readonly updated: Tick;
}

/** Lo que `from` siente por cada otro. Quien no figura es un extraño: la línea base. */
export interface Relations {
  readonly toward: Readonly<Record<string, Relationship>>;
  readonly originEventId: EventId;
}

export const RELATIONS = table<Relations>("relations.state");

export const MAX_HISTORY = 16;
const DAY = 86_400;

const clamp = (x: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, x));
const round = (x: number) => Math.round(x * 1e6) / 1e6;
const range = (d: Dimension): [number, number] => (BIPOLAR.has(d) ? [-1, 1] : [0, 1]);

export function clampDim(d: Dimension, x: number): number {
  const [lo, hi] = range(d);
  return round(clamp(x, lo, hi));
}

/** Un extraño: todas las dimensiones en su línea base. */
export function strangerDims(defs: readonly DimensionDef[]): Vector {
  const out = {} as Record<Dimension, number>;
  for (const d of DIMENSIONS) out[d] = 0;
  for (const def of defs) out[def.id] = clampDim(def.id, def.baseline);
  return out;
}

/** Hacia dónde decae `dim` con estos vínculos: la base, o el piso más alto de un vínculo. */
export function floorOf(
  dim: Dimension,
  base: number,
  bonds: readonly string[],
  bondDefs: readonly BondDef[],
): number {
  let floor = base;
  for (const id of bonds) {
    const f = bondDefs.find((b) => b.id === id)?.floor[dim];
    if (f !== undefined && f > floor) floor = f;
  }
  return floor;
}

export interface DecayContext {
  readonly dims: readonly DimensionDef[];
  readonly bonds: readonly BondDef[];
  /** Fuerza (0-1) de cada esquema de quien siente, para los que alargan una dimensión. */
  readonly schemaStrength: (schema: string) => number;
}

/** La relación al día `now`: cada dimensión recorrió su camino hacia la base. Pura. */
export function current(rel: Relationship, now: Tick, ctx: DecayContext): Relationship {
  const elapsed = now - rel.updated;
  if (elapsed <= 0) return rel;
  const dims = { ...rel.dims };
  for (const def of ctx.dims) {
    const target = floorOf(def.id, def.baseline, rel.bonds, ctx.bonds);
    const slow = def.slowedBy
      ? 1 + def.slowedBy.factor * ctx.schemaStrength(def.slowedBy.schema)
      : 1;
    const half = def.halfLifeDays * slow * DAY;
    const x = rel.dims[def.id];
    // Lo que está por debajo del piso sube hacia él; lo que está por encima, baja hacia él.
    dims[def.id] = clampDim(def.id, target + (x - target) * exp((-LN2 * elapsed) / half));
  }
  return { ...rel, dims, updated: now };
}

export type Deltas = Partial<Record<Dimension, number>>;

/** Aplica el cambio que una interpretación le puso a la relación (ya al día). Cita el evento. */
export function applyDeltas(rel: Relationship, deltas: Deltas, event: EventId): Relationship {
  const dims = { ...rel.dims };
  let moved = false;
  for (const d of DIMENSIONS) {
    const delta = deltas[d];
    if (!delta) continue;
    const next = clampDim(d, dims[d] + delta);
    if (next !== dims[d]) moved = true;
    dims[d] = next;
  }
  if (!moved) return rel;
  const history = rel.history.includes(event) ? rel.history : [...rel.history, event];
  return { ...rel, dims, history: history.slice(-MAX_HISTORY) };
}

/** La relación de `from` hacia `to` al día `now` (extraño si no figura). */
export function relationship(
  rels: Relations | undefined,
  to: AgentId,
  now: Tick,
  ctx: DecayContext,
): Relationship {
  const found = rels?.toward[to];
  if (found) return current(found, now, ctx);
  return { dims: strangerDims(ctx.dims), bonds: [], history: [], updated: now };
}

/** Problemas del contenido: dimensiones que faltan o repetidas, y esquemas que no existen. */
export function relationProblems(
  dims: readonly DimensionDef[],
  bonds: readonly BondDef[],
  schemaIds: ReadonlySet<string>,
): string[] {
  const problems: string[] = [];
  for (const d of DIMENSIONS) {
    const n = dims.filter((x) => x.id === d).length;
    if (n === 0) problems.push(`falta la dimensión ${d}`);
    if (n > 1) problems.push(`la dimensión ${d} está repetida`);
  }
  for (const d of dims) {
    const [lo, hi] = range(d.id);
    if (d.baseline < lo || d.baseline > hi) problems.push(`${d.id}: base fuera de rango`);
    if (d.slowedBy && !schemaIds.has(d.slowedBy.schema)) {
      problems.push(`${d.id}: no existe el esquema ${d.slowedBy.schema}`);
    }
  }
  for (const b of bonds) {
    for (const [dim, v] of Object.entries(b.floor)) {
      const initial = (b.initial as Record<string, number | undefined>)[dim];
      if (initial === undefined || initial < v) {
        problems.push(`vínculo ${b.id}: el piso de ${dim} supera lo inicial`);
      }
    }
  }
  return problems;
}

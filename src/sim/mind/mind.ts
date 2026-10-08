// Lo adquirido de la mente (npc-psychology §1-§2, §10, Fase 2): esquemas con fuerza y los eventos
// que los formaron, valores derivados de temperamento + esquemas, y la formación por eventos
// intensos: Δ = intensidad × plasticidad(etapa) × susceptibilidad(temperamento) × dirección.
//
// El temperamento (los seis ejes) ya vive en `INNATE` (family): acá solo se lee. Los valores no se
// guardan: se derivan cada vez de lo innato y de los esquemas, así nunca quedan viejos. Todavía no
// hay interpretación del evento (appraisal), emociones, memorias ni cultura de origen en los
// valores: quien llama dice qué tema tocó el evento y con cuánta intensidad.

import { contentId, defineContent, type EventId, z } from "../../core/index.ts";
import type { Innate } from "../family/index.ts";
import { table } from "../world/index.ts";

export const TEMPERAMENT_AXES = [
  "reactivity",
  "sociability",
  "curiosity",
  "control",
  "warmth",
  "boldness",
] as const;
export type TemperamentAxis = (typeof TEMPERAMENT_AXES)[number];

export const VALUE_IDS = [
  "power",
  "safety",
  "family",
  "knowledge",
  "freedom",
  "justice",
  "wealth",
  "status",
  "pleasure",
  "tradition",
  "immortality",
] as const;
export type ValueId = (typeof VALUE_IDS)[number];

/** Lo que un evento le hizo a quien lo vivió, en el lenguaje de los esquemas. */
export const THEMES = [
  "care",
  "neglect",
  "violence",
  "loss",
  "hardship",
  "plenty",
  "betrayal",
  "kindness",
  "success",
  "failure",
  "injustice",
  "calamity",
  "blessing",
] as const;
export type Theme = (typeof THEMES)[number];

/** Los temas que duelen: la reactividad los amplifica. */
const PAINFUL: ReadonlySet<Theme> = new Set([
  "neglect",
  "violence",
  "loss",
  "hardship",
  "betrayal",
  "failure",
  "injustice",
  "calamity",
]);

const Weights = <K extends string>(keys: readonly [K, ...K[]]) =>
  z.partialRecord(z.enum(keys), z.number().min(-1).max(1));

export const SchemaDef = z.strictObject({
  id: contentId,
  species: contentId,
  name: z.string().min(1),
  /** Una visión del mundo que daña a quien la tiene (la psicología la trata con más cuidado). */
  harmful: z.boolean().default(false),
  /** Cuánto empuja cada eje del temperamento a tenerla de base. */
  lean: Weights(TEMPERAMENT_AXES),
  /** Hacia dónde mueve la fuerza un evento de cada tema (+ la sube, - la baja). */
  effects: Weights(THEMES),
  /** Qué valores alimenta con su fuerza plena. */
  values: Weights(VALUE_IDS),
});
export type SchemaDef = z.infer<typeof SchemaDef>;
export const SCHEMAS = defineContent("schemas", SchemaDef);

export const ValueDef = z.strictObject({
  id: z.enum(VALUE_IDS),
  species: contentId,
  name: z.string().min(1),
  /** Peso antes de temperamento y esquemas. */
  base: z.number().min(0),
  temperament: Weights(TEMPERAMENT_AXES),
});
export type ValueDef = z.infer<typeof ValueDef>;
export const VALUES = defineContent("values", ValueDef);

export const StageDef = z.strictObject({
  id: contentId,
  species: contentId,
  name: z.string().min(1),
  /** Edad vivida, en años, desde la que rige (la etapa la marca la edad vivida, no el cuerpo). */
  fromAge: z.number().min(0),
  /** Multiplica el Δ de la formación (§2). */
  plasticity: z.number().min(0).max(1),
  /** Esquemas que en esta etapa se fijan con más fuerza (§10). */
  sensitive: z.array(contentId),
});
export type StageDef = z.infer<typeof StageDef>;
export const LIFE_STAGES = defineContent("life-stages", StageDef);

export interface SchemaHold {
  readonly strength: number;
  /** Los eventos que la formaron, del más viejo al más nuevo (los últimos `MAX_CAUSES`). */
  readonly causes: readonly EventId[];
}

export interface Mind {
  readonly schemas: Readonly<Record<string, SchemaHold>>;
  /** Eventos de alto impacto en un período sensible (§10). */
  readonly formative: readonly EventId[];
  /** El evento con que esta mente entró al mundo (el nacimiento o la siembra del seed). */
  readonly originEventId: EventId;
}

export const MIND = table<Mind>("mind.state");

export interface FormativeStimulus {
  readonly theme: Theme;
  /** 0-1: cuánto pesó. */
  readonly intensity: number;
}

/** Cuánto vale un Δ=1 de efecto con plasticidad y susceptibilidad 1. */
export const FORMATION_RATE = 0.25;
/** Cuánto más se fija un esquema sensible en su etapa. */
export const SENSITIVE_BOOST = 2;
/** Con esta intensidad el evento es un trauma que la edad no amortigua del todo. */
export const TRAUMA_INTENSITY = 0.9;
export const TRAUMA_FLOOR = 0.35;
/** Fuerza de base de un esquema sin empuje del temperamento. */
export const SCHEMA_BASE = 0.25;
/** Cambio mínimo que cuenta como causa y como evento formativo. */
export const CAUSE_MIN = 0.002;
export const FORMATIVE_MIN = 0.05;
export const MAX_CAUSES = 12;
export const MAX_FORMATIVE = 24;
/** Piso del peso de un valor: nadie deja de valorar algo del todo. */
export const VALUE_FLOOR = 0.02;

const clamp = (x: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, x));

/** La etapa que rige a `ageYears`: la de mayor `fromAge` que no pasa de la edad. */
export function stageAt(stages: readonly StageDef[], ageYears: number): StageDef {
  let found: StageDef | undefined;
  for (const s of stages) {
    if (s.fromAge <= ageYears && (!found || s.fromAge > found.fromAge)) found = s;
  }
  const first = found ?? [...stages].sort((a, b) => a.fromAge - b.fromAge)[0];
  if (!first) throw new RangeError("no hay etapas de vida");
  return first;
}

/** Fuerza de base de cada esquema para un temperamento (sin historia). `jitter(id)` suma variación. */
export function baselineSchemas(
  defs: readonly SchemaDef[],
  innate: Innate,
  jitter: (schema: string) => number = () => 0,
): Record<string, number> {
  const out: Record<string, number> = {};
  for (const d of defs) {
    let s = SCHEMA_BASE + jitter(d.id);
    for (const axis of TEMPERAMENT_AXES) s += (d.lean[axis] ?? 0) * (innate[axis] ?? 0);
    out[d.id] = Math.round(clamp(s, 0, 1) * 1000) / 1000;
  }
  return out;
}

/** El sesgo de valores de una cultura (rasgo `values.bias`): solo los parámetros que son valores. */
export function valueBias(
  params: Readonly<Record<string, number>>,
): Partial<Record<ValueId, number>> {
  const out: Partial<Record<ValueId, number>> = {};
  for (const id of VALUE_IDS) if (params[id] !== undefined) out[id] = params[id];
  return out;
}

/**
 * Los valores de alguien, normalizados a suma 1: temperamento + esquemas (§2), más el sesgo de la
 * cultura en que se crió (`bias`, culture §2).
 */
export function valuesOf(
  valueDefs: readonly ValueDef[],
  schemaDefs: readonly SchemaDef[],
  mind: Mind,
  innate: Innate,
  bias: Partial<Record<ValueId, number>> = {},
): Record<ValueId, number> {
  const raw = {} as Record<ValueId, number>;
  let total = 0;
  for (const v of valueDefs) {
    let w = v.base + (bias[v.id] ?? 0);
    for (const axis of TEMPERAMENT_AXES) w += (v.temperament[axis] ?? 0) * (innate[axis] ?? 0);
    for (const d of schemaDefs) w += (d.values[v.id] ?? 0) * (mind.schemas[d.id]?.strength ?? 0);
    raw[v.id] = Math.max(VALUE_FLOOR, w);
    total += raw[v.id];
  }
  for (const v of valueDefs) raw[v.id] = Math.round((raw[v.id] / total) * 1000) / 1000;
  return raw;
}

export interface FormationContext {
  readonly schemas: readonly SchemaDef[];
  readonly stage: StageDef;
  readonly innate: Innate;
  /** El evento que vivió: queda como causa de lo que cambie. */
  readonly event: EventId;
}

export interface SchemaChange {
  readonly schema: string;
  readonly delta: number;
}

/** El cambio de cada esquema por un evento vivido (§2). Puro: no escribe nada. */
export function formationDeltas(
  stimulus: FormativeStimulus,
  ctx: FormationContext,
): SchemaChange[] {
  const intensity = clamp(stimulus.intensity, 0, 1);
  const trauma = intensity >= TRAUMA_INTENSITY;
  const p = ctx.stage.plasticity;
  const plasticity = trauma ? Math.max(p, TRAUMA_FLOOR) : p;
  const susceptibility = PAINFUL.has(stimulus.theme)
    ? 1 + 0.5 * (ctx.innate["reactivity"] ?? 0)
    : 1;
  const out: SchemaChange[] = [];
  for (const d of ctx.schemas) {
    const effect = d.effects[stimulus.theme] ?? 0;
    if (effect === 0) continue;
    const boost = ctx.stage.sensitive.includes(d.id) ? SENSITIVE_BOOST : 1;
    out.push({
      schema: d.id,
      delta: intensity * plasticity * boost * susceptibility * effect * FORMATION_RATE,
    });
  }
  return out;
}

/** Tope de causas que conserva la primera (la de base) y se queda con las más recientes. */
function capCauses(causes: readonly EventId[]): EventId[] {
  if (causes.length <= MAX_CAUSES) return [...causes];
  return [causes[0] as EventId, ...causes.slice(-(MAX_CAUSES - 1))];
}

/** Aplica un evento vivido a una mente y devuelve la nueva (y qué cambió). */
export function form(
  mind: Mind,
  stimulus: FormativeStimulus,
  ctx: FormationContext,
): { readonly mind: Mind; readonly changes: readonly SchemaChange[] } {
  const changes = formationDeltas(stimulus, ctx);
  const schemas: Record<string, SchemaHold> = { ...mind.schemas };
  let formative = mind.formative;
  for (const c of changes) {
    const old = schemas[c.schema] ?? { strength: 0, causes: [] };
    const strength = Math.round(clamp(old.strength + c.delta, 0, 1) * 1e6) / 1e6;
    const counts = Math.abs(c.delta) >= CAUSE_MIN;
    schemas[c.schema] = {
      strength,
      causes: counts ? capCauses([...old.causes, ctx.event]) : old.causes,
    };
    if (
      Math.abs(c.delta) >= FORMATIVE_MIN &&
      ctx.stage.sensitive.includes(c.schema) &&
      !formative.includes(ctx.event)
    ) {
      formative = [...formative, ctx.event].slice(-MAX_FORMATIVE);
    }
  }
  return { mind: { ...mind, schemas, formative }, changes };
}

/** Problemas del contenido: referencias rotas entre etapas, esquemas y valores. */
export function mindProblems(
  stages: readonly StageDef[],
  schemas: readonly SchemaDef[],
  values: readonly ValueDef[],
): string[] {
  const problems: string[] = [];
  const known = new Set(schemas.map((s) => s.id));
  for (const s of stages) {
    for (const id of s.sensitive) {
      if (!known.has(id)) problems.push(`etapa ${s.id}: no existe el esquema ${id}`);
    }
  }
  const ids = new Set(values.map((v) => v.id as string));
  for (const v of VALUE_IDS) if (!ids.has(v)) problems.push(`falta el valor ${v}`);
  if (!stages.some((s) => s.fromAge === 0)) problems.push("ninguna etapa arranca en 0");
  return problems;
}

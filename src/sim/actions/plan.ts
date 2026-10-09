// El plan (actions §3): un árbol de verbos que el actor sigue. En la Fase 1, `do`, `seq` y
// `until` con condiciones sobre lo que el actor percibe (la luz, el tiempo, si cree que le salió).
// El plan es JSON plano: va a `player_plans`, al componente del actor y al replay. Las
// plantillas (`steal`) se expanden al armarlo: el plan guardado ya no las nombra.
//
// El cursor dice qué hoja toca: `advance` es puro y decide la próxima hoja después de la actual
// (o la primera), contando las vueltas de cada `until` y cortando en su `max`.

import type { AgentId, CauseRef, EntityRef, Tick } from "../../core/index.ts";
import { isId, parseId, z } from "../../core/index.ts";
import type { ActionCatalog, TemplateNode } from "./catalog.ts";
import { PURPOSES, type Purpose } from "./purpose.ts";

/**
 * El acto de habla que declara quien habla, con las referencias ya resueltas contra lo que cree
 * (actions §4, dialogue §2). Es la intención: el oyente entiende las palabras, no este acto.
 */
export type SpeakAct =
  | { readonly kind: "greet" }
  | { readonly kind: "farewell" }
  | { readonly kind: "ask"; readonly about: EntityRef | null }
  | { readonly kind: "request"; readonly what: string | null }
  | {
      readonly kind: "tell";
      readonly about: EntityRef;
      /** `dead`/`alive`: noticia de la persona. `theft`/`assault`: un rumor de que `about` lo hizo a `victim`. */
      readonly claim: "dead" | "alive" | "theft" | "assault";
      readonly victim?: EntityRef | null | undefined;
    }
  | {
      readonly kind: "promise";
      readonly what: string | null;
      readonly times?: number | undefined;
      readonly dueDays?: number | null | undefined;
      readonly precision?: number | undefined;
    };

export type ArgValue =
  | { readonly role: string; readonly entity: EntityRef }
  | { readonly role: string; readonly seconds: number }
  /** Las palabras, y si las dice con un acto declarado (solo el contenido de `speak`). */
  | { readonly role: string; readonly text: string; readonly act?: SpeakAct | undefined };

/** Condiciones de corte de un `until`, sobre lo que el actor percibe. */
export type Condition =
  | { readonly kind: "dark" }
  | { readonly kind: "light" }
  | { readonly kind: "elapsed"; readonly seconds: number }
  /** El último resultado que el actor cree, dentro de este `until`, es un éxito. */
  | { readonly kind: "succeeded" }
  | { readonly kind: "any"; readonly of: readonly Condition[] };

export type PlanNode =
  | {
      readonly kind: "do";
      readonly verb: string;
      readonly args: readonly ArgValue[];
      readonly manner: readonly string[];
    }
  | { readonly kind: "seq"; readonly steps: readonly PlanNode[] }
  | {
      readonly kind: "until";
      readonly body: PlanNode;
      readonly cond: Condition;
      /** Tope de vueltas: un plan nunca corre para siempre. */
      readonly max: number;
    };

export const PLAN_SOURCES = ["player", "utility", "order", "routine", "reflex"] as const;
export type PlanSource = (typeof PLAN_SOURCES)[number];

export interface ActionPlan {
  readonly actor: AgentId;
  readonly source: PlanSource;
  /** Para qué, en palabras del actor (la memoria y la narración lo citan). */
  readonly goal?: string | undefined;
  /** El porqué declarado, en la verdad del actor: los demás lo leen con `readPurpose`. */
  readonly purpose?: Purpose | undefined;
  readonly root: PlanNode;
  /** Modos para todo el plan; los de cada `do` se suman. */
  readonly manner: readonly string[];
  readonly causes: readonly CauseRef[];
}

export const MAX_UNTIL = 1000;
export const MAX_PLAN_LEAVES = 64;

const entityRef = z.custom<EntityRef>(
  (v) => typeof v === "string" && parseId(v) !== undefined,
  "referencia inválida",
);

const SpeakActSchema: z.ZodType<SpeakAct> = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("greet") }),
  z.strictObject({ kind: z.literal("farewell") }),
  z.strictObject({ kind: z.literal("ask"), about: entityRef.nullable() }),
  z.strictObject({ kind: z.literal("request"), what: z.string().max(500).nullable() }),
  z.strictObject({
    kind: z.literal("tell"),
    about: entityRef,
    claim: z.enum(["dead", "alive", "theft", "assault"]),
    victim: entityRef.nullable().optional(),
  }),
  z.strictObject({
    kind: z.literal("promise"),
    what: z.string().max(500).nullable(),
    times: z.number().positive().max(100).optional(),
    dueDays: z.number().int().positive().max(3650).nullable().optional(),
    precision: z.number().min(0).max(1).optional(),
  }),
]);

const ArgValueSchema = z.union([
  z.strictObject({ role: z.string(), entity: entityRef }),
  z.strictObject({ role: z.string(), seconds: z.number().int().positive() }),
  z.strictObject({
    role: z.string(),
    text: z.string().max(2000),
    act: SpeakActSchema.optional(),
  }),
]);

const ConditionSchema: z.ZodType<Condition> = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("dark") }),
  z.strictObject({ kind: z.literal("light") }),
  z.strictObject({ kind: z.literal("elapsed"), seconds: z.number().int().positive() }),
  z.strictObject({ kind: z.literal("succeeded") }),
  z.strictObject({
    kind: z.literal("any"),
    get of() {
      return z.array(ConditionSchema).min(1);
    },
  }),
]);

const PlanNodeSchema: z.ZodType<PlanNode> = z.discriminatedUnion("kind", [
  z.strictObject({
    kind: z.literal("do"),
    verb: z.string(),
    args: z.array(ArgValueSchema),
    manner: z.array(z.string()),
  }),
  z.strictObject({
    kind: z.literal("seq"),
    get steps() {
      return z.array(PlanNodeSchema).min(1);
    },
  }),
  z.strictObject({
    kind: z.literal("until"),
    get body() {
      return PlanNodeSchema;
    },
    cond: ConditionSchema,
    max: z.number().int().min(1).max(MAX_UNTIL),
  }),
]);

/** La forma del plan (sin mirar el catálogo): para leerlo de la base o del replay. */
export const ActionPlanSchema = z.strictObject({
  actor: z.custom<AgentId>((v) => typeof v === "string" && isId("agent", v), "actor inválido"),
  source: z.enum(PLAN_SOURCES),
  goal: z.string().max(500).optional(),
  purpose: z.strictObject({ motive: z.enum(PURPOSES), forWhom: entityRef.optional() }).optional(),
  root: PlanNodeSchema,
  manner: z.array(z.string()),
  causes: z.array(z.custom<CauseRef>((v) => typeof v === "object" && v !== null)),
});

export function parsePlan(raw: unknown): ActionPlan {
  return ActionPlanSchema.parse(raw);
}

/** Las hojas del plan en orden de aparición, con su camino. */
export function planLeaves(
  node: PlanNode,
  at: readonly number[] = [],
): { path: number[]; node: Extract<PlanNode, { kind: "do" }> }[] {
  switch (node.kind) {
    case "do":
      return [{ path: [...at], node }];
    case "seq":
      return node.steps.flatMap((s, i) => planLeaves(s, [...at, i]));
    case "until":
      return planLeaves(node.body, [...at, 0]);
  }
}

/** Lo que el catálogo dice del plan: verbos, roles, tipos, requeridos y modos. Vacío si va. */
export function validatePlan(plan: ActionPlan, catalog: ActionCatalog): string[] {
  const problems: string[] = [];
  const leaves = planLeaves(plan.root);
  if (leaves.length > MAX_PLAN_LEAVES) problems.push(`demasiados pasos: ${leaves.length}`);
  for (const { path, node } of leaves) {
    const where = `paso ${path.join(".") || "0"} (${node.verb})`;
    const def = catalog.verb(node.verb);
    if (!def) {
      problems.push(`${where}: verbo desconocido`);
      continue;
    }
    const seen = new Set<string>();
    for (const a of node.args) {
      const spec = def.args.find((s) => s.role === a.role);
      if (!spec) {
        problems.push(`${where}: rol desconocido ${a.role}`);
        continue;
      }
      if (seen.has(a.role)) problems.push(`${where}: rol repetido ${a.role}`);
      seen.add(a.role);
      const ok =
        spec.kind === "duration"
          ? "seconds" in a
          : spec.kind === "text"
            ? "text" in a
            : "entity" in a && kindMatches(spec.kind, a.entity);
      if (!ok) problems.push(`${where}: ${a.role} no es un ${spec.kind}`);
    }
    for (const spec of def.args) {
      if (spec.required && !seen.has(spec.role)) problems.push(`${where}: falta ${spec.role}`);
    }
    for (const m of [...plan.manner, ...node.manner]) {
      // Un modo del plan que el verbo no tiene se ignora en ese paso; uno del paso, no.
      if (node.manner.includes(m) && !def.manners.some((x) => x.id === m)) {
        problems.push(`${where}: modo desconocido ${m}`);
      }
    }
  }
  return problems;
}

function kindMatches(kind: string, entity: EntityRef): boolean {
  if (kind === "person") return entity.startsWith("agent:");
  if (kind === "place") return entity.startsWith("place:") || entity.startsWith("settlement:");
  return true;
}

/** Expande una plantilla con sus parámetros: un `seq` (o un `do`) de verbos del catálogo. */
export function expandTemplate(
  node: TemplateNode,
  params: Readonly<Record<string, EntityRef>>,
): PlanNode {
  if (node.kind === "seq")
    return { kind: "seq", steps: node.steps.map((s) => expandTemplate(s, params)) };
  const args: ArgValue[] = node.args.map((a) => {
    if ("seconds" in a) return { role: a.role, seconds: a.seconds };
    const entity = params[a.param];
    if (entity === undefined) throw new Error(`falta el parámetro ${a.param}`);
    return { role: a.role, entity };
  });
  return { kind: "do", verb: node.verb, args, manner: [...(node.manner ?? [])] };
}

// ---------------------------------------------------------------------------------------------
// Cursor

export interface PlanCursor {
  /** La hoja en curso; null antes de empezar. */
  readonly path: readonly number[] | null;
  /** Vueltas y comienzo de cada `until` en curso, por camino ("0.1"). */
  readonly iters: Readonly<Record<string, number>>;
  readonly starts: Readonly<Record<string, Tick>>;
}

export const FRESH_CURSOR: PlanCursor = { path: null, iters: {}, starts: {} };

/** Lo que las condiciones leen: el momento, si está oscuro y qué cree el actor que le salió. */
export interface CursorEnv {
  readonly now: Tick;
  readonly dark: boolean;
  /** El último resultado que el actor cree (success, partial, failure, unsure) o null. */
  readonly lastBelieved: string | null;
}

interface Walk {
  readonly env: CursorEnv;
  readonly iters: Record<string, number>;
  readonly starts: Record<string, Tick>;
}

function holds(c: Condition, key: string, w: Walk, fresh: boolean): boolean {
  switch (c.kind) {
    case "dark":
      return w.env.dark;
    case "light":
      return !w.env.dark;
    case "elapsed":
      return w.env.now - (w.starts[key] ?? w.env.now) >= c.seconds;
    case "succeeded":
      return !fresh && w.env.lastBelieved === "success";
    case "any":
      return c.of.some((x) => holds(x, key, w, fresh));
  }
}

/** La primera hoja de `node` (entrando de nuevo), o null si no hay nada que hacer. */
function enter(node: PlanNode, at: number[], w: Walk): number[] | null {
  switch (node.kind) {
    case "do":
      return at;
    case "seq":
      for (let i = 0; i < node.steps.length; i++) {
        const r = enter(node.steps[i] as PlanNode, [...at, i], w);
        if (r) return r;
      }
      return null;
    case "until": {
      const key = at.join(".");
      w.starts[key] = w.env.now;
      w.iters[key] = 0;
      if (holds(node.cond, key, w, true)) return null;
      w.iters[key] = 1;
      return enter(node.body, [...at, 0], w);
    }
  }
}

/** La hoja que sigue a la que está en `rest` dentro de `node`, o null si `node` terminó. */
function after(node: PlanNode, at: number[], rest: readonly number[], w: Walk): number[] | null {
  switch (node.kind) {
    case "do":
      return null;
    case "seq": {
      const i = rest[0] as number;
      const r = after(node.steps[i] as PlanNode, [...at, i], rest.slice(1), w);
      if (r) return r;
      for (let j = i + 1; j < node.steps.length; j++) {
        const next = enter(node.steps[j] as PlanNode, [...at, j], w);
        if (next) return next;
      }
      return null;
    }
    case "until": {
      const r = after(node.body, [...at, 0], rest.slice(1), w);
      if (r) return r;
      const key = at.join(".");
      const n = w.iters[key] ?? 1;
      if (n >= node.max || holds(node.cond, key, w, false)) return null;
      w.iters[key] = n + 1;
      return enter(node.body, [...at, 0], w);
    }
  }
}

/** La próxima hoja del plan y el cursor que queda; `path: null` si el plan terminó. */
export function advance(root: PlanNode, cursor: PlanCursor, env: CursorEnv): PlanCursor {
  const w: Walk = { env, iters: { ...cursor.iters }, starts: { ...cursor.starts } };
  const path = cursor.path === null ? enter(root, [], w) : after(root, [], cursor.path, w);
  // Lo de los `until` que ya no están en el camino no hace falta guardarlo.
  const at = path?.join(".");
  const live = (k: string) => at !== undefined && (k === "" || at.startsWith(`${k}.`));
  const keep = <T>(r: Record<string, T>) =>
    Object.fromEntries(Object.entries(r).filter(([k]) => live(k)));
  return { path, iters: keep(w.iters), starts: keep(w.starts) };
}

/** El nodo en un camino. */
export function nodeAt(root: PlanNode, path: readonly number[]): PlanNode {
  let node = root;
  for (const i of path) {
    if (node.kind === "seq") node = node.steps[i] as PlanNode;
    else if (node.kind === "until") node = node.body;
    else throw new RangeError(`camino inválido: ${path.join(".")}`);
  }
  return node;
}

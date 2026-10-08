// Del borrador del parser al plan (actions §9, pasos 3 y 6): las descripciones se resuelven
// contra lo que el actor conoce (§4), las plantillas se expanden, las duraciones pasan a segundos
// con el reloj del planeta y las condiciones se toman de su forma normalizada (`is`). Si queda
// algo ambiguo no hay plan: vuelve la aclaración, que el juego le pregunta al jugador en términos
// del personaje. Lo que la Fase 1 no sabe hacer (`repeat`, `if`, `onEvent`) es un problema, no se
// aproxima.

import {
  type AgentId,
  type CauseRef,
  compareIds,
  type EntityRef,
  type PlanetClock,
} from "../../core/index.ts";
import type { ActionCatalog, ArgKind } from "./catalog.ts";
import type {
  DraftAct,
  DraftArg,
  DraftCondition,
  DraftDuration,
  DraftPlanNode,
  EntityKind,
  IntentDraft,
} from "./intent.ts";
import {
  type ActionPlan,
  type ArgValue,
  type Condition,
  expandTemplate,
  type PlanNode,
  type PlanSource,
  type SpeakAct,
  validatePlan,
} from "./plan.ts";
import { clarifyOptions, type KnownEntity, type ResolvedRef, resolveRef } from "./refs.ts";

/** Vueltas de un `until` que pidió el jugador si no dijo otra cosa (simulation §12 para más). */
export const DEFAULT_UNTIL_MAX = 100;

/** Una referencia que no quedó única, con dónde está en el borrador. */
export interface RefIssue {
  readonly at: string;
  readonly role: string;
  readonly resolved: Exclude<ResolvedRef, { status: "unique" }>;
}

export type DraftResult =
  | {
      readonly kind: "plan";
      readonly plan: ActionPlan;
      /**
       * Dónde del borrador una referencia resolvió a algo que no existe (actions §4): para el
       * inspector y los tests, nunca para el jugador. El plan se intenta igual y falla al ejecutar.
       */
      readonly phantoms: readonly string[];
    }
  /** Hay que preguntar: a cuál de estos se refiere. */
  | { readonly kind: "clarify"; readonly refs: readonly RefIssue[] }
  /** El personaje no conoce algo nombrado: reformular como buscar o preguntar (§4). */
  | { readonly kind: "unknown"; readonly refs: readonly RefIssue[] }
  /** No se puede armar un plan (verbo, rol, condición o nodo que no se entiende). */
  | { readonly kind: "invalid"; readonly problems: readonly string[] };

export interface DraftContext {
  readonly actor: AgentId;
  readonly source: PlanSource;
  readonly catalog: ActionCatalog;
  readonly known: readonly KnownEntity[];
  readonly clock: PlanetClock;
  readonly causes: readonly CauseRef[];
  /** El hex donde está el actor: si la persona nombrada cree que está en otro, primero va. */
  readonly here?: number | undefined;
}

/** El tipo de entidad que cada clase de argumento acepta. */
const ENTITY_KINDS_FOR: Partial<Record<ArgKind, readonly EntityKind[]>> = {
  person: ["person"],
  place: ["place"],
  thing: ["object", "lot"],
};

export function planFromDraft(draft: IntentDraft, ctx: DraftContext): DraftResult {
  if (draft.kind !== "act" && draft.kind !== "plan") {
    return { kind: "invalid", problems: [`un ${draft.kind} no es un plan`] };
  }
  const w: Walk = { ctx, problems: [], ambiguous: [], unknown: [], phantoms: [] };
  const steps: PlanNode[] = [];
  if (draft.speech) {
    const act = draft.speech.act ? speakAct(draft.speech.act, "speech.act", w) : undefined;
    const speak = draft.speech.to
      ? convert(
          {
            kind: "do",
            verb: "speak",
            args: [
              { role: "to", ref: draft.speech.to },
              { role: "content", text: draft.speech.text },
            ],
            manner: draft.speech.manner,
          },
          "speech",
          w,
          act,
        )
      : speakToPresent(draft.speech.text, [...(draft.speech.manner ?? [])], w, act);
    if (speak) steps.push(speak);
  }
  if (draft.plan) {
    const root = convert(draft.plan, "plan", w);
    if (root) steps.push(root);
  }
  if (w.problems.length > 0) return { kind: "invalid", problems: w.problems };
  if (w.ambiguous.length > 0) return { kind: "clarify", refs: w.ambiguous };
  if (w.unknown.length > 0) return { kind: "unknown", refs: w.unknown };

  const root: PlanNode = steps.length === 1 ? (steps[0] as PlanNode) : { kind: "seq", steps };
  const plan: ActionPlan = {
    actor: ctx.actor,
    source: ctx.source,
    root,
    manner: [...(draft.manner ?? [])],
    causes: ctx.causes,
  };
  const problems = validatePlan(plan, ctx.catalog);
  return problems.length > 0
    ? { kind: "invalid", problems }
    : { kind: "plan", plan, phantoms: w.phantoms };
}

interface Walk {
  readonly ctx: DraftContext;
  readonly problems: string[];
  readonly ambiguous: RefIssue[];
  readonly unknown: RefIssue[];
  readonly phantoms: string[];
}

function convert(
  node: DraftPlanNode,
  at: string,
  w: Walk,
  act?: SpeakAct | undefined,
): PlanNode | null {
  switch (node.kind) {
    case "do": {
      const def = w.ctx.catalog.verb(node.verb);
      if (!def) {
        w.problems.push(`${at}: verbo desconocido ${node.verb}`);
        return null;
      }
      const args: ArgValue[] = [];
      for (const a of node.args) {
        const spec = def.args.find((s) => s.role === a.role);
        if (!spec) {
          w.problems.push(`${at}: ${node.verb} no tiene el rol ${a.role}`);
          continue;
        }
        const v = argValue(a, spec.kind, `${at}.${a.role}`, w);
        if (v) args.push(act && node.verb === "speak" && "text" in v ? { ...v, act } : v);
      }
      const step: PlanNode = {
        kind: "do",
        verb: node.verb,
        args,
        manner: [...(node.manner ?? [])],
      };
      const trip = node.verb === "speak" ? tripToListener(args, w) : null;
      return trip ? { kind: "seq", steps: [trip, step] } : step;
    }
    case "seq": {
      const steps = node.steps
        .map((s, i) => convert(s, `${at}.${i}`, w))
        .filter((s): s is PlanNode => s !== null);
      return steps.length > 0 ? { kind: "seq", steps } : null;
    }
    case "until": {
      const body = convert(node.body, `${at}.body`, w);
      const cond = condition(node.cond, `${at}.cond`, w);
      return body && cond ? { kind: "until", body, cond, max: DEFAULT_UNTIL_MAX } : null;
    }
    case "template": {
      const t = w.ctx.catalog.template(node.template);
      if (!t) {
        w.problems.push(`${at}: plantilla desconocida ${node.template}`);
        return null;
      }
      const params: Record<string, EntityRef> = {};
      for (const p of t.params) {
        const a = node.params[p.id];
        if (!a) {
          w.problems.push(`${at}: a ${t.id} le falta ${p.id}`);
          continue;
        }
        const v = argValue(a, p.kind, `${at}.${p.id}`, w);
        if (v && "entity" in v) params[p.id] = v.entity;
      }
      return Object.keys(params).length === t.params.length ? expandTemplate(t.root, params) : null;
    }
    case "repeat":
    case "if":
    case "onEvent":
      w.problems.push(`${at}: ${node.kind} todavía no se ejecuta (Fase 3)`);
      return null;
  }
}

/**
 * «Hablo con mi madre» es ir a donde cree que está y hablarle (actions §4): si el destinatario no
 * está en el hex del actor y hay un lugar conocido que contiene el hex donde lo cree, el plan
 * antepone el desplazamiento a ese lugar.
 */
function tripToListener(args: readonly ArgValue[], w: Walk): PlanNode | null {
  const here = w.ctx.here;
  const to = args.find((a) => a.role === "to");
  if (here === undefined || !to || !("entity" in to)) return null;
  const who = w.ctx.known.find((k) => k.kind === "person" && k.ref === to.entity);
  if (who?.at === undefined || who.at === here) return null;
  const at = who.at;
  const place = w.ctx.known.find((k) => k.kind === "place" && k.hexes?.includes(at));
  if (!place) return null;
  return { kind: "do", verb: "move", args: [{ role: "to", entity: place.ref }], manner: [] };
}

function argValue(a: DraftArg, kind: ArgKind, at: string, w: Walk): ArgValue | null {
  if ("duration" in a) {
    if (kind !== "duration") {
      w.problems.push(`${at}: una duración no es un ${kind}`);
      return null;
    }
    return { role: a.role, seconds: toSeconds(a.duration, w.ctx.clock) };
  }
  if ("text" in a) {
    if (kind !== "text") {
      w.problems.push(`${at}: un texto no es un ${kind}`);
      return null;
    }
    return { role: a.role, text: a.text };
  }
  if (kind === "text") return { role: a.role, text: a.ref.text };
  const kinds = ENTITY_KINDS_FOR[kind];
  if (!kinds) {
    w.problems.push(`${at}: una referencia no es un ${kind}`);
    return null;
  }
  // El tipo del verbo manda sobre el que adivinó el parser.
  const desc = kinds.length === 1 ? { ...a.ref, kind: kinds[0] } : a.ref;
  const known = w.ctx.known.filter((k) => kinds.includes(k.kind));
  const r = resolveRef(desc, known);
  if (r.status === "unique") return { role: a.role, entity: r.chosen };
  if (r.status === "phantom") {
    w.phantoms.push(at);
    return { role: a.role, entity: r.chosen };
  }
  (r.status === "ambiguous" ? w.ambiguous : w.unknown).push({ at, role: a.role, resolved: r });
  return null;
}

function condition(c: DraftCondition, at: string, w: Walk): Condition | null {
  const is = c.is;
  if (!is) {
    w.problems.push(`${at}: no se entiende la condición "${c.text}"`);
    return null;
  }
  if (is.kind === "elapsed")
    return { kind: "elapsed", seconds: toSeconds(is.duration, w.ctx.clock) };
  return { kind: is.kind };
}

/** Hablar sin decir a quién: a la única persona presente; si hay varias, se pregunta. */
function speakToPresent(
  text: string,
  manner: string[],
  w: Walk,
  act?: SpeakAct | undefined,
): PlanNode | null {
  const here = w.ctx.known.filter((k) => k.kind === "person" && k.present);
  const [only] = here;
  if (here.length === 1 && only) {
    return {
      kind: "do",
      verb: "speak",
      args: [
        { role: "to", entity: only.ref },
        { role: "content", text, ...(act ? { act } : {}) },
      ],
      manner,
    };
  }
  const desc = { text: "alguien", kind: "person" as const, features: [] };
  if (here.length === 0) {
    w.unknown.push({
      at: "speech.to",
      role: "to",
      resolved: { status: "unknown", desc, candidates: [] },
    });
  } else {
    const sorted = [...here].sort((a, b) => compareIds(a.ref, b.ref));
    w.ambiguous.push({
      at: "speech.to",
      role: "to",
      resolved: {
        status: "ambiguous",
        desc,
        candidates: sorted.map((k) => ({ ref: k.ref, score: 1, via: k.via })),
        clarify: clarifyOptions(sorted),
      },
    });
  }
  return null;
}

/**
 * El acto de habla declarado, con sus referencias resueltas contra lo que el actor conoce
 * (actions §4). Preguntar por alguien que no se conoce queda sin `about` (el oyente no sabe a quién
 * se pregunta); contar algo de alguien no conocido o ambiguo sí frena y pregunta.
 */
function speakAct(act: DraftAct, at: string, w: Walk): SpeakAct | undefined {
  switch (act.kind) {
    case "greet":
    case "farewell":
      return { kind: act.kind };
    case "request":
    case "promise":
      return { kind: act.kind, what: act.what ?? null };
    case "ask": {
      if (!act.about) return { kind: "ask", about: null };
      const r = resolveRef(
        { ...act.about, features: act.about.features ?? [], kind: "person" },
        personsKnown(w),
      );
      if (r.status === "unique" || r.status === "phantom") {
        if (r.status === "phantom") w.phantoms.push(`${at}.about`);
        return { kind: "ask", about: r.chosen };
      }
      if (r.status === "ambiguous") {
        w.ambiguous.push({ at: `${at}.about`, role: "about", resolved: r });
        return undefined;
      }
      return { kind: "ask", about: null };
    }
    case "tell": {
      const r = resolveRef(
        { ...act.about, features: act.about.features ?? [], kind: "person" },
        personsKnown(w),
      );
      if (r.status === "unique" || r.status === "phantom") {
        if (r.status === "phantom") w.phantoms.push(`${at}.about`);
        return { kind: "tell", about: r.chosen, claim: act.claim };
      }
      (r.status === "ambiguous" ? w.ambiguous : w.unknown).push({
        at: `${at}.about`,
        role: "about",
        resolved: r,
      });
      return undefined;
    }
  }
}

function personsKnown(w: Walk): KnownEntity[] {
  return w.ctx.known.filter((k) => k.kind === "person");
}

/** Segundos de una duración del jugador, con el día y el año del planeta. */
export function toSeconds(d: DraftDuration, clock: PlanetClock): number {
  const unit = {
    second: 1,
    minute: 60,
    hour: 3600,
    day: clock.day,
    week: 7 * clock.day,
    month: clock.year / 12,
    year: clock.year,
  }[d.unit];
  return Math.max(1, Math.round(d.amount * unit));
}

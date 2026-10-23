// Del borrador del parser al plan (actions §9, pasos 3 y 6): las descripciones se resuelven
// contra lo que el actor conoce (§4), las plantillas se expanden, las duraciones pasan a segundos
// con el reloj del planeta y las condiciones se toman de su forma normalizada (`is`). Si queda
// algo ambiguo no hay plan: vuelve la aclaración, que el juego le pregunta al jugador en términos
// del personaje. Lo que todavía no sabe hacer (`onEvent`, la separación entre vueltas de un `repeat`) es un
// problema, no se aproxima.

import {
  type AgentId,
  type CauseRef,
  compareIds,
  type EntityRef,
  type PlanetClock,
  type SpaceKey,
} from "../../core/index.ts";
import type { ActionCatalog, ArgKind } from "./catalog.ts";
import type {
  DraftAct,
  DraftArg,
  DraftCondition,
  DraftDuration,
  DraftPlanNode,
  DraftPurpose,
  EntityKind,
  IntentDraft,
  RefDescription,
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
import type { Purpose } from "./purpose.ts";
import {
  clarifyOptions,
  type KnownEntity,
  type ResolvedRef,
  refTokens,
  resolveRef,
} from "./refs.ts";

/** Vueltas de un `until` que pidió el jugador si no dijo otra cosa (simulation §12 para más). */
export const DEFAULT_UNTIL_MAX = 100;

/** Un conjunto al que se refirió el jugador en plural («los niños»): dónde, con qué palabras y quiénes. */
export interface GroupNote {
  readonly at: string;
  readonly text: string;
  readonly members: readonly EntityRef[];
}

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
      /** Dónde del borrador una descripción en plural resolvió a un conjunto (§4): quiénes son. */
      readonly groups?: readonly GroupNote[];
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
  /** Los espacios del sitio que conoce y puede nombrar (la plaza, su casa, la del vecino). */
  readonly spaces?: readonly KnownSpace[] | undefined;
}

/**
 * Un espacio adentro de un sitio que el actor conoce (perception §3): «salgo afuera», «vuelvo a
 * casa», «voy a la casa de mi tío». El paso es `move` al lugar que lo contiene con el espacio como
 * texto (`space`), así el plan guardado lo repite igual.
 */
export interface KnownSpace {
  readonly key: SpaceKey;
  /** El lugar con nombre que lo contiene (la aldea): el `to` del paso. */
  readonly place: EntityRef;
  /** Cómo lo dice el actor desde donde está («afuera», «la plaza», «mi casa»). */
  readonly names: readonly string[];
  /** Los que el actor sabe que viven ahí: «la casa de mi madre». */
  readonly owners: readonly EntityRef[];
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
  const w: Walk = { ctx, problems: [], ambiguous: [], unknown: [], phantoms: [], groups: [] };
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
  const purpose = draft.purpose ? purposeOf(draft.purpose, w) : undefined;
  if (w.problems.length > 0) return { kind: "invalid", problems: w.problems };
  if (w.ambiguous.length > 0) return { kind: "clarify", refs: w.ambiguous };
  if (w.unknown.length > 0) return { kind: "unknown", refs: w.unknown };

  const root: PlanNode = steps.length === 1 ? (steps[0] as PlanNode) : { kind: "seq", steps };
  const plan: ActionPlan = {
    actor: ctx.actor,
    source: ctx.source,
    ...(purpose ? { purpose } : {}),
    root,
    manner: [...(draft.manner ?? [])],
    causes: ctx.causes,
  };
  const problems = validatePlan(plan, ctx.catalog);
  return problems.length > 0
    ? { kind: "invalid", problems }
    : {
        kind: "plan",
        plan,
        phantoms: w.phantoms,
        ...(w.groups.length > 0 ? { groups: w.groups } : {}),
      };
}

/**
 * El porqué declarado, con «para quién» resuelto contra lo que el actor conoce (actions §4). Si el
 * beneficiario es ambiguo se pregunta; si no se lo conoce el motivo queda sin él (decir «para
 * alguien que no conozco» no cambia por qué lo hace), y nunca frena el plan.
 */
function purposeOf(p: DraftPurpose, w: Walk): Purpose {
  if (!p.forWhom) return { motive: p.motive };
  const desc = p.forWhom;
  const known = w.ctx.known.filter((k) => !desc.kind || k.kind === desc.kind);
  const r = resolveRef(desc, known);
  if (r.status === "unique") return { motive: p.motive, forWhom: r.chosen };
  if (r.status === "phantom") {
    w.phantoms.push("purpose.forWhom");
    return { motive: p.motive, forWhom: r.chosen };
  }
  if (r.status === "ambiguous") {
    w.ambiguous.push({ at: "purpose.forWhom", role: "forWhom", resolved: r });
  }
  return { motive: p.motive };
}

interface Walk {
  readonly ctx: DraftContext;
  readonly problems: string[];
  readonly ambiguous: RefIssue[];
  readonly unknown: RefIssue[];
  readonly phantoms: string[];
  readonly groups: GroupNote[];
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
      if (node.verb === "move") {
        const to = node.args.find((a) => a.role === "to" && "ref" in a);
        const step = to && "ref" in to ? siteStep(to.ref, w, node.manner ?? []) : undefined;
        if (step !== undefined) return step;
        const near =
          to && "ref" in to && node.args.length === 1
            ? approachPeople(to.ref, `${at}.to`, w, node.manner ?? [])
            : undefined;
        if (near !== undefined) return near;
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
    case "repeat": {
      if (node.every !== undefined) {
        w.problems.push(`${at}: repeat con separación entre vueltas todavía no se ejecuta`);
        return null;
      }
      if (node.times === undefined) {
        w.problems.push(`${at}: repeat sin cuántas veces`);
        return null;
      }
      const body = convert(node.body, `${at}.body`, w);
      return body ? { kind: "repeat", body, times: node.times } : null;
    }
    case "if": {
      const cond = condition(node.cond, `${at}.cond`, w);
      const then = convert(node.then, `${at}.then`, w);
      const other = node.else ? convert(node.else, `${at}.else`, w) : undefined;
      if (!cond || !then || other === null) return null;
      return other ? { kind: "if", cond, then, else: other } : { kind: "if", cond, then };
    }
    case "onEvent":
      w.problems.push(`${at}: onEvent todavía no se ejecuta (reacciones a mitad de plan)`);
      return null;
  }
}

/**
 * «Me acerco a los niños»: `move` pide un lugar, pero el jugador nombró gente. Si ningún lugar
 * conocido encaja y sí personas, se acerca a ellas: si las tiene delante, mira y escucha de cerca
 * (`look`: no hay sub-hex donde acercarse); si cree que están en otro hex, va al lugar que lo
 * contiene. `undefined` = no aplica (sigue el camino normal); `null` = pregunta o problema anotado.
 */
function approachPeople(
  desc: RefDescription,
  at: string,
  w: Walk,
  manner: readonly string[],
): PlanNode | null | undefined {
  const places = w.ctx.known.filter((k) => k.kind === "place");
  if (resolveRef({ ...desc, kind: "place" }, places).status !== "unknown") return undefined;
  const people = w.ctx.known.filter((k) => k.kind === "person");
  const r = resolveRef({ ...desc, kind: "person" }, people);
  if (r.status === "unknown") return undefined;
  if (r.status === "ambiguous") {
    w.ambiguous.push({ at, role: "to", resolved: r });
    return null;
  }
  const members = r.status === "group" ? r.members : [r.chosen];
  if (r.status === "group") w.groups.push({ at, text: desc.text, members });
  const who = members.map((m) => people.find((k) => k.ref === m)).filter((k) => k !== undefined);
  if (who.every((k) => k.present)) {
    return { kind: "do", verb: "look", args: [], manner: [...manner] };
  }
  const first = who.find((k) => !k.present) ?? who[0];
  const hex = first?.at;
  const place =
    hex === undefined
      ? undefined
      : w.ctx.known.find((k) => k.kind === "place" && k.hexes?.includes(hex));
  if (!place) {
    w.problems.push(`${at}: no sabés dónde encontrar a ${desc.text}`);
    return null;
  }
  return {
    kind: "do",
    verb: "move",
    args: [{ role: "to", entity: place.ref }],
    manner: [...manner],
  };
}

/** Un `move` a un espacio del sitio que el actor conoce, o `undefined` si no nombra ninguno. */
function siteStep(desc: RefDescription, w: Walk, manner: readonly string[]): PlanNode | undefined {
  const spaces = w.ctx.spaces;
  if (spaces === undefined || spaces.length === 0) return undefined;
  const owner = /\bcasa\s+(?:de|del)\s+(.+)$/iu.exec(desc.text);
  let hit: KnownSpace | undefined;
  if (owner) {
    const who = (owner[1] as string).replace(/^(?:la|el)\s+/i, "");
    const rel = /^(?:mi|mis)\s+(\p{L}+)$/iu.exec(who);
    const person: RefDescription = {
      text: who,
      kind: "person",
      features: [],
      ...(rel ? { relation: { to: "self" as const, rel: rel[1] as string } } : {}),
    };
    const r = resolveRef(
      person,
      w.ctx.known.filter((k) => k.kind === "person"),
    );
    if (r.status === "unique") hit = spaces.find((s) => s.owners.includes(r.chosen));
  } else {
    // «La plaza de la aldea» es la plaza: alcanza con que cada palabra dicha sea de un nombre del
    // mismo espacio y que alguno de sus nombres esté entero en lo dicho.
    const said = refTokens(desc.text);
    if (said.length > 0) {
      hit = spaces.find((s) => {
        const names = s.names.map(refTokens);
        const all = new Set(names.flat());
        return (
          said.every((t) => all.has(t)) &&
          names.some((n) => n.length > 0 && n.every((t) => said.includes(t)))
        );
      });
    }
  }
  if (hit === undefined) return undefined;
  return {
    kind: "do",
    verb: "move",
    args: [
      { role: "to", entity: hit.place },
      { role: "space", text: hit.key },
    ],
    manner: [...manner],
  };
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
  if (r.status === "group") {
    // Un verbo que toma una sola cosa va hacia el primero del conjunto; el conjunto queda anotado.
    w.groups.push({ at, text: a.ref.text, members: r.members });
    return { role: a.role, entity: r.chosen };
  }
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
  // Por ref: el familiar y la figura sin reconocer pueden ser la misma persona.
  const here = w.ctx.known
    .filter((k) => k.kind === "person" && k.present)
    .filter((k, i, all) => all.findIndex((o) => o.ref === k.ref) === i);
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
      return { kind: act.kind, what: act.what ?? null };
    case "promise":
      return {
        kind: "promise",
        what: act.what ?? null,
        ...(act.times !== undefined ? { times: act.times } : {}),
        ...(act.dueDays !== undefined ? { dueDays: act.dueDays } : {}),
        ...(act.precision !== undefined ? { precision: act.precision } : {}),
      };
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
        if (act.claim === "dead" || act.claim === "alive" || !act.victim) {
          return { kind: "tell", about: r.chosen, claim: act.claim };
        }
        // Un rumor de un hecho: a quién se lo hicieron, si es alguien que conoce (si no, queda sin decir).
        const v = resolveRef(
          { ...act.victim, features: act.victim.features ?? [], kind: "person" },
          personsKnown(w),
        );
        const victim = v.status === "unique" || v.status === "phantom" ? v.chosen : null;
        return { kind: "tell", about: r.chosen, claim: act.claim, victim };
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

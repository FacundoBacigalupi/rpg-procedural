// Testigos en el juego (law §5): cuando alguien le pregunta a otro por un hecho (`law.inquiry`:
// un vecino, el alguacil, el personaje), el testigo arma lo que recuerda y lo que siente por los
// involucrados, y `testify` decide qué cuenta. Lo dicho entra en `KNOWN_DEEDS` de quien preguntó
// como `told` (no pisa lo que vio) y queda como evento `law.testimony`; la mentira y la deformación
// van en un campo que solo lee el inspector. El testigo solo usa lo que sabe: su `Deed` guardado,
// sus relaciones y su temperamento, nunca el evento de la verdad.

import type { AgentId, Event, EventId, PlaceRef, Rng, Tick } from "../../core/index.ts";
import {
  type BondDef,
  clampTemper,
  type Deed,
  type DeedRecallContext,
  type DimensionDef,
  ENTITY,
  type EventDraft,
  INNATE,
  KNOWN_DEEDS,
  learnDeed,
  MIND,
  PERSON,
  type ProcessDef,
  RELATIONS,
  type ReadonlyWorldTruth,
  type Relationship,
  relationship,
  type StateChange,
  setComponent,
  standardize,
  type Testimony,
  type Trait,
  testify,
  testimonyAsDeed,
  type WitnessMotives,
} from "../../sim/index.ts";

export const TESTIFY_PROCESS = "life.testify";
export const INQUIRY_EVENT = "law.inquiry";
export const TESTIMONY_EVENT = "law.testimony";

export interface TestifyOptions {
  readonly dims: readonly DimensionDef[];
  readonly bonds: readonly BondDef[];
  readonly traits: readonly Trait[];
  readonly placeOf: (truth: ReadonlyWorldTruth, who: AgentId) => PlaceRef;
}

/** Datos de un `law.inquiry`: el hecho por el que se pregunta y lo que se ofrece por otra versión. */
export interface InquiryData {
  /** El evento del hecho (la clave con que el testigo lo guardó). */
  readonly deed: EventId;
  /** 0-1: lo que se ofrece por callar o por decir otra cosa, ya en términos de utilidad del testigo. */
  readonly bribe?: number;
}

/** Cuánto vio según cómo lo supo (la claridad al formar el recuerdo no se guarda). */
export const CLARITY_BY_VIA = { saw: 0.85, heard: 0.5, told: 0.4 } as const;
/** Resentimiento mínimo hacia alguien para que le cuelgue un hecho de autor desconocido. */
export const SUSPICION_AT = 0.3;

const clamp01 = (x: number): number => Math.min(1, Math.max(0, x));

/** Lo que `witness` siente por `to` hoy (extraño si no figura). */
function feeling(
  truth: ReadonlyWorldTruth,
  o: TestifyOptions,
  witness: AgentId,
  to: AgentId,
  now: Tick,
): Relationship {
  return relationship(truth.get(RELATIONS, witness), to, now, {
    dims: o.dims,
    bonds: o.bonds,
    schemaStrength: (s) => truth.get(MIND, witness)?.schemas[s]?.strength ?? 0,
  });
}

/**
 * A quién le cuelga el hecho el testigo: de entre la gente que conoce (sin el que hizo el hecho,
 * la víctima, él ni quien pregunta), el que más rencor le despierta si pasa de `SUSPICION_AT`.
 * Empata por id para que sea determinista.
 */
export function suspectOf(
  truth: ReadonlyWorldTruth,
  o: TestifyOptions,
  witness: AgentId,
  exclude: readonly (AgentId | null)[],
  now: Tick,
): { who: AgentId; resentment: number } | null {
  const known = Object.keys(truth.get(RELATIONS, witness)?.toward ?? {}).sort() as AgentId[];
  let best: { who: AgentId; resentment: number } | null = null;
  for (const who of known) {
    if (who === witness || exclude.includes(who)) continue;
    if (truth.get(ENTITY, who)?.endedAt !== undefined) continue;
    const resentment = feeling(truth, o, witness, who, now).dims.resentment;
    if (resentment >= SUSPICION_AT && (!best || resentment > best.resentment)) {
      best = { who, resentment };
    }
  }
  return best;
}

/** El contexto de recuerdo y los motivos de `witness` ante `deed`, desde relaciones y temperamento. */
export function witnessProfile(
  truth: ReadonlyWorldTruth,
  o: TestifyOptions,
  witness: AgentId,
  asker: AgentId,
  deed: Deed,
  bribe: number,
  now: Tick,
): { recall: DeedRecallContext; motives: WitnessMotives; other: AgentId | null } {
  const doer = deed.by;
  const toDoer = doer ? feeling(truth, o, witness, doer, now).dims : null;
  const toVictim = feeling(truth, o, witness, deed.victim, now).dims;
  const suspect = suspectOf(truth, o, witness, [doer, deed.victim, asker], now);
  const innate = truth.get(INNATE, witness);
  const z = innate
    ? standardize(innate, o.traits, truth.get(PERSON, witness)?.sex ?? "female")
    : {};
  const sameHome =
    doer !== null && truth.get(PERSON, doer)?.household === truth.get(PERSON, witness)?.household;
  return {
    recall: {
      now,
      clarity: CLARITY_BY_VIA[deed.via],
      affinityToDoer: toDoer ? toDoer.affection : 0,
      affinityToVictim: toVictim.affection,
      suspect: suspect?.who ?? null,
      bias: clamp01(
        0.2 + 0.6 * (suspect?.resentment ?? 0) + 0.15 * clampTemper(z["reactivity"] ?? 0),
      ),
    },
    motives: {
      fear: toDoer ? toDoer.fear : 0,
      loyaltyToDoer: toDoer
        ? clamp01(
            0.6 * Math.max(0, toDoer.affection) + 0.4 * toDoer.gratitude + (sameHome ? 0.2 : 0),
          )
        : 0,
      bribe: clamp01(bribe),
      hatredOfOther: suspect?.resentment ?? 0,
      honesty: clamp01(0.5 + 0.35 * clampTemper(z["willpower"] ?? 0)),
      skill: clamp01(0.5 + 0.5 * clampTemper(z["control"] ?? 0)),
    },
    other: suspect?.who ?? null,
  };
}

/**
 * Lo que `witness` le declara a `asker` sobre el hecho `inq.deed`. Si no lo conoce, no hay
 * declaración (no inventa de la nada). Devuelve el cambio en lo que sabe quien preguntó y el
 * evento; quien niega o calla no deja nada que aprender, pero sí el evento.
 */
export function giveTestimony(
  truth: ReadonlyWorldTruth,
  o: TestifyOptions,
  witness: AgentId,
  asker: AgentId,
  inq: InquiryData,
  cause: EventId,
  now: Tick,
  rng: Rng,
): { changes: StateChange[]; events: EventDraft[]; testimony: Testimony } | null {
  const deed = truth.get(KNOWN_DEEDS, witness)?.deeds.find((d) => d.event === inq.deed);
  if (!deed) return null;
  const p = witnessProfile(truth, o, witness, asker, deed, inq.bribe ?? 0, now);
  const t = testify(
    deed,
    p.recall,
    p.motives,
    p.other,
    rng.fork("testify", witness, asker, inq.deed),
  );
  const told = testimonyAsDeed(t, "told");
  const changes: StateChange[] = [];
  if (told && truth.get(ENTITY, asker)?.endedAt === undefined) {
    const before = truth.get(KNOWN_DEEDS, asker);
    const after = learnDeed(before, told);
    if (after !== before) changes.push(setComponent(KNOWN_DEEDS, asker, after));
  }
  const events: EventDraft[] = [
    {
      kind: TESTIMONY_EVENT,
      actors: [witness, asker],
      place: o.placeOf(truth, witness),
      data: {
        deed: inq.deed,
        said: told !== null,
        kind: t.kind,
        accused: t.accused,
        certainty: t.certainty,
        // Solo para el inspector y los tests: nadie del mundo lo ve.
        truthOf: { lie: t.lie, distortion: t.distortion },
      },
      emissions: {},
      causes: [{ kind: "event", event: cause }],
    },
  ];
  return { changes, events, testimony: t };
}

function inquiryOf(e: Event): { witness: AgentId; asker: AgentId; data: InquiryData } | null {
  if (e.kind !== INQUIRY_EVENT) return null;
  const [asker, witness] = e.actors as AgentId[];
  const data = e.data as Partial<InquiryData> | null;
  if (!asker || !witness || !data?.deed) return null;
  return {
    asker,
    witness,
    data: { deed: data.deed, ...(data.bribe ? { bribe: data.bribe } : {}) },
  };
}

export function testifyProcess(o: TestifyOptions): ProcessDef {
  return {
    id: TESTIFY_PROCESS,
    system: "life",
    scope: "world",
    cadence: { local: "onEvent", scene: "onEvent" },
    representation: "individual",
    phase: "perceive",
    reads: [KNOWN_DEEDS.name, RELATIONS.name, MIND.name, INNATE.name, PERSON.name, ENTITY.name],
    writes: [KNOWN_DEEDS.name],
    run(ctx) {
      const changes: StateChange[] = [];
      const events: EventDraft[] = [];
      // Varias preguntas en el mismo paso se suman sobre lo que ya aprendió quien preguntó.
      const learned = new Map<AgentId, ReturnType<typeof learnDeed>>();
      for (const e of ctx.recent) {
        const inq = inquiryOf(e);
        if (!inq) continue;
        if (ctx.truth.get(ENTITY, inq.witness)?.endedAt !== undefined) continue;
        const out = giveTestimony(
          ctx.truth,
          o,
          inq.witness,
          inq.asker,
          inq.data,
          e.id,
          ctx.now,
          ctx.rng,
        );
        if (!out) continue;
        events.push(...out.events);
        const told = testimonyAsDeed(out.testimony, "told");
        if (!told || ctx.truth.get(ENTITY, inq.asker)?.endedAt !== undefined) continue;
        const before = learned.get(inq.asker) ?? ctx.truth.get(KNOWN_DEEDS, inq.asker);
        learned.set(inq.asker, learnDeed(before, told));
      }
      for (const [id, value] of learned) changes.push(setComponent(KNOWN_DEEDS, id, value));
      return changes.length === 0 && events.length === 0 ? {} : { changes, events };
    },
  };
}

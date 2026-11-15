// La rivalidad entre las dos sectas de la región (novel4-rival-sect-relation, organizations §10):
// dos sectas al alcance compiten por el mismo qi, los mismos discípulos y la misma aldea. Cuando la
// más nueva se funda, la rivalidad nace con ella (`org.rivalry`, causada por las dos fundaciones) y
// cada una guarda su `OrgTie` hacia la otra: la fuerza que le cree, contada de lo que se ve de sus
// ancianos y discípulos con un error propio (`seededBelief`: se puede pasar o quedar corta), y un
// sentimiento de rival (respeto y desconfianza, el miedo según cuánto más fuerte la cree).
//
// Puro: sin IO. El rng sale del seed con su propia rama, así que no corre los de la siembra.

import {
  type AgentId,
  type EntityRef,
  type EventId,
  type EventLog,
  exp,
  type IdAllocator,
  type PlaceRef,
  Rng,
  type Seed,
  type Tick,
} from "../../core/index.ts";
import {
  ORG_RELATION,
  type OrgRelations,
  type OrgSentiment,
  type OrgStrength,
  type OrgTie,
} from "../org/index.ts";
import { table, type WorldTruth } from "../world/index.ts";
import { SECT, type Sect } from "./sect.ts";

export const ORG_RIVALRY_EVENT = "org.rivalry";

/** Cuánto puede errar una secta al contar a la otra (fracción, sin calibrar). */
export const BELIEF_ERROR = 0.4;

const round3 = (x: number) => Math.round(x * 1000) / 1000;
const clamp01 = (x: number) => round3(Math.min(1, Math.max(0, x)));

/** La fuerza de verdad de una secta, de sus ranuras. */
export function sectStrength(s: Sect): OrgStrength {
  return {
    elders: s.slots.filter((x) => x.rank === "elder" || x.rank === "master").length,
    disciples: s.slots.filter((x) => x.rank === "disciple").length,
    topStage: s.slots.reduce((m, x) => Math.max(m, x.stage), 0),
  };
}

/** Un número de fuerza para comparar (ancianos pesan más; el umbral más alto, más todavía). */
export function strengthScore(s: OrgStrength): number {
  return s.disciples + 3 * s.elders + 4 * s.topStage;
}

/** Lo que una secta cree de la fuerza de otra: la verdad con un error que sale del rng. */
export function seededBelief(truth: OrgStrength, rng: Rng): OrgStrength {
  const off = (n: number) =>
    Math.max(0, Math.round(n * (1 + BELIEF_ERROR * (2 * rng.float() - 1))));
  return {
    elders: Math.max(1, off(truth.elders)),
    disciples: off(truth.disciples),
    topStage: Math.max(0, truth.topStage + rng.int(-1, 1)),
  };
}

/** El sentimiento de rival de quien cree `mine` contra quien cree `theirs`. */
export function rivalSentiment(mine: OrgStrength, theirs: OrgStrength, rng: Rng): OrgSentiment {
  const ratio = strengthScore(theirs) / Math.max(1, strengthScore(mine) + strengthScore(theirs));
  return {
    trust: clamp01(0.05 + 0.15 * rng.float()),
    respect: clamp01(0.3 + 0.3 * rng.float()),
    fear: clamp01(ratio - 0.3 + 0.1 * rng.float()),
    resentment: clamp01(0.1 + 0.3 * rng.float()),
  };
}

export interface SeedRivalryOptions {
  readonly seed: Seed;
  readonly a: EntityRef;
  readonly b: EntityRef;
  readonly place: PlaceRef;
}

/**
 * Siembra la rivalidad entre las sectas `a` y `b`: el evento que la abre (cuando se funda la más
 * nueva, causado por las dos fundaciones) y la relación de cada una hacia la otra.
 */
export function seedRivalry(
  truth: WorldTruth,
  ids: IdAllocator,
  log: EventLog,
  o: SeedRivalryOptions,
): EventId | undefined {
  const sa = truth.get(SECT, o.a);
  const sb = truth.get(SECT, o.b);
  if (!sa || !sb) return undefined;
  const rng = Rng.root(o.seed).fork("cultivation", "sect", "rivalry");
  const event = ids.next("event") as EventId;
  const tick: Tick = Math.max(sa.founded, sb.founded);
  log.append({
    id: event,
    tick,
    kind: ORG_RIVALRY_EVENT,
    actors: [],
    place: o.place,
    data: { a: o.a, b: o.b, stance: "rival" },
    emissions: {},
    causes: [
      { kind: "event", event: sa.originEventId },
      { kind: "event", event: sb.originEventId },
    ],
    resolution: "world",
  });
  const tie = (from: Sect, to: Sect, key: string): OrgTie => {
    const r = rng.fork(key);
    const believed = seededBelief(sectStrength(to), r.fork("believed"));
    return {
      formal: ["rival"],
      sentiment: rivalSentiment(sectStrength(from), believed, r.fork("sentiment")),
      believedStrength: believed,
      grievances: [],
      originEventId: event,
      history: [event],
    };
  };
  const add = (from: EntityRef, to: EntityRef, t: OrgTie): void => {
    const had: OrgRelations = truth.get(ORG_RELATION, from) ?? { toward: {} };
    truth.set(ORG_RELATION, from, { toward: { ...had.toward, [to]: t } });
  };
  add(o.a, o.b, tie(sa, sb, "a"));
  add(o.b, o.a, tie(sb, sa, "b"));
  return event;
}

/** Cuánto mueve un duelo entre sectas lo que la del vencido siente por la del vencedor (sin calibrar). */
export const SECT_DUEL_LOSER_RESPECT = 0.05;
export const SECT_DUEL_LOSER_RESENTMENT = 0.06;
/** Y cuánto baja el respeto de la del vencedor por la del vencido. */
export const SECT_DUEL_WINNER_RESPECT = 0.03;

/**
 * Lo que un duelo entre discípulos de dos sectas le hace a la relación de una hacia la otra
 * (novel4-sect-meet-face, organizations §14): la del vencido respeta más y guarda más rencor a la
 * del vencedor; la del vencedor la respeta un poco menos. La cara de un discípulo es la de su secta.
 * El duelo queda en la historia de la relación.
 */
export function afterSectDuel(tie: OrgTie, side: "won" | "lost", event: EventId): OrgTie {
  const s = tie.sentiment;
  const sentiment: OrgSentiment =
    side === "lost"
      ? {
          ...s,
          respect: clamp01(s.respect + SECT_DUEL_LOSER_RESPECT),
          resentment: clamp01(s.resentment + SECT_DUEL_LOSER_RESENTMENT),
        }
      : { ...s, respect: clamp01(s.respect - SECT_DUEL_WINNER_RESPECT) };
  return { ...tie, sentiment, history: [...tie.history, event] };
}

export const ORG_GRIEVANCE_EVENT = "org.grievance";

/** Lo que pesa cada ofensa en el rencor de la secta ofendida (sin calibrar). */
export const GRIEVANCE_RESENTMENT = {
  theft: 0.05,
  assault: 0.08,
  /** Una agresión que dejó muerto al de la secta. */
  killing: 0.25,
} as const;

export type GrievanceKind = keyof typeof GRIEVANCE_RESENTMENT;

/**
 * La ofensa que la secta guarda contra otra (novel4-grievance-record, organizations §10): el hecho
 * queda en `grievances` y en la historia, y el rencor sube según su peso. La misma ofensa no se
 * cuenta dos veces.
 */
export function addGrievance(tie: OrgTie, event: EventId, kind: GrievanceKind): OrgTie {
  if (tie.grievances.includes(event)) return tie;
  return {
    ...tie,
    sentiment: {
      ...tie.sentiment,
      resentment: clamp01(tie.sentiment.resentment + GRIEVANCE_RESENTMENT[kind]),
    },
    grievances: [...tie.grievances, event],
    history: [...tie.history, event],
  };
}

export const ORG_GRIEVANCE_MATTER_EVENT = "org.grievance_matter";

/** Lo que la secta hace con una ofensa: exigir reparación, devolverla u olvidarla. */
export type GrievanceResponse = "demand" | "retaliate" | "forget";

/** Una ofensa que la secta guarda, con lo que decidió (si ya lo trató). */
export interface SectGrievanceEntry {
  /** El hecho (evento de la verdad) que la causó. */
  readonly deed: EventId;
  readonly against: EntityRef;
  readonly kind: GrievanceKind;
  readonly by: AgentId;
  readonly victim: AgentId;
  readonly at: Tick;
  readonly response?: { readonly choice: GrievanceResponse; readonly at: Tick };
}

export interface SectGrievances {
  readonly entries: readonly SectGrievanceEntry[];
}

/** Las ofensas de cada secta como asuntos, en su entidad `org:N`. */
export const SECT_GRIEVANCES = table<SectGrievances>("cultivation.sect_grievances");

/** Cuánto pesa cada ofensa al tratarla (0-1, sin calibrar). */
export const GRIEVANCE_WEIGHT: Readonly<Record<GrievanceKind, number>> = {
  theft: 0.3,
  assault: 0.5,
  killing: 1,
};

/** Qué tan pareja es la elección: más bajo, más se impone la mejor opción (sin calibrar). */
export const GRIEVANCE_TEMPERATURE = 0.15;

/**
 * Lo que vale cada respuesta para quien manda en la secta (organizations §4: una secta concentra
 * el poder y decide el líder): olvidar si teme a la otra y la ofensa es chica; exigir reparación si
 * la ofensa pesa y algo le cree a su palabra; devolverla si el rencor puede más que el miedo. Lee
 * solo lo que la secta siente y cree de la otra (el miedo ya sale de la fuerza que le cree).
 */
export function grievanceUtilities(
  tie: OrgTie,
  kind: GrievanceKind,
): Readonly<Record<GrievanceResponse, number>> {
  const w = GRIEVANCE_WEIGHT[kind];
  const { fear, resentment, trust } = tie.sentiment;
  return {
    forget: round3(0.2 + 0.5 * fear - 0.5 * w - 0.3 * resentment),
    demand: round3(0.3 * w + 0.2 * resentment + 0.2 * trust),
    retaliate: round3(-0.1 + 0.5 * w + 0.6 * resentment - 0.7 * fear),
  };
}

const RESPONSES: readonly GrievanceResponse[] = ["demand", "retaliate", "forget"];

/** Elige la respuesta con softmax sobre las utilidades, con una tirada `roll` en [0, 1). */
export function chooseGrievanceResponse(
  tie: OrgTie,
  kind: GrievanceKind,
  roll: number,
  temperature = GRIEVANCE_TEMPERATURE,
): GrievanceResponse {
  const u = grievanceUtilities(tie, kind);
  const top = Math.max(...RESPONSES.map((r) => u[r]));
  const weights = RESPONSES.map((r) => exp((u[r] - top) / temperature));
  const total = weights.reduce((a, b) => a + b, 0);
  let acc = 0;
  for (let i = 0; i < RESPONSES.length; i++) {
    acc += (weights[i] ?? 0) / total;
    if (roll < acc) return RESPONSES[i] as GrievanceResponse;
  }
  return RESPONSES[RESPONSES.length - 1] as GrievanceResponse;
}

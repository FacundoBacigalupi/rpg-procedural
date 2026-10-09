// El vecino o la víctima que pregunta por lo que le hicieron (law §5): quien sabe de un hecho en
// que fue la víctima (o que alguien le contó) sale a preguntarle a la gente que cree que estaba
// cerca. «Cree» es lo que él conoce: personas con las que tiene trato (`RELATIONS`), vivas y en el
// mismo lugar que él hoy; nunca la verdad de quién presenció el hecho. Emite `law.inquiry` y
// `life.testify` resuelve lo que cada uno recuerda y cuenta. Un testigo por día y por persona.

import type { AgentId, EventId, PlaceRef, Tick } from "../../core/index.ts";
import {
  clampTemper,
  ENTITY,
  type EventDraft,
  INNATE,
  KNOWN_DEEDS,
  LOCATION,
  MEMORIES,
  PERSON,
  type ProcessDef,
  RELATIONS,
  type ReadonlyWorldTruth,
  standardize,
  type Trait,
} from "../../sim/index.ts";
import { INQUIRY_EVENT, type InquiryData } from "./testify.ts";

export const ASK_AROUND_PROCESS = "life.askAround";

/** Segundos desde el hecho durante los que la víctima sigue preguntando (3 días, sin calibrar). */
export const ASK_WINDOW = 3 * 86_400;
/** Chance diaria de que salga a preguntar (sin calibrar). */
export const ASK_CHANCE = 0.6;

/** Cuánto suma a la chance la sociabilidad (-1..1) y cuánto la emoción del hecho (sin calibrar). */
export const ASK_SOCIABILITY = 0.2;
export const ASK_EMOTION = 0.3;

/**
 * La chance de salir a preguntar: la base, más la sociabilidad (el retraído se lo guarda) y cuánto
 * le pesó el hecho (la intensidad de su memoria, 0,5 es neutra); entre 0 y 1.
 */
export function askChance(sociability: number, emotion: number): number {
  const x = ASK_CHANCE + ASK_SOCIABILITY * sociability + ASK_EMOTION * (emotion - 0.5);
  return Math.round(Math.min(1, Math.max(0, x)) * 1e6) / 1e6;
}

export interface AskAroundOptions {
  readonly traits: readonly Trait[];
  /** El hogar del jugador queda afuera: lo que hace su personaje lo decide él. */
  readonly player: AgentId;
  readonly placeOf: (truth: ReadonlyWorldTruth, who: AgentId) => PlaceRef;
}

function alive(truth: ReadonlyWorldTruth, id: AgentId): boolean {
  return truth.get(ENTITY, id)?.endedAt === undefined;
}

function together(truth: ReadonlyWorldTruth, a: AgentId, b: AgentId): boolean {
  const x = truth.get(LOCATION, a);
  const y = truth.get(LOCATION, b);
  return x !== undefined && y !== undefined && x.hex === y.hex && x.space === y.space;
}

/**
 * A quién interroga `asker` por su hecho más reciente dentro de la ventana: una persona que
 * conoce, viva y en su mismo lugar, que no sea el autor que él sabe ni él mismo. Devuelve el hecho
 * y la lista ordenada de candidatos (el que elige el sorteo sale de ahí).
 */
export function whomToAsk(
  truth: ReadonlyWorldTruth,
  asker: AgentId,
  now: Tick,
): { event: EventId; candidates: AgentId[] } | null {
  const mine = (truth.get(KNOWN_DEEDS, asker)?.deeds ?? [])
    .filter((d) => d.victim === asker && now - d.at <= ASK_WINDOW && now >= d.at)
    .sort((a, b) => b.at - a.at || (a.event < b.event ? -1 : 1))[0];
  if (!mine) return null;
  const known = Object.keys(truth.get(RELATIONS, asker)?.toward ?? {}).sort() as AgentId[];
  const candidates = known.filter(
    (id) =>
      id !== asker &&
      id !== mine.by &&
      truth.get(PERSON, id) !== undefined &&
      alive(truth, id) &&
      together(truth, asker, id),
  );
  return candidates.length === 0 ? null : { event: mine.event, candidates };
}

export function askAroundProcess(o: AskAroundOptions): ProcessDef {
  return {
    id: ASK_AROUND_PROCESS,
    system: "life",
    scope: "household",
    cadence: { local: "day", scene: "day" },
    representation: "individual",
    phase: "decide",
    reads: [
      KNOWN_DEEDS.name,
      RELATIONS.name,
      LOCATION.name,
      PERSON.name,
      ENTITY.name,
      INNATE.name,
      MEMORIES.name,
    ],
    writes: [],
    run(ctx) {
      const home = ctx.scope as string;
      const members = (ctx.truth.ids(PERSON) as AgentId[])
        .filter((id) => ctx.truth.get(PERSON, id)?.household === home && alive(ctx.truth, id))
        .sort();
      if (members.length === 0 || members.includes(o.player)) return {};
      const events: EventDraft[] = [];
      for (const asker of members) {
        const plan = whomToAsk(ctx.truth, asker, ctx.now);
        if (!plan) continue;
        const rng = ctx.rng.fork("askAround", asker);
        const innate = ctx.truth.get(INNATE, asker);
        const z = innate
          ? standardize(innate, o.traits, ctx.truth.get(PERSON, asker)?.sex ?? "female")
          : {};
        const felt = ctx.truth.get(MEMORIES, asker)?.items.find((m) => m.eventId === plan.event);
        if (!rng.chance(askChance(clampTemper(z["sociability"] ?? 0), felt?.intensity ?? 0.5))) {
          continue;
        }
        const witness = rng.pick(plan.candidates);
        events.push({
          kind: INQUIRY_EVENT,
          actors: [asker, witness],
          place: o.placeOf(ctx.truth, asker),
          data: { deed: plan.event } satisfies InquiryData,
          emissions: {},
          causes: [{ kind: "state", entity: asker as never, key: "law.known_deeds" }],
        });
      }
      return events.length === 0 ? {} : { events };
    },
  };
}

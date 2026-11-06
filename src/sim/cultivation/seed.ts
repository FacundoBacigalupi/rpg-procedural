// La siembra del cultivo en una vida nueva (novel-cult-law): la ley del seed en la fila del plano,
// con su evento de origen (`cultivation.law`, condición del seed), y el talento de cada persona que
// ya existe, heredado de sus padres cuando están (los mayores primero) o del fondo de la población.
// Solo con el cultivo encendido; apagado no se escribe nada.

import {
  type AgentId,
  compareStrings,
  type EventId,
  type EventLog,
  type IdAllocator,
  type PlaceRef,
  Rng,
  type Seed,
  type Tick,
} from "../../core/index.ts";
import { PERSON, type Trait } from "../family/index.ts";
import { ENTITY, type WorldTruth } from "../world/index.ts";
import { QI_TAKEN } from "./absorb.ts";
import { CULTIVATION_LAW, type CultivationLaw, generateCultivationLaw } from "./law.ts";
import { PLACE_QI, type PlaceQi } from "./meditation.ts";
import { TALENT, type TalentRecord, talentOf } from "./talent.ts";

export const CULTIVATION_LAW_EVENT = "cultivation.law";

export interface SeedCultivationOptions {
  readonly seed: Seed;
  readonly now: Tick;
  readonly place: PlaceRef;
  readonly elementSystem: { readonly id: string; readonly elements: readonly string[] };
  readonly talents: readonly Trait[];
  /** El qi de la celda de la aldea (novel-cult-meditate); sin él, un lugar común. */
  readonly qi?: PlaceQi;
}

/** El rng del talento de una persona: el mismo al sembrar y al nacer. */
export const talentRng = (seed: Seed, who: AgentId): Rng => Rng.root(seed).fork("talent", who);

/** Escribe la ley y el talento de la gente. Devuelve la ley. */
export function seedCultivation(
  truth: WorldTruth,
  ids: IdAllocator,
  log: EventLog,
  o: SeedCultivationOptions,
): CultivationLaw {
  const event = ids.next("event") as EventId;
  const plane = ids.next("plane");
  const law = generateCultivationLaw(
    Rng.root(o.seed).fork("cultivation", "law"),
    o.elementSystem,
    event,
  );
  log.append({
    id: event,
    tick: o.now,
    kind: CULTIVATION_LAW_EVENT,
    actors: [],
    place: o.place,
    data: { plane, thresholds: law.paths[0]?.thresholds.length ?? 0 },
    emissions: {},
    causes: [{ kind: "seed" }],
    resolution: "world",
  });
  truth.set(ENTITY, plane, { id: plane, originEventId: event, createdAt: o.now });
  truth.set(CULTIVATION_LAW, plane, law);
  if (o.qi) {
    truth.set(PLACE_QI, plane, o.qi);
    truth.set(QI_TAKEN, plane, { taken: 0, drawn: 0, at: o.now });
  }
  const people = truth
    .ids(PERSON)
    .map((id) => id as AgentId)
    .sort(
      (a, b) =>
        (truth.get(PERSON, a)?.born ?? 0) - (truth.get(PERSON, b)?.born ?? 0) ||
        compareStrings(a, b),
    );
  const done = new Map<AgentId, TalentRecord>();
  for (const who of people) {
    const p = truth.get(PERSON, who);
    if (!p) continue;
    const m = p.mother ? done.get(p.mother) : undefined;
    const f = p.father ? done.get(p.father) : undefined;
    const origin = truth.get(ENTITY, who)?.originEventId ?? event;
    const t = talentOf(
      o.talents,
      p.sex,
      m && f && p.mother && p.father
        ? {
            mother: { id: p.mother, genome: m.genome },
            father: { id: p.father, genome: f.genome },
          }
        : undefined,
      talentRng(o.seed, who),
      origin,
    );
    done.set(who, t);
    truth.set(TALENT, who, t);
  }
  return law;
}

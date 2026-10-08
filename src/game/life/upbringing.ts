// La crianza y el hambre prolongada como eventos formativos (npc-psychology §2, §3, Fase 2). Una vez
// por temporada, cada vivo cuyo cuerpo viene agotado de hambre vive una carencia, y cada chico vive
// cómo lo criaron: el cuidado o el abandono de quien lo cría según su calidez, su cariño por el
// chico y lo apretada que esté la casa, y a veces mano dura. No hay un modificador abstracto: son
// eventos con causa (`mind.hardship`, `family.rearing`) que `life.appraise` interpreta con el
// temperamento y los esquemas del chico y pasa por `form`.
//
// Quien cría son los padres vivos de la casa; si no hay, otro adulto de la casa (cuida menos); si
// no hay nadie, el chico queda abandonado. La mano dura es lo único al azar: tira sobre lo que la
// situación del que cría permite. No escribe golpes en el cuerpo del chico todavía.

import type { AgentId, EntityRef, PlaceRef, PlanetClock } from "../../core/index.ts";
import {
  BODY_STATE,
  type BodyPlanDef,
  type BondDef,
  CARE_ABANDONED,
  CARE_STRANGER,
  careOf,
  type DimensionDef,
  type FoodDef,
  HARDSHIP_FAT_START,
  harshChance,
  INNATE,
  MIND,
  PERSON,
  type ProcessDef,
  REARING_AGE,
  RELATIONS,
  type ReadonlyWorldTruth,
  readPressures,
  relationship,
} from "../../sim/index.ts";
import { living } from "./living.ts";
import { householdHungerSource } from "./pressures.ts";

export const UPBRINGING_PROCESS = "life.upbringing";
/** Edad vivida (años) desde la que alguien de la casa puede criar a otro. */
export const CAREGIVER_AGE = 16;
/** kcal de un kilo de grasa (la referencia de reservas de `newBody`). */
const KCAL_PER_KG_FAT = 7700;

export interface UpbringingOptions {
  readonly clock: PlanetClock;
  readonly bodyPlans: readonly BodyPlanDef[];
  readonly foods: readonly FoodDef[];
  readonly dims: readonly DimensionDef[];
  readonly bonds: readonly BondDef[];
  readonly placeOf: (truth: ReadonlyWorldTruth, who: AgentId) => PlaceRef;
}

export function upbringingProcess(o: UpbringingOptions): ProcessDef {
  return {
    id: UPBRINGING_PROCESS,
    system: "life",
    scope: "agent",
    cadence: { local: "season", scene: "season" },
    representation: "individual",
    phase: "settle",
    reads: [BODY_STATE.name, PERSON.name, INNATE.name, MIND.name, RELATIONS.name],
    writes: [],
    run(ctx) {
      const truth = ctx.truth;
      const me = ctx.scope as unknown as AgentId;
      const person = truth.get(PERSON, me);
      if (!person) return {};
      const place = o.placeOf(truth, me);
      const events: NonNullable<ReturnType<ProcessDef["run"]>["events"]>[number][] = [];

      const body = truth.get(BODY_STATE, me);
      const plan = body ? o.bodyPlans.find((p) => p.id === body.plan) : undefined;
      if (body && plan && body.death === null) {
        const reference = body.massKg * plan.physiology.fatFraction * KCAL_PER_KG_FAT;
        const ratio = reference > 0 ? body.fat / reference : 1;
        if (ratio < HARDSHIP_FAT_START)
          events.push({
            kind: "mind.hardship",
            actors: [me],
            place,
            data: { fatRatio: Math.round(ratio * 1e4) / 1e4 },
            emissions: {},
            causes: [{ kind: "state", entity: me, key: "reserves" }],
          });
      }

      const age = (ctx.now - person.born) / o.clock.year;
      if (age < REARING_AGE && ctx.ledger) {
        const strain =
          readPressures([householdHungerSource(o.foods)], {
            truth,
            ledger: ctx.ledger,
            now: ctx.now,
          }).find((p) => p.scope.ref === (person.household as unknown as EntityRef))?.value ?? 0;
        const kin = [person.mother, person.father].filter((p): p is AgentId => p !== null);
        const home = living(truth).filter(
          (id) => id !== me && truth.get(PERSON, id)?.household === person.household,
        );
        const parents = kin.filter((p) => home.includes(p));
        const adults = home.filter(
          (id) =>
            !parents.includes(id) &&
            (ctx.now - (truth.get(PERSON, id)?.born ?? ctx.now)) / o.clock.year >= CAREGIVER_AGE,
        );
        const givers = parents.length > 0 ? parents : adults;
        const share = parents.length > 0 ? 1 : CARE_STRANGER;
        let care = CARE_ABANDONED;
        let harsh = 0;
        let harshBy: AgentId | null = null;
        if (givers.length > 0) {
          let total = 0;
          for (const g of givers) {
            const warmth = truth.get(INNATE, g)?.["warmth"] ?? 0;
            const boldness = truth.get(INNATE, g)?.["boldness"] ?? 0;
            const affection = relationship(truth.get(RELATIONS, g), me, ctx.now, {
              dims: o.dims,
              bonds: o.bonds,
              schemaStrength: (s) => truth.get(MIND, g)?.schemas[s]?.strength ?? 0,
            }).dims.affection;
            total += careOf(warmth, affection, strain);
            const rng = ctx.rng.fork("harsh", g);
            if (harshBy === null && rng.chance(harshChance(boldness, warmth, strain))) {
              harshBy = g;
              harsh = Math.round((0.2 + 0.8 * rng.float()) * 1e3) / 1e3;
            }
          }
          care = (share * total) / givers.length;
        }
        events.push({
          kind: "family.rearing",
          actors: harshBy ? [me, harshBy] : [me],
          place,
          data: {
            caregivers: givers,
            care: Math.round(care * 1e4) / 1e4,
            harsh,
            strain: Math.round(strain * 1e4) / 1e4,
          },
          emissions: {},
          causes: [{ kind: "state", entity: me, key: "rearing" }],
        });
      }
      return events.length === 0 ? {} : { events };
    },
  };
}

// Nacer vivo (family-lineage §3, causality ley 2): cuando `life.labor` resolvió un parto y el niño no
// murió, nace una persona: entidad con el parto como origen, civil (sexo, madre, padre, hogar de la
// madre), genoma heredado de los dos y su innato, un cuerpo de recién nacido y su lugar en el hogar.
// Opt-in (`LifeOptions.births`, con `conception`). Un nacimiento por parto: la fila `BIRTH` (único
// escritor de este proceso) guarda qué parto ya dio a luz. No mueve bienes. El azar sale de
// `ctx.rng.fork("birth", madre, parto)`, así que mismo seed, mismo hijo.

import type {
  AgentId,
  EntityRef,
  HouseholdId,
  PlaceRef,
  PlanetClock,
  Tick,
} from "../../core/index.ts";
import {
  BODY_STATE,
  type BodyPlanDef,
  createEntity,
  draftEvent,
  ENTITY,
  type EventDraft,
  expressInnate,
  GENOME,
  HOUSEHOLD,
  INNATE,
  inheritGenome,
  LOCATION,
  massOf,
  newBody,
  PERSON,
  type ProcessDef,
  type ReadonlyWorldTruth,
  type Sex,
  type StateChange,
  setComponent,
  type Trait,
  table,
} from "../../sim/index.ts";
import { PREGNANCY } from "./conception.ts";
import { LABOR } from "./midwife.ts";

export const BIRTH_PROCESS = "life.birth";

/** Qué parto de una madre ya dio a luz, y a quién. */
export interface BirthRow {
  readonly dueAt: Tick;
  readonly child: AgentId;
}

export const BIRTH = table<BirthRow>("life.birth");

/** Proporción de varones al nacer cuando no hay otra (sin calibrar; la pre-corrida usa la de demografía). */
export const MALE_BIRTH_RATIO = 0.51;

export interface BirthOptions {
  readonly clock: PlanetClock;
  readonly traits: readonly Trait[];
  readonly bodyPlans: readonly BodyPlanDef[];
  readonly maleRatio?: number;
  readonly placeOf: (truth: ReadonlyWorldTruth, who: AgentId) => PlaceRef;
}

export function birthProcess(o: BirthOptions): ProcessDef {
  return {
    id: BIRTH_PROCESS,
    system: "life",
    scope: "world",
    cadence: { local: "day", scene: "day" },
    representation: "individual",
    phase: "settle",
    reads: [
      LABOR.name,
      PREGNANCY.name,
      BIRTH.name,
      PERSON.name,
      GENOME.name,
      HOUSEHOLD.name,
      ENTITY.name,
      LOCATION.name,
    ],
    writes: [
      BIRTH.name,
      ENTITY.name,
      PERSON.name,
      GENOME.name,
      INNATE.name,
      HOUSEHOLD.name,
      LOCATION.name,
      BODY_STATE.name,
    ],
    run(ctx) {
      const plan = o.bodyPlans.find((p) => p.id === "human");
      if (!plan) return {};
      const changes: StateChange[] = [];
      const events: EventDraft[] = [];
      // Las casas que ganan miembros en este paso (dos hijos del mismo hogar el mismo día).
      const members = new Map<HouseholdId, AgentId[]>();
      const mothers = ctx.truth
        .ids(LABOR)
        .map((id) => id as unknown as AgentId)
        .sort();
      for (const mother of mothers) {
        const key = mother as unknown as EntityRef;
        const labor = ctx.truth.get(LABOR, key);
        // Si la madre murió en el parto el niño, si vive, nace igual y entra al hogar de ella.
        if (!labor || labor.infantDied) continue;
        if ((ctx.truth.get(BIRTH, key)?.dueAt ?? -1) >= labor.dueAt) continue;
        const preg = ctx.truth.get(PREGNANCY, key);
        const m = ctx.truth.get(PERSON, key);
        if (!preg || !m || preg.dueAt !== labor.dueAt) continue;
        const f = preg.father;
        const father = ctx.truth.get(PERSON, f as unknown as EntityRef);
        const mg = ctx.truth.get(GENOME, key);
        const fg = ctx.truth.get(GENOME, f as unknown as EntityRef);
        if (!father || !mg || !fg) continue;

        const rng = ctx.rng.fork("birth", mother, labor.dueAt);
        const sex: Sex = rng.chance(o.maleRatio ?? MALE_BIRTH_RATIO) ? "male" : "female";
        const child = ctx.newId("agent") as unknown as AgentId;
        const k = events.length;
        events.push({
          kind: "family.birth",
          actors: [child, mother, f],
          place: o.placeOf(ctx.truth, mother),
          data: { sex, midwife: labor.midwife, complication: labor.complication },
          emissions: { sight: 0.2, sound: 0.5 },
          // El parto resuelto es la causa; el niño es su efecto.
          causes: [{ kind: "event", event: labor.cause as never }],
        });
        const birthEvent = draftEvent(k);
        const genome = inheritGenome(
          o.traits,
          { id: mother, genome: mg },
          { id: f, genome: fg },
          rng.fork("genetics"),
          birthEvent,
        );
        const innate = expressInnate(o.traits, genome, sex, rng.fork("development"));
        // Nace al registrarse el parto (el día siguiente al de `life.labor`): la entidad no puede ser
        // anterior al evento que la causa.
        const born = ctx.now;
        changes.push(
          createEntity(child as unknown as EntityRef, birthEvent, born),
          setComponent(PERSON, child as unknown as EntityRef, {
            sex,
            born,
            mother,
            father: f,
            household: m.household,
            spouse: null,
          }),
          setComponent(GENOME, child as unknown as EntityRef, genome),
          setComponent(INNATE, child as unknown as EntityRef, innate),
          setComponent(
            BODY_STATE,
            child as unknown as EntityRef,
            newBody(plan, massOf(plan, innate, o.traits, sex, 0), born),
          ),
          setComponent(BIRTH, key, { dueAt: labor.dueAt, child }),
        );
        const where = ctx.truth.get(LOCATION, key);
        if (where) changes.push(setComponent(LOCATION, child as unknown as EntityRef, where));
        const house = ctx.truth.get(HOUSEHOLD, m.household as unknown as EntityRef);
        if (house) {
          const added = [...(members.get(m.household) ?? house.members), child];
          members.set(m.household, added);
          changes.push(
            setComponent(HOUSEHOLD, m.household as unknown as EntityRef, {
              ...house,
              members: added,
            }),
          );
        }
      }
      return { changes, events };
    },
  };
}

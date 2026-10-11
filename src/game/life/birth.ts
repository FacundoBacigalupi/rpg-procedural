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
  type BondDef,
  type TraitDef as CultureTraitDef,
  createEntity,
  type DimensionDef,
  draftEvent,
  ENTITY,
  type EventDraft,
  expressInnate,
  GENOME,
  HOUSEHOLD,
  INNATE,
  inheritGenome,
  kinRelationship,
  type Language,
  LOCATION,
  MIND,
  massOf,
  nameNewborn,
  newBody,
  newMind,
  PERSON,
  PERSON_CULTURE,
  PERSON_NAME,
  type ProcessDef,
  RELATIONS,
  RELIGIOUS_IDENTITY,
  type ReadonlyWorldTruth,
  type Relationship,
  type SchemaDef,
  type Sex,
  type StateChange,
  seedAffiliation,
  seedPersonCulture,
  setComponent,
  strangerDims,
  type Trait,
  table,
  villageCulture,
  villageReligion,
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
  /**
   * Con esto el recién nacido también trae nombre (la lengua de la aldea), mente de base y lo que
   * siente por su parentela y su casa, con los mismos caminos que la siembra (`nameNewborn`,
   * `newMind`, `kinRelationship`); sin esto nace sin nombre, mente ni relaciones.
   */
  readonly newborn?:
    | {
        readonly language: Language;
        readonly schemas: readonly SchemaDef[];
        readonly dims: readonly DimensionDef[];
        readonly bonds: readonly BondDef[];
        /** Los rasgos de cultura: con ellos copia a sus padres lo que siguen (culture §4). */
        readonly cultureTraits: readonly CultureTraitDef[];
      }
    | undefined;
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
      ...(o.newborn ? [PERSON_NAME.name, PERSON_CULTURE.name, RELIGIOUS_IDENTITY.name] : []),
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
      ...(o.newborn
        ? [
            PERSON_NAME.name,
            MIND.name,
            RELATIONS.name,
            PERSON_CULTURE.name,
            RELIGIOUS_IDENTITY.name,
          ]
        : []),
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
        if (o.newborn) {
          const n = o.newborn;
          const childKey = child as unknown as EntityRef;
          // El nombre: el apellido del padre y un nombre de pila que la casa no repite.
          const used = new Set<string>();
          for (const member of ctx.truth.get(HOUSEHOLD, m.household as unknown as EntityRef)
            ?.members ?? []) {
            const name = ctx.truth.get(PERSON_NAME, member as unknown as EntityRef);
            const given = name?.parts.find((x) => x.kind === "given")?.form;
            if (given) used.add(given);
          }
          changes.push(
            setComponent(
              PERSON_NAME,
              childKey,
              nameNewborn(n.language, {
                rng: rng.fork("name"),
                sex,
                father: ctx.truth.get(PERSON_NAME, f as unknown as EntityRef),
                used,
                raisedBy: f,
                event: birthEvent,
              }),
            ),
            // La mente de base desde su temperamento, con el nacimiento como causa.
            setComponent(
              MIND,
              childKey,
              newMind(n.schemas, innate, rng.fork("psyche"), birthEvent),
            ),
          );
          // Lo que sigue de su cultura y su fe: copia a sus padres, como los chicos de la siembra.
          const parents = [mother, f];
          const community = villageCulture(ctx.truth);
          if (community) {
            const learned = parents.flatMap((p) => {
              const culture = ctx.truth.get(PERSON_CULTURE, p as unknown as EntityRef);
              return culture ? [{ id: p, culture }] : [];
            });
            changes.push(
              setComponent(
                PERSON_CULTURE,
                childKey,
                seedPersonCulture(
                  {
                    community,
                    traits: n.cultureTraits,
                    parents: learned,
                    since: born,
                    originEventId: birthEvent,
                  },
                  rng.fork("person-culture"),
                ),
              ),
            );
          }
          const religion = villageReligion(ctx.truth);
          if (religion) {
            const raised = parents.flatMap((p) => {
              const aff = ctx.truth.get(RELIGIOUS_IDENTITY, p as unknown as EntityRef)
                ?.affiliations[0];
              return aff ? [{ id: p, aff }] : [];
            });
            changes.push(
              setComponent(RELIGIOUS_IDENTITY, childKey, {
                affiliations: [
                  seedAffiliation(
                    {
                      religion,
                      parents: raised.map((r) => r.aff),
                      learnedFrom: raised.map((r) => r.id),
                      since: born,
                      originEventId: birthEvent,
                    },
                    rng.fork("person-religion"),
                  ),
                ],
                doubts: [],
              }),
            );
          }
          // Lo que siente por su parentela y su casa, con la misma regla que la siembra.
          const record = { sex, born, mother, father: f, household: m.household, spouse: null };
          const person = (who: AgentId) =>
            who === child ? record : ctx.truth.get(PERSON, who as unknown as EntityRef);
          const kin = [
            ...new Set([
              mother,
              f,
              ...(ctx.truth.get(HOUSEHOLD, m.household as unknown as EntityRef)?.members ?? []),
            ]),
          ].sort();
          const stranger = strangerDims(n.dims);
          const toward: Record<string, Relationship> = {};
          for (const other of kin) {
            const r = kinRelationship(child, other, person as never, innate["warmth"] ?? 0, {
              rng: rng.fork("relation", other),
              dims: stranger,
              bonds: n.bonds,
              event: birthEvent,
              now: born,
            });
            if (r) toward[other] = r;
          }
          if (Object.keys(toward).length > 0) {
            changes.push(setComponent(RELATIONS, childKey, { toward, originEventId: birthEvent }));
          }
        }
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

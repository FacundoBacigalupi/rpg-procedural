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
  type NameRules,
  nameNewborn,
  newBody,
  newMind,
  newTastes,
  PERSON,
  PERSON_CULTURE,
  PERSON_NAME,
  type ProcessDef,
  practicesOfKind,
  RELATIONS,
  RELIGIOUS_IDENTITY,
  type ReadonlyWorldTruth,
  type Relationship,
  type SchemaDef,
  SELF_IMAGES,
  type Sex,
  SKILL_STATE,
  type SkillCatalog,
  type StateChange,
  seedAffiliation,
  seedPersonCulture,
  seedSelfImages,
  setComponent,
  standardize,
  strangerDims,
  TASTES_OF,
  type TasteDef,
  type Trait,
  table,
  tasteWorld,
  upbringingSkills,
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
        /** La forma de los nombres (el largo mínimo); por defecto, la de ahora. */
        readonly names?: NameRules;
        readonly schemas: readonly SchemaDef[];
        readonly dims: readonly DimensionDef[];
        readonly bonds: readonly BondDef[];
        /** Los rasgos de cultura: con ellos copia a sus padres lo que siguen (culture §4). */
        readonly cultureTraits: readonly CultureTraitDef[];
        /** Las habilidades de base (sin aprendido: solo lo heredado) y los gustos que trae al nacer. */
        readonly skills: SkillCatalog;
        readonly tastes: readonly TasteDef[];
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
            SKILL_STATE.name,
            SELF_IMAGES.name,
            TASTES_OF.name,
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
      const usedGiven = new Map<HouseholdId, Set<string>>();
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
          let used = usedGiven.get(m.household);
          if (!used) {
            used = new Set<string>();
            for (const member of ctx.truth.get(HOUSEHOLD, m.household as unknown as EntityRef)
              ?.members ?? []) {
              const name = ctx.truth.get(PERSON_NAME, member as unknown as EntityRef);
              const given = name?.parts.find((x) => x.kind === "given")?.form;
              // `pickGiven` compara el texto de la lengua, antes de capitalizar el nombre.
              if (given) used.add(given.toLowerCase());
            }
            usedGiven.set(m.household, used);
          }
          const name = nameNewborn(n.language, {
            rng: rng.fork("name"),
            sex,
            father: ctx.truth.get(PERSON_NAME, f as unknown as EntityRef),
            used,
            raisedBy: f,
            event: birthEvent,
            ...(n.names ? { rules: n.names } : {}),
          });
          const given = name.parts.find((x) => x.kind === "given")?.form;
          if (given) used.add(given.toLowerCase());
          changes.push(
            setComponent(PERSON_NAME, childKey, name),
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
          // Lo heredado de habilidad (talento y techo, sin aprendido) y los gustos de la mesa de su madre.
          const z = standardize(innate, o.traits, sex);
          const skills = upbringingSkills(n.skills, z, born, born, o.clock);
          changes.push(
            setComponent(SKILL_STATE, childKey, skills),
            setComponent(SELF_IMAGES, childKey, seedSelfImages(n.skills, skills, z, born)),
            setComponent(
              TASTES_OF,
              childKey,
              newTastes(
                n.tastes,
                tasteWorld(n.tastes, practicesOfKind(villageReligion(ctx.truth), "taboo")),
                innate,
                mother,
                rng.fork("tastes"),
                birthEvent,
              ),
            ),
          );
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

export const BONDED_PROCESS = "life.newborn_bonds";

/** A qué hijo de una madre ya le tomaron cariño los suyos. */
export const BONDED = table<{ readonly child: AgentId }>("life.newborn_bonded");

export interface BondOptions {
  readonly dims: readonly DimensionDef[];
  readonly bonds: readonly BondDef[];
}

/**
 * Lo que sienten por el recién nacido su madre, su padre y la gente de su casa: su lado de
 * `RELATIONS` con la misma regla que la siembra (`kinRelationship`), una vez por hijo. Va en la fase
 * `physics`, donde ningún otro proceso escribe esa tabla (`appraise` percibe, `company` asienta), y
 * por eso no choca con ellos; sin esto el niño siente por su familia pero la familia no por él.
 */
export function newbornBondsProcess(o: BondOptions): ProcessDef {
  return {
    id: BONDED_PROCESS,
    system: "life",
    scope: "world",
    cadence: { local: "day", scene: "day" },
    representation: "individual",
    phase: "physics",
    reads: [
      BIRTH.name,
      BONDED.name,
      PERSON.name,
      INNATE.name,
      HOUSEHOLD.name,
      ENTITY.name,
      RELATIONS.name,
    ],
    writes: [BONDED.name, RELATIONS.name],
    run(ctx) {
      const alive = (a: AgentId) =>
        ctx.truth.get(ENTITY, a as unknown as EntityRef)?.endedAt === undefined;
      const changes: StateChange[] = [];
      const stranger = strangerDims(o.dims);
      // Las filas que van tomando los suyos en este paso (dos hijos de la misma casa el mismo día).
      const rows = new Map<AgentId, { toward: Record<string, Relationship>; origin: string }>();
      const mothers = ctx.truth
        .ids(BIRTH)
        .map((id) => id as unknown as AgentId)
        .sort();
      for (const mother of mothers) {
        const born = ctx.truth.get(BIRTH, mother as unknown as EntityRef);
        if (!born || ctx.truth.get(BONDED, mother as unknown as EntityRef)?.child === born.child) {
          continue;
        }
        const child = born.child;
        const record = ctx.truth.get(PERSON, child as unknown as EntityRef);
        const origin = ctx.truth.get(ENTITY, child as unknown as EntityRef)?.originEventId;
        if (!record || !origin) continue;
        const person = (who: AgentId) => ctx.truth.get(PERSON, who as unknown as EntityRef);
        const kin = [
          ...new Set([
            ...(record.mother ? [record.mother] : []),
            ...(record.father ? [record.father] : []),
            ...(ctx.truth.get(HOUSEHOLD, record.household as unknown as EntityRef)?.members ?? []),
          ]),
        ]
          .filter((k) => k !== child && alive(k))
          .sort();
        for (const k of kin) {
          const warmth = ctx.truth.get(INNATE, k as unknown as EntityRef)?.["warmth"] ?? 0;
          const r = kinRelationship(k, child, person, warmth, {
            rng: ctx.rng.fork("newborn-bond", k, child),
            dims: stranger,
            bonds: o.bonds,
            event: origin as never,
            now: ctx.now,
          });
          if (!r) continue;
          const row = rows.get(k) ?? {
            toward: { ...(ctx.truth.get(RELATIONS, k as unknown as EntityRef)?.toward ?? {}) },
            origin: ctx.truth.get(RELATIONS, k as unknown as EntityRef)?.originEventId ?? origin,
          };
          row.toward[child] = r;
          rows.set(k, row);
        }
        changes.push(setComponent(BONDED, mother as unknown as EntityRef, { child }));
      }
      for (const [k, row] of [...rows].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))) {
        changes.push(
          setComponent(RELATIONS, k as unknown as EntityRef, {
            toward: row.toward,
            originEventId: row.origin as never,
          }),
        );
      }
      return { changes };
    },
  };
}

// Los de la secta en carne (novel-sect-seat-hall-people-born, simulation §6): mientras nadie sube,
// los cultivadores de la secta son ranuras con hechos fijados (`SectSlot`). Cuando el jugador entra al
// parche de la sede (antes de que pueda verlos), cada ranura se vuelve una persona ahí: su sexo, su
// edad, su talento, su reino, su qi, su pureza y su fundamento son los de la ranura; el genoma, el
// innato, el cuerpo y el nombre salen de `rng.fork("materialize", org, ranura)`, así que mismo seed,
// misma gente. Un solo evento (`life.sect_hall`) los trae, causado por la fundación de la secta y por
// la llegada del jugador (su lugar); todos quedan miembros con su rango, de pie en el salón.
// `SECT_HALL` guarda quiénes salieron de cada ranura: no se materializa dos veces. El qi de las
// ranuras no estaba en ninguna reserva (era parte del agregado), así que pasa a la persona sin tocar
// las reservas.
//
// Su sustento (novel-sect-seat-hall-people-keep): su casa es un hogar propio cuya cuenta es la
// despensa de la sede. Al materializarse llega con lo que la secta tenía guardado para ellos, y cada
// semana se repone desde `sect.upkeep` (fuente externa declarada solo con la región) hasta
// `store.days` días de comida de los vivos. La rutina los lleva a dormir a los dormitorios y a meditar
// en la cueva (`RoutineOptions.seatOf`).
//
// Su mente (novel-sect-seat-hall-people-talk): con `mind`, cada uno llega con lo que la siembra le da
// a un aldeano adulto (mente de base desde su temperamento, cultura de la comunidad, habilidades y
// autoimagen de su crianza, gustos), con los mismos caminos que el nacimiento y con el evento de la
// materialización como causa; así `speak` y los demás sistemas los leen como a cualquiera.

import {
  type AgentId,
  type EntityRef,
  externalAccount,
  type HolderRef,
  type HouseholdId,
  holderAccount,
  type LedgerAccount,
  type LedgerUnit,
  type PlaceId,
  type PlaceRef,
  type PlanetClock,
  Rng,
  type Tick,
} from "../../core/index.ts";
import {
  BODY_STATE,
  type BodyPlanDef,
  CULTIVATION_STATE,
  type TraitDef as CultureTraitDef,
  createEntity,
  draftEvent,
  ENTITY,
  type EventDraft,
  expressInnate,
  founderGenome,
  GENOME,
  INNATE,
  type Language,
  LOCATION,
  type LocalMap,
  MEAL_KCAL,
  type MemberRank,
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
  PLACE,
  type PostingDraft,
  type ProcessDef,
  patchOf,
  practicesOfKind,
  type ReadonlyWorldTruth,
  type SchemaDef,
  SECT,
  SECT_MEMBER,
  SELF_IMAGES,
  type SectRank,
  SKILL_STATE,
  type SkillCatalog,
  type StateChange,
  sectSpaceKey,
  seedPersonCulture,
  seedSelfImages,
  setComponent,
  standardize,
  TALENT,
  TASTES_OF,
  type TasteDef,
  type Trait,
  table,
  tasteWorld,
  upbringingSkills,
  villageCulture,
  villageReligion,
} from "../../sim/index.ts";
import { PLAYER } from "./player.ts";

/** Quiénes salieron de las ranuras de una secta (por organización), en el orden de las ranuras. */
export interface SectHall {
  readonly at: Tick;
  /** Su casa: la despensa de la sede es la cuenta de este hogar. */
  readonly house: HouseholdId;
  readonly people: readonly { readonly slot: number; readonly person: AgentId }[];
  /** La última vez que se repuso la despensa. */
  readonly stocked?: Tick;
}
export const SECT_HALL = table<SectHall>("life.sect_hall");

export const SECT_HALL_PROCESS = "life.sect_hall";
/** El evento de la materialización: la gente de la secta, en su sede. */
export const SECT_HALL_EVENT = "life.sect_hall";
/** La reposición de la despensa de la sede. */
export const SECT_UPKEEP_EVENT = "life.sect_upkeep";
/**
 * La fuente externa de la comida de la sede: lo que la secta junta afuera de lo simulado (tributos,
 * campos de sirvientes, compras). El tesoro de verdad y las tareas que lo pagan son `-duties`.
 */
export const SECT_UPKEEP = "sect.upkeep";
/** Para cuántos días de comida se abastece la despensa de la sede. */
export const SECT_STORE_DAYS = 30;
/** Cada cuántos días se repone la despensa. */
const STORE_EVERY_DAYS = 7;

/** El rango de miembro de cada ranura: los discípulos de la sede son internos. */
const MEMBER_RANK: Readonly<Record<SectRank, MemberRank>> = {
  master: "master",
  elder: "elder",
  disciple: "inner",
};

/** Con qué y para cuántos días se abastece la despensa de la sede. */
export interface SectStore {
  readonly unit: LedgerUnit;
  readonly kcalPerGram: number;
  readonly days: number;
  /** El dinero del tributo (novel-sect-duty-treasury); sin él, el tesoro es solo de grano. */
  readonly coin?: LedgerUnit;
}

/** El tributo de cada semana (novel-sect-duty-treasury). */
export const SECT_TRIBUTE_EVENT = "life.sect_tribute";
/** Cuánto más de lo que comen sus vivos entra de tributo: el tesoro crece despacio. */
export const TRIBUTE_SURPLUS = 1.25;
/** Cobre por cabeza y por semana que entra de tributo. */
export const TRIBUTE_COIN_PER_HEAD = 20;
/** Con cuántos días de comida en el tesoro, además de la despensa, llega la secta a la carne. */
export const TREASURY_RESERVE_DAYS = 30;

/** La cuenta del tesoro de la secta: su propia tenencia en el ledger. */
export function treasuryAccount(org: EntityRef): LedgerAccount {
  return holderAccount(org as unknown as HolderRef);
}

export interface SectHallOptions {
  readonly map: LocalMap;
  readonly yearTicks: number;
  readonly dayTicks: number;
  readonly traits: readonly Trait[];
  readonly bodyPlans: readonly BodyPlanDef[];
  /** La lengua de sus nombres (la de la región); sin ella quedan sin nombre. */
  readonly language?: Language;
  readonly names?: NameRules;
  /** La despensa de la sede (novel-sect-seat-hall-people-keep); sin ella, nada que comer. */
  readonly store?: SectStore;
  /** Con esto llegan con mente, cultura, habilidades y gustos (novel-sect-seat-hall-people-talk). */
  readonly mind?: SectHallMind;
}

/** Lo que hace falta para darles la mente de un adulto de la siembra. */
export interface SectHallMind {
  readonly clock: PlanetClock;
  readonly schemas: readonly SchemaDef[];
  readonly cultureTraits: readonly CultureTraitDef[];
  readonly skills: SkillCatalog;
  readonly tastes: readonly TasteDef[];
}

/**
 * La casa y el lugar de las horas de trabajo de quien vive en la sede: los dormitorios y la cueva.
 * El discípulo externo vive ahí solo si ya subió (con `map`: está en el parche de la sede), y sus
 * horas de trabajo son de tareas en el portón (novel-sect-duty-routine).
 */
export function seatRoutineOf(
  truth: ReadonlyWorldTruth,
  me: AgentId,
  map?: LocalMap,
): { readonly home: string; readonly work: string; readonly chores?: boolean } | undefined {
  const member = truth.get(SECT_MEMBER, me as unknown as EntityRef);
  if (!member) return undefined;
  const sect = truth.get(SECT, member.org);
  if (!sect) return undefined;
  const home = sectSpaceKey(sect.seatPlace, "dorm");
  if (member.rank !== "outer") {
    return truth.has(SECT_HALL, member.org)
      ? { home, work: sectSpaceKey(sect.seatPlace, "cave") }
      : undefined;
  }
  const seatHex = truth.get(PLACE, sect.seatPlace)?.hexes[0];
  const here = truth.get(LOCATION, me)?.hex;
  if (!map || seatHex === undefined || here === undefined) return undefined;
  if (patchOf(map, here).base !== patchOf(map, seatHex).base) return undefined;
  return { home, work: sectSpaceKey(sect.seatPlace, "gate"), chores: true };
}

/** Escritor de `SECT_HALL` y de la gente de la secta que materializa (cableado opt-in). */
export function sectHallProcess(o: SectHallOptions): ProcessDef {
  return {
    id: SECT_HALL_PROCESS,
    system: "life",
    scope: "world",
    cadence: { local: "hour", scene: "hour" },
    representation: "individual",
    phase: "settle",
    reads: [PLAYER.name, LOCATION.name, SECT.name, SECT_HALL.name, PLACE.name, ENTITY.name],
    writes: [
      SECT_HALL.name,
      ENTITY.name,
      PERSON.name,
      GENOME.name,
      INNATE.name,
      BODY_STATE.name,
      TALENT.name,
      CULTIVATION_STATE.name,
      SECT_MEMBER.name,
      LOCATION.name,
      PERSON_NAME.name,
      ...(o.mind
        ? [MIND.name, PERSON_CULTURE.name, SKILL_STATE.name, SELF_IMAGES.name, TASTES_OF.name]
        : []),
    ],
    run(ctx) {
      const truth = ctx.truth;
      const changes: StateChange[] = [];
      const events: EventDraft[] = [];
      const postings: PostingDraft[] = [];
      // La despensa de cada sede ya en carne: se repone cada semana hasta `days` días de comida.
      for (const org of truth.ids(SECT)) {
        const hall = truth.get(SECT_HALL, org);
        const sect = truth.get(SECT, org);
        if (!hall || !sect || !o.store || !ctx.ledger) continue;
        if (hall.stocked !== undefined && ctx.now - hall.stocked < STORE_EVERY_DAYS * o.dayTicks) {
          continue;
        }
        changes.push(setComponent(SECT_HALL, org, { ...hall, stocked: ctx.now }));
        const alive = aliveIn(truth, hall);
        const tribute = {
          grams: Math.ceil(dailyGrams(o.store, alive) * STORE_EVERY_DAYS * TRIBUTE_SURPLUS),
          coin: o.store.coin ? alive * TRIBUTE_COIN_PER_HEAD : 0,
        };
        restock(
          o.store,
          org,
          sect.seatPlace,
          hall.house,
          tribute,
          topUp(o.store, truth, ctx.ledger, hall, alive),
          {
            balance: ctx.ledger.balance(treasuryAccount(org), o.store.unit),
            events,
            postings,
            causes: [{ kind: "state", entity: org, key: SECT.name }],
          },
        );
      }
      const plan = o.bodyPlans.find((p) => p.id === "human");
      const here = (truth.ids(PLAYER) as AgentId[])
        .filter((p) => truth.get(ENTITY, p)?.endedAt === undefined)
        .flatMap((p) => {
          const hex = truth.get(LOCATION, p)?.hex;
          return hex === undefined ? [] : [{ p, base: patchOf(o.map, hex).base }];
        });
      for (const org of plan && here.length > 0 ? truth.ids(SECT) : []) {
        if (!plan || truth.has(SECT_HALL, org)) continue;
        const sect = truth.get(SECT, org);
        const seatHex = sect ? truth.get(PLACE, sect.seatPlace)?.hexes[0] : undefined;
        if (!sect || seatHex === undefined) continue;
        const base = patchOf(o.map, seatHex).base;
        const who = here.find((h) => h.base === base);
        if (!who) continue;
        const event = draftEvent(events.length);
        const house = ctx.newId("household") as unknown as HouseholdId;
        changes.push(createEntity(house as unknown as EntityRef, event, ctx.now));
        const people: { slot: number; person: AgentId }[] = [];
        const usedGiven = new Set<string>();
        const hallKey = sectSpaceKey(sect.seatPlace, "hall");
        for (const slot of sect.slots) {
          const rng = Rng.root(ctx.rng.seed).fork("materialize", org, slot.slot);
          const id = ctx.newId("agent") as unknown as AgentId;
          const key = id as unknown as EntityRef;
          const genome = founderGenome(o.traits, rng.fork("genome"), event);
          const innate = expressInnate(o.traits, genome, slot.sex, rng.fork("development"));
          const years = Math.max(0, (ctx.now - slot.born) / o.yearTicks);
          changes.push(
            createEntity(key, event, ctx.now),
            setComponent(PERSON, key, {
              sex: slot.sex,
              born: slot.born,
              mother: null,
              father: null,
              household: house,
              spouse: null,
            }),
            setComponent(GENOME, key, genome),
            setComponent(INNATE, key, innate),
            setComponent(
              BODY_STATE,
              key,
              newBody(plan, massOf(plan, innate, o.traits, slot.sex, years), ctx.now),
            ),
            setComponent(TALENT, key, slot.talent),
            setComponent(CULTIVATION_STATE, key, {
              // Ya cultivan: sienten el qi desde antes de que el jugador los vea.
              sensitivity: 1,
              hours: 0,
              sensed: { at: ctx.now, event: event as never },
              qi: slot.qi,
              purity: slot.purity,
              stage: slot.stage,
              foundation: slot.foundation,
            }),
            setComponent(SECT_MEMBER, key, {
              org,
              rank: MEMBER_RANK[slot.rank],
              since: ctx.now,
            }),
            setComponent(LOCATION, key, { hex: seatHex, space: hallKey }),
          );
          if (o.language) {
            const name = nameNewborn(o.language, {
              rng: rng.fork("name"),
              sex: slot.sex,
              father: undefined,
              used: usedGiven,
              raisedBy: null,
              event,
              ...(o.names ? { rules: o.names } : {}),
            });
            const given = name.parts.find((x) => x.kind === "given")?.form;
            if (given) usedGiven.add(given.toLowerCase());
            changes.push(setComponent(PERSON_NAME, key, name));
          }
          if (o.mind)
            changes.push(
              ...mindOf(o.mind, o.traits, truth, key, slot, innate, rng, event, ctx.now),
            );
          people.push({ slot: slot.slot, person: id });
        }
        // Lo que la secta tenía guardado para ellos pasa con ellos (simulation §6, paso 4).
        const hall: SectHall = { at: ctx.now, house, people };
        const grams =
          o.store && ctx.ledger ? topUp(o.store, truth, ctx.ledger, hall, people.length) : 0;
        changes.push(setComponent(SECT_HALL, org, o.store ? { ...hall, stocked: ctx.now } : hall));
        const born = events.length;
        events.push({
          kind: SECT_HALL_EVENT,
          actors: people.map((x) => x.person),
          place: seatRef(sect.seatPlace),
          data: { org, people: people.length, ...(grams > 0 ? { stored: grams } : {}) },
          emissions: {},
          causes: [
            { kind: "event", event: sect.originEventId },
            { kind: "state", entity: who.p, key: LOCATION.name },
          ],
        });
        // El tesoro llega a la carne con la despensa y una reserva; de ahí se llena la despensa.
        if (o.store && ctx.ledger) {
          const reserve = Math.ceil(dailyGrams(o.store, people.length) * TREASURY_RESERVE_DAYS);
          restock(
            o.store,
            org,
            sect.seatPlace,
            house,
            {
              grams: grams + reserve,
              coin: o.store.coin ? people.length * TRIBUTE_COIN_PER_HEAD * 4 : 0,
              endowment: true,
            },
            grams,
            {
              balance: ctx.ledger.balance(treasuryAccount(org), o.store.unit),
              events,
              postings,
              causes: [{ kind: "event", event: draftEvent(born) }],
            },
          );
        }
      }
      if (changes.length === 0 && events.length === 0) return {};
      return { changes, events, ...(postings.length > 0 ? { postings } : {}) };
    },
  };
}

/** La mente, la cultura, las habilidades y los gustos de un adulto que llega de una ranura. */
function mindOf(
  m: SectHallMind,
  traits: readonly Trait[],
  truth: ReadonlyWorldTruth,
  key: EntityRef,
  slot: { readonly sex: "female" | "male"; readonly born: Tick },
  innate: Readonly<Record<string, number>>,
  rng: Rng,
  event: ReturnType<typeof draftEvent>,
  now: Tick,
): StateChange[] {
  const out: StateChange[] = [
    setComponent(MIND, key, newMind(m.schemas, innate, rng.fork("psyche"), event as never)),
  ];
  const community = villageCulture(truth);
  if (community) {
    out.push(
      setComponent(
        PERSON_CULTURE,
        key,
        seedPersonCulture(
          {
            community,
            traits: m.cultureTraits,
            parents: [],
            since: slot.born,
            originEventId: event as never,
          },
          rng.fork("person-culture"),
        ),
      ),
    );
  }
  const z = standardize(innate, traits, slot.sex);
  const skills = upbringingSkills(m.skills, z, slot.born, now, m.clock);
  out.push(
    setComponent(SKILL_STATE, key, skills),
    setComponent(SELF_IMAGES, key, seedSelfImages(m.skills, skills, z, now)),
    setComponent(
      TASTES_OF,
      key,
      newTastes(
        m.tastes,
        tasteWorld(m.tastes, practicesOfKind(villageReligion(truth), "taboo")),
        innate,
        undefined,
        rng.fork("tastes"),
        event as never,
      ),
    ),
  );
  return out;
}

function seatRef(place: EntityRef): PlaceRef {
  return { kind: "place", place: place as unknown as PlaceId };
}

/** Cuántos de la gente de la sede siguen vivos. */
function aliveIn(truth: ReadonlyWorldTruth, hall: SectHall): number {
  return hall.people.filter(
    (x) => truth.get(ENTITY, x.person as unknown as EntityRef)?.endedAt === undefined,
  ).length;
}

/** Los gramos que comen por día `alive` personas. */
function dailyGrams(store: SectStore, alive: number): number {
  return (alive * 3 * MEAL_KCAL) / store.kcalPerGram;
}

/** Los gramos que faltan para que la despensa tenga `days` días de comida de los vivos. */
function topUp(
  store: SectStore,
  truth: ReadonlyWorldTruth,
  ledger: { balance(account: LedgerAccount, unit: LedgerUnit): number },
  hall: SectHall,
  alive = aliveIn(truth, hall),
): number {
  const want = Math.ceil(dailyGrams(store, alive) * store.days);
  const have = ledger.balance(holderAccount(hall.house as unknown as HolderRef), store.unit);
  return Math.max(0, want - have);
}

/**
 * Entra el tributo al tesoro de la secta (desde la fuente externa `sect.upkeep`) y de ahí sale lo
 * que falta en la despensa, hasta donde alcance: si el tesoro no da, la despensa queda corta y se
 * anota cuánto (novel-sect-duty-treasury).
 */
function restock(
  store: SectStore,
  org: EntityRef,
  seat: EntityRef,
  house: HouseholdId,
  tribute: { readonly grams: number; readonly coin: number; readonly endowment?: boolean },
  want: number,
  out: {
    readonly balance: number;
    readonly events: EventDraft[];
    readonly postings: PostingDraft[];
    readonly causes: EventDraft["causes"];
  },
): void {
  const treasury = treasuryAccount(org);
  let causes = out.causes;
  if (tribute.grams > 0 || tribute.coin > 0) {
    const at = out.events.length;
    out.postings.push({
      event: draftEvent(at),
      transfers: [
        ...(tribute.grams > 0
          ? [
              {
                unit: store.unit,
                from: externalAccount(SECT_UPKEEP),
                to: treasury,
                amount: tribute.grams,
              },
            ]
          : []),
        ...(store.coin && tribute.coin > 0
          ? [
              {
                unit: store.coin,
                from: externalAccount(SECT_UPKEEP),
                to: treasury,
                amount: tribute.coin,
              },
            ]
          : []),
      ],
    });
    out.events.push({
      kind: SECT_TRIBUTE_EVENT,
      actors: [],
      place: seatRef(seat),
      data: {
        org,
        good: store.unit,
        grams: tribute.grams,
        ...(store.coin ? { coin: store.coin, amount: tribute.coin } : {}),
        ...(tribute.endowment ? { endowment: true } : {}),
      },
      emissions: {},
      causes,
    });
    causes = [{ kind: "event", event: draftEvent(at) }];
  }
  const pay = Math.min(want, out.balance + tribute.grams);
  if (want <= 0) return;
  const at = out.events.length;
  if (pay > 0)
    out.postings.push({
      event: draftEvent(at),
      transfers: [
        {
          unit: store.unit,
          from: treasury,
          to: holderAccount(house as unknown as HolderRef),
          amount: pay,
        },
      ],
    });
  out.events.push({
    kind: SECT_UPKEEP_EVENT,
    actors: [],
    place: seatRef(seat),
    data: { org, good: store.unit, grams: pay, ...(pay < want ? { short: want - pay } : {}) },
    emissions: {},
    causes,
  });
}

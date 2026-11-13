// Las hierbas espirituales día a día (novel2-pills-herbs): en cada lugar de monte o en la sede, lo que
// hay en pie de cada hierba vive en la cuenta del lugar en el libro mayor (fuente `herb`) y de ahí lo
// toma `gather` cuando se nombra («junto hierbas espirituales»). Cada día rebrota hacia el techo que
// da el qi del lugar (`herbCapacity`): la reserva propia si la tiene (la sede), si no la del plano.
// Lo juntado ya no está; si se deja, vuelve.
//
// El qi de las hierbas (novel2-alch-qi): crecer saca `qiPerGram` por gramo de la reserva de la celda
// (débito en `QI_TAKEN`, hasta lo que queda) y lo que se seca lo devuelve. La alquimia de la secta
// (novel2-alch-sect) corre acá, una vez por semana en cada sede: cosecha `HERB_HARVEST_SHARE` de lo
// que hay en pie al tesoro y el anciano o maestro vivo con mejor mano refina lo que falta para tener
// `endowPerHead` píldoras por cabeza; lo que se quema pasa al horno (`sect.furnace`) y de ahí salen
// las píldoras con el qi de sus hierbas; el resto del qi (lo fallido, lo que no se lleva una de romper)
// vuelve a la celda de la sede. Lo que se tragó y no cupo ya vuelve en `meditate.ts`.
//
// Lo que se pudre (novel2-alch-rot): con `rot`, las hierbas juntadas que lleva cada uno o guarda su
// casa se pudren acá con la vida media de su bien (no en `life.spoilage`) y su qi vuelve a la reserva
// del lugar donde se pudren: la propia si el que las lleva está en un lugar con reserva (la sede), si
// no la del plano. Lo podrido va al sumidero `rotted` como cualquier comida. El tesoro de la secta
// todavía no se pudre (tampoco lo pudre `life.spoilage`).

import {
  type AgentId,
  type EntityRef,
  externalAccount,
  type HolderRef,
  holderAccount,
  type LedgerAccount,
  type LedgerUnit,
  ledgerUnit,
  type PlaceId,
  type PlaceRef,
  Rng,
} from "../../core/index.ts";
import {
  CULTIVATION_LAW,
  draftEvent,
  ENTITY,
  type GoodDef,
  HERB_STAND,
  type HerbDef,
  type HerbStand,
  herbCapacity,
  LOCATION,
  PERSON,
  type PillDef,
  PLACE,
  PLACE_QI,
  type PlaceQi,
  type ProcessDef,
  type ProcessResult,
  QI_TAKEN,
  type QiTaken,
  type ReadonlyWorldTruth,
  ROTTED,
  refineBatch,
  refineReleasedQi,
  regrowHerb,
  regrown,
  SECT,
  SECT_MEMBER,
  SKILL_STATE,
  type SkillDef,
  setComponent,
  skillLevel,
  spoilage,
} from "../../sim/index.ts";
import { SECT_HALL, type SectHall, treasuryAccount } from "./sect-hall.ts";
import { householdsOf } from "./spoilage.ts";

export const HERBS_PROCESS = "cultivation.herbs";
/** Fuente del ledger de las hierbas espirituales (lo que crece del qi del lugar). */
export const HERB_SOURCE = "herb";
export const HERBS_GREW_EVENT = "cultivation.herbs_grew";
/** Hierbas juntadas que se pudrieron y devolvieron su qi (novel2-alch-rot). */
export const HERBS_ROTTED_EVENT = "cultivation.herbs_rotted";
/** Fuente externa del horno de la secta: entran hierbas, salen píldoras (novel2-alch-sect). */
export const SECT_FURNACE = "sect.furnace";
export const SECT_ALCHEMY_EVENT = "cultivation.sect_alchemy";
/** Qué parte de lo que hay en pie en la sede cosecha la secta cada semana. */
export const HERB_HARVEST_SHARE = 0.5;
/** Cada cuántos días cosecha y refina la secta. */
export const BREW_EVERY_DAYS = 7;

/** Dónde crecen: el monte y la sede. */
const HERB_PLACES: ReadonlySet<string> = new Set(["forest", "sect"]);

type Transfer = NonNullable<ProcessResult["postings"]>[number]["transfers"][number];
type Change = NonNullable<ProcessResult["changes"]>[number];
type Draft = NonNullable<ProcessResult["events"]>[number];
type Posting = NonNullable<ProcessResult["postings"]>[number];

/** Lo que necesita la alquimia semanal de la secta (novel2-alch-sect). */
export interface SectAlchemy {
  readonly pills: readonly PillDef[];
  /** El saber hacer que da la mano del alquimista; sin él, la mano es 0. */
  readonly skill?: SkillDef;
}

/** Lo que necesitan las hierbas juntadas para pudrirse (novel2-alch-rot). */
export interface HerbRot {
  /** El catálogo de bienes, de donde sale la vida media. */
  readonly goods: readonly GoodDef[];
  /** Dónde poner el evento de cada uno. */
  readonly placeOf: (truth: ReadonlyWorldTruth, who: AgentId) => PlaceRef;
}

export function herbsProcess(o: {
  readonly dayTicks: number;
  /** Ticks por año, para la regeneración de la celda (novel2-alch-qi). */
  readonly yearTicks: number;
  readonly herbs: readonly HerbDef[];
  /** La secta cosecha y refina en su sede (novel2-alch-sect). */
  readonly alchemy?: SectAlchemy;
  /** Las hierbas juntadas se pudren acá y devuelven su qi (novel2-alch-rot). */
  readonly rot?: HerbRot;
}): ProcessDef {
  return {
    id: HERBS_PROCESS,
    system: "cultivation",
    scope: "world",
    cadence: { local: "day", scene: "day" },
    representation: "individual",
    phase: "settle",
    reads: [
      CULTIVATION_LAW.name,
      PLACE.name,
      PLACE_QI.name,
      HERB_STAND.name,
      QI_TAKEN.name,
      ...(o.alchemy
        ? [SECT.name, SECT_HALL.name, SECT_MEMBER.name, ENTITY.name, SKILL_STATE.name]
        : []),
      ...(o.rot ? [PERSON.name, LOCATION.name, ...(o.alchemy ? [] : [ENTITY.name])] : []),
    ],
    writes: [HERB_STAND.name, QI_TAKEN.name],
    run(ctx) {
      const plane = ctx.truth.ids(CULTIVATION_LAW)[0];
      const ledger = ctx.ledger;
      if (plane === undefined || !ledger || o.herbs.length === 0) return {};
      const days = Math.max(1, ctx.window) / o.dayTicks;
      const changes: Change[] = [];
      const events: Draft[] = [];
      const postings: Posting[] = [];
      /** Las reservas tocadas: su fila repuesta hasta hoy y lo que cambió. */
      const pools = new Map<EntityRef, { place: PlaceQi; row: QiTaken; dirty: boolean }>();
      const poolOf = (id: EntityRef, place: PlaceQi) => {
        let pool = pools.get(id);
        if (!pool) {
          const row = ctx.truth.get(QI_TAKEN, id);
          pool = {
            place,
            row: row
              ? regrown(row, place, ctx.now, o.yearTicks)
              : { taken: 0, drawn: 0, at: ctx.now },
            dirty: false,
          };
          pools.set(id, pool);
        }
        return pool;
      };
      const settle = (pool: { row: QiTaken; dirty: boolean }, drawn: number, back: number) => {
        if (drawn === 0 && back === 0) return;
        pool.row = {
          ...pool.row,
          taken: round4(Math.max(0, pool.row.taken + drawn - back)),
          drawn: round4(pool.row.drawn + drawn),
        };
        pool.dirty = true;
      };
      /** Lo que quedó en pie en cada lugar esta corrida (para la cosecha de la sede). */
      const stands = new Map<EntityRef, HerbStand>();
      const places = ctx.truth
        .ids(PLACE)
        .filter((p) => HERB_PLACES.has(ctx.truth.get(PLACE, p)?.kind ?? ""))
        .sort();
      for (const p of places) {
        const own = ctx.truth.get(PLACE_QI, p);
        const poolId = own ? p : plane;
        const qi = own ?? ctx.truth.get(PLACE_QI, plane);
        if (!qi) continue;
        const pool = poolOf(poolId as EntityRef, qi);
        const account = holderAccount({ kind: "place", place: p as unknown as PlaceId });
        const prev = ctx.truth.get(HERB_STAND, p);
        const standing: Record<string, number> = {};
        const transfers: Transfer[] = [];
        const grew: Record<string, number> = {};
        let drawn = 0;
        let back = 0;
        for (const herb of o.herbs) {
          const unit = ledgerUnit(`good:${herb.good}`);
          const cap = herbCapacity(herb, qi);
          const held = Math.floor(ledger.balance(account, unit));
          // Lo que había, menos lo que se juntó desde ayer (la cuenta bajó); la primera vez, el techo.
          const was = prev?.standing[herb.id];
          let now =
            was === undefined
              ? cap
              : regrowHerb(herb, Math.max(0, was - (Math.floor(was) - held)), cap, days);
          // Crecer saca qi de la celda: no más de lo que queda en ella.
          const inCell = Math.max(0, qi.level - pool.row.taken - drawn + back);
          const room = held + Math.floor(inCell / herb.qiPerGram);
          if (Math.floor(now) > room) now = room;
          if (now <= 0 && held <= 0) continue;
          standing[herb.id] = now;
          const delta = Math.floor(now) - held;
          if (delta === 0) continue;
          grew[herb.id] = delta;
          if (delta > 0) drawn += delta * herb.qiPerGram;
          else back += -delta * herb.qiPerGram;
          transfers.push(
            delta > 0
              ? { unit, from: externalAccount(HERB_SOURCE), to: account, amount: delta }
              : { unit, from: account, to: externalAccount(HERB_SOURCE), amount: -delta },
          );
        }
        if (Object.keys(standing).length === 0 && !prev) continue;
        const stand: HerbStand = {
          standing,
          day: ctx.now,
          ...(prev?.brewed !== undefined ? { brewed: prev.brewed } : {}),
        };
        stands.set(p as EntityRef, stand);
        settle(pool, round4(drawn), round4(back));
        if (transfers.length === 0) continue;
        const i = events.length;
        events.push({
          kind: HERBS_GREW_EVENT,
          actors: [],
          place: { kind: "place", place: p as unknown as PlaceId },
          data: {
            grew,
            ...(drawn > 0 ? { qi: round4(drawn) } : {}),
            ...(back > 0 ? { back: round4(back) } : {}),
          },
          emissions: {},
          causes: [{ kind: "state", entity: poolId as EntityRef, key: PLACE_QI.name }],
        });
        postings.push({ event: draftEvent(i), transfers });
      }
      // La alquimia de la semana en cada sede.
      for (const org of o.alchemy ? ctx.truth.ids(SECT) : []) {
        const alchemy = o.alchemy as SectAlchemy;
        const sect = ctx.truth.get(SECT, org);
        const hall = ctx.truth.get(SECT_HALL, org);
        const seat = sect?.seatPlace as EntityRef | undefined;
        const stand = seat === undefined ? undefined : stands.get(seat);
        const qi = seat === undefined ? undefined : ctx.truth.get(PLACE_QI, seat);
        if (!sect || !hall || seat === undefined || !stand || !qi) continue;
        if (stand.brewed !== undefined && ctx.now - stand.brewed < BREW_EVERY_DAYS * o.dayTicks)
          continue;
        const next = brew(alchemy, o.herbs, ctx.truth, ledger, {
          rng: Rng.root(ctx.rng.seed).fork("alchemy", ctx.now),
          org: org as EntityRef,
          seat,
          hall,
          stand,
          events,
          postings,
        });
        settle(poolOf(seat, qi), 0, next.back);
        stands.set(seat, { ...next.stand, brewed: ctx.now });
      }
      if (o.rot) {
        const planeQi = ctx.truth.get(PLACE_QI, plane);
        const rows = planeQi
          ? rotHerbs(ctx.truth, ledger, o.herbs, o.rot, days, ctx.rng, plane as EntityRef, planeQi)
          : [];
        for (const r of rows) {
          settle(poolOf(r.pool, r.qi), 0, r.back);
          const i = events.length;
          events.push(r.event);
          postings.push({ event: draftEvent(i), transfers: r.transfers });
        }
      }
      for (const [p, stand] of stands) changes.push(setComponent(HERB_STAND, p, stand));
      for (const [id, pool] of pools)
        if (pool.dirty) changes.push(setComponent(QI_TAKEN, id, pool.row));
      return {
        ...(changes.length > 0 ? { changes } : {}),
        ...(events.length > 0 ? { events, postings } : {}),
      };
    },
  };
}

/**
 * Una semana de alquimia en una sede: la cosecha (cuenta del lugar → tesoro), el refinado (tesoro →
 * horno → tesoro) y el qi que vuelve a la celda. Devuelve lo que quedó en pie y ese qi.
 */
function brew(
  alchemy: SectAlchemy,
  herbs: readonly HerbDef[],
  truth: ReadonlyWorldTruth,
  ledger: { balance(account: LedgerAccount, unit: LedgerUnit): number },
  at: {
    readonly rng: Rng;
    readonly org: EntityRef;
    readonly seat: EntityRef;
    readonly hall: SectHall;
    readonly stand: HerbStand;
    readonly events: Draft[];
    readonly postings: Posting[];
  },
): { stand: HerbStand; back: number } {
  const treasury = treasuryAccount(at.org);
  const field = holderAccount({ kind: "place", place: at.seat as unknown as PlaceId });
  const furnace = externalAccount(SECT_FURNACE);
  const transfers: Transfer[] = [];
  const harvested: Record<string, number> = {};
  const standing: Record<string, number> = { ...at.stand.standing };
  const inTreasury = new Map<string, number>();
  for (const herb of herbs) {
    const unit = ledgerUnit(`good:${herb.good}`);
    const up = Math.floor(standing[herb.id] ?? 0);
    const cut = Math.floor(up * HERB_HARVEST_SHARE);
    if (cut > 0) {
      transfers.push({ unit, from: field, to: treasury, amount: cut });
      harvested[herb.id] = cut;
      standing[herb.id] = (standing[herb.id] ?? 0) - cut;
    }
    inTreasury.set(herb.id, Math.max(0, ledger.balance(treasury, unit)) + cut);
  }
  // El alquimista: el anciano o maestro vivo con mejor mano.
  let alchemist: AgentId | undefined;
  let hand = 0;
  for (const { person } of at.hall.people) {
    const ref = person as unknown as EntityRef;
    if (truth.get(ENTITY, ref)?.endedAt !== undefined) continue;
    const member = truth.get(SECT_MEMBER, ref);
    if (member?.org !== at.org || (member.rank !== "elder" && member.rank !== "master")) continue;
    const skill = alchemy.skill;
    const level = skill ? skillLevel(skill, truth.get(SKILL_STATE, ref)?.[skill.id]) : 0;
    if (alchemist === undefined || level > hand) {
      alchemist = person;
      hand = level;
    }
  }
  hand = Math.min(1, Math.max(0, hand));
  const alive = at.hall.people.filter(
    (x) => truth.get(ENTITY, x.person as unknown as EntityRef)?.endedAt === undefined,
  ).length;
  const refined: { pill: string; attempts: number; made: number; used: number }[] = [];
  let back = 0;
  for (const pill of alchemist === undefined ? [] : alchemy.pills) {
    const recipe = pill.recipe;
    const herb = recipe ? herbs.find((h) => h.id === recipe.herb) : undefined;
    if (!recipe || !herb) continue;
    const unit = ledgerUnit(`good:${pill.good}`);
    const need = Math.ceil((pill.endowPerHead ?? 0) * alive) - ledger.balance(treasury, unit);
    const have = inTreasury.get(herb.id) ?? 0;
    if (need <= 0 || have < recipe.grams) continue;
    const r = refineBatch(pill, Math.min(have, need * recipe.grams), hand, at.rng.fork(pill.id));
    if (r.attempts === 0) continue;
    inTreasury.set(herb.id, have - r.used);
    transfers.push({
      unit: ledgerUnit(`good:${herb.good}`),
      from: treasury,
      to: furnace,
      amount: r.used,
    });
    if (r.made > 0) transfers.push({ unit, from: furnace, to: treasury, amount: r.made });
    back += refineReleasedQi(pill, r, herb.qiPerGram);
    refined.push({ pill: pill.id, ...r });
  }
  const stand: HerbStand = { ...at.stand, standing };
  if (transfers.length === 0) return { stand, back: 0 };
  const i = at.events.length;
  at.postings.push({ event: draftEvent(i), transfers });
  const brewer = alchemist !== undefined && refined.length > 0 ? alchemist : undefined;
  at.events.push({
    kind: SECT_ALCHEMY_EVENT,
    actors: brewer === undefined ? [] : [brewer],
    place: { kind: "place", place: at.seat as unknown as PlaceId },
    data: {
      org: at.org,
      harvested,
      refined,
      ...(brewer === undefined ? {} : { hand, qiBack: round4(back) }),
    },
    emissions: {},
    causes: [
      { kind: "state", entity: at.org, key: SECT.name },
      ...(brewer === undefined
        ? []
        : [
            {
              kind: "state" as const,
              entity: brewer as unknown as EntityRef,
              key: SKILL_STATE.name,
            },
          ]),
    ],
  });
  return { stand, back: round4(back) };
}

function round4(x: number): number {
  return Math.round(x * 1e4) / 1e4;
}

/** Lo que se pudrió de uno: a qué reserva vuelve su qi, cuánto, el evento y las transferencias. */
interface Rotted {
  readonly pool: EntityRef;
  readonly qi: PlaceQi;
  readonly back: number;
  readonly event: Draft;
  readonly transfers: Transfer[];
}

/**
 * Lo que se pudre de las hierbas juntadas (novel2-alch-rot): de cada casa con alguien vivo y de cada
 * vivo, con la vida media de su bien (`spoilage`, RNG por cuenta), y a qué reserva vuelve su qi: la
 * de un lugar con reserva propia donde está el que las lleva, si no la del plano (la casa está en la
 * aldea). Uno por quien tiene algo podrido.
 */
function rotHerbs(
  truth: ReadonlyWorldTruth,
  ledger: NonNullable<Parameters<ProcessDef["run"]>[0]["ledger"]>,
  herbs: readonly HerbDef[],
  rot: HerbRot,
  days: number,
  rng: Rng,
  plane: EntityRef,
  planeQi: PlaceQi,
): Rotted[] {
  const goods = rot.goods.filter((g) => herbs.some((h) => h.good === g.id));
  if (goods.length === 0) return [];
  const qiPer = new Map<string, number>(herbs.map((h) => [`good:${h.good}`, h.qiPerGram]));
  /** Los lugares con reserva propia y sus hexes. */
  const own = truth.ids(PLACE).flatMap((p) => {
    const qi = truth.get(PLACE_QI, p);
    const hexes = truth.get(PLACE, p)?.hexes ?? [];
    return qi && p !== plane ? [{ id: p as EntityRef, qi, hexes }] : [];
  });
  const poolAt = (hex: number | undefined): { id: EntityRef; qi: PlaceQi } =>
    (hex === undefined ? undefined : own.find((x) => x.hexes.includes(hex))) ?? {
      id: plane,
      qi: planeQi,
    };
  const alive = (truth.ids(PERSON) as unknown as AgentId[])
    .filter((id) => truth.get(ENTITY, id as unknown as EntityRef)?.endedAt === undefined)
    .sort();
  const holders: { holder: HolderRef; hex: number | undefined; at: AgentId }[] = [];
  for (const home of householdsOf(truth)) {
    const first = alive.find(
      (id) => truth.get(PERSON, id as unknown as EntityRef)?.household === (home as string),
    );
    if (first) holders.push({ holder: home as unknown as HolderRef, hex: undefined, at: first });
  }
  for (const id of alive)
    holders.push({
      holder: id as unknown as HolderRef,
      hex: truth.get(LOCATION, id as unknown as EntityRef)?.hex,
      at: id,
    });
  const out: Rotted[] = [];
  for (const { holder, hex, at } of holders) {
    const account = holderAccount(holder);
    const rows = spoilage(ledger.holdings(account), goods, days, rng.fork("herb-rot", account));
    if (rows.length === 0) continue;
    const pool = poolAt(hex);
    const back = round4(rows.reduce((s, r) => s + r.amount * (qiPer.get(r.unit) ?? 0), 0));
    const grams: Record<string, number> = {};
    for (const r of rows) grams[r.unit] = r.amount;
    out.push({
      pool: pool.id,
      qi: pool.qi,
      back,
      transfers: rows.map((r) => ({
        unit: r.unit,
        from: account,
        to: externalAccount(ROTTED),
        amount: r.amount,
      })),
      event: {
        kind: HERBS_ROTTED_EVENT,
        actors: [],
        place: rot.placeOf(truth, at),
        data: { holder, grams, ...(back > 0 ? { back } : {}) },
        emissions: {},
        causes: [
          { kind: "state", entity: holder as unknown as EntityRef, key: "spoilage" },
          { kind: "state", entity: pool.id, key: PLACE_QI.name },
        ],
      },
    });
  }
  return out;
}

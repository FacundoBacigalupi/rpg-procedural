// Las tareas de discípulo (novel-sect-duty-chore, organizations §6): en la sede, `chore` es barrer,
// hacer guardia o juntar leña para la secta. La tarea es la que dijo («barro», «hago guardia») o la del
// lugar (el portón: guardia; los salones: barrer; afuera: leña). Al terminar, si quien la hizo es de
// la secta y la hizo en su sede, se le anotan puntos de contribución (`SECT_CONTRIBUTION`, un
// derecho contra la secta) por las horas y por cómo salió; si no, trabajó de balde. Cada tarea deja
// `cultivation.sect_chore`, causado por la acción. También lleva el pase a la cueva: las horas
// meditadas adentro salen del pase (novel-sect-cave-pass) y `redeem` canjea puntos por horas de pase
// (novel-sect-duty-exchange) con `cultivation.sect_exchange`, causado por el pedido y los puntos.
// Pedir el método (novel2-method-pavilion): si lo que se canjea es una técnica, el pabellón de
// escrituras da el del reino siguiente (`methodExchange`) por puntos o por rango, con
// `cultivation.sect_exchange` (`what: "method"`) y, si lo da, `cultivation.technique_taught`.
// Las misiones (novel2-missions-ask): el `cultivation.mission_assigned` que deja el anciano al darla
// se anota acá en `SECT_MISSION` (una por miembro), con el evento como causa. Las hierbas
// (novel2-missions-herbs): dárselas a un anciano de la secta en la sede las pasa al tesoro y anota
// los puntos de lo que cuenta (`cultivation.mission_progress`, o `mission_done` si la cumple); la
// misión vencida se cae sin más puntos (`cultivation.mission_lapsed`).
// Y el permiso para bajar (novel-sect-seat-return-leave): `furlough` en la sede deja `SECT_LEAVE`
// con `cultivation.sect_leave`; la ausencia la lleva `life.sect_absence` (`sect-leave.ts`).

import {
  type AgentId,
  type EntityRef,
  type Event,
  type HolderRef,
  holderAccount,
  type ItemId,
  type LedgerUnit,
  ledgerUnit,
  type PlaceId,
} from "../../core/index.ts";
import {
  ART_KNOWN,
  BREAKTHROUGH_EVENT,
  CAVE_RANKS,
  CHORE_POINTS_PER_HOUR,
  CULTIVATION_STATE,
  CULTIVATION_TECHNIQUE,
  choreOf,
  chorePoints,
  type DecayContext,
  deleteComponent,
  draftEvent,
  ENTITY,
  type EventDraft,
  type ExchangeRefusal,
  exchangeHours,
  type HerbDef,
  ITEM_HOLD,
  ITEM_LOOK,
  ITEM_WEAR,
  isSectCave,
  type KnownTechnique,
  LOCATION,
  leaveDays,
  MASTER_OF,
  MISSION_ASSIGNED_EVENT,
  MISSION_DONE_EVENT,
  MISSION_LAPSED_EVENT,
  MISSION_PROGRESS_EVENT,
  methodExchange,
  missionCredit,
  missionLapsed,
  type PillDef,
  PLACE,
  type PostingDraft,
  PROMOTION_CHORE_HOURS,
  PROMOTION_STAGE,
  type ProcessDef,
  pillExchange,
  promotionDue,
  RANK_PETITION_EVENT,
  type ReadonlyWorldTruth,
  SECT,
  SECT_CAVE_PASS,
  SECT_CAVE_PASS_SPENT_EVENT,
  SECT_CHORE_EVENT,
  SECT_CONTRIBUTION,
  SECT_EXCHANGE_EVENT,
  SECT_LEAVE,
  SECT_LEAVE_EVENT,
  SECT_MEMBER,
  SECT_MISSION,
  SECT_PROMOTED_EVENT,
  SECT_RANK_RULING,
  SECT_SCHOOL,
  type SectCavePass,
  type SectContribution,
  type SectMission,
  type StateChange,
  setComponent,
  TECHNIQUE_TAUGHT_EVENT,
  type WeaponDef,
} from "../../sim/index.ts";
import { meditation } from "./meditate.ts";
import { RANK_REVIEW_READS, type RankIssue, reviewRank } from "./rank-review.ts";
import { treasuryAccount } from "./sect-hall.ts";

export const SECT_DUTY_PROCESS = "life.sect_duty";
/** Una hora de tareas de la rutina delegada en la sede (novel-sect-duty-routine). */
export const ROUTINE_CHORE_EVENT = "routine.chore";

/** La secta de cuya sede es el lugar donde está `who`, si es miembro de ella. */
function seatOrgOf(truth: ReadonlyWorldTruth, who: AgentId): EntityRef | undefined {
  const member = truth.get(SECT_MEMBER, who as unknown as EntityRef);
  const hex = truth.get(LOCATION, who)?.hex;
  if (!member || hex === undefined) return undefined;
  const sect = truth.get(SECT, member.org);
  const seat = sect ? truth.get(PLACE, sect.seatPlace) : undefined;
  return seat?.hexes.includes(hex) ? member.org : undefined;
}

/** Lo que se pide al canjear cuando es una técnica (lo que dejó el parser en `what`). */
const METHOD_WORDS = /t[eé]cnica|m[eé]todo|escritura|manual|sutra|canon/iu;

/** Lo que se pide al canjear cuando es una píldora. */
const PILL_WORDS = /p[ií]ldora|elixir/iu;

/** Lo que se pide al canjear cuando es un arma de la armería (novel3-weapons-sect). */
const WEAPON_WORDS = /\b(?:arma|espada|sable|lanza|palo|bast[oó]n)\b/iu;

/** La forma que pidió, si nombró una. */
const WEAPON_SHAPES: readonly (readonly [RegExp, string])[] = [
  [/espada/iu, "sword"],
  [/sable/iu, "saber"],
  [/lanza/iu, "spear"],
  [/palo|bast[oó]n/iu, "stick"],
];

/** Por qué la armería no da el arma pedida. */
export type WeaponRefusal = "not_member" | "no_stock" | "no_points";

/**
 * Canjear puntos por un arma de la armería (novel3-weapons-sect): la pide quien es de la secta,
 * tiene que quedar una de repuesto (de la forma que nombró, si nombró una) y alcanzarle los puntos.
 */
export function weaponExchange(
  member: boolean,
  points: number,
  spare: { readonly def: WeaponDef } | undefined,
): { kind: "given"; cost: number } | { kind: "refused"; refused: WeaponRefusal } {
  if (!member) return { kind: "refused", refused: "not_member" };
  if (!spare || spare.def.points === undefined) return { kind: "refused", refused: "no_stock" };
  if (spare.def.points > points) return { kind: "refused", refused: "no_points" };
  return { kind: "given", cost: spare.def.points };
}

/** Las armas de repuesto de la secta `org` (suyas, sin gastar), de la forma pedida si la hay. */
function spareWeapon(
  truth: ReadonlyWorldTruth,
  org: EntityRef,
  weapons: readonly WeaponDef[],
  asked: string | undefined,
  handed: ReadonlySet<string>,
): { item: ItemId; def: WeaponDef } | undefined {
  const byShape = new Map(weapons.map((w) => [w.shape, w]));
  for (const item of [...truth.ids(ITEM_HOLD)].sort() as ItemId[]) {
    if (handed.has(item)) continue;
    if (truth.get(ITEM_HOLD, item)?.possession !== (org as unknown as HolderRef)) continue;
    if (truth.get(ENTITY, item)?.endedAt !== undefined) continue;
    const def = byShape.get(truth.get(ITEM_LOOK, item)?.shape ?? "");
    if (!def || def.points === undefined || (asked !== undefined && def.shape !== asked)) continue;
    if ((truth.get(ITEM_WEAR, item)?.wear ?? 0) >= 1) continue;
    return { item, def };
  }
  return undefined;
}

const fold = (s: string) => s.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();

/** La píldora que nombra lo pedido (la de más palabras en común; si no dice cuál, la primera). */
function pillNamed(
  pills: readonly { readonly def: PillDef; readonly name: string }[],
  what: string,
): PillDef | undefined {
  const words = fold(what)
    .split(/[^\p{L}]+/u)
    .filter((w) => w.length > 2 && w !== "pildora" && w !== "una" && w !== "del");
  let best: PillDef | undefined;
  let score = -1;
  for (const p of pills) {
    const name = fold(p.name);
    const s = words.filter((w) => name.includes(w)).length;
    if (s > score) {
      best = p.def;
      score = s;
    }
  }
  return best;
}

/** Quién hizo tareas, cuántas horas y qué dijo que hacía, de un `action.chore`. */
function choreDone(e: Event): { who: AgentId; hours: number; said?: string } | undefined {
  if (e.kind !== "action.chore" && e.kind !== ROUTINE_CHORE_EVENT) return undefined;
  const who = e.actors[0] as AgentId | undefined;
  const data = e.data as { seconds?: unknown; effect?: { what?: unknown } } | null;
  const seconds = data?.seconds;
  if (!who || typeof seconds !== "number" || seconds <= 0) return undefined;
  const said = data?.effect?.what;
  return { who, hours: seconds / 3600, ...(typeof said === "string" ? { said } : {}) };
}

/** Escritor de `SECT_CONTRIBUTION` (cableado con el cultivo); `dayTicks` para los días de permiso. */
export function sectDutyProcess(
  o: {
    readonly dayTicks?: number;
    /** Las píldoras que canjea el tesoro, con el nombre de su bien (novel2-pills-exchange). */
    readonly pills?: readonly { readonly def: PillDef; readonly name: string }[];
    /** Las relaciones con las que los ancianos sienten al candidato (novel2-rank-review). */
    readonly relations?: Pick<DecayContext, "dims" | "bonds">;
    /** Las hierbas que piden las misiones, con su bien (novel2-missions-herbs). */
    readonly herbs?: readonly HerbDef[];
    /** Las armas que canjea la armería (novel3-weapons-sect); sin esto no se canjean. */
    readonly weapons?: readonly WeaponDef[];
  } = {},
): ProcessDef {
  const day = o.dayTicks ?? 86_400;
  return {
    id: SECT_DUTY_PROCESS,
    system: "life",
    scope: "world",
    cadence: { local: "onEvent", scene: "onEvent" },
    representation: "individual",
    phase: "perceive",
    reads: [
      SECT_MEMBER.name,
      SECT.name,
      PLACE.name,
      LOCATION.name,
      SECT_CONTRIBUTION.name,
      SECT_CAVE_PASS.name,
      CULTIVATION_STATE.name,
      CULTIVATION_TECHNIQUE.name,
      SECT_SCHOOL.name,
      ...RANK_REVIEW_READS,
      ...(o.weapons ? [ITEM_HOLD.name, ITEM_LOOK.name, ITEM_WEAR.name, ENTITY.name] : []),
    ],
    writes: [
      SECT_MISSION.name,
      SECT_RANK_RULING.name,
      SECT_CONTRIBUTION.name,
      SECT_CAVE_PASS.name,
      SECT_MEMBER.name,
      SECT_LEAVE.name,
      CULTIVATION_TECHNIQUE.name,
      ART_KNOWN.name,
      ...(o.weapons ? [ITEM_HOLD.name, LOCATION.name] : []),
    ],
    run(ctx) {
      const changes: StateChange[] = [];
      const events: EventDraft[] = [];
      const rows = new Map<AgentId, SectContribution>();
      // `null`: el pase se acabó y se borra.
      const passes = new Map<AgentId, SectCavePass | null>();
      const passOf = (who: AgentId) =>
        passes.has(who)
          ? (passes.get(who) ?? undefined)
          : ctx.truth.get(SECT_CAVE_PASS, who as unknown as EntityRef);
      const pointsOf = (who: AgentId) =>
        rows.get(who) ?? ctx.truth.get(SECT_CONTRIBUTION, who as unknown as EntityRef);
      /** Los métodos que dio el pabellón en esta corrida. */
      const taught = new Map<AgentId, KnownTechnique>();
      const postings: PostingDraft[] = [];
      /** Las píldoras que salieron de cada tesoro en esta corrida (`org|unidad`). */
      const sold = new Map<string, number>();
      /** Las armas que dio la armería en esta corrida. */
      const handed = new Set<string>();
      // Quién pudo haber llegado al ascenso en esta corrida, y por qué evento.
      const maybe = new Map<AgentId, Event>();
      // Los asuntos de ascenso que alguien planteó en este paso (novel2-rank-review).
      const issues: RankIssue[] = [];
      // Las misiones tocadas en esta corrida (null: se cerró).
      const missions = new Map<AgentId, SectMission | null>();
      const missionOf = (who: AgentId) =>
        missions.has(who)
          ? missions.get(who)
          : ctx.truth.get(SECT_MISSION, who as unknown as EntityRef);
      for (const e of ctx.recent) {
        if (e.kind === MISSION_ASSIGNED_EVENT) {
          const d = e.data as Omit<SectMission, "at" | "done" | "cause"> | null;
          const who = e.actors[0] as AgentId | undefined;
          if (who !== undefined && d)
            missions.set(who, { ...d, at: ctx.now, done: 0, cause: e.id });
          continue;
        }
        if (e.kind === "action.give" && e.outcome !== "failure") {
          const delivered = herbDelivery(ctx.truth, e, missionOf, o.herbs ?? []);
          if (!delivered) continue;
          const { who, to, mission, unit, grams } = delivered;
          const credit = missionCredit(mission, grams);
          const before = pointsOf(who);
          const same = before?.org === mission.org ? before : undefined;
          rows.set(who, {
            org: mission.org,
            points: round2((same?.points ?? 0) + credit.points),
            hours: same?.hours ?? 0,
            last: ctx.now,
          });
          const done = mission.done + credit.counted;
          missions.set(who, credit.complete ? null : { ...mission, done });
          const at = events.length;
          postings.push({
            event: draftEvent(at),
            transfers: [
              {
                unit,
                from: holderAccount(to as unknown as HolderRef),
                to: treasuryAccount(mission.org),
                amount: grams,
              },
            ],
          });
          events.push({
            kind: credit.complete ? MISSION_DONE_EVENT : MISSION_PROGRESS_EVENT,
            actors: [who, to],
            place: e.place,
            data: {
              org: mission.org,
              kind: mission.kind,
              herb: mission.herb,
              grams,
              counted: credit.counted,
              done,
              of: mission.grams,
              points: credit.points,
            },
            emissions: {},
            causes: [
              { kind: "event", event: e.id },
              ...(mission.cause ? [{ kind: "event" as const, event: mission.cause }] : []),
              { kind: "state", entity: who as unknown as EntityRef, key: SECT_MISSION.name },
            ],
          });
          continue;
        }
        if (e.kind === RANK_PETITION_EVENT) {
          const d = e.data as { org?: EntityRef; refused?: unknown } | null;
          const [who, raisedBy] = e.actors as AgentId[];
          if (who && raisedBy && d?.org !== undefined && d.refused === undefined) {
            issues.push({
              who,
              org: d.org,
              raisedBy,
              cause: e.id,
              place: e.place,
            });
          }
          continue;
        }
        if (e.kind === BREAKTHROUGH_EVENT && e.actors[0]) maybe.set(e.actors[0] as AgentId, e);
        // El permiso para bajar (novel-sect-seat-return-leave): lo da la secta al que es de ella.
        if (e.kind === "action.furlough" && e.outcome !== "failure") {
          const who = e.actors[0] as AgentId | undefined;
          if (!who) continue;
          const wanted = (e.data as { effect?: { days?: unknown } } | null)?.effect?.days;
          const org = seatOrgOf(ctx.truth, who);
          const days = leaveDays(typeof wanted === "number" ? wanted : null);
          const until = ctx.now + days * day;
          if (org) changes.push(setComponent(SECT_LEAVE, who, { org, from: ctx.now, until }));
          events.push({
            kind: SECT_LEAVE_EVENT,
            actors: [who],
            place: e.place,
            data: org ? { org, days, until } : { refused: "not_member" },
            emissions: {},
            causes: [{ kind: "event", event: e.id }],
          });
          continue;
        }
        // El canje de aportes por horas de pase (novel-sect-duty-exchange).
        if (e.kind === "action.redeem" && e.outcome !== "failure") {
          const who = e.actors[0] as AgentId | undefined;
          if (!who) continue;
          const effect = (e.data as { effect?: { hours?: unknown; what?: unknown } } | null)
            ?.effect;
          const wanted = effect?.hours;
          const org = seatOrgOf(ctx.truth, who);
          const member = ctx.truth.get(SECT_MEMBER, who as unknown as EntityRef);
          const have = pointsOf(who);
          // Una píldora del tesoro (novel2-pills-exchange), por el libro mayor.
          if (typeof effect?.what === "string" && PILL_WORDS.test(effect.what) && o.pills) {
            const pill = pillNamed(o.pills, effect.what);
            const unit = pill ? ledgerUnit(`good:${pill.good}`) : undefined;
            const key = `${org}|${unit}`;
            const stock =
              org && unit && ctx.ledger
                ? ctx.ledger.balance(treasuryAccount(org), unit) - (sold.get(key) ?? 0)
                : 0;
            const points = have?.org === org ? (have?.points ?? 0) : 0;
            const r = pillExchange(pill, !!(org && member), points, stock);
            const at = events.length;
            if (r.kind === "given" && org && unit && have) {
              rows.set(who, { ...have, points: round2(have.points - r.cost), last: ctx.now });
              sold.set(key, (sold.get(key) ?? 0) + 1);
              postings.push({
                event: draftEvent(at),
                transfers: [
                  {
                    unit,
                    from: treasuryAccount(org),
                    to: holderAccount(who as unknown as HolderRef),
                    amount: 1,
                  },
                ],
              });
            }
            events.push({
              kind: SECT_EXCHANGE_EVENT,
              actors: [who],
              place: e.place,
              data: {
                ...(org ? { org } : {}),
                what: "pill",
                ...(pill ? { pill: pill.id } : {}),
                ...(r.kind === "given" ? { points: r.cost } : { refused: r.refused, points: 0 }),
              },
              emissions: {},
              causes: [
                { kind: "event", event: e.id },
                ...(r.kind === "given"
                  ? [{ kind: "state" as const, entity: who, key: SECT_CONTRIBUTION.name }]
                  : []),
              ],
            });
            continue;
          }
          // La armería (novel3-weapons-sect): un arma de repuesto pasa a la mano de quien canjea.
          if (typeof effect?.what === "string" && WEAPON_WORDS.test(effect.what) && o.weapons) {
            const asked = WEAPON_SHAPES.find(([re]) => re.test(effect.what as string))?.[1];
            const spare = org ? spareWeapon(ctx.truth, org, o.weapons, asked, handed) : undefined;
            const points = have?.org === org ? (have?.points ?? 0) : 0;
            const r = weaponExchange(!!(org && member), points, spare);
            if (r.kind === "given" && spare && have) {
              rows.set(who, { ...have, points: round2(have.points - r.cost), last: ctx.now });
              handed.add(spare.item);
              const hold = ctx.truth.get(ITEM_HOLD, spare.item);
              changes.push(
                setComponent(ITEM_HOLD, spare.item, {
                  possession: who as unknown as HolderRef,
                  rights: hold?.rights ?? [],
                }),
                deleteComponent(LOCATION, spare.item),
              );
            }
            events.push({
              kind: SECT_EXCHANGE_EVENT,
              actors: [who],
              place: e.place,
              data: {
                ...(org ? { org } : {}),
                what: "weapon",
                ...(asked ? { asked } : {}),
                ...(r.kind === "refused"
                  ? { refused: r.refused, points: 0 }
                  : { item: spare?.item, shape: spare?.def.shape, points: r.cost }),
              },
              emissions: {},
              causes: [
                { kind: "event", event: e.id },
                ...(r.kind === "given" && spare
                  ? [
                      { kind: "state" as const, entity: who, key: SECT_CONTRIBUTION.name },
                      { kind: "state" as const, entity: spare.item, key: ITEM_HOLD.name },
                    ]
                  : []),
              ],
            });
            continue;
          }
          // El pabellón de escrituras (novel2-method-pavilion): el método del reino siguiente.
          if (typeof effect?.what === "string" && METHOD_WORDS.test(effect.what)) {
            const school = org ? ctx.truth.get(SECT_SCHOOL, org) : undefined;
            const known = taught.get(who) ?? ctx.truth.get(CULTIVATION_TECHNIQUE, who);
            const stage = ctx.truth.get(CULTIVATION_STATE, who)?.stage ?? 0;
            const points = have?.org === org ? (have?.points ?? 0) : 0;
            const r =
              org && member && school
                ? methodExchange(
                    school,
                    known?.org === org ? known : undefined,
                    member.rank,
                    stage,
                    points,
                  )
                : ({ kind: "refused", refused: "not_member" } as const);
            if (r.kind === "given" && org) {
              if (have && r.cost > 0)
                rows.set(who, { ...have, points: round2(have.points - r.cost), last: ctx.now });
              taught.set(who, {
                org,
                name: r.method.name,
                factor: r.method.factor,
                learnedAt: ctx.now,
                realm: r.method.realm,
              });
            }
            const exchange = {
              kind: SECT_EXCHANGE_EVENT,
              actors: [who],
              place: e.place,
              data: {
                ...(org ? { org } : {}),
                what: "method",
                ...(r.kind === "given"
                  ? { realm: r.method.realm, technique: r.method.name, points: r.cost }
                  : {
                      refused: r.refused,
                      points: 0,
                      ...(r.realm !== undefined ? { realm: r.realm } : {}),
                    }),
              },
              emissions: {},
              causes: [
                { kind: "event" as const, event: e.id },
                { kind: "state" as const, entity: who, key: CULTIVATION_STATE.name },
                ...(r.kind === "given" && r.cost > 0
                  ? [{ kind: "state" as const, entity: who, key: SECT_CONTRIBUTION.name }]
                  : []),
              ],
            };
            events.push(exchange);
            if (r.kind === "given" && org)
              events.push({
                kind: TECHNIQUE_TAUGHT_EVENT,
                actors: [who],
                place: e.place,
                data: { org, technique: r.method.name, realm: r.method.realm, via: "pavilion" },
                emissions: {},
                causes: [
                  { kind: "event", event: e.id },
                  { kind: "state", entity: org, key: SECT_SCHOOL.name },
                ],
              });
            continue;
          }
          const points = have?.org === org ? (have?.points ?? 0) : 0;
          const { hours, cost } = exchangeHours(points, typeof wanted === "number" ? wanted : null);
          const refused: ExchangeRefusal | undefined = !org
            ? "not_member"
            : member && CAVE_RANKS.has(member.rank)
              ? "no_need"
              : hours <= 0
                ? "no_points"
                : undefined;
          if (!refused && org && have) {
            rows.set(who, { ...have, points: round2(have.points - cost), last: ctx.now });
            const pass = passOf(who);
            const kept = pass?.org === org ? pass : undefined;
            passes.set(who, {
              org,
              hours: round2((kept?.hours ?? 0) + hours),
              since: kept?.since ?? ctx.now,
            });
          }
          events.push({
            kind: SECT_EXCHANGE_EVENT,
            actors: [who],
            place: e.place,
            data: {
              ...(org ? { org } : {}),
              wanted: typeof wanted === "number" ? wanted : null,
              ...(refused ? { refused, hours: 0, points: 0 } : { hours, points: cost }),
            },
            emissions: {},
            causes: [
              { kind: "event", event: e.id },
              ...(refused
                ? []
                : [{ kind: "state" as const, entity: who, key: SECT_CONTRIBUTION.name }]),
            ],
          });
          continue;
        }
        // Las horas meditadas en la cueva salen del pase de quien entró con uno (novel-sect-cave-pass).
        const sat = meditation(e);
        if (sat && isSectCave(ctx.truth.get(LOCATION, sat.who)?.space)) {
          const pass = passOf(sat.who);
          const member = ctx.truth.get(SECT_MEMBER, sat.who as unknown as EntityRef);
          const ranked = member?.org === pass?.org && member?.rank !== "outer";
          if (pass && !ranked) {
            const left = round2(pass.hours - sat.hours);
            if (pass.hours > 0) {
              passes.set(sat.who, left > 0 ? { ...pass, hours: left } : null);
              if (left <= 0)
                events.push({
                  kind: SECT_CAVE_PASS_SPENT_EVENT,
                  actors: [sat.who],
                  place: e.place,
                  data: { org: pass.org },
                  emissions: {},
                  causes: [{ kind: "event", event: e.id }],
                });
            }
          }
          continue;
        }
        const done = choreDone(e);
        if (!done) continue;
        const space = ctx.truth.get(LOCATION, done.who)?.space;
        const task = choreOf(done.said, space);
        const org = seatOrgOf(ctx.truth, done.who);
        const margin = (e.data as { margin?: unknown } | null)?.margin;
        const points = org
          ? chorePoints(
              done.hours,
              e.kind === ROUTINE_CHORE_EVENT ? "success" : (e.outcome as string | undefined),
              typeof margin === "number" ? margin : 0,
            )
          : 0;
        if (org) {
          const before = pointsOf(done.who);
          const same = before?.org === org ? before : undefined;
          const row: SectContribution = {
            org,
            points: round2((same?.points ?? 0) + points),
            hours: round2((same?.hours ?? 0) + done.hours),
            last: ctx.now,
          };
          rows.set(done.who, row);
          maybe.set(done.who, e);
        }
        events.push({
          kind: SECT_CHORE_EVENT,
          actors: [done.who],
          place: e.place,
          data: {
            task,
            hours: round2(done.hours),
            points,
            credited: org !== undefined,
            ...(org ? { org, rate: CHORE_POINTS_PER_HOUR } : {}),
          },
          emissions: {},
          causes: [{ kind: "event", event: e.id }],
        });
      }
      // El ascenso (novel-sect-duty-rank): externo en su sede con las horas de tarea y el tramo.
      const promotedHere: [number, { who: AgentId; org: EntityRef }][] = [];
      for (const [who, e] of maybe) {
        const ref = who as unknown as EntityRef;
        const member = ctx.truth.get(SECT_MEMBER, ref);
        const stage = ctx.truth.get(CULTIVATION_STATE, ref)?.stage ?? 0;
        const contribution = pointsOf(who);
        if (!member || seatOrgOf(ctx.truth, who) !== member.org) continue;
        if (!promotionDue(member, contribution, stage)) continue;
        changes.push(
          setComponent(SECT_MEMBER, who, { ...member, rank: "inner", rankSince: ctx.now }),
        );
        promotedHere.push([events.length, { who, org: member.org }]);
        events.push({
          kind: SECT_PROMOTED_EVENT,
          actors: [who],
          place: e.place,
          data: {
            org: member.org,
            from: "outer",
            to: "inner",
            hours: contribution?.hours ?? 0,
            stage,
            needs: { hours: PROMOTION_CHORE_HOURS, stage: PROMOTION_STAGE },
          },
          emissions: { sight: 0.3 },
          causes: [
            { kind: "event", event: e.id },
            { kind: "state", entity: who, key: SECT_CONTRIBUTION.name },
            { kind: "state", entity: who, key: CULTIVATION_STATE.name },
          ],
        });
      }
      // El maestro plantea el ascenso del discípulo que rompió, si cree que ya llega.
      for (const [who, e] of maybe) {
        if (e.kind !== BREAKTHROUGH_EVENT) continue;
        const bond = ctx.truth.get(MASTER_OF, who as unknown as EntityRef);
        if (!bond) continue;
        issues.push({
          who,
          org: bond.org,
          raisedBy: bond.master,
          cause: e.id,
          onlyIfDue: true,
          place: e.place,
        });
      }
      // La secta decide cada asunto una vez por paso (el primero que lo planteó).
      const reviewed = new Set<AgentId>();
      /** El que deja de ser externo aprende la técnica de ataque de la escuela (novel3-technique-school). */
      const teachArt = (who: AgentId, org: EntityRef, at: number) => {
        const art = ctx.truth.get(SECT_SCHOOL, org)?.art;
        const known = ctx.truth.get(ART_KNOWN, who as unknown as EntityRef);
        if (!art || known?.org === org) return;
        changes.push(
          setComponent(ART_KNOWN, who, {
            org,
            name: art.name,
            learnedAt: ctx.now,
            event: draftEvent(at),
          }),
        );
      };
      for (const [at, e] of promotedHere) teachArt(e.who, e.org, at);
      for (const issue of issues) {
        if (reviewed.has(issue.who)) continue;
        const out = reviewRank(
          {
            truth: ctx.truth,
            now: ctx.now,
            rng: ctx.rng,
            dayTicks: day,
            ...(o.relations ? { relations: o.relations } : {}),
          },
          issue,
        );
        if (out.events.length > 0) reviewed.add(issue.who);
        changes.push(...out.changes);
        for (const e of out.events) {
          const d = e.data as { org?: EntityRef; from?: string } | null;
          if (e.kind === SECT_PROMOTED_EVENT && d?.org && d.from === "outer") {
            teachArt(issue.who, d.org, events.length);
          }
          events.push(e);
        }
      }
      // Las misiones vencidas se caen sin más puntos.
      for (const id of ctx.truth.ids(SECT_MISSION)) {
        const who = id as unknown as AgentId;
        const m = missionOf(who);
        if (!m || !missionLapsed(m, ctx.now)) continue;
        missions.set(who, null);
        const seat = ctx.truth.get(SECT, m.org)?.seatPlace;
        events.push({
          kind: MISSION_LAPSED_EVENT,
          actors: [who],
          place: { kind: "place", place: (seat ?? id) as unknown as PlaceId },
          data: { org: m.org, kind: m.kind, done: m.done, due: m.due },
          emissions: {},
          causes: [
            ...(m.cause ? [{ kind: "event" as const, event: m.cause }] : []),
            { kind: "state", entity: id, key: SECT_MISSION.name },
          ],
        });
      }
      for (const [who, m] of missions) {
        if (m) changes.push(setComponent(SECT_MISSION, who, m));
        else if (ctx.truth.has(SECT_MISSION, who as unknown as EntityRef))
          changes.push(deleteComponent(SECT_MISSION, who as unknown as EntityRef));
      }
      for (const [who, row] of rows) changes.push(setComponent(SECT_CONTRIBUTION, who, row));
      for (const [who, k] of taught) changes.push(setComponent(CULTIVATION_TECHNIQUE, who, k));
      for (const [who, pass] of passes) {
        if (pass) changes.push(setComponent(SECT_CAVE_PASS, who, pass));
        else if (ctx.truth.has(SECT_CAVE_PASS, who as unknown as EntityRef))
          changes.push(deleteComponent(SECT_CAVE_PASS, who as unknown as EntityRef));
      }
      return { changes, events, ...(postings.length > 0 ? { postings } : {}) };
    },
  };
}

const round2 = (x: number) => Math.round(x * 100) / 100;

/**
 * Si `e` es la entrega de las hierbas de una misión (novel2-missions-herbs): quien la tiene le dio a
 * un anciano o al maestro de la misma secta, en la sede, el bien de la hierba que pide.
 */
function herbDelivery(
  truth: ReadonlyWorldTruth,
  e: Event,
  missionOf: (who: AgentId) => SectMission | null | undefined,
  herbs: readonly HerbDef[],
):
  | {
      readonly who: AgentId;
      readonly to: AgentId;
      readonly mission: SectMission;
      readonly unit: LedgerUnit;
      readonly grams: number;
    }
  | undefined {
  const who = e.actors[0] as AgentId | undefined;
  const effect = (e.data as { effect?: { to?: unknown; good?: unknown; grams?: unknown } } | null)
    ?.effect;
  const to = effect?.to as AgentId | undefined;
  const grams = typeof effect?.grams === "number" ? effect.grams : 0;
  if (!who || !to || grams <= 0 || typeof effect?.good !== "string") return undefined;
  const mission = missionOf(who);
  if (!mission || mission.kind !== "herbs") return undefined;
  const herb = herbs.find((h) => h.id === mission.herb);
  if (!herb || effect.good !== `good:${herb.good}`) return undefined;
  const elder = truth.get(SECT_MEMBER, to as unknown as EntityRef);
  if (elder?.org !== mission.org || (elder.rank !== "elder" && elder.rank !== "master"))
    return undefined;
  if (seatOrgOf(truth, to) !== mission.org) return undefined;
  return { who, to, mission, unit: ledgerUnit(`good:${herb.good}`), grams };
}

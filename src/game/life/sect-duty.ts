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
// Y el permiso para bajar (novel-sect-seat-return-leave): `furlough` en la sede deja `SECT_LEAVE`
// con `cultivation.sect_leave`; la ausencia la lleva `life.sect_absence` (`sect-leave.ts`).

import {
  type AgentId,
  type EntityRef,
  type Event,
  type HolderRef,
  holderAccount,
  ledgerUnit,
} from "../../core/index.ts";
import {
  BREAKTHROUGH_EVENT,
  CAVE_RANKS,
  CHORE_POINTS_PER_HOUR,
  CULTIVATION_STATE,
  CULTIVATION_TECHNIQUE,
  choreOf,
  chorePoints,
  deleteComponent,
  draftEvent,
  type EventDraft,
  type ExchangeRefusal,
  exchangeHours,
  isSectCave,
  type KnownTechnique,
  LOCATION,
  leaveDays,
  methodExchange,
  type PillDef,
  PLACE,
  type PostingDraft,
  PROMOTION_CHORE_HOURS,
  PROMOTION_STAGE,
  type ProcessDef,
  pillExchange,
  promotionDue,
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
  SECT_PROMOTED_EVENT,
  SECT_SCHOOL,
  type SectCavePass,
  type SectContribution,
  type StateChange,
  setComponent,
  TECHNIQUE_TAUGHT_EVENT,
} from "../../sim/index.ts";
import { meditation } from "./meditate.ts";
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
    ],
    writes: [
      SECT_CONTRIBUTION.name,
      SECT_CAVE_PASS.name,
      SECT_MEMBER.name,
      SECT_LEAVE.name,
      CULTIVATION_TECHNIQUE.name,
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
      // Quién pudo haber llegado al ascenso en esta corrida, y por qué evento.
      const maybe = new Map<AgentId, Event>();
      for (const e of ctx.recent) {
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
      for (const [who, e] of maybe) {
        const ref = who as unknown as EntityRef;
        const member = ctx.truth.get(SECT_MEMBER, ref);
        const stage = ctx.truth.get(CULTIVATION_STATE, ref)?.stage ?? 0;
        const contribution = pointsOf(who);
        if (!member || seatOrgOf(ctx.truth, who) !== member.org) continue;
        if (!promotionDue(member, contribution, stage)) continue;
        changes.push(setComponent(SECT_MEMBER, who, { ...member, rank: "inner" }));
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

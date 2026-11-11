// Las tareas de discípulo (novel-sect-duty-chore, organizations §6): en la sede, `chore` es barrer,
// hacer guardia o juntar leña para la secta. La tarea es la que dijo («barro», «hago guardia») o la del
// lugar (el portón: guardia; los salones: barrer; afuera: leña). Al terminar, si quien la hizo es de
// la secta y la hizo en su sede, se le anotan puntos de contribución (`SECT_CONTRIBUTION`, un
// derecho contra la secta) por las horas y por cómo salió; si no, trabajó de balde. Cada tarea deja
// `cultivation.sect_chore`, causado por la acción. También lleva el pase a la cueva: las horas
// meditadas adentro salen del pase (novel-sect-cave-pass) y `redeem` canjea puntos por horas de pase
// (novel-sect-duty-exchange) con `cultivation.sect_exchange`, causado por el pedido y los puntos.

import type { AgentId, EntityRef, Event } from "../../core/index.ts";
import {
  CAVE_RANKS,
  CHORE_POINTS_PER_HOUR,
  choreOf,
  chorePoints,
  deleteComponent,
  type EventDraft,
  type ExchangeRefusal,
  exchangeHours,
  isSectCave,
  LOCATION,
  PLACE,
  type ProcessDef,
  type ReadonlyWorldTruth,
  SECT,
  SECT_CAVE_PASS,
  SECT_CAVE_PASS_SPENT_EVENT,
  SECT_CHORE_EVENT,
  SECT_CONTRIBUTION,
  SECT_EXCHANGE_EVENT,
  SECT_MEMBER,
  type SectCavePass,
  type SectContribution,
  type StateChange,
  setComponent,
} from "../../sim/index.ts";
import { meditation } from "./meditate.ts";

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

/** Escritor de `SECT_CONTRIBUTION` (cableado con el cultivo). */
export function sectDutyProcess(): ProcessDef {
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
    ],
    writes: [SECT_CONTRIBUTION.name, SECT_CAVE_PASS.name],
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
      for (const e of ctx.recent) {
        // El canje de aportes por horas de pase (novel-sect-duty-exchange).
        if (e.kind === "action.redeem" && e.outcome !== "failure") {
          const who = e.actors[0] as AgentId | undefined;
          if (!who) continue;
          const wanted = (e.data as { effect?: { hours?: unknown } } | null)?.effect?.hours;
          const org = seatOrgOf(ctx.truth, who);
          const member = ctx.truth.get(SECT_MEMBER, who as unknown as EntityRef);
          const have = pointsOf(who);
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
      for (const [who, row] of rows) changes.push(setComponent(SECT_CONTRIBUTION, who, row));
      for (const [who, pass] of passes) {
        if (pass) changes.push(setComponent(SECT_CAVE_PASS, who, pass));
        else if (ctx.truth.has(SECT_CAVE_PASS, who as unknown as EntityRef))
          changes.push(deleteComponent(SECT_CAVE_PASS, who as unknown as EntityRef));
      }
      return { changes, events };
    },
  };
}

const round2 = (x: number) => Math.round(x * 100) / 100;

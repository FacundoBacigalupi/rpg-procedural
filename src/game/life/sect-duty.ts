// Las tareas de discípulo (novel-sect-duty-chore, organizations §6): en la sede, `chore` es barrer,
// hacer guardia o juntar leña para la secta. La tarea es la que dijo («barro», «hago guardia») o la del
// lugar (el portón: guardia; los salones: barrer; afuera: leña). Al terminar, si quien la hizo es de
// la secta y la hizo en su sede, se le anotan puntos de contribución (`SECT_CONTRIBUTION`, un
// derecho contra la secta) por las horas y por cómo salió; si no, trabajó de balde. Cada tarea deja
// `cultivation.sect_chore`, causado por la acción.

import type { AgentId, EntityRef, Event } from "../../core/index.ts";
import {
  CHORE_POINTS_PER_HOUR,
  choreOf,
  chorePoints,
  type EventDraft,
  LOCATION,
  PLACE,
  type ProcessDef,
  type ReadonlyWorldTruth,
  SECT,
  SECT_CHORE_EVENT,
  SECT_CONTRIBUTION,
  SECT_MEMBER,
  type SectContribution,
  type StateChange,
  setComponent,
} from "../../sim/index.ts";

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
    reads: [SECT_MEMBER.name, SECT.name, PLACE.name, LOCATION.name, SECT_CONTRIBUTION.name],
    writes: [SECT_CONTRIBUTION.name],
    run(ctx) {
      const changes: StateChange[] = [];
      const events: EventDraft[] = [];
      const rows = new Map<AgentId, SectContribution>();
      for (const e of ctx.recent) {
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
          const before = rows.get(done.who) ?? ctx.truth.get(SECT_CONTRIBUTION, done.who);
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
      return { changes, events };
    },
  };
}

const round2 = (x: number) => Math.round(x * 100) / 100;

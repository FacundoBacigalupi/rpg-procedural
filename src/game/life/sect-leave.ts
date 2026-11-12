// La ausencia de la sede (novel-sect-seat-return-leave, organizations §3): la secta lleva cuenta de
// sus miembros que ya subieron. La primera hora que uno está en el parche de la sede nace su
// `SECT_PRESENCE`; desde ahí, cada hora se mira dónde está. Cuando sale del parche, la secta lo anota
// afuera (`cultivation.sect_left`), con el plazo del permiso si tenía uno vigente (`SECT_LEAVE`, que
// da `furlough`) o con un día de gracia si no. Si se pasa del plazo queda anotado una vez
// (`cultivation.sect_overdue`). Al volver al parche, `cultivation.sect_returned` dice cuántos días
// faltó y cuántos de más, y por cada día de más pierde `ABSENCE_POINTS_PER_DAY` puntos de aporte
// (hasta los que tenga). El sueldo del mes ya lo pierde solo: se paga a quien está en la sede.
// La regla la aplica la secta sin un encargado en carne (como el pase a la cueva).

import type { AgentId, EntityRef, PlaceId, Tick } from "../../core/index.ts";
import {
  absenceDue,
  absencePenalty,
  ENTITY,
  type EventDraft,
  LOCATION,
  type LocalMap,
  lateDays,
  PLACE,
  type ProcessDef,
  patchOf,
  SECT,
  SECT_CONTRIBUTION,
  SECT_LEAVE,
  SECT_LEFT_EVENT,
  SECT_MEMBER,
  SECT_OVERDUE_EVENT,
  SECT_PRESENCE,
  SECT_RETURNED_EVENT,
  type StateChange,
  setComponent,
} from "../../sim/index.ts";

export const SECT_ABSENCE_PROCESS = "life.sect_absence";

export interface SectAbsenceOptions {
  readonly map: LocalMap;
  readonly dayTicks: number;
}

/** Escritor de `SECT_PRESENCE` (y de los puntos que se pierden al volver tarde). */
export function sectAbsenceProcess(o: SectAbsenceOptions): ProcessDef {
  return {
    id: SECT_ABSENCE_PROCESS,
    system: "life",
    scope: "world",
    cadence: { local: "hour", scene: "hour" },
    representation: "individual",
    phase: "settle",
    reads: [
      SECT_MEMBER.name,
      SECT.name,
      PLACE.name,
      LOCATION.name,
      ENTITY.name,
      SECT_LEAVE.name,
      SECT_PRESENCE.name,
      SECT_CONTRIBUTION.name,
    ],
    writes: [SECT_PRESENCE.name, SECT_CONTRIBUTION.name],
    run(ctx) {
      const changes: StateChange[] = [];
      const events: EventDraft[] = [];
      const now = ctx.now;
      for (const ref of ctx.truth.ids(SECT_MEMBER) as EntityRef[]) {
        const member = ctx.truth.get(SECT_MEMBER, ref);
        if (!member || ctx.truth.get(ENTITY, ref)?.endedAt !== undefined) continue;
        const sect = ctx.truth.get(SECT, member.org);
        const seatHex = sect ? ctx.truth.get(PLACE, sect.seatPlace)?.hexes[0] : undefined;
        const here = ctx.truth.get(LOCATION, ref)?.hex;
        if (!sect || seatHex === undefined || here === undefined) continue;
        const atSeat = patchOf(o.map, here).base === patchOf(o.map, seatHex).base;
        const known = ctx.truth.get(SECT_PRESENCE, ref);
        const p = known?.org === member.org ? known : undefined;
        const who = ref as unknown as AgentId;
        const place = {
          kind: "place" as const,
          place: sect.seatPlace as unknown as PlaceId,
        };
        if (atSeat) {
          if (p && !p.away) continue;
          if (p?.away) {
            const late = lateDays(p, now, o.dayTicks);
            const have = ctx.truth.get(SECT_CONTRIBUTION, ref);
            const points = have?.org === member.org ? have.points : 0;
            const penalty = absencePenalty(points, late);
            if (have && penalty > 0)
              changes.push(
                setComponent(SECT_CONTRIBUTION, ref, {
                  ...have,
                  points: round2(have.points - penalty),
                }),
              );
            events.push({
              kind: SECT_RETURNED_EVENT,
              actors: [who],
              place,
              data: {
                org: member.org,
                days: round2((now - p.since) / o.dayTicks),
                late: round2(late),
                penalty,
                leave: p.until !== undefined,
              },
              emissions: {},
              causes: [{ kind: "state", entity: ref, key: SECT_PRESENCE.name }],
            });
          }
          changes.push(
            setComponent(SECT_PRESENCE, ref, { org: member.org, away: false, since: now }),
          );
          continue;
        }
        if (!p) continue;
        if (!p.away) {
          const leave = ctx.truth.get(SECT_LEAVE, ref);
          const valid = leave?.org === member.org && leave.until > now ? leave : undefined;
          changes.push(
            setComponent(SECT_PRESENCE, ref, {
              org: member.org,
              away: true,
              since: now,
              ...(valid ? { until: valid.until } : {}),
            }),
          );
          events.push({
            kind: SECT_LEFT_EVENT,
            actors: [who],
            place,
            data: {
              org: member.org,
              leave: valid !== undefined,
              ...(valid ? { until: valid.until } : {}),
            },
            emissions: {},
            causes: [
              { kind: "state", entity: ref, key: LOCATION.name },
              ...(valid ? [{ kind: "state" as const, entity: ref, key: SECT_LEAVE.name }] : []),
            ],
          });
          continue;
        }
        if (p.overdue || now <= absenceDue(p, o.dayTicks)) continue;
        changes.push(setComponent(SECT_PRESENCE, ref, { ...p, overdue: true }));
        events.push({
          kind: SECT_OVERDUE_EVENT,
          actors: [who],
          place,
          data: { org: member.org, since: p.since, due: absenceDue(p, o.dayTicks) as Tick },
          emissions: {},
          causes: [{ kind: "state", entity: ref, key: SECT_PRESENCE.name }],
        });
      }
      return { changes, events };
    },
  };
}

const round2 = (x: number) => Math.round(x * 100) / 100;

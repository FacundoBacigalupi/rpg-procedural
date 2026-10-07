// El proceso del cuerpo en el scheduler (simulation §2): en la fase `physics`, cada cuerpo avanza
// hasta ahora y lo que le pasó sale como eventos con causas. Si muere, la entidad termina con el
// evento de la muerte, que nombra la falla fisiológica (body-health §13) y cita las heridas que la
// causaron. Corre por escena en escena y por hora en local; la fórmula cerrada aguanta ventanas
// largas igual, así que la cadencia solo cambia cuán fino se ven los eventos.

import type { AgentId, PlaceRef } from "../../core/index.ts";
import {
  draftEvent,
  type EventDraft,
  endEntity,
  type ProcessDef,
  type StateChange,
  setComponent,
} from "../scheduler/index.ts";
import { ENTITY, type ReadonlyWorldTruth } from "../world/index.ts";
import { advanceBody, type Happening } from "./physiology.ts";
import type { BodyPlanDef } from "./plan.ts";
import { BODY_STATE } from "./state.ts";

export interface BodyProcessOptions {
  readonly plans: readonly BodyPlanDef[];
  /** Dónde está el cuerpo, para el lugar de los eventos (lo arma `game` con el mapa local). */
  placeOf(truth: ReadonlyWorldTruth, who: AgentId): PlaceRef;
}

export function bodyProcess(o: BodyProcessOptions): ProcessDef {
  const plans = new Map(o.plans.map((p) => [p.id, p]));
  return {
    id: "body.physiology",
    system: "body",
    scope: "agent",
    cadence: { scene: "scene", local: "hour", regional: "day", world: "day" },
    representation: "individual",
    phase: "physics",
    reads: [BODY_STATE.name, ENTITY.name],
    writes: [BODY_STATE.name, ENTITY.name],
    run(ctx) {
      const me = ctx.scope as AgentId;
      const base = ctx.truth.get(ENTITY, me);
      const body = ctx.truth.get(BODY_STATE, me);
      if (!base || !body || base.endedAt !== undefined) return {};
      const plan = plans.get(body.plan);
      if (!plan) throw new RangeError(`plan corporal desconocido: ${body.plan}`);
      const place = o.placeOf(ctx.truth, me);
      const from = Math.max(ctx.now - ctx.window, 0);
      const tickOf = (at: number) => Math.min(ctx.now, Math.max(from, at));

      // Murió de un golpe (la cabeza): el cuerpo ya lo dice, falta cerrar la entidad.
      if (body.death) {
        const wounds = body.wounds.filter((w) => w.zone === "head" && w.stage !== "healed");
        const event: EventDraft = {
          kind: "body.died",
          actors: [me],
          place,
          tick: tickOf(body.death.at),
          data: { cause: body.death.cause },
          emissions: { sight: 0.6, sound: 0.3 },
          causes: wounds.length
            ? wounds.map((w) => ({ kind: "event", event: w.cause }) as const)
            : [{ kind: "state", entity: me, key: "body" }],
        };
        return { events: [event], changes: [endEntity(base, draftEvent(0), ctx.now)] };
      }

      if (body.updatedAt >= ctx.now) return {};
      const { body: next, happenings } = advanceBody(plan, me, body, ctx.now);
      const events = happenings.map((h) => eventOf(h, me, place, tickOf(h.at)));
      const changes: StateChange[] = [setComponent(BODY_STATE, me, next)];
      const died = happenings.findIndex((h) => h.kind === "died");
      if (died >= 0) changes.push(endEntity(base, draftEvent(died), ctx.now));
      return { events, changes };
    },
  };
}

function eventOf(h: Happening, me: AgentId, place: PlaceRef, tick: number): EventDraft {
  const common = { actors: [me], place, tick };
  switch (h.kind) {
    case "infected":
    case "healed":
      return {
        ...common,
        kind: h.kind === "infected" ? "body.wound_infected" : "body.wound_healed",
        data: { zone: h.wound.zone, wound: h.wound.id },
        emissions: {},
        causes: [{ kind: "event", event: h.wound.cause }],
      };
    case "collapsed":
    case "came_to":
      return {
        ...common,
        kind: h.kind === "collapsed" ? "body.collapsed" : "body.came_to",
        data: null,
        emissions: { sight: 0.5, sound: h.kind === "collapsed" ? 0.3 : 0 },
        causes: h.causes,
      };
    case "died":
      return {
        ...common,
        kind: "body.died",
        data: { cause: h.cause },
        emissions: { sight: 0.5, sound: 0.1 },
        causes: h.causes,
      };
  }
}

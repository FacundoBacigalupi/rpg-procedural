// Sustancias cableadas a la vida (body-health §9): cada día, en pasos de una hora, lo que cada
// persona tiene en el cuerpo se absorbe, se metaboliza y daña o se repara (`stepSubstance`). Las
// dosis vienen de una fuente explícita (`SubstanceDose`: un escenario, un envenenador, una
// receta); la sustancia es una entidad con origen la primera vez que se usa. El estado vive en
// `PERSON_SUBSTANCE`, aparte del `Body`. Sin dosis ni filas el proceso no hace nada (ni RNG), así
// que la aldea por defecto no cambia. Si el daño llega al total, muere con causa `poison`.

import type { AgentId, PlaceRef, PlanetClock, Tick } from "../../core/index.ts";
import {
  type AcuteEffects,
  acuteEffects,
  BODY_STATE,
  CLEAN,
  createEntity,
  draftEvent,
  ENTITY,
  type EventDraft,
  endEntity,
  type HeldSubstance,
  NEUTRAL,
  PERSON,
  PERSON_SUBSTANCE,
  type ProcessDef,
  type ReadonlyWorldTruth,
  type StateChange,
  SUBSTANCE,
  type SubstanceDef,
  type SubstanceRoute,
  type SubstanceState,
  setComponent,
  stepSubstance,
  substanceDeath,
  dose as takeDose,
} from "../../sim/index.ts";

/** Lo que alguien tiene en el cuerpo y sus efectos agudos; sin filas, `NEUTRAL` (no cambia nada). */
export function acuteOf(truth: ReadonlyWorldTruth, who: AgentId): AcuteEffects {
  const rows = truth.get(PERSON_SUBSTANCE, who as never)?.held;
  if (!rows || rows.length === 0) return NEUTRAL;
  const defs = new Map<string, SubstanceDef>();
  for (const id of truth.ids(SUBSTANCE)) {
    const rec = truth.get(SUBSTANCE, id);
    if (rec) defs.set(rec.def.id, rec.def);
  }
  const held = [];
  for (const h of rows) {
    const def = defs.get(h.substance);
    if (def) held.push({ def, state: h.state });
  }
  return acuteEffects(held);
}

export const SUBSTANCES_PROCESS = "life.substances";

/** Una dosis explícita: quién la toma, cuándo, por qué vía y qué la trajo. */
export interface SubstanceDose {
  readonly def: SubstanceDef;
  readonly who: AgentId;
  readonly at: Tick;
  readonly route: SubstanceRoute;
  readonly amount: number;
  /** Lo que pasó, en palabras (queda en el evento y en la sustancia). */
  readonly source: string;
}

export interface SubstancesOptions {
  readonly clock: PlanetClock;
  readonly doses?: readonly SubstanceDose[];
  readonly placeOf: (truth: ReadonlyWorldTruth, who: AgentId) => PlaceRef;
}

/** Por debajo de esto no queda nada que guardar. */
const TRACE = 0.01;

function isSpent(s: SubstanceState): boolean {
  return (
    s.blood === 0 &&
    s.damage < TRACE &&
    s.tolerance < TRACE &&
    s.dependence < TRACE &&
    Object.keys(s.depot).length === 0
  );
}

export function substancesProcess(o: SubstancesOptions): ProcessDef {
  const tph = o.clock.day / 24;
  return {
    id: SUBSTANCES_PROCESS,
    system: "life",
    scope: "world",
    cadence: { local: "day", scene: "day" },
    representation: "individual",
    phase: "settle",
    reads: [PERSON.name, ENTITY.name, BODY_STATE.name, SUBSTANCE.name, PERSON_SUBSTANCE.name],
    writes: [SUBSTANCE.name, PERSON_SUBSTANCE.name, ENTITY.name],
    run(ctx) {
      const window = Math.max(tph, Math.min(ctx.window, o.clock.day));
      const from = ctx.now - window;
      const dosing = (o.doses ?? []).filter((d) => d.at > from && d.at <= ctx.now);
      const holders = new Set<string>(ctx.truth.ids(PERSON_SUBSTANCE));
      for (const d of dosing) holders.add(d.who);
      if (holders.size === 0) return {};

      const known = new Map<string, SubstanceDef>();
      for (const id of ctx.truth.ids(SUBSTANCE)) {
        const rec = ctx.truth.get(SUBSTANCE, id);
        if (rec) known.set(rec.def.id, rec.def);
      }
      const changes: StateChange[] = [];
      const events: EventDraft[] = [];
      const hours = Math.max(1, Math.round(window / tph));
      for (const pid of [...holders].sort()) {
        const base = ctx.truth.get(ENTITY, pid as never);
        const body = ctx.truth.get(BODY_STATE, pid as never);
        if (!base || !body || base.endedAt !== undefined || body.death) continue;
        const agent = pid as AgentId;
        const mine = dosing.filter((d) => d.who === pid);
        const held = new Map<string, SubstanceState>();
        const defs = new Map<string, SubstanceDef>();
        for (const h of ctx.truth.get(PERSON_SUBSTANCE, pid as never)?.held ?? []) {
          held.set(h.substance, h.state);
          const def = known.get(h.substance);
          if (def) defs.set(h.substance, def);
        }
        for (const d of mine) defs.set(d.def.id, known.get(d.def.id) ?? d.def);
        let died = false;
        for (let k = 0; k < hours && !died; k++) {
          const before = from + k * tph;
          const t = before + tph;
          for (const d of mine) {
            if (d.at > before && d.at <= t) {
              const def = defs.get(d.def.id) ?? d.def;
              held.set(d.def.id, takeDose(def, held.get(d.def.id) ?? CLEAN, d.route, d.amount));
            }
          }
          for (const [sid, st] of held) {
            const def = defs.get(sid);
            if (!def) continue;
            const next = stepSubstance(def, st, 1);
            held.set(sid, next);
            if (substanceDeath(next)) died = true;
          }
        }
        // La sustancia nace como entidad con origen la primera vez que alguien la toma.
        for (const d of mine) {
          if (known.has(d.def.id)) continue;
          known.set(d.def.id, d.def);
          const k = events.length;
          const sid = ctx.newId("substance");
          events.push({
            kind: "body.substance_introduced",
            actors: [d.who],
            place: o.placeOf(ctx.truth, d.who),
            data: { substance: d.def.id, source: d.source, route: d.route },
            emissions: {},
            causes: [{ kind: "state", entity: d.who, key: "body.substance" }],
          });
          changes.push(
            createEntity(sid, draftEvent(k), ctx.now),
            setComponent(SUBSTANCE, sid, { def: d.def, source: d.source }),
          );
        }
        const rows: HeldSubstance[] = [...held]
          .filter(([, s]) => !isSpent(s))
          .map(([substance, state]) => ({ substance, state }));
        if (died) {
          const kd = events.length;
          events.push({
            kind: "body.died",
            actors: [agent],
            place: o.placeOf(ctx.truth, agent),
            data: { cause: "poison", substances: [...held.keys()] },
            emissions: { sight: 0.6, sound: 0.2 },
            causes: [{ kind: "state", entity: agent, key: "body.substance" }],
          });
          changes.push(
            endEntity(base, draftEvent(kd), ctx.now),
            setComponent(PERSON_SUBSTANCE, pid as never, { held: rows, at: ctx.now }),
          );
        } else if (rows.length > 0) {
          changes.push(setComponent(PERSON_SUBSTANCE, pid as never, { held: rows, at: ctx.now }));
        } else if (ctx.truth.get(PERSON_SUBSTANCE, pid as never)) {
          changes.push({ op: "delete", table: PERSON_SUBSTANCE.name, id: pid as never });
        }
      }
      return changes.length > 0 || events.length > 0 ? { changes, events } : {};
    },
  };
}

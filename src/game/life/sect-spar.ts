// La práctica de la sede (novel3-spar-npc, combat §19): a la hora de practicar de la rutina, los
// discípulos que viven en la sede se juntan en el mismo lugar y practican de a dos con quien conocen
// (`sparWilling` de los dos lados), con la misma pelea de práctica que «entreno con X»
// (`strikeFight` con intención `spar`): toques frenados, nadie queda a merced, y cada uno aprende el
// estilo del otro. Quien no encuentra con quién pierde la hora.
import type { AgentId, Event } from "../../core/index.ts";
import {
  BODY_STATE,
  type BodyPlanDef,
  CULTIVATION_STATE,
  type EventDraft,
  LOCATION,
  type ProcessDef,
  RELATIONS,
  SKILL_STATE,
  type SkillCatalog,
  type StateChange,
  setComponent,
  TRIBULATION,
  type Trait,
} from "../../sim/index.ts";
import { exposeSkills, sparWilling, strikeFight } from "./fight.ts";

export const SECT_SPAR_PROCESS = "life.sect_spar";
/** Una hora de práctica de la rutina delegada en la sede (novel3-spar-npc). */
export const ROUTINE_SPAR_EVENT = "routine.spar";
/** La hora local en que practican (una de la tarde de trabajo; calibración abierta). */
export const SECT_SPAR_HOUR = 15;
/** La luz del patio de práctica a esa hora. */
export const SECT_SPAR_LIGHT = 1;

export interface SectSparOptions {
  readonly bodyPlans: readonly BodyPlanDef[];
  readonly skills: SkillCatalog;
  readonly traits: readonly Trait[];
  /** Ticks por día, para olvidar la familiaridad. */
  readonly dayTicks: number;
  /** La luz del lugar donde practican (de día, a cubierto). */
  readonly light: number;
  /** Cada uno pelea con el cuerpo que le dejó el cultivo (`strikeFight.refined`). */
  readonly refined?: boolean;
}

/** El lugar (espacio o hex) donde está alguien, para juntar a los que practican ahí. */
function spotOf(e: Event, where: { hex: number; space?: string } | undefined): string {
  return where ? `${where.hex}|${where.space ?? ""}` : `place|${JSON.stringify(e.place)}`;
}

/** Escritor de los cuerpos y las habilidades de quienes practican en la sede (cableado opt-in). */
export function sectSparProcess(o: SectSparOptions): ProcessDef {
  const plans = new Map(o.bodyPlans.map((p) => [p.id, p]));
  return {
    id: SECT_SPAR_PROCESS,
    system: "life",
    scope: "world",
    cadence: { local: "onEvent", scene: "onEvent" },
    representation: "individual",
    phase: "perceive",
    reads: [
      LOCATION.name,
      BODY_STATE.name,
      SKILL_STATE.name,
      RELATIONS.name,
      TRIBULATION.name,
      ...(o.refined ? [CULTIVATION_STATE.name] : []),
    ],
    writes: [BODY_STATE.name, SKILL_STATE.name],
    run(ctx) {
      const truth = ctx.truth;
      // Quién vino a practicar, con su evento (la causa de la práctica), por lugar.
      const spots = new Map<string, { who: AgentId; event: Event }[]>();
      const seen = new Set<AgentId>();
      for (const e of ctx.recent) {
        if (e.kind !== ROUTINE_SPAR_EVENT) continue;
        const who = e.actors[0] as AgentId | undefined;
        if (!who || seen.has(who)) continue;
        seen.add(who);
        // Quien tiene al Cielo encima no practica: las olas le escriben el cuerpo en esta fase.
        if (truth.get(TRIBULATION, who)) continue;
        const key = spotOf(e, truth.get(LOCATION, who));
        const list = spots.get(key) ?? [];
        list.push({ who, event: e });
        spots.set(key, list);
      }
      const changes: StateChange[] = [];
      const events: EventDraft[] = [];
      for (const key of [...spots.keys()].sort()) {
        const here = [...(spots.get(key) ?? [])].sort((a, b) => (a.who < b.who ? -1 : 1));
        // El orden en que se buscan pareja sale del rng: no siempre los mismos con los mismos.
        const order = ctx.rng.fork("spar-order", key).shuffle(here);
        const paired = new Set<AgentId>();
        for (const a of order) {
          if (paired.has(a.who)) continue;
          const b = order.find(
            (x) =>
              x.who !== a.who &&
              !paired.has(x.who) &&
              sparWilling(truth, a.who, x.who, ctx.now) &&
              sparWilling(truth, x.who, a.who, ctx.now),
          );
          const mine = truth.get(BODY_STATE, a.who);
          if (!b || !mine) continue;
          paired.add(a.who);
          paired.add(b.who);
          const f = strikeFight({
            truth,
            me: a.who,
            myBody: mine,
            target: b.who,
            plans,
            skills: o.skills,
            traits: o.traits,
            intent: "spar",
            light: o.light,
            ...(o.refined ? { refined: true } : {}),
            start: ctx.now,
            rng: ctx.rng.fork("spar", a.who, b.who),
            day: o.dayTicks,
            cause: a.event.id,
            place: a.event.place,
          });
          changes.push(setComponent(BODY_STATE, a.who, f.myBody), ...f.changes);
          if (f.exposure) {
            changes.push(
              setComponent(
                SKILL_STATE,
                a.who,
                exposeSkills(
                  truth.get(SKILL_STATE, a.who),
                  f.exposure,
                  ctx.now + f.seconds,
                  o.dayTicks,
                ),
              ),
            );
          }
          events.push(f.event);
        }
      }
      return { changes, events };
    },
  };
}

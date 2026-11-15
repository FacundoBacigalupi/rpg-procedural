// La práctica de la sede (novel3-spar-npc, combat §19): a la hora de practicar de la rutina, los
// discípulos que viven en la sede se juntan en el mismo lugar y practican de a dos con quien conocen
// (`sparWilling` de los dos lados), con la misma pelea de práctica que «entreno con X»
// (`strikeFight` con intención `spar`): toques frenados, nadie queda a merced, y cada uno aprende el
// estilo del otro. Quien no encuentra con quién pierde la hora.
//
// Los duelos pactados (novel4-duel-npc, combat §13): a esa hora, quien retó y su retado, si los
// dos vinieron y pueden pelear, suben a la plataforma (`arena`) con un anciano de la secta que
// también vino, y pelean el duelo con su regla en vez de practicar (`strikeFight` con `duel`);
// `life.duels` lo cierra como el del personaje. Uno a muerte sin anciano que mire no se pelea.
import { type AgentId, compareStrings, type Event } from "../../core/index.ts";
import {
  BODY_STATE,
  type BodyPlanDef,
  CULTIVATION_STATE,
  DUEL,
  type DuelRule,
  type EventDraft,
  LOCATION,
  type ProcessDef,
  RELATIONS,
  type ReadonlyWorldTruth,
  SECT,
  SECT_MEMBER,
  SKILL_STATE,
  type SkillCatalog,
  type StateChange,
  sectSpaceKey,
  setComponent,
  TRIBULATION,
  type Trait,
  YIELDED,
} from "../../sim/index.ts";
import {
  canFight,
  DUEL_INTENT,
  exposeSkills,
  FIGHT_STATE,
  sparWilling,
  strikeFight,
} from "./fight.ts";

export const SECT_SPAR_PROCESS = "life.sect_spar";
/** Una hora de práctica de la rutina delegada en la sede (novel3-spar-npc). */
export const ROUTINE_SPAR_EVENT = "routine.spar";
/** La hora local en que practican (una de la tarde de trabajo; calibración abierta). */
export const SECT_SPAR_HOUR = 15;
/** La luz del patio de práctica a esa hora. */
export const SECT_SPAR_LIGHT = 1;
/** Los duelistas (y el anciano que mira) suben a la plataforma (novel4-duel-npc). */
export const DUEL_PLATFORM_EVENT = "life.duel_platform";

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

/**
 * Quién de los que vinieron puede mirar el duelo de `a` y `b` en la plataforma: un anciano o el
 * maestro de su secta, despierto, en la misma sede, sin duelo propio ni otro duelo que mirar.
 */
export function duelWitness(
  truth: ReadonlyWorldTruth,
  a: AgentId,
  b: AgentId,
  came: readonly AgentId[],
  busy: ReadonlySet<AgentId>,
): AgentId | undefined {
  const org = truth.get(SECT_MEMBER, a)?.org;
  const hex = truth.get(LOCATION, a)?.hex;
  return came.find((id) => {
    if (id === a || id === b || busy.has(id) || truth.has(DUEL, id)) return false;
    const m = truth.get(SECT_MEMBER, id);
    if (!m || m.org !== org || (m.rank !== "elder" && m.rank !== "master")) return false;
    const body = truth.get(BODY_STATE, id);
    if (!body || body.death !== null || body.activity === "sleep") return false;
    return truth.get(LOCATION, id)?.hex === hex;
  });
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
      DUEL.name,
      SECT.name,
      SECT_MEMBER.name,
      FIGHT_STATE.name,
      ...(o.refined ? [CULTIVATION_STATE.name] : []),
    ],
    // Un duelo puede dejar a uno rendido o la pelea pausada (`strikeFight`).
    writes: [BODY_STATE.name, SKILL_STATE.name, LOCATION.name, YIELDED.name, FIGHT_STATE.name],
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
      const fight = (
        a: { who: AgentId; event: Event },
        b: AgentId,
        duel?: { rule: DuelRule; witness?: AgentId },
      ): void => {
        const mine = truth.get(BODY_STATE, a.who);
        if (!mine) return;
        const f = strikeFight({
          truth,
          me: a.who,
          myBody: mine,
          target: b,
          plans,
          skills: o.skills,
          traits: o.traits,
          intent: duel ? DUEL_INTENT[duel.rule] : "spar",
          light: o.light,
          ...(o.refined ? { refined: true } : {}),
          ...(duel ? { duel: duel.rule } : {}),
          ...(duel?.witness ? { witness: duel.witness } : {}),
          start: ctx.now,
          rng: ctx.rng.fork(duel ? "duel" : "spar", a.who, b),
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
      };
      // Primero los duelos pactados: quien retó y su retado, los dos acá, a la plataforma.
      const came = new Map<AgentId, Event>();
      for (const list of spots.values()) for (const x of list) came.set(x.who, x.event);
      const comers = [...came.keys()].sort(compareStrings);
      const dueled = new Set<AgentId>();
      for (const a of comers) {
        const d = truth.get(DUEL, a);
        if (!d || d.challenger !== a || ctx.now > d.until) continue;
        const b = d.with;
        if (dueled.has(a) || dueled.has(b) || !came.has(b)) continue;
        if (truth.get(DUEL, b)?.with !== a || !canFight(truth, a) || !canFight(truth, b)) continue;
        const at = truth.get(LOCATION, a);
        const org = truth.get(SECT_MEMBER, a)?.org;
        const sect = org ? truth.get(SECT, org) : undefined;
        if (!at || !sect || truth.get(LOCATION, b)?.hex !== at.hex) continue;
        if (truth.get(SECT_MEMBER, b)?.org !== org) continue;
        const witness = duelWitness(truth, a, b, comers, dueled);
        if (d.rule === "death" && !witness) continue;
        const arena = { hex: at.hex, space: sectSpaceKey(sect.seatPlace, "arena") };
        const up = witness ? [a, b, witness] : [a, b];
        for (const id of up) {
          dueled.add(id);
          changes.push(setComponent(LOCATION, id, arena));
        }
        const event = came.get(a) as Event;
        events.push({
          kind: DUEL_PLATFORM_EVENT,
          actors: up,
          place: event.place,
          data: { rule: d.rule, duel: d.event },
          emissions: { sight: 0.6 },
          causes: [
            { kind: "event", event: d.event },
            { kind: "event", event: event.id },
          ],
        });
        fight({ who: a, event }, b, { rule: d.rule, ...(witness ? { witness } : {}) });
      }
      for (const key of [...spots.keys()].sort()) {
        const here = [...(spots.get(key) ?? [])]
          .filter((x) => !dueled.has(x.who))
          .sort((a, b) => (a.who < b.who ? -1 : 1));
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
          if (!b || !truth.get(BODY_STATE, a.who)) continue;
          paired.add(a.who);
          paired.add(b.who);
          fight(a, b.who);
        }
      }
      return { changes, events };
    },
  };
}

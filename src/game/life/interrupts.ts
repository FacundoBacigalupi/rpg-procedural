// Las interrupciones fijas (player-loop §6): lo que corta un turno largo aunque el usuario no lo
// haya pedido. Leen solo lo que el personaje percibe (player-loop §3, principio 3): lo que le hacen
// en el cuerpo lo siente siempre; lo que le pasa a otro, solo si lo ve o lo oye (perception); y lo
// que siente de sí mismo son los signos del cuerpo (`bodySigns`), nunca los números de la verdad.
// Las configurables por el usuario y la delegación llegan con las rutinas (Fase 3).

import type { AgentId, Event, EventId, Tick } from "../../core/index.ts";
import { BODY_STATE, SECT_HERALD_EVENT, SECT_LORE, SECT_VISIT_EVENT } from "../../sim/index.ts";
import { ALARMING_SIGNS, alarmingSignsOf } from "./alarms.ts";
import { deficiencyStagesOf } from "./nutrition.ts";
import { perceivedDetail } from "./perceive.ts";
import { acquaintances } from "./view.ts";
import type { LifeWorld } from "./world.ts";

export type InterruptKind =
  /** Alguien lo ataca o le hace algo en el cuerpo: lo siente. */
  | "attacked"
  /** Alguien le habla en persona y lo oye. */
  | "spoken_to"
  /** Nota algo grave en el cuerpo que antes no notaba. */
  | "body_alarm"
  /** Ve u oye morir a alguien cercano. */
  | "death_seen"
  /** En un salto delegado, percibe algo que el usuario pidió que lo avise (player-loop §6). */
  | "watched";

export interface Interrupt {
  readonly kind: InterruptKind;
  readonly tick: Tick;
  /** El evento que lo causó, si lo hay (los signos del cuerpo son estado, no evento). */
  readonly event?: EventId;
  /** Quién, si es otro. */
  readonly who?: AgentId;
  /** Los signos nuevos, para `body_alarm`. */
  readonly signs?: readonly string[];
  /** La regla que lo disparó, para `watched`. */
  readonly rule?: WatchOn;
}

/** Qué decisiones chicas toma solo el personaje en un salto delegado (player-loop §7). */
export const DELEGATION_LEVELS = ["minimal", "normal", "wide"] as const;
export type DelegationLevel = (typeof DELEGATION_LEVELS)[number];

/** Qué mira una regla del usuario: alguien de su lista que aparece, o una clase de suceso. */
export type WatchOn =
  | { readonly kind: "person"; readonly who: AgentId }
  | { readonly kind: "event"; readonly event: WatchedEvent }
  /**
   * Lo ligado a una meta del personaje (novel-goals-watch): la persona de la meta, o sucesos cuya
   * clase empieza con alguno de `events` (`cultivation.`, `property.`).
   */
  | {
      readonly kind: "goal";
      readonly goal: number;
      readonly who?: AgentId;
      readonly events?: readonly string[];
    };

/** Los sucesos que se pueden pedir que avisen (los que el personaje percibe como evento). */
export const WATCHED_EVENTS = ["body.died", "family.birth", "combat.fight"] as const;
export type WatchedEvent = (typeof WATCHED_EVENTS)[number];

/** Una regla configurable (player-loop §6): `stop` corta el salto, `note` lo anota y sigue. */
export interface WatchRule {
  readonly on: WatchOn;
  readonly action: "stop" | "note";
}

/** Las reglas de un salto delegado: delegación y avisos del usuario. Leen solo lo percibido. */
export interface RoutineRules {
  readonly delegation: DelegationLevel;
  readonly watch: readonly WatchRule[];
}

export const DEFAULT_ROUTINE_RULES: RoutineRules = { delegation: "normal", watch: [] };

export { ALARMING_SIGNS, alarmingSignsOf };

/**
 * Los signos que no cortan un salto de tiempo delegado (novel-montage-live): el cansancio de un día
 * de campo lo resuelve la rutina durmiendo. La sed, el hambre, la fiebre y las heridas sí cortan:
 * dicen que la rutina no alcanza.
 */
export const ROUTINE_TOLERATED_SIGNS: ReadonlySet<string> = new Set(["exhausted"]);

/**
 * En un salto delegado, que le hablen corta solo si le piden algo o le prometen algo (una decisión
 * que la rutina no toma, player-loop §7); el saludo, la pregunta o la noticia quedan anotados.
 */
export const ROUTINE_STOPPING_ACTS: ReadonlySet<string> = new Set(["request", "promise"]);

/**
 * Qué actos de habla cortan un salto según la delegación (`null`: cualquiera): con `minimal` toda
 * palabra dirigida a él; con `normal`, pedidos y promesas; con `wide`, solo las promesas (un
 * compromiso, que lo grande interrumpe siempre).
 */
export const DELEGATION_STOPPING_ACTS: Readonly<
  Record<DelegationLevel, ReadonlySet<string> | null>
> = {
  minimal: null,
  normal: ROUTINE_STOPPING_ACTS,
  wide: new Set(["promise"]),
};

/** Si el evento es lo que mira la regla (sin mirar si lo percibió). */
function matches(on: WatchOn, e: Event, me: AgentId): boolean {
  if (on.kind === "person") return on.who !== me && e.actors.includes(on.who);
  if (on.kind === "event") return e.kind === on.event && !e.actors.includes(me);
  if (on.who !== undefined) return on.who !== me && e.actors.includes(on.who);
  return !e.actors.includes(me) && (on.events ?? []).some((p) => e.kind.startsWith(p));
}

/** Los signos graves que el personaje siente ahora. */
export function alarmingSigns(w: LifeWorld): Set<string> {
  const body = w.truth.get(BODY_STATE, w.player);
  const plan = body && w.plans.find((p) => p.id === body.plan);
  if (!body || !plan) return new Set();
  return alarmingSignsOf(plan, body, deficiencyStagesOf(w.truth, w.player, w.deficiencySigns));
}

/**
 * Las noticias sin actor que el personaje no ve pero sabe (novel-cult-sect-goals): el aviso de la
 * secta le dejó la fecha en la creencia, y el día de la bajada sabe que llegaron porque la esperaba.
 */
function learns(w: LifeWorld, e: Event): boolean {
  const lore = w.truth.get(SECT_LORE, w.player);
  if (lore?.visitAt === undefined) return false;
  const d = (e.data ?? {}) as { visitAt?: number; start?: number };
  if (e.kind === SECT_HERALD_EVENT) return lore.visitAt === d.visitAt;
  if (e.kind === SECT_VISIT_EVENT) return lore.visitAt === d.start;
  return false;
}

/** Lo que el evento de otro le hace al personaje en el cuerpo (un golpe que lo alcanza). */
function touches(e: Event, me: AgentId): boolean {
  if (e.actors[0] === me || !e.actors.includes(me)) return false;
  return e.kind === "action.strike";
}

/** Si el personaje ve u oye el evento: lo dice lo que quedó guardado en la fase `perceive`. */
function perceives(w: LifeWorld, e: Event): boolean {
  return perceivedDetail(w.truth, w.player, e.id) === "clear";
}

/**
 * La primera interrupción fija entre los eventos de un paso del scheduler, o la alarma del cuerpo
 * si aparece un signo grave que al empezar el turno no estaba (`known`, que se actualiza).
 */
export function fixedInterrupt(
  w: LifeWorld,
  events: readonly Event[],
  known: Set<string>,
  /**
   * Las reglas de un salto delegado, o `null` si no lo es: los signos de `ROUTINE_TOLERATED_SIGNS`
   * no alarman, que le hablen corta según la delegación y los avisos del usuario cortan o anotan.
   */
  routine: RoutineRules | null = null,
  /** En un salto delegado, lo que no corta y queda anotado para el montaje. */
  notes?: Interrupt[],
): Interrupt | null {
  const me = w.player;
  const close = acquaintances(w);
  for (const e of events) {
    const who = e.actors[0] as AgentId | undefined;
    if (touches(e, me))
      return { kind: "attacked", tick: e.tick, event: e.id, ...(who ? { who } : {}) };
    if (!who && routine !== null && learns(w, e)) {
      const rule = routine.watch.find((r) => matches(r.on, e, me));
      if (rule !== undefined) {
        const heard: Interrupt = { kind: "watched", tick: e.tick, event: e.id, rule: rule.on };
        if (rule.action === "stop") return heard;
        notes?.push(heard);
      }
    }
    if (!who || who === me) continue;
    if (e.kind === "action.speak") {
      const data = e.data as {
        effect?: { to?: string | null; text?: string | null; act?: { kind: string } | null };
      } | null;
      if (data?.effect?.to === me && perceives(w, e)) {
        const heard: Interrupt = { kind: "spoken_to", tick: e.tick, event: e.id, who };
        const act = data.effect.act?.kind;
        const stopping = routine === null ? null : DELEGATION_STOPPING_ACTS[routine.delegation];
        if (stopping === null || (act !== undefined && stopping.has(act))) return heard;
        notes?.push(heard);
        continue;
      }
    }
    if (routine !== null && routine.watch.length > 0) {
      const rule = routine.watch.find((r) => matches(r.on, e, me));
      if (rule !== undefined && perceives(w, e)) {
        const seen: Interrupt = {
          kind: "watched",
          tick: e.tick,
          event: e.id,
          who,
          rule: rule.on,
        };
        if (rule.action === "stop") return seen;
        // Una nota por persona o suceso y por día: verlo trabajar diez veces no son diez noticias.
        const day = Math.floor(e.tick / w.clock.day);
        const dup = notes?.some(
          (n) =>
            n.kind === "watched" &&
            Math.floor(n.tick / w.clock.day) === day &&
            JSON.stringify(n.rule) === JSON.stringify(rule.on),
        );
        if (!dup) notes?.push(seen);
      }
    }
    if (e.kind === "body.died" && close.has(who) && perceives(w, e)) {
      return { kind: "death_seen", tick: e.tick, event: e.id, who };
    }
  }
  const now = alarmingSigns(w);
  if (routine !== null) for (const s of ROUTINE_TOLERATED_SIGNS) now.delete(s);
  const fresh = [...now].filter((s) => !known.has(s));
  // Lo que ya no siente vuelve a poder alarmarlo si reaparece.
  for (const s of [...known]) if (!now.has(s)) known.delete(s);
  for (const s of fresh) known.add(s);
  if (fresh.length > 0) return { kind: "body_alarm", tick: w.scheduler.now, signs: fresh.sort() };
  return null;
}

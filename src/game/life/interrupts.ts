// Las interrupciones fijas (player-loop §6): lo que corta un turno largo aunque el usuario no lo
// haya pedido. Leen solo lo que el personaje percibe (player-loop §3, principio 3): lo que le hacen
// en el cuerpo lo siente siempre; lo que le pasa a otro, solo si lo ve o lo oye (perception); y lo
// que siente de sí mismo son los signos del cuerpo (`bodySigns`), nunca los números de la verdad.
// Las configurables por el usuario y la delegación llegan con las rutinas (Fase 3).

import type { AgentId, Event, EventId, Tick } from "../../core/index.ts";
import { BODY_STATE, bodySigns } from "../../sim/index.ts";
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
  | "death_seen";

export interface Interrupt {
  readonly kind: InterruptKind;
  readonly tick: Tick;
  /** El evento que lo causó, si lo hay (los signos del cuerpo son estado, no evento). */
  readonly event?: EventId;
  /** Quién, si es otro. */
  readonly who?: AgentId;
  /** Los signos nuevos, para `body_alarm`. */
  readonly signs?: readonly string[];
}

/** Lo que el personaje nota como grave en su cuerpo (player-loop §6: "dolor que nota como grave"). */
export const ALARMING_SIGNS: ReadonlySet<string> = new Set([
  "dizzy",
  "parched",
  "starving",
  "exhausted",
  "feverish",
  "bleeding_heavily",
  "bone_broken",
  "wound_hot",
]);

/** Los signos graves que el personaje siente ahora. */
export function alarmingSigns(w: LifeWorld): Set<string> {
  const body = w.truth.get(BODY_STATE, w.player);
  const plan = body && w.plans.find((p) => p.id === body.plan);
  if (!body || !plan) return new Set();
  const signs = bodySigns(
    plan,
    body,
    false,
    deficiencyStagesOf(w.truth, w.player, w.deficiencySigns),
  );
  return new Set(
    [...signs.general, ...signs.zones.flatMap((z) => z.signs)].filter((s) => ALARMING_SIGNS.has(s)),
  );
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
): Interrupt | null {
  const me = w.player;
  const close = acquaintances(w);
  for (const e of events) {
    const who = e.actors[0] as AgentId | undefined;
    if (touches(e, me))
      return { kind: "attacked", tick: e.tick, event: e.id, ...(who ? { who } : {}) };
    if (!who || who === me) continue;
    if (e.kind === "action.speak") {
      const data = e.data as { effect?: { to?: string | null; text?: string | null } } | null;
      if (data?.effect?.to === me && perceives(w, e)) {
        return { kind: "spoken_to", tick: e.tick, event: e.id, who };
      }
    }
    if (e.kind === "body.died" && close.has(who) && perceives(w, e)) {
      return { kind: "death_seen", tick: e.tick, event: e.id, who };
    }
  }
  const now = alarmingSigns(w);
  const fresh = [...now].filter((s) => !known.has(s));
  // Lo que ya no siente vuelve a poder alarmarlo si reaparece.
  for (const s of [...known]) if (!now.has(s)) known.delete(s);
  for (const s of fresh) known.add(s);
  if (fresh.length > 0) return { kind: "body_alarm", tick: w.scheduler.now, signs: fresh.sort() };
  return null;
}

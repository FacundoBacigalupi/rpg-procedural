// Cobertura dirigida de oficios vistos y profecías contadas (perfil2c-encounters-trade). Opt-in del
// tooling: sin `commerce` el perfil completo no cambia. Causas de los ceros, medidas en seed 1:
// - `life.trade_view`: la vista no recibía el seed, así que no veía ningún oficio (ahora `fromSeed`).
// - `life.retold`: nadie cuenta una profecía; es un turno legal del personaje (`speak`).
// - `life.npc_encounters`: depende de que un viaje de recado cruce un hex ocupado; con el azar de
//   cada corrida a veces ocurre y a veces no (ver ROADMAP, perfil2c-encounters-trade).
// - `life.pitch`: el vecino solo ofrece si le sobra un bien que no es el que el personaje tiene a
//   mano y a su casa le falta; la aldea solo guarda grano (y algo de pan en un hogar pobre) y el
//   personaje solo plata. Sin segundo bien con excedente no hay oferta: ítem aparte.
// - `life.migration`: necesita otro asentamiento al que irse; la vida real tiene una sola aldea.
// Nada de esto inventa estado: son planes legales del personaje por el mismo `Life.turn` del jugador.
import type { AgentId } from "../../core/index.ts";
import type { Life, LifeOptions } from "../../game/index.ts";
import { type ActionPlan, ENTITY, PERSON } from "../../sim/index.ts";

/** Opciones del perfil con la vista de oficios alimentada por el seed (aditivo: no toca lo demás). */
export function commerceLifeOptions<T extends LifeOptions>(base: T): T {
  const view = typeof base.tradeView === "object" ? base.tradeView : {};
  return { ...base, tradeView: { ...view, fromSeed: true } };
}

const plan = (
  actor: AgentId,
  verb: string,
  args: Extract<ActionPlan["root"], { kind: "do" }>["args"],
): ActionPlan => ({
  actor,
  source: "player",
  root: { kind: "do", verb, args, manner: [] },
  manner: [],
  causes: [{ kind: "state", entity: actor, key: "intent" }],
});

/**
 * Turno dirigido del personaje: contarle una profecía a quien convive con él (se reintenta con otro
 * conviviente si no la anota). El oyente la guarda con el salto en el linaje (`life.retold`).
 * Devuelve los planes ejecutados, para el reporte de reproducción.
 */
export function runCommerceTurns(life: Life, maxTries = 3): ActionPlan[] {
  const w = life.world;
  const me = life.player;
  const home = w.truth.get(PERSON, me)?.household;
  const mates = w.truth
    .ids(PERSON)
    .filter(
      (id) =>
        id !== me &&
        w.truth.get(PERSON, id)?.household === home &&
        w.truth.get(ENTITY, id)?.endedAt === undefined,
    )
    .sort() as AgentId[];
  const done: ActionPlan[] = [];
  let seq = 1;
  for (const who of mates.slice(0, maxTries)) {
    const p = plan(me, "speak", [
      { role: "to", entity: who },
      { role: "content", text: "Dicen que serás grande, es un augurio" },
    ]);
    const report = life.turn(p, seq++);
    done.push(p);
    if (!life.alive || report.events.some((e) => e.kind === "divination.retold")) break;
  }
  return done;
}

export const COMMERCE_PROCESSES = ["life.trade_view", "life.retold"] as const;

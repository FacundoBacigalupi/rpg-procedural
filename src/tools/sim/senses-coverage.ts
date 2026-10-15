// Cobertura dirigida de mirar y suponer (perfil2c-senses). Opt-in del tooling: sin `senses` el
// perfil completo no cambia. Causas de los ceros de perfil2b, medidas en las corridas de 2 años:
// - `life.looking` y `life.ponder`: corren solo ante un `action.look`/`action.ponder` del
//   personaje (verbos del jugador; los NPC no los eligen) y la corrida headless no tiene quien
//   juegue. Acá son dos turnos legales del personaje por el mismo `Life.turn` del jugador.
// Los demás ceros de esa lista tienen otra causa (ver ROADMAP, perfil2c-senses): `life.neighbors`
// y `life.keep` ya corren con `--rescue`/`full-profile-focus` (hogares apretados y promesas
// vencidas), `life.mark_exposure` y `life.born_taboos_settle` dependen de cableados abiertos.
import type { AgentId } from "../../core/index.ts";
import type { Life } from "../../game/index.ts";
import type { ActionPlan } from "../../sim/index.ts";

/** Lo que el personaje supone del campo: cae en el catálogo de afirmaciones (`claimOfText`). */
export const SENSES_PONDER_TEXT = "el campo rinde más en verano";

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
 * Turnos dirigidos del personaje: mirar a los presentes (`life.looking` escribe lo visto) y
 * suponer en voz baja qué hace rendir al campo (`life.ponder` formula la hipótesis). Devuelve los
 * planes ejecutados, para el reporte de reproducción.
 */
export function runSensesTurns(life: Life, firstSeq = 1): ActionPlan[] {
  const me = life.player;
  const done: ActionPlan[] = [];
  let seq = firstSeq;
  for (const p of [
    plan(me, "look", []),
    plan(me, "ponder", [{ role: "about", text: SENSES_PONDER_TEXT }]),
  ]) {
    if (!life.alive) break;
    life.turn(p, seq++);
    done.push(p);
  }
  return done;
}

export const SENSES_PROCESSES = ["life.looking", "life.ponder"] as const;

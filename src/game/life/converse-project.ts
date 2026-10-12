// Opt-in: la respuesta se decide sobre el snapshot de decide; cara y noticias se proyectan en
// physics desde respuestas ya confirmadas, antes de settle y de percibir al cierre del paso.
import { type AgentId, compareStrings, type Tick } from "../../core/index.ts";
import {
  adjustFace,
  FACE,
  type Face,
  HEARD,
  type Heard,
  type HeardClaim,
  hear,
  type ProcessDef,
  type ReadonlyWorldTruth,
  type StateChange,
  setComponent,
} from "../../sim/index.ts";

export type ConverseProjectionEffect =
  | { readonly kind: "face"; readonly actor: AgentId; readonly delta: number; readonly at: Tick }
  | { readonly kind: "heard"; readonly actor: AgentId; readonly claim: HeardClaim };

export const CONVERSATION_EFFECTS_KEY = "conversationEffects";
export const CONVERSE_PROJECTION_PROCESS = "life.converse_projection";

/** Operaciones semánticas en orden de confirmación; no mezcla snapshots tomados en paralelo. */
export function foldConversationEffects(
  truth: ReadonlyWorldTruth,
  effects: readonly ConverseProjectionEffect[],
): StateChange[] {
  const faces = new Map<AgentId, Face>();
  const heard = new Map<AgentId, Heard>();
  for (const effect of effects) {
    if (effect.kind === "face") {
      faces.set(
        effect.actor,
        adjustFace(
          faces.get(effect.actor) ?? truth.get(FACE, effect.actor),
          effect.delta,
          effect.at,
        ),
      );
    } else {
      heard.set(
        effect.actor,
        hear(heard.get(effect.actor) ?? truth.get(HEARD, effect.actor), effect.claim),
      );
    }
  }
  return [
    ...[...faces]
      .sort(([a], [b]) => compareStrings(a, b))
      .map(([actor, value]) => setComponent(FACE, actor, value)),
    ...[...heard]
      .sort(([a], [b]) => compareStrings(a, b))
      .map(([actor, value]) => setComponent(HEARD, actor, value)),
  ];
}

export function converseProjectionProcess(): ProcessDef {
  return {
    id: CONVERSE_PROJECTION_PROCESS,
    system: "life",
    scope: "world",
    representation: "individual",
    phase: "physics",
    cadence: { local: "onEvent", scene: "onEvent" },
    withRecent: true,
    reads: [FACE.name, HEARD.name],
    writes: [FACE.name, HEARD.name],
    run(ctx) {
      const effects = ctx.recent.flatMap((event) =>
        event.kind === "action.speak"
          ? ((event.data as { readonly conversationEffects?: readonly ConverseProjectionEffect[] })
              .conversationEffects ?? [])
          : [],
      );
      return { changes: foldConversationEffects(ctx.truth, effects) };
    },
  };
}

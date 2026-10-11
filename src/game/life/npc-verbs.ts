// El NPC ejecuta el verbo que decidió (actions §10, npc-c): la candidata ganadora de `life.decide`
// (`life.decision`) se vuelve un `ActionPlan` de fuente `utility` y entra a `life.plan` como el del
// personaje; `life.act` lo resuelve con la misma tirada, eventos y aprendizaje. Opt-in por verbo
// (`NpcVerbsOptions.verbs`): apagado, la decisión sigue sin mover nada salvo lo que ya ejecutan
// `life.routine` (comer, hervir, descansar, ir) y `life.lend`/`life.pawn_decide`.

import type { AgentId, Tick } from "../../core/index.ts";
import {
  type ActionCatalog,
  type ActionPlan,
  type ArgValue,
  ENTITY,
  type ProcessDef,
  setComponent,
  table,
} from "../../sim/index.ts";
import { ACT_PROCESS, FRESH_CURSOR, PLAN_STATE, type PlanState, planKey } from "./act.ts";
import { type Decision, NPC_DECISION } from "./decide.ts";

export const NPC_VERBS_PROCESS = "life.npc_verbs";

export interface NpcVerbsOptions {
  readonly catalog: ActionCatalog;
  /** Verbos de la decisión que se ejecutan (el resto sigue como hasta ahora). */
  readonly verbs: readonly string[];
  readonly day: number;
  /** El personaje decide por su cuenta: queda afuera. */
  readonly player: AgentId;
}

/** Qué decisión ya se volvió plan, para no repetirla cada hora mientras siga vigente. */
export const NPC_VERB_LOG = table<{ readonly at: Tick; readonly id: string }>("life.npc_verb_log");

const ENTITY_PART = /^(agent|place):/;
/** Ids con partes propias de otro proceso (pedir prestado, empeñar, ir hacia): no son del catálogo. */
const SPECIAL_PART = /^(borrow|pawn|toward):/;

/**
 * El plan de una decisión del catálogo (puro): el id es `<verbo>:<parte>+<parte>` con las partes en
 * el orden de los argumentos del verbo (`idOf` de `utility-verbs`). Lo que no encaja, un verbo
 * desconocido o un id con partes de otro proceso, no se ejecuta (`undefined`).
 */
export function planFromDecision(
  decision: Pick<Decision, "id" | "verb"> & Partial<Pick<Decision, "act">>,
  catalog: ActionCatalog,
  actor: AgentId,
): ActionPlan | undefined {
  const def = catalog.verb(decision.verb);
  const prefix = `${decision.verb}:`;
  if (!def || !decision.id.startsWith(prefix)) return undefined;
  const rest = decision.id.slice(prefix.length);
  const parts = rest === "" ? [] : rest.split("+");
  if (parts.some((p) => SPECIAL_PART.test(p))) return undefined;
  const args: ArgValue[] = [];
  let next = 0;
  for (const a of def.args) {
    if (a.kind === "duration") {
      // La duración por defecto no deja parte en el id; se usa la del verbo.
      if (a.required) return undefined;
      continue;
    }
    const part = parts[next];
    if (part === undefined) {
      if (a.required) return undefined;
      continue;
    }
    if (a.kind === "text") {
      if (ENTITY_PART.test(part)) {
        if (a.required) return undefined;
        continue;
      }
      args.push({ role: a.role, text: part });
    } else {
      if (!ENTITY_PART.test(part)) {
        if (a.required) return undefined;
        continue;
      }
      args.push({ role: a.role, entity: part as never });
    }
    next++;
  }
  if (next !== parts.length) return undefined;
  // El acto de habla declarado por la candidata viaja con el contenido (vacío si no dice palabras).
  if (decision.act && decision.verb === "speak") {
    const at = args.findIndex((a) => a.role === "content" && "text" in a);
    const spoken = args[at];
    if (at >= 0 && spoken && "text" in spoken) args[at] = { ...spoken, act: decision.act };
    else args.push({ role: "content", text: "", act: decision.act });
  }
  return {
    actor,
    source: "utility",
    root: { kind: "do", verb: decision.verb, args, manner: [] },
    manner: [],
    causes: [{ kind: "state", entity: actor, key: "utility" }],
  };
}

/** Convierte la decisión vigente en plan y lo agenda para `life.act`; un plan en curso no se pisa. */
export function npcVerbsProcess(o: NpcVerbsOptions): ProcessDef {
  const allowed = new Set(o.verbs);
  return {
    id: NPC_VERBS_PROCESS,
    system: "life",
    scope: "agent",
    cadence: { local: "hour", scene: "hour" },
    representation: "individual",
    phase: "decide",
    reads: [NPC_DECISION.name, PLAN_STATE.name, ENTITY.name, NPC_VERB_LOG.name],
    writes: [PLAN_STATE.name, NPC_VERB_LOG.name],
    run(ctx) {
      const me = ctx.scope as AgentId;
      const truth = ctx.truth;
      if (me === o.player || truth.get(ENTITY, me)?.endedAt !== undefined) return {};
      const decision = truth.get(NPC_DECISION, me);
      if (!decision || !allowed.has(decision.verb) || ctx.now - decision.at >= o.day) return {};
      const done = truth.get(NPC_VERB_LOG, me);
      if (done && done.at === decision.at && done.id === decision.id) return {};
      const state = truth.get(PLAN_STATE, me);
      if (state && !state.done) return {};
      const plan = planFromDecision(decision, o.catalog, me);
      if (!plan) return {};
      const seq = (state?.seq ?? 0) + 1;
      const next: PlanState = {
        seq,
        plan,
        cursor: FRESH_CURSOR,
        lastBelieved: null,
        steps: [],
        done: false,
      };
      return {
        changes: [
          setComponent(PLAN_STATE, me, next),
          setComponent(NPC_VERB_LOG, me, { at: decision.at, id: decision.id }),
        ],
        schedule: [
          {
            at: (ctx.now + 1) as Tick,
            phase: "act",
            process: ACT_PROCESS,
            scope: me,
            reason: { kind: "state", entity: me, key: planKey(seq) },
          },
        ],
      };
    },
  };
}

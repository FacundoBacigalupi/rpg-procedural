// La herramienta de la casa en el plan del NPC (perfil2-item-claims-item-demand-npc): quien sale a
// trabajar con una plantilla (ir al campo, trabajar, volver) y tiene en su casa una herramienta que
// sirve para ese trabajo la agarra antes de salir (`take` sobre su `ItemId`), la usa como
// instrumento (`with`) y al volver entra a su casa y la deja (`drop`). Solo lo que está suelto en un
// cuarto de su propia casa, en el hex donde está, entero y sin otro que lo lleve.

import type { AgentId, EntityRef, ItemId } from "../../core/index.ts";
import {
  type ActionCatalog,
  type ActionPlan,
  type ArgValue,
  ENTITY,
  gatherYield,
  houseKey,
  ITEM_HOLD,
  ITEM_LOOK,
  ITEM_WEAR,
  LOCATION,
  PERSON,
  PLACE,
  type ReadonlyWorldTruth,
} from "../../sim/index.ts";

/** Las tablas que lee `withHouseholdTool` (para declararlas en el proceso). */
export const NPC_TOOL_READS = [
  ITEM_HOLD.name,
  ITEM_LOOK.name,
  ITEM_WEAR.name,
  PERSON.name,
  PLACE.name,
] as const;

type Step = ActionPlan["root"];
type DoStep = Extract<Step, { kind: "do" }>;

/** Las formas de herramienta que sirven para `step`, en el orden del catálogo (la primera, la mejor). */
function shapesFor(
  catalog: ActionCatalog,
  truth: ReadonlyWorldTruth,
  step: DoStep,
  /** El lugar al que llega el paso anterior (donde se junta). */
  at: string | undefined,
): string[] {
  const def = catalog.verb(step.verb);
  if (!def || def.instruments.length === 0) return [];
  if (step.args.some((a) => a.role === "with")) return [];
  const kind = at === undefined ? undefined : truth.get(PLACE, at as never)?.kind;
  const good =
    def.resolver === "gather"
      ? gatherYield(def.yields, kind === undefined ? [] : [kind], null)?.good
      : undefined;
  return def.instruments
    .filter((t) => t.good === undefined || t.good === good)
    .flatMap((t) => t.shapes);
}

/**
 * La herramienta suelta en la casa de `me` de alguna de `shapes` (la de forma más alta en la lista,
 * después por id): en el hex donde está, en un cuarto de su casa, sin un agente que la lleve y sin
 * gastar del todo.
 */
export function householdToolFor(
  truth: ReadonlyWorldTruth,
  me: AgentId,
  shapes: readonly string[],
): ItemId | undefined {
  if (shapes.length === 0) return undefined;
  const household = truth.get(PERSON, me)?.household;
  const here = truth.get(LOCATION, me)?.hex;
  if (household === undefined || here === undefined) return undefined;
  const home = houseKey(household);
  let best: { item: ItemId; rank: number } | undefined;
  for (const item of [...truth.ids(ITEM_HOLD)].sort() as ItemId[]) {
    const shape = truth.get(ITEM_LOOK, item)?.shape;
    const rank = shape === undefined ? -1 : shapes.indexOf(shape);
    if (rank < 0 || (best !== undefined && rank >= best.rank)) continue;
    if (truth.get(ENTITY, item)?.endedAt !== undefined) continue;
    if (String(truth.get(ITEM_HOLD, item)?.possession ?? "").startsWith("agent:")) continue;
    const loc = truth.get(LOCATION, item);
    if (loc?.hex !== here) continue;
    if (loc.space !== home && !String(loc.space ?? "").startsWith(`${home}/`)) continue;
    if ((truth.get(ITEM_WEAR, item)?.wear ?? 0) >= 1) continue;
    best = { item, rank };
  }
  return best?.item;
}

/**
 * El plan de una plantilla con la herramienta de la casa (puro): si la secuencia tiene un paso que
 * acepta instrumento y termina volviendo (`move`), y en la casa hay una que sirve, agrega la toma al
 * principio, el `with` en los pasos que la aceptan, la casa como espacio del último `move` y el
 * `drop` al final. Si no, el plan tal cual.
 */
export function withHouseholdTool(
  plan: ActionPlan,
  catalog: ActionCatalog,
  truth: ReadonlyWorldTruth,
  me: AgentId,
): ActionPlan {
  const root = plan.root;
  if (root.kind !== "seq") return plan;
  const last = root.steps[root.steps.length - 1];
  if (last?.kind !== "do" || last.verb !== "move") return plan;
  const household = truth.get(PERSON, me)?.household;
  if (household === undefined) return plan;
  let shapes: string[] = [];
  let at: string | undefined;
  for (const s of root.steps) {
    if (s.kind !== "do") continue;
    if (s.verb === "move") {
      const to = s.args.find((a) => a.role === "to");
      at = to && "entity" in to ? to.entity : at;
      continue;
    }
    shapes = shapesFor(catalog, truth, s, at);
    if (shapes.length > 0) break;
  }
  const item = householdToolFor(truth, me, shapes);
  if (item === undefined) return plan;
  const tool: ArgValue = { role: "with", entity: item as unknown as EntityRef };
  const what: ArgValue = { role: "what", entity: item as unknown as EntityRef };
  const steps = root.steps.map((s, i): Step => {
    if (s.kind !== "do") return s;
    if (i === root.steps.length - 1) {
      return { ...s, args: [...s.args, { role: "space", text: houseKey(household) }] };
    }
    const def = catalog.verb(s.verb);
    const fits = def?.instruments.some((t) =>
      t.shapes.includes(truth.get(ITEM_LOOK, item)?.shape ?? ""),
    );
    return fits ? { ...s, args: [...s.args, tool] } : s;
  });
  return {
    ...plan,
    root: {
      ...root,
      steps: [
        { kind: "do", verb: "take", args: [what], manner: [] },
        ...steps,
        { kind: "do", verb: "drop", args: [what], manner: [] },
      ],
    },
  };
}

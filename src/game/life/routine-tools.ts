// La herramienta de la casa en la rutina de campo (perfil2-item-claims-item-demand-routine): quien sale
// de su casa al campo agarra la herramienta de trabajar la tierra que esté suelta ahí (azada, hoz:
// los `instruments` de `work`), cada hora de campo con ella rinde más y la gasta como en `toolFor`,
// y al volver a su casa la deja, otra vez del hogar. Desde `life-55` (use-tools-mend-npc), al dejarla
// la cuida: si está mellada y en la casa hay piedra de afilar, la afila; si la piedra ya no alcanza
// (mucho metal comido) o no hay piedra y está muy gastada, la lleva al herrero y le paga el arreglo.

import {
  type AgentId,
  type EntityRef,
  externalAccount,
  type HolderRef,
  holderAccount,
  type ItemId,
  type LedgerAccount,
  type LedgerUnit,
  type SpaceKey,
} from "../../core/index.ts";
import {
  type ActionDef,
  COPPER,
  deleteComponent,
  ENTITY,
  type EventDraft,
  ITEM_HOLD,
  ITEM_LOOK,
  ITEM_WEAR,
  LOCATION,
  type Location,
  mendQuote,
  PERSON,
  type ReadonlyWorldTruth,
  SHARPEN_GRIND,
  type StateChange,
  setComponent,
  WORKSHOP_WASTE,
} from "../../sim/index.ts";
import { householdToolFor } from "./npc-tools.ts";
import { IRON_UNIT, SMITH, smithLevelAfterJob, smithOf } from "./smith.ts";

export const ROUTINE_TOOL_TAKEN = "routine.took_tool";
export const ROUTINE_TOOL_RETURNED = "routine.returned_tool";
export const ROUTINE_TOOL_SHARPENED = "routine.sharpened_tool";
export const ROUTINE_TOOL_MENDED = "routine.mended_tool";

/** Lo mellada (desgaste sobre el metal comido) desde la que un NPC afila al volver (sin calibrar). */
export const NPC_SHARPEN_DULL = 0.25;
/** Metal comido desde el que la piedra ya no alcanza y la lleva al herrero (sin calibrar). */
export const NPC_MEND_GROUND = 0.3;
/** Sin piedra en la casa, desgaste desde el que la lleva al herrero (sin calibrar). */
export const NPC_MEND_WEAR = 0.6;

/** Un asiento del paso: el evento (índice en `events`) y lo que mueve. */
export interface RoutineToolPosting {
  readonly at: number;
  readonly transfers: readonly {
    readonly from: LedgerAccount;
    readonly to: LedgerAccount;
    readonly unit: LedgerUnit;
    readonly amount: number;
  }[];
}

/** Lo que el cuidado de la herramienta lee del ledger (cobre de la bolsa, hierro del hogar del herrero). */
export interface RoutineMendBalances {
  readonly balance: (account: LedgerAccount, unit: LedgerUnit) => number;
}

export interface RoutineToolStep {
  readonly changes: StateChange[];
  readonly events: EventDraft[];
  /** Lo que multiplica la cosecha de esta hora (1 sin herramienta o gastada del todo). */
  readonly rate: number;
  /** La herramienta con la que trabaja esta hora, si hay. */
  readonly tool?: ItemId;
  /** Asientos del arreglo del herrero (cobre al herrero, hierro a la fragua). */
  readonly postings?: readonly RoutineToolPosting[];
}

function inHome(space: SpaceKey | undefined, home: SpaceKey): boolean {
  return space !== undefined && (space === home || space.startsWith(`${home}/`));
}

/** La herramienta de campo que `me` lleva encima (la primera por id), si lleva alguna. */
function carriedTool(
  truth: ReadonlyWorldTruth,
  me: AgentId,
  shapes: readonly string[],
): ItemId | undefined {
  for (const item of [...truth.ids(ITEM_HOLD)].sort() as ItemId[]) {
    if (truth.get(ITEM_HOLD, item)?.possession !== me) continue;
    if (truth.get(ENTITY, item)?.endedAt !== undefined) continue;
    if (shapes.includes(truth.get(ITEM_LOOK, item)?.shape ?? "")) return item;
  }
  return undefined;
}

/**
 * El paso de herramienta de una hora de rutina (puro). En el campo (`atFields`): si no lleva una y
 * sale de un cuarto de su casa, agarra la suelta que sirva (`householdToolFor`); con una entera, la
 * hora rinde `1 + (rate - 1)·(1 - wear)` y la gasta `1 / hours`. Volviendo a su casa (`there` es un
 * cuarto de su casa) con una herramienta de campo encima, la deja ahí como del hogar.
 */
export function routineToolStep(input: {
  readonly truth: ReadonlyWorldTruth;
  readonly me: AgentId;
  readonly household: string;
  readonly home: SpaceKey;
  readonly here: Location | undefined;
  readonly there: Location | undefined;
  readonly atFields: boolean;
  /** Si la hora de campo trabaja la tierra (no en invierno ni de chico): si no, no la agarra ni gasta. */
  readonly working: boolean;
  readonly instruments: ActionDef["instruments"];
  readonly place: EventDraft["place"];
  /** Desde `life-55`: al dejarla en la casa la afila o la lleva al herrero (`careForTool`). */
  readonly mend?: RoutineMendBalances;
}): RoutineToolStep {
  const { truth, me, home, instruments } = input;
  const shapes = instruments.flatMap((t) => t.shapes);
  const changes: StateChange[] = [];
  const events: EventDraft[] = [];
  if (shapes.length === 0) return { changes, events, rate: 1 };
  let tool = carriedTool(truth, me, shapes);
  const cause = [{ kind: "state" as const, entity: me as EntityRef, key: "routine" }];
  if (input.atFields) {
    if (!input.working) return { changes, events, rate: 1 };
    if (tool === undefined && inHome(input.here?.space, home)) {
      const pick = householdToolFor(truth, me, shapes);
      const hold = pick === undefined ? undefined : truth.get(ITEM_HOLD, pick);
      if (pick !== undefined && hold !== undefined) {
        changes.push(
          setComponent(ITEM_HOLD, pick, { ...hold, possession: me as unknown as HolderRef }),
          deleteComponent(LOCATION, pick),
        );
        events.push({
          kind: ROUTINE_TOOL_TAKEN,
          actors: [me],
          place: input.place,
          data: { item: pick, shape: truth.get(ITEM_LOOK, pick)?.shape ?? "" },
          emissions: { sight: 0.2, sound: 0.05 },
          causes: cause,
        });
        tool = pick;
      }
    }
    if (tool === undefined) return { changes, events, rate: 1 };
    const shape = truth.get(ITEM_LOOK, tool)?.shape ?? "";
    const spec = instruments.find((t) => t.shapes.includes(shape));
    const row = truth.get(ITEM_WEAR, tool);
    const wear = row?.wear ?? 0;
    if (spec === undefined || wear >= 1) return { changes, events, rate: 1 };
    const worn = Math.min(1, Math.round((wear + 1 / spec.hours) * 1e6) / 1e6);
    changes.push(setComponent(ITEM_WEAR, tool, { ...row, wear: worn }));
    return { changes, events, rate: 1 + (spec.rate - 1) * (1 - wear), tool };
  }
  const there = input.there;
  if (tool !== undefined && there !== undefined && inHome(there.space, home)) {
    const hold = truth.get(ITEM_HOLD, tool);
    if (hold !== undefined) {
      changes.push(
        setComponent(ITEM_HOLD, tool, {
          ...hold,
          possession: input.household as unknown as HolderRef,
        }),
        setComponent(LOCATION, tool, there),
      );
      events.push({
        kind: ROUTINE_TOOL_RETURNED,
        actors: [me],
        place: input.place,
        data: { item: tool, shape: truth.get(ITEM_LOOK, tool)?.shape ?? "" },
        emissions: { sight: 0.1 },
        causes: cause,
      });
      if (input.mend !== undefined) {
        const care = careForTool(truth, me, input.household, tool, input.mend, input.place);
        if (care !== undefined) {
          const at = events.length;
          changes.push(...care.changes);
          events.push(care.event);
          return {
            changes,
            events,
            rate: 1,
            ...(care.transfers.length > 0 ? { postings: [{ at, transfers: care.transfers }] } : {}),
          };
        }
      }
    }
  }
  return { changes, events, rate: 1 };
}

/** Si la casa `household` tiene una piedra de afilar entera. */
function hasStone(truth: ReadonlyWorldTruth, household: string): boolean {
  for (const item of truth.ids(ITEM_HOLD)) {
    if (truth.get(ITEM_HOLD, item)?.possession !== (household as unknown as HolderRef)) continue;
    if (truth.get(ENTITY, item)?.endedAt !== undefined) continue;
    if (truth.get(ITEM_LOOK, item)?.shape === "whetstone") return true;
  }
  return false;
}

/**
 * El cuidado de la herramienta que `me` deja en su casa (puro, use-tools-mend-npc). Con mucho metal
 * comido (`NPC_MEND_GROUND`), o sin piedra en la casa y muy gastada (`NPC_MEND_WEAR`), la lleva al
 * herrero vivo: le paga `mendQuote` de su bolsa, el herrero pone el hierro de su hogar, la deja con el
 * filo entero y sube de oficio; si no le alcanza el cobre o al herrero el hierro, no la arregla. Si
 * no, mellada (`NPC_SHARPEN_DULL`) y con piedra, la afila como `tool.sharpen` con una afilada de grado
 * medio (recupera todo el filo sobre el metal comido y come `SHARPEN_GRIND` por unidad).
 */
export function careForTool(
  truth: ReadonlyWorldTruth,
  me: AgentId,
  household: string,
  tool: ItemId,
  ledger: RoutineMendBalances,
  place: EventDraft["place"],
):
  | {
      readonly changes: StateChange[];
      readonly event: EventDraft;
      readonly transfers: RoutineToolPosting["transfers"];
    }
  | undefined {
  const row = truth.get(ITEM_WEAR, tool);
  const wear = row?.wear ?? 0;
  const ground = row?.ground ?? 0;
  const shape = truth.get(ITEM_LOOK, tool)?.shape ?? "";
  const stone = hasStone(truth, household);
  const cause = [{ kind: "state" as const, entity: me as EntityRef, key: "tool_care" }];
  const r6 = (x: number) => Math.round(x * 1e6) / 1e6;
  if (ground >= NPC_MEND_GROUND || (!stone && wear >= NPC_MEND_WEAR)) {
    const smith = smithOf(truth);
    const level = smith === undefined ? undefined : truth.get(SMITH, smith)?.level;
    const forge = smith === undefined ? undefined : truth.get(PERSON, smith)?.household;
    if (smith !== undefined && level !== undefined && forge !== undefined) {
      const q = mendQuote(wear, ground, level);
      const cost = smith === me ? 0 : q.cost;
      const purse = holderAccount(me as unknown as HolderRef);
      const ironFrom = holderAccount(forge as unknown as HolderRef);
      if (ledger.balance(purse, COPPER) >= cost && ledger.balance(ironFrom, IRON_UNIT) >= q.iron) {
        return {
          changes: [
            setComponent(ITEM_WEAR, tool, { ...row, wear: q.ground, ground: q.ground }),
            setComponent(SMITH, smith, { level: smithLevelAfterJob(level) }),
          ],
          event: {
            kind: ROUTINE_TOOL_MENDED,
            actors: smith === me ? [me] : [me, smith],
            place,
            data: { item: tool, shape, smith, paid: cost, iron: q.iron, ground: q.ground },
            emissions: { sight: 0.3, sound: 0.4 },
            causes: cause,
          },
          transfers: [
            ...(cost > 0
              ? [
                  {
                    from: purse,
                    to: holderAccount(smith as unknown as HolderRef),
                    unit: COPPER,
                    amount: cost,
                  },
                ]
              : []),
            {
              from: ironFrom,
              to: externalAccount(WORKSHOP_WASTE),
              unit: IRON_UNIT,
              amount: q.iron,
            },
          ],
        };
      }
    }
  }
  const dull = Math.max(0, wear - ground);
  if (!stone || dull < NPC_SHARPEN_DULL) return undefined;
  const ground2 = Math.min(1, r6(ground + SHARPEN_GRIND * dull));
  const wear2 = Math.max(ground2, r6(wear - dull));
  return {
    changes: [setComponent(ITEM_WEAR, tool, { ...row, wear: wear2, ground: ground2 })],
    event: {
      kind: ROUTINE_TOOL_SHARPENED,
      actors: [me],
      place,
      data: { item: tool, shape, wear: wear2, ground: ground2 },
      emissions: { sight: 0.2, sound: 0.2 },
      causes: cause,
    },
    transfers: [],
  };
}

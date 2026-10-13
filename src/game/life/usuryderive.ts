// Deriva `UsuryOptions` del mundo en vez de pasarlo a mano (economy §8, culture §2): `prohibits` sale
// de lo que sostiene la gente del hogar prestamista (rasgo cultural de interés, ponderado por firmeza),
// `available` de lo que el prestamista realmente tiene a mano, `believedValue` de la tasación creída
// del observador (su ojo, con un error determinista por observador). Todo puro y opt-in: se pasa en
// `LifeParts.loanUsury` solo si quien arma la vida lo pide; sin esto nada cambia.

import type { AgentId, Ledger } from "../../core/index.ts";
import {
  clampTemper,
  type DisguiseKind,
  ENTITY,
  INNATE,
  PERSON,
  PERSON_CULTURE,
  type ReadonlyWorldTruth,
  standardize,
  type Trait,
} from "../../sim/index.ts";
import type { UsuryOptions } from "./loans.ts";

/** Gente viva del hogar. */
function livingMembers(truth: ReadonlyWorldTruth, home: string): AgentId[] {
  return [...truth.ids(PERSON)]
    .sort()
    .filter(
      (id) =>
        truth.get(PERSON, id)?.household === home && truth.get(ENTITY, id)?.endedAt === undefined,
    ) as AgentId[];
}

/**
 * La cultura del hogar prohíbe el interés si, entre quienes sostienen el rasgo `traitId`, el peso
 * (firmeza) de las variantes en `prohibitedVariants` supera al resto. Sin nadie que lo sostenga, no.
 */
export function culturalUsuryBan(
  traitId: string,
  prohibitedVariants: readonly string[],
): UsuryOptions["prohibits"] {
  return (truth, home) => {
    let ban = 0;
    let allow = 0;
    for (const id of livingMembers(truth, home)) {
      const h = truth.get(PERSON_CULTURE, id)?.holdings[traitId];
      if (!h) continue;
      if (prohibitedVariants.includes(h.variant)) ban += h.strength;
      else allow += h.strength;
    }
    return ban > allow;
  };
}

/**
 * Disfraces que el prestamista realmente puede armar: los que piden un bien (venta con recompra,
 * precio inflado, regalo) solo si tiene algo que dar (`goodsHeld > 0`); el trabajo, si el mercado
 * tiene jornal (`wagePerDay > 0`).
 */
export function availableDisguises(o: {
  readonly goodsHeld: (
    truth: ReadonlyWorldTruth,
    home: string,
    ledger?: Pick<Ledger, "balance" | "holdings">,
  ) => number;
  readonly wagePerDay?: number;
}): (
  truth: ReadonlyWorldTruth,
  home: string,
  ledger?: Pick<Ledger, "balance" | "holdings">,
) => readonly DisguiseKind[] {
  return (truth, home, ledger) => {
    const out: DisguiseKind[] = [];
    const held = ledger ? o.goodsHeld(truth, home, ledger) : o.goodsHeld(truth, home);
    if (held > 0) out.push("buyback", "inflated_price", "gift");
    if ((o.wagePerDay ?? 0) > 0) out.push("labor");
    return out;
  };
}

/** Hash entero estable de un id (sin RNG ni reloj). */
function hashId(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619) >>> 0;
  return h;
}

/**
 * Tasación creída del observador: el principal por un factor que se desvía hasta `error` según lo
 * poco que ve (`eyeOf`, 0-1; con 1 no se equivoca); el signo del desvío es fijo por observador.
 */
export function believedPrincipal(o: {
  readonly error?: number;
  readonly eyeOf?: (truth: ReadonlyWorldTruth, observer: AgentId) => number;
}): (truth: ReadonlyWorldTruth, observer: AgentId, principal: number) => number {
  const error = o.error ?? 0.3;
  return (truth, observer, principal) => {
    const eye = Math.min(1, Math.max(0, o.eyeOf?.(truth, observer) ?? 0.5));
    const sign = ((hashId(observer as string) % 2001) - 1000) / 1000;
    return Math.max(0, Math.round(principal * (1 + sign * error * (1 - eye)) * 1e6) / 1e6);
  };
}

/** Ojo del observador desde su percepción innata (0,5 más o menos 0,35 por desvío). */
export function eyeByPerception(traits: readonly Trait[]) {
  return (truth: ReadonlyWorldTruth, who: AgentId): number => {
    const innate = truth.get(INNATE, who);
    if (!innate) return 0.5;
    const z = standardize(innate, traits, truth.get(PERSON, who)?.sex ?? "female");
    return Math.min(1, Math.max(0, 0.5 + 0.35 * clampTemper(z["perception"] ?? 0)));
  };
}

export interface DeriveUsuryInput {
  readonly traitId: string;
  readonly prohibitedVariants: readonly string[];
  readonly goodsHeld: (
    truth: ReadonlyWorldTruth,
    home: string,
    ledger?: Pick<Ledger, "balance" | "holdings">,
  ) => number;
  readonly wagePerDay?: number;
  readonly visibility?: Partial<Record<DisguiseKind, number>>;
  readonly tolerance?: number;
  readonly error?: number;
  readonly eyeOf?: (truth: ReadonlyWorldTruth, observer: AgentId) => number;
  readonly communityCase?: UsuryOptions["communityCase"];
}

/** Arma `UsuryOptions` con las tres piezas derivadas del mundo. */
export function deriveUsury(i: DeriveUsuryInput): UsuryOptions {
  return {
    prohibits: culturalUsuryBan(i.traitId, i.prohibitedVariants),
    available: availableDisguises({
      goodsHeld: i.goodsHeld,
      ...(i.wagePerDay !== undefined ? { wagePerDay: i.wagePerDay } : {}),
    }),
    ...(i.visibility ? { visibility: i.visibility } : {}),
    ...(i.wagePerDay !== undefined ? { wagePerDay: i.wagePerDay } : {}),
    ...(i.communityCase ? { communityCase: i.communityCase } : {}),
    suspicion: {
      ...(i.tolerance !== undefined ? { tolerance: i.tolerance } : {}),
      believedValue: believedPrincipal({
        ...(i.error !== undefined ? { error: i.error } : {}),
        ...(i.eyeOf ? { eyeOf: i.eyeOf } : {}),
      }),
    },
  };
}

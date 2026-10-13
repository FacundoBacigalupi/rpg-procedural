// Foco opt-in del perfil completo (perfil2c-contagion-workout): FULL_PROFILE solo configura procesos
// que necesitan entidades del escenario (un portador, un sanador, un préstamo entre hogares reales),
// así que quedan en 0 llamadas efectivas. Con el seed fijo se crea una Life de sondeo, se leen sus
// personas y hogares y se derivan las semillas; las opciones resultantes son JSON y viajan en
// `setup.life` (replay desde seed). No cambia FULL_PROFILE ni los defaults del motor.

import type { Content } from "../../core/index.ts";
import { holderAccount } from "../../core/index.ts";
import { Life, type LifeOptions } from "../../game/index.ts";
import {
  ENTITY,
  type PathogenDef,
  PERSON,
  type RemedyDef,
  type SubstanceDef,
  type WorldTruth,
} from "../../sim/index.ts";

const GRAIN = "good:grain";

const FLU: PathogenDef = {
  id: "focus-flu",
  routes: { air: 1, contact: 1 },
  incubationHours: 24,
  courseHours: 96,
  contagiousFrom: 0.5,
  transmissibility: 50,
  lethality: 0,
  immunity: "lifelong",
  immunityHours: 0,
};

const TEA: RemedyDef = {
  id: "focus-tea",
  targets: ["focus-flu"],
  onsetHours: 1,
  peakHours: 6,
  endHours: 48,
  potency: 0.9,
  optimalDose: 1,
  toxicDose: 3,
  placebo: 0.2,
};

// Sustancia suave (alcohol de aldea): dosis ingerida que baja un poco el habla y el dolor.
const BREW: SubstanceDef = {
  id: "focus-brew",
  routes: { ingest: { bioavailability: 0.8, halfHours: 1 } },
  halfLifeHours: 4,
  ec50: 3,
  hill: 1,
  latencyHours: 2,
  toxicThreshold: 0,
  damagePerHourAtDouble: 0,
  repairHalfHours: 24,
  acute: { impairs: { speech: 0.2 }, numbs: 0.1 },
};

/** Personas vivas por hogar, ordenadas por id: el sondeo no depende del orden de inserción. */
function livingByHome(truth: WorldTruth): Map<string, string[]> {
  const out = new Map<string, string[]>();
  for (const id of [...truth.ids(PERSON)].sort()) {
    if (truth.get(ENTITY, id)?.endedAt !== undefined) continue;
    const home = truth.get(PERSON, id)?.household as unknown as string | undefined;
    if (home === undefined) continue;
    out.set(home, [...(out.get(home) ?? []), id as unknown as string]);
  }
  return out;
}

/**
 * Opciones extra sobre `base` que ejercitan contagio de deudas, workout, exposición, medicina,
 * sustancias y nutrición. Determinista dado (seed, content, base).
 */
export function healthDebtFocus(
  seed: number,
  content: Content,
  base: LifeOptions,
  startDay = 1,
): LifeOptions {
  const probe = Life.create(seed, content, base);
  const { truth, ledger, clock } = probe.world;
  const homes = livingByHome(truth);
  const grain = (h: string) =>
    ledger.holdings(holderAccount(h as never)).find((x) => x.unit === GRAIN)?.amount ?? 0;
  const ranked = [...homes.keys()].sort((a, b) => grain(b) - grain(a) || (a < b ? -1 : 1));
  const lender = ranked[0];
  const borrower = ranked[ranked.length - 1];
  if (ranked.length < 4 || lender === undefined || borrower === undefined)
    throw new Error("el foco necesita al menos 4 hogares con vivos");
  const principal = Math.floor(grain(lender) / 2);
  const rate = 0.5;
  // El deudor cae solo si debe más de lo que tiene tras recibir el principal.
  if (principal * rate <= grain(borrower))
    throw new Error("el deudor del foco no cae: principal o tasa insuficientes");
  const middle = ranked.filter((h) => h !== lender && h !== borrower);
  const carrier = homes.get(middle[0] as string)?.[0];
  const healer = homes.get(middle[1] as string)?.[0];
  const drinker = homes.get(middle[2] as string)?.[0];
  if (!carrier || !healer || !drinker)
    throw new Error("el foco necesita portador, sanador y bebedor");
  const at = probe.now + startDay * clock.day;
  return {
    ...base,
    eatenNutrition: true,
    loanContagion: GRAIN,
    loanSeeds: [
      {
        id: "focus-loan",
        lender,
        borrower,
        good: "grain",
        principal,
        rate,
        startDay,
        termDays: 30,
        collateral: [
          {
            ref: "focus-lot",
            believedValue: principal,
            trueValue: principal,
            heldBy: borrower,
            lot: { unit: GRAIN, amount: grain(borrower) },
          },
        ],
      },
    ],
    pathogenSeeds: [
      { def: FLU, carrier: carrier as never, from: at as never, source: "foco del perfil" },
    ],
    healers: [
      {
        agent: healer as never,
        skill: 1,
        models: [{ id: FLU.id, signature: { fever: 1, weakness: 1 }, prior: 0 }],
        remedies: [TEA],
        remedyFor: { [FLU.id]: TEA.id },
        isolation: 1,
        compliance: 1,
      },
    ],
    substanceDoses: [
      {
        def: BREW,
        who: drinker as never,
        at: at as never,
        route: "ingest",
        amount: 3,
        source: "foco del perfil",
      },
    ],
  };
}

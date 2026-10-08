// Los paneles del personaje (player-loop §9): lo que el usuario puede consultar fuera del turno sin
// que el tiempo pase. Como la `PlayerView`, son un muro con la verdad: ningún número del mundo sale
// de acá. El cuerpo va como signos (`bodySigns`), la habilidad como se ve a sí mismo (su autoimagen,
// skills §9: puede errar; las horas de práctica y el nivel real no salen) y los bienes como los estima a ojo.
//
// En la Fase 1 no hay todavía creencias de inventario (information, Fase 2): lo que "cree tener"
// es lo que tiene, redondeado como lo estimaría él. Cuando haya creencias, un robo que no notó
// sigue figurando acá hasta que revisa.

import type { HolderRef, LedgerUnit } from "../../core/index.ts";
import { holderAccount, ledgerUnit } from "../../core/index.ts";
import {
  BODY_STATE,
  bodySigns,
  COPPER,
  houseKey,
  LOCATION,
  MEAL_KCAL,
  PERSON,
  PLACE,
  SELF_IMAGES,
  SKILL_STATE,
  type SkillStanding,
  STATUS,
  seedSelfImage,
  skillStandingOf,
} from "../../sim/index.ts";
import { acquaintances } from "./view.ts";
import { type LifeWorld, living } from "./world.ts";

/** Cuánto hay de algo a ojo. */
export type Amount = "a_little" | "some" | "plenty";

/** Para cuánto alcanza la despensa, a ojo. */
export type Lasts = "empty" | "days" | "weeks" | "months" | "a_year";

/** Dispersión de la autoimagen desde la cual está seguro de lo que cree. */
const SURE_SPREAD = 0.1;

export interface CharacterPanel {
  /** Los años que sabe que tiene. */
  readonly ageYears: number;
  readonly sex: "female" | "male";
  /** Dónde está, como lo nombraría. */
  readonly where: { readonly home: boolean; readonly placeKinds: readonly string[] };
  /** Cómo se siente: signos generales y por zona (con el nombre de la zona del plan corporal). */
  readonly body: {
    readonly general: readonly string[];
    readonly zones: readonly { readonly zone: string; readonly signs: readonly string[] }[];
  };
  /** Su lugar en la aldea, como lo sabe él (social-structure §13). */
  readonly status?: string;
  /** Su gente, por la relación que sabe que tiene, y si vive (de lo que sabe). */
  readonly family: readonly { readonly relation: string }[];
  /** Lo que cree que sabe hacer (su autoimagen, no la verdad ni las horas), sin niveles. */
  readonly skills: readonly {
    readonly id: string;
    readonly name: string;
    readonly standing: SkillStanding;
    /** Si ya se conoce lo bastante como para estar seguro. */
    readonly sure: boolean;
  }[];
}

export interface InventoryPanel {
  /** Monedas de cobre que lleva (se cuentan, no se estiman). */
  readonly coins: number;
  readonly carried: readonly { readonly good: string; readonly amount: Amount }[];
  readonly larder: readonly { readonly good: string; readonly lasts: Lasts }[];
}

export function characterPanel(w: LifeWorld): CharacterPanel {
  const me = w.truth.get(PERSON, w.player);
  const at = w.truth.get(LOCATION, w.player);
  const body = w.truth.get(BODY_STATE, w.player);
  if (!me || !at || !body) throw new Error("el personaje no tiene persona, lugar o cuerpo");
  const plan = w.plans.find((p) => p.id === body.plan);
  const signs = plan ? bodySigns(plan, body) : { general: [], zones: [] };
  const mine = w.truth.get(STATUS, w.player);
  const statusName = w.statuses.find((d) => d.id === mine?.status)?.name;
  const zoneName = (id: string) => plan?.zones.find((z) => z.id === id)?.name ?? id;
  const alive = new Set(living(w.truth));
  const images = w.truth.get(SELF_IMAGES, w.player);
  const skills = Object.entries(w.truth.get(SKILL_STATE, w.player) ?? {})
    .flatMap(([id, s]) => {
      const def = w.skills.skill(id);
      // Una vida sin autoimagen guardada (anterior a este modelo) se ve como lo siembra la infancia.
      const image = images?.[id] ?? (def ? seedSelfImage(def, s, {}, w.scheduler.now) : undefined);
      if (!image) return [];
      return [
        {
          id,
          name: def?.name ?? id,
          standing: skillStandingOf(image.estimate.level),
          sure: image.estimate.spread <= SURE_SPREAD,
        },
      ];
    })
    .sort((a, b) => (a.id < b.id ? -1 : 1));
  const places = w.truth.ids(PLACE).flatMap((id) => {
    const p = w.truth.get(PLACE, id);
    return p?.hexes.includes(at.hex) ? [p.kind] : [];
  });
  return {
    ageYears: Math.floor((w.scheduler.now - me.born) / w.clock.year),
    sex: me.sex,
    ...(statusName === undefined ? {} : { status: statusName }),
    where: { home: at.space === houseKey(me.household), placeKinds: places },
    body: {
      general: signs.general,
      zones: signs.zones.map((z) => ({ zone: zoneName(z.zone), signs: z.signs })),
    },
    // Las muertes que no vio todavía no las sabe; sin creencias (Fase 2), vale lo que hay.
    family: [...acquaintances(w)]
      .filter(([id]) => alive.has(id))
      .flatMap(([, a]) => (a.relation ? [{ relation: a.relation }] : [])),
    skills,
  };
}

function amountOf(grams: number): Amount {
  if (grams >= 5000) return "plenty";
  if (grams >= 500) return "some";
  return "a_little";
}

function lastsOf(days: number): Lasts {
  if (days < 1) return "empty";
  if (days < 10) return "days";
  if (days < 60) return "weeks";
  if (days < 300) return "months";
  return "a_year";
}

export function inventoryPanel(w: LifeWorld): InventoryPanel {
  const me = w.truth.get(PERSON, w.player);
  if (!me) throw new Error("el personaje no tiene persona");
  const name = (unit: LedgerUnit) =>
    w.foods.find((f) => ledgerUnit(`good:${f.id}`) === unit)?.name ?? unit.replace(/^good:/, "");
  const kcal = (unit: LedgerUnit) =>
    w.foods.find((f) => ledgerUnit(`good:${f.id}`) === unit)?.kcalPerGram ?? 0;
  const holdings = (h: HolderRef) =>
    w.ledger
      .holdings(holderAccount(h))
      .filter((x) => x.amount > 0)
      .sort((a, b) => (a.unit < b.unit ? -1 : 1));
  const mouths = living(w.truth).filter(
    (id) => w.truth.get(PERSON, id)?.household === me.household,
  ).length;
  return {
    coins: holdings(w.player as HolderRef).find((h) => h.unit === COPPER)?.amount ?? 0,
    carried: holdings(w.player as HolderRef)
      .filter((h) => h.unit !== COPPER)
      .map((h) => ({ good: name(h.unit), amount: amountOf(h.amount) })),
    larder: holdings(me.household as unknown as HolderRef).map((h) => ({
      good: name(h.unit),
      lasts: lastsOf((h.amount * kcal(h.unit)) / (3 * MEAL_KCAL * Math.max(1, mouths))),
    })),
  };
}

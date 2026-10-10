// Los paneles del personaje (player-loop §9): lo que el usuario puede consultar fuera del turno sin
// que el tiempo pase. Como la `PlayerView`, son un muro con la verdad: ningún número del mundo sale
// de acá. El cuerpo va como signos (`bodySigns`), la habilidad como se ve a sí mismo (su autoimagen,
// skills §9: puede errar; las horas de práctica y el nivel real no salen) y los bienes como los estima a ojo.
//
// Lo que "cree tener" sale de `INVENTORY_BELIEF` (la foto de la última vez que revisó), redondeado
// como lo estimaría él: un robo que no notó sigue figurando hasta que revisa. La foto se toma al
// empezar la vida y `inventoryProcess` la corrige al usar sus bienes (comer, dar, comprar, guardar).

import type { AgentId, EntityRef, HolderRef, LedgerUnit } from "../../core/index.ts";
import { holderAccount, ledgerUnit } from "../../core/index.ts";
import {
  AMENDS,
  affiliationOf,
  BODY_STATE,
  bodySigns,
  bookOf,
  COPPER,
  type DeedKind,
  type GuiltResponse,
  houseKey,
  INFECTION,
  KNOWN_DEEDS,
  LOCATION,
  MEAL_KCAL,
  MENTAL,
  mentionableTastes,
  OWN_DEEDS,
  PERSON,
  PLACE,
  PLEDGE,
  PLEDGE_BOOK,
  RELIGIOUS_IDENTITY,
  RUMORS,
  reputationIn,
  SELF_IMAGES,
  SKILL_STATE,
  type SkillStanding,
  STATUS,
  seedSelfImage,
  skillStandingOf,
  TASTES_OF,
  villageReligion,
} from "../../sim/index.ts";
import { creditRows } from "./credit.ts";
import { INVENTORY_BELIEF } from "./inventory-belief.ts";
import { type SubstancePanel, substancePanel } from "./substance-panel.ts";
import { acquaintances } from "./view.ts";
import { type LifeWorld, living } from "./world.ts";

/** Cuánto hay de algo a ojo. */
export type Amount = "a_little" | "some" | "plenty";

/** Para cuánto alcanza la despensa, a ojo. */
export type Lasts = "empty" | "days" | "weeks" | "months" | "a_year";

/** Dispersión de la autoimagen desde la cual está seguro de lo que cree. */
const SURE_SPREAD = 0.1;

/** Cuánto de una dimensión de la fe siente, en palabras. */
export type FaithLevel = "none" | "faint" | "firm" | "deep";

/** De 0-1 a la palabra con que uno se describe: las raíces de la fe no se cuentan en números. */
export function faithLevel(x: number): FaithLevel {
  if (x < 0.15) return "none";
  if (x < 0.4) return "faint";
  if (x < 0.75) return "firm";
  return "deep";
}

/** Cuánto pesa una carga mental, en palabras. */
export type BurdenLevel = "light" | "heavy" | "crushing";

export function burdenLevel(severity: number): BurdenLevel {
  if (severity < 0.35) return "light";
  if (severity < 0.7) return "heavy";
  return "crushing";
}

/** Desde qué gravedad una condición se nota en el panel. */
export const BURDEN_FROM = 0.1;

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
  /** Lo que sabe que le gusta y lo que rechaza (npc-psychology §16), lo más fuerte primero. */
  readonly tastes: readonly {
    readonly name: string;
    readonly stance: "loves" | "likes" | "dislikes" | "loathes";
  }[];
  /**
   * Su fe, como la vive él (religion §1): lo que cree, cuánto cumple y cuánto se siente parte, en
   * palabras, y las prácticas de su religión que conoce. Nunca dice si lo que cree es cierto.
   */
  readonly faith?: {
    readonly religion: string;
    readonly belief: FaithLevel;
    readonly practice: FaithLevel;
    readonly belonging: FaithLevel;
    /** Las prácticas de su religión (ofrendas, fiestas, tabúes) con su clase, sin pesos. */
    readonly practices: readonly { readonly name: string; readonly kind: string }[];
  };
  /**
   * Cómo se siente por dentro (npc-psychology §11): las cargas que lleva, en palabras, y qué decidió
   * hacer con cada culpa (sin menú: es lo que ya decidió su conciencia, `AMENDS`). Sin números.
   */
  readonly conscience?: {
    readonly burdens: readonly {
      readonly kind: "trauma" | "guilt";
      readonly weight: BurdenLevel;
    }[];
    readonly guilt: readonly {
      readonly deed: string;
      /** A quién, como lo llama (nombre o relación; «alguien» si no lo ubica). */
      readonly other: string;
      readonly stance: GuiltResponse;
    }[];
  };
  /**
   * Su fama en la aldea (information §5), opt-in (`characterPanel(w, { reputation: true })`): solo si
   * ya se nota (la trata distinto), en palabras y sin números. El apodo sale del hecho que más
   * gente cuenta de él (`Reputation.dominant`); el que lo nombra es el narrador/render.
   */
  readonly reputation?: {
    readonly fame: "some" | "many" | "everyone";
    readonly standing: "tainted" | "bad" | "feared";
    readonly nickname: DeedKind | null;
  };
  /** Opt-in: señales perceptibles de sustancias (sin nombre de sustancia), de sí y de los vistos. */
  readonly substances?: SubstancePanel;
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

/** Desde qué fracción de la aldea la fama se nota. */
export const REPUTATION_NOTICED = 0.15;

export interface CharacterPanelOptions {
  readonly reputation?: boolean;
  /** Opt-in: señales de sustancias propias y de los que ve (`substances`). */
  readonly substances?: boolean;
}

export function characterPanel(w: LifeWorld, opts: CharacterPanelOptions = {}): CharacterPanel {
  const me = w.truth.get(PERSON, w.player);
  const at = w.truth.get(LOCATION, w.player);
  const body = w.truth.get(BODY_STATE, w.player);
  if (!me || !at || !body) throw new Error("el personaje no tiene persona, lugar o cuerpo");
  const plan = w.plans.find((p) => p.id === body.plan);
  const signs = plan
    ? bodySigns(plan, body, (w.truth.get(INFECTION, w.player)?.ill.length ?? 0) > 0)
    : { general: [], zones: [] };
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
  const community = villageReligion(w.truth);
  const aff = community
    ? affiliationOf(w.truth.get(RELIGIOUS_IDENTITY, w.player), community.religion)
    : undefined;
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
    tastes: mentionableTastes(
      w.truth.get(TASTES_OF, w.player)?.preferences ?? [],
      w.tastes,
      PANEL_TASTES,
      PANEL_TASTE_STRENGTH,
    ).map((t) => ({ name: t.name, stance: t.stance })),
    ...(community && aff
      ? {
          faith: {
            religion: community.name,
            belief: faithLevel(aff.belief),
            practice: faithLevel(aff.practice),
            belonging: faithLevel(aff.belonging),
            practices: community.practices.map((p) => ({ name: p.name, kind: p.kind })),
          },
        }
      : {}),
    ...conscienceOf(w),
    ...(opts.reputation ? reputationOf(w) : {}),
    ...(opts.substances ? { substances: substancePanel(w) } : {}),
    skills,
  };
}

/** Su fama desde `reputationIn` (solo lectura): vacío si nadie lo conoce todavía o no lo mal creen. */
function reputationOf(w: LifeWorld): Pick<CharacterPanel, "reputation"> | Record<string, never> {
  const rep = reputationIn(
    w.truth.ids(PERSON) as readonly AgentId[],
    w.player,
    (id) => w.truth.get(KNOWN_DEEDS, id),
    (id) => w.truth.get(RUMORS, id),
  );
  if (rep.fame < REPUTATION_NOTICED || rep.standing >= 0) return {};
  return {
    reputation: {
      fame: rep.fame < 0.5 ? "some" : rep.fame < 0.85 ? "many" : "everyone",
      standing: rep.standing > -0.35 ? "tainted" : rep.standing > -0.7 ? "bad" : "feared",
      nickname: rep.dominant,
    },
  };
}

/**
 * La carga interior del personaje: condiciones que pesan (desde `BURDEN_FROM`) y, por cada hecho
 * propio con postura decidida, qué quiere hacer con él. Vacío si no carga nada.
 */
function conscienceOf(w: LifeWorld): Pick<CharacterPanel, "conscience"> | Record<string, never> {
  const burdens = (w.truth.get(MENTAL, w.player)?.conditions ?? [])
    .filter((c) => c.severity >= BURDEN_FROM)
    .map((c) => ({ kind: c.kind, weight: burdenLevel(c.severity) }));
  const amends = w.truth.get(AMENDS, w.player);
  const known = acquaintances(w);
  const guilt = (w.truth.get(OWN_DEEDS, w.player)?.deeds ?? []).flatMap((d) => {
    const stance = amends?.byDeed[d.event];
    if (!stance || stance.response === "none") return [];
    const a = known.get(d.victim);
    return [{ deed: d.kind, other: a?.name ?? a?.relation ?? "alguien", stance: stance.response }];
  });
  return burdens.length + guilt.length === 0 ? {} : { conscience: { burdens, guilt } };
}

/** Cuántos gustos muestra el panel y desde qué fuerza (los que ya se notan de uno mismo). */
export const PANEL_TASTES = 6;
export const PANEL_TASTE_STRENGTH = 0.3;

/** Qué tan seguro está de una entrada del libro. */
export type Surety = "sure" | "unsure" | "vague";

/** Una línea del libro de deudas y promesas, como la lleva el personaje (contracts §14). */
export interface BookLine {
  readonly kind: "debt" | "pledge";
  readonly direction: "i-owe" | "owed-to-me";
  /** A quién, como lo llama (nombre o relación; «alguien» si no sabe). */
  readonly other: string;
  /** Qué: monedas exactas, o el bien a ojo, o un favor/silencio con su texto. */
  readonly what:
    | { readonly kind: "coins"; readonly coins: number }
    | { readonly kind: "good"; readonly good: string; readonly amount: Amount }
    | { readonly kind: "favor"; readonly what: string }
    | { readonly kind: "silence"; readonly about: string };
  /** Días que cree que faltan (negativo: ya pasó); null si no recuerda plazo. */
  readonly dueInDays: number | null;
  readonly sure: Surety;
  /** Una deuda que ya cayó en mora. */
  readonly defaulted: boolean;
}

export interface BookPanel {
  readonly lines: readonly BookLine[];
}

function suretyOf(confidence: number): Surety {
  if (confidence >= 0.7) return "sure";
  if (confidence >= 0.4) return "unsure";
  return "vague";
}

/** El libro del personaje: sus deudas de fiado (exactas) y sus promesas como las cree, nunca la verdad. */
export function bookPanel(w: LifeWorld): BookPanel {
  return { lines: bookLinesOf(w).map((x) => x.line) };
}

/** Las líneas del libro con el id de la contraparte, para filtrar por persona (`qué sé de X`). */
export function bookLinesOf(w: LifeWorld): { readonly ref: AgentId; readonly line: BookLine }[] {
  const now = w.scheduler.now;
  const acq = acquaintances(w);
  const entries = bookOf(
    w.player,
    creditRows(w.truth),
    w.truth.get(PLEDGE_BOOK, w.player),
    now,
    (id) => w.truth.get(PLEDGE, id as EntityRef)?.weight ?? 0.5,
  );
  const goodName = (unit: LedgerUnit) =>
    w.foods.find((f) => ledgerUnit(`good:${f.id}`) === unit)?.name ?? unit.replace(/^good:/, "");
  return entries.map((e) => {
    const t = e.term;
    const what: BookLine["what"] =
      t.kind === "give"
        ? t.unit === COPPER
          ? { kind: "coins", coins: Math.round(t.grams) }
          : { kind: "good", good: goodName(t.unit), amount: amountOf(t.grams) }
        : t.kind === "favor"
          ? { kind: "favor", what: t.what }
          : { kind: "silence", about: t.about };
    const a = acq.get(e.other);
    const line: BookLine = {
      kind: e.kind,
      direction: e.direction,
      other: a?.name ?? a?.relation ?? "alguien",
      what,
      dueInDays: e.due === null ? null : Math.round((e.due - now) / w.clock.day),
      sure: suretyOf(e.confidence),
      defaulted: e.status === "defaulted",
    };
    return { ref: e.other, line };
  });
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
  // Lo que cree tener: la foto de la última vez que revisó. Sin foto (vida anterior o que todavía
  // no contó nada) vale lo que hay, como lo contaría al mirar.
  const believed = w.truth.get(INVENTORY_BELIEF, w.player);
  const carriedNow = believed?.carried ?? holdings(w.player as HolderRef);
  const larderNow = believed?.larder ?? holdings(me.household as unknown as HolderRef);
  return {
    coins: carriedNow.find((h) => h.unit === COPPER)?.amount ?? 0,
    carried: carriedNow
      .filter((h) => h.unit !== COPPER)
      .map((h) => ({ good: name(h.unit), amount: amountOf(h.amount) })),
    larder: larderNow.map((h) => ({
      good: name(h.unit),
      lasts: lastsOf((h.amount * kcal(h.unit)) / (3 * MEAL_KCAL * Math.max(1, mouths))),
    })),
  };
}

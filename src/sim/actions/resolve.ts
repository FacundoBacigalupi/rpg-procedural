// Los resolvers (actions §7, §8): lo que cada verbo cambia en el mundo con el resultado de la
// tirada común (`attempt`). El resultado no es una categoría y nada más: el margen da un grado
// continuo (cuánto rindió, cuán claro habló, con cuánta fuerza pegó), la forma del fracaso cambia
// qué pasa (perderse deja en otro hex; resbalar llega tarde y golpeado; agarrar lo que no era se
// lleva otra cosa) y lo que el actor cree del resultado se arma con la misma forma que la verdad,
// así el narrador y la memoria leen lo creído sin ver la verdad.
//
// Puro y determinista: lee la verdad que le pasan y devuelve cambios, un evento y asientos para el
// scheduler. Lo que sacan, toman o pasan de mano va por el ledger y sale de un titular que lo
// tenía (el stock del lugar, el bolsillo del otro): nada aparece. Lo que todavía no tiene sistema
// (la herida de un golpe, la cosecha que el trabajo adelanta, el precio del trato) queda como
// efecto con grado en el evento, para que lo lea el sistema que llegue (body, economy, dialogue).

import {
  type CauseRef,
  type EntityRef,
  externalAccount,
  type HolderRef,
  holderAccount,
  type LedgerAccount,
  type LedgerUnit,
  ledgerUnit,
  logistic,
  type PlaceRef,
} from "../../core/index.ts";
import {
  defectsOf,
  handsOf,
  type RecipeDef,
  type RecipeDefect,
  runSession,
} from "../crafts/index.ts";
import {
  COPPER,
  DAILY_KCAL,
  type DealBudget,
  DISTRESS_ASK_FACTOR,
  DISTRESS_BID_FACTOR,
  gramsIn,
  HARVEST,
  type HouseholdQuote,
  householdQuote,
  KEEP_DAYS,
  type LotQualities,
  type PriceBeliefs,
  perceivedQuality,
  type QuoteOptions,
  qualityOfUnit,
  qualityPriceFactor,
  strainOf,
  strike as strikeDeal,
  WANT_DAYS,
} from "../economy/index.ts";
import { notorietyEdge } from "../law/index.ts";
import {
  draftEvent,
  type EventDraft,
  type PostingDraft,
  type ReadonlyLedger,
  type StateChange,
  setComponent,
} from "../scheduler/index.ts";
import { deferenceEdge } from "../social/index.ts";
import { hexPath, LOCATION, type LocalMap } from "../world/index.ts";
import {
  type Attempt,
  type AttemptInput,
  actionDuration,
  activeManners,
  attempt,
  type BelievedOutcome,
  CRITICAL_MARGIN,
  type Outcome,
  PARTIAL_MARGIN,
  SUCCESS_MARGIN,
} from "./attempt.ts";
import type { FactorKey, FailureModeId } from "./catalog.ts";
import type { SpeakAct } from "./plan.ts";
import { refTokens } from "./refs.ts";

/** Lo que pesa en el rumbo de un tramo: la visibilidad y los hitos que se ven (travel §11.3). */
export interface Bearing {
  /** Multiplica la chance de torcer el rumbo (`bearingFactor`; 1 = día claro, campo abierto). */
  readonly factor: number;
  /** Hexes con un hito a la vista (la aldea, el agua); vacío si no hay luz para verlos. */
  readonly landmarks: ReadonlySet<number>;
}

/** A cuántos hexes se distingue un hito. */
export const LANDMARK_SIGHT_HEXES = 2;

/** Lo que el mundo le da al resolver además de lo que necesita la tirada. */
export interface ResolveInput extends Omit<AttemptInput, "has"> {
  readonly map: LocalMap;
  /** El hex adonde va `move` (el del lugar del argumento, ya elegido por quien arma el paso). */
  readonly destination?: number | undefined;
  /** Cuánto más cuesta caminar hoy por el tiempo (1 = seco y templado; `walkingFactor`). */
  readonly walkFactor?: number | undefined;
  /** Qué tan fácil es torcer el rumbo hoy (1 = día claro; `bearingFactor`) y qué hitos se ven. */
  readonly bearing?: Bearing | undefined;
  /** Lo que tiene cada titular: de acá sale qué hay para tomar, ofrecer o sacar del lugar. */
  readonly ledger: Pick<ReadonlyLedger, "holdings">;
  /** Dónde está el actor: el lugar del evento y el titular del stock que se recolecta. */
  readonly place: PlaceRef;
  /** Por qué: las causas del plan (la intención, las creencias que la sostienen). */
  readonly causes: readonly CauseRef[];
  /** Lo que se come, por unidad del ledger (`good:<id>`): lo pone quien carga `content/foods`. */
  readonly foods?: ReadonlyMap<LedgerUnit, Nutrition>;
  /** La despensa del hogar del actor: de ahí come si no lleva nada encima. */
  readonly larder?: HolderRef | undefined;
  /** Con qué se comercia y se cosecha: sin esto `trade` no mueve nada y `work` no rinde grano. */
  readonly market?: Market | undefined;
  /** Cómo se llama cada unidad en la lengua del jugador: «grano» tiene que dar `good:grain`. */
  readonly unitNames?: ReadonlyMap<LedgerUnit, string> | undefined;
  /** Lo que el actor le debe al destinatario de `give`, por unidad: «le devuelvo» paga eso. */
  readonly owed?: ReadonlyMap<LedgerUnit, number> | undefined;
  /** Las recetas que conoce el mundo: sin ellas, `cook` no tiene qué hacer. */
  readonly recipes?: readonly RecipeDef[] | undefined;
}

/** Lo que el resolver sabe de la economía de la aldea (economy §1, §4): precios base y casas. */
export interface Market {
  /** Precio base por kilo (monedas de cobre) de cada bien que se compra y se vende. */
  readonly priceCopperPerKg: ReadonlyMap<LedgerUnit, number>;
  /** Personas del hogar del actor, para saber cuántos días de comida le quedan. */
  readonly ownMembers: number;
  /** El otro del trato: su despensa y cuántos comen de ella. */
  readonly other?:
    | {
        readonly larder: HolderRef | null;
        readonly members: number;
        /** Su presupuesto de hogar: el tope de monedas y cómo está (economy §3); solo en tratos del jugador. */
        readonly budget?: DealBudget | undefined;
      }
    | undefined;
  /** Cuánto grano rinde una hora de trabajo medio en el campo, en gramos. */
  readonly harvestGramsPerHour?: number | undefined;
  /** La unidad que rinde el campo. */
  readonly harvestGood?: LedgerUnit | undefined;
  /** El rango ritual de cada parte, si lo tiene: de ahí sale la deferencia en el trato. */
  readonly ranks?:
    | { readonly actor: number | undefined; readonly other: number | undefined }
    | undefined;
  /** Qué parte de la aldea sabe de algo malo que hizo el actor, 0-1 (law §2): baja el trato. */
  readonly fame?: number | undefined;
  /**
   * Lo que cada parte cree que vale cada bien (`economy/priceMemory`) y el día del mundo: la base
   * de `askPerKg`/`bidPerKg` de cada una es `baseFor` (lo creído mezclado con el precio de
   * contenido según su fe). Sin esto, las dos usan el precio de contenido.
   */
  readonly beliefs?:
    | {
        readonly actor: PriceBeliefs | undefined;
        readonly other: PriceBeliefs | undefined;
        readonly day: number;
      }
    | undefined;
  /** La calidad de lo que tiene cada parte (`economy/quality`): sin registro vale la referencia. */
  readonly lots?:
    | { readonly actor: LotQualities | undefined; readonly other: LotQualities | undefined }
    | undefined;
}

/** Lo que da un gramo de comida. */
export interface Nutrition {
  readonly kcalPerGram: number;
  /** Litros de agua por gramo. */
  readonly waterPerGram: number;
}

/**
 * Adonde va lo que se come: deja el mundo como bien y entra al cuerpo como kcal y agua (body lo
 * aplica con `ingest`). Quien arma el ledger declara este sumidero con las unidades de comida.
 */
export const EATEN = "eaten";
/**
 * Por donde pasa lo que se cocina: los insumos se van acá y el producto sale de acá. Las dos
 * puntas quedan en el diario del evento de cocinar; el agua que absorbe la masa no se cuenta.
 */
export const COOKED = "cooked";
/** Cuánto busca comer alguien en una comida (kcal): un plato de grano cocido, más o menos. */
export const MEAL_KCAL = 800;
/** Cuánto toma de una vez del pozo, del río o del cántaro (litros). */
export const DRINK_LITERS = 0.75;

export interface Holding {
  readonly unit: LedgerUnit;
  readonly amount: number;
}

/** Qué emite el paso por canal (0-1); perception lo convierte en percepts para los demás. */
export interface ActionEmissions {
  readonly sight: number;
  readonly sound: number;
}

/**
 * Lo que el paso hizo, por verbo. La misma forma sirve para la verdad y para lo que el actor
 * cree: un `null` en lo creído es "no sabe" (perdido, no sabe en qué hex está).
 */
export type VerbEffect =
  | { readonly kind: "none" }
  | {
      readonly kind: "move";
      readonly from: number;
      readonly to: number;
      readonly reached: number | null;
      /** Se cayó o se torció algo en el camino (body lo lee cuando llegue). */
      readonly stumbled: boolean;
      /** Terminó un tramo bien y sigue hacia `to`: la misma hoja del plan sigue en el próximo. */
      readonly onTheWay?: boolean;
      /** Se torció del rumbo sin notarlo: el hex donde cree estar (`reached` es donde está). */
      readonly believedAt?: number;
    }
  | {
      readonly kind: "observe";
      /** Cuán bien miró, 0-1: perception lo usa como atención sobre la escena. */
      readonly acuity: number;
    }
  | {
      readonly kind: "search";
      readonly target: EntityRef | null;
      /** Si está ahí (en lo creído: si cree que está). */
      readonly present: boolean;
      readonly found: boolean;
      /** Lo vio de pasada: sabe que anda cerca, no dónde. */
      readonly glimpsed: boolean;
    }
  | {
      readonly kind: "gather";
      readonly good: LedgerUnit | null;
      readonly amount: number;
      readonly what: string | null;
      readonly stumbled: boolean;
    }
  | {
      readonly kind: "work";
      /** Trabajo que rindió, en segundos de trabajo medio: lo que la tierra o el oficio cobran. */
      readonly effectiveSeconds: number;
      /** Se lastimó trabajando. */
      readonly hurt: boolean;
    }
  | {
      readonly kind: "speak";
      readonly to: EntityRef | null;
      /** Si lo llegó a decir (la duda puede dejarlo en la boca). */
      readonly delivered: boolean;
      /** Cuán claro salió, 0-1: dialogue lo usa para lo que el otro entiende. */
      readonly clarity: number;
      readonly text: string | null;
      /** El acto que declaró quien habla (dialogue §2): su intención, no lo que el otro entiende. */
      readonly act?: SpeakAct | null;
    }
  | {
      readonly kind: "strike";
      readonly target: EntityRef | null;
      /** Si soltó el golpe (la duda lo frena). */
      readonly committed: boolean;
      readonly hit: boolean;
      readonly glancing: boolean;
      /** 0-1: body lo convierte en herida. */
      readonly force: number;
      /** Quedó desequilibrado: el otro tiene un hueco (combat). */
      readonly offBalance: boolean;
      /** La pelea que siguió, si la hubo (la pone `game` con `sim/combat`; el resolver no la sabe). */
      readonly fight?: FightGist;
      /** Lo remató estando a su merced (la pone `game`: el resolver no sabe de rendiciones). */
      readonly finished?: boolean;
    }
  | {
      /** Perdonar a quien se rindió: dejarlo ir. */
      readonly kind: "spare";
      readonly target: EntityRef | null;
    }
  | {
      readonly kind: "trade";
      readonly with: EntityRef | null;
      /** Si se llegó a un trato. */
      readonly deal: boolean;
      /** Ventaja sobre el precio que el otro cree justo, -0,3 a 0,3: economy cierra el trato. */
      readonly edge: number;
      /** Qué hizo el actor en el trato (`null` si no se movió nada). */
      readonly direction: "buy" | "sell" | null;
      readonly good: LedgerUnit | null;
      /** Gramos del bien que cambiaron de mano y monedas que fueron al otro lado. */
      readonly grams: number;
      readonly coins: number;
      /** Calidad real del lote que cambió de mano (0-1); falta si no se movió nada. */
      readonly quality?: number;
      /** Sin trato por el precio: lo que quien vende sacó a la venta y no vendió (cierre del día). */
      readonly unsold?: Unsold;
      /** El otro anda apretado o en la ruina: pesó en el precio o en lo que podía pagar. */
      readonly strain?: "tight" | "broke";
    }
  | {
      readonly kind: "give";
      readonly to: EntityRef | null;
      /** Lo que pasó de un bolsillo al otro (nada si no llevaba o no estaba). */
      readonly good: LedgerUnit | null;
      readonly grams: number;
    }
  | {
      readonly kind: "take";
      readonly from: HolderRef;
      /** Lo que quería llevarse. */
      readonly wanted: LedgerUnit | null;
      readonly got: readonly Holding[];
    }
  | {
      readonly kind: "eat";
      readonly good: LedgerUnit | null;
      /** De quién era lo que comió: lo suyo o la despensa de la casa. */
      readonly from: HolderRef | null;
      readonly grams: number;
      readonly kcal: number;
      /** Litros de agua que trae la comida. */
      readonly water: number;
    }
  | {
      readonly kind: "store";
      /** Lo que dejó en la despensa de la casa (nada si no llevaba o no podía). */
      readonly got: readonly Holding[];
    }
  | { readonly kind: "drink"; readonly liters: number }
  | {
      readonly kind: "cook";
      /** La receta que intentó (null si no hay o no tenía con qué). */
      readonly recipe: string | null;
      /** De quién eran los insumos y adónde vuelve lo cocinado. */
      readonly from: HolderRef | null;
      /** Lo que salió, en el ledger (null si no se cocinó nada). */
      readonly good: LedgerUnit | null;
      readonly grams: number;
      /** Los gramos de insumo que se gastaron. */
      readonly used: number;
      /** 0-1: la calidad del producto (la verdad; lo creído la reemplaza por `perceived`). */
      readonly quality: number;
      /** 0-1: la calidad que el cocinero cree que le salió, juzgada con sus sentidos. */
      readonly perceived: number;
      /** Cómo quedó: a punto, crudo, pasado o quemado. */
      readonly state: "done" | "raw" | "dry" | "burnt" | null;
      /** Los defectos reales de la tanda (crafts §11), del más grave al menos; un maestro nota algunos. */
      readonly defects?: readonly RecipeDefect[];
    }
  | {
      readonly kind: "tend";
      /** A quién curó (él mismo si no nombra a nadie). */
      readonly target: EntityRef;
      /** Si lo llegó a hacer bien: body limpia, venda o entablilla la peor herida. */
      readonly done: boolean;
      /** 0-1: cuán bien lo hizo. */
      readonly care: number;
    }
  | {
      /** Ir a ver a alguien que lee el futuro y pagarle: lo que pasa después es de `game`. */
      readonly kind: "consult";
      readonly with: EntityRef | null;
      /** Si se sentó a la consulta (la duda o no tener con qué pagar la dejan en la puerta). */
      readonly delivered: boolean;
      /** Lo que preguntó, en sus palabras. */
      readonly asked: string | null;
      /** Lo que dejó en la mano del adivino. */
      readonly paid: { readonly unit: LedgerUnit; readonly amount: number } | null;
    }
  | {
      /** Una idea sobre cómo anda el mundo, en palabras del jugador (discovery §14). */
      readonly kind: "ponder";
      readonly about: string | null;
    };

/** Cómo terminó una pelea para cada lado, tal como lo ve quien la vivió (combat §12, §17). */
export type FightSide = "standing" | "down" | "fled" | "yielded";

export interface FightGist {
  readonly seconds: number;
  readonly mine: FightSide | "dead";
  /** El rival: quien lo vio caer no distingue si murió o quedó inconsciente. */
  readonly theirs: FightSide;
  readonly woundsTaken: number;
  readonly woundsDealt: number;
  /** La pelea sigue: lo que notó que le pide decidir (combat §16). */
  readonly paused?: "wounded" | "foe_fleeing";
}

/** Lo que el actor cree de su paso. */
export interface SelfReport {
  readonly believed: BelievedOutcome;
  /** Los factores que percibe que le jugaron en contra (lo que el narrador puede contar). */
  readonly cues: readonly FactorKey[];
  readonly effect: VerbEffect;
}

export interface ActionResolution {
  /** La tirada común, tal cual. */
  readonly attempt: Attempt;
  /** El resultado final: corrige la tirada cuando el mundo no acompaña (lo buscado no estaba). */
  readonly outcome: Outcome;
  readonly failure: FailureModeId | null;
  /** 0-1: cuán bien salió lo que salió (la verdad). 0,5 es un resultado medio. */
  readonly degree: number;
  /** Cuánto tardó de verdad, en segundos. */
  readonly seconds: number;
  readonly effect: VerbEffect;
  readonly emissions: ActionEmissions;
  /** Para el scheduler: cambios, el evento del paso (índice 0) y sus asientos. */
  readonly changes: readonly StateChange[];
  readonly events: readonly EventDraft[];
  readonly postings: readonly PostingDraft[];
  readonly self: SelfReport;
}

/** Cuán abrupto pasa el grado de malo a bueno con el margen (calibración abierta). */
export const DEGREE_SLOPE = 1.5;

/** El grado de un margen: 0,5 en un margen de 0; null (no se pudo ni empezar) es 0. */
export function degreeOf(margin: number | null): number {
  return margin === null ? 0 : logistic(DEGREE_SLOPE * margin);
}

/** Lo que un resolver decide además de la tirada. */
interface VerbResult {
  readonly effect: VerbEffect;
  readonly seconds: number;
  readonly changes?: readonly StateChange[];
  readonly transfers?: readonly {
    from: HolderRef;
    unit: LedgerUnit;
    amount: number;
    /** Adonde va; si no, al actor. */
    to?: LedgerAccount;
    /** De dónde sale cuando no es un titular (la cosecha viene de afuera del ledger). */
    source?: LedgerAccount;
  }[];
  /**
   * El oficio reemplaza a la tirada: el resultado es lo que quedó de la sesión, y de ahí aprende
   * quien lo hizo (crafts §1: se cocina, no se tira).
   */
  readonly verdict?: {
    outcome: Outcome;
    failure: FailureModeId | null;
    believed: BelievedOutcome;
  };
  /** El mundo corrige la tirada: lo buscado no estaba, no quedaba nada que sacar. */
  readonly override?: { outcome: Outcome; failure: FailureModeId; believed: BelievedOutcome };
  /** Quienes además lo notaron (el robo que sale muy mal). */
  readonly noticedBy?: readonly EntityRef[];
  /** Multiplica el sonido emitido (ruido, golpe). */
  readonly loud?: number;
}

interface Ctx {
  readonly input: ResolveInput;
  readonly roll: Attempt;
  readonly degree: number;
  /** Lo que duraría el paso con un resultado medio. */
  readonly nominal: number;
  readonly path: readonly number[];
  readonly rng: AttemptInput["rng"];
}

type Resolver = (c: Ctx) => VerbResult;

export function resolve(input: ResolveInput): ActionResolution {
  const { def, node, actor } = input;
  if (input.causes.length === 0) throw new RangeError(`${def.id}: un paso sin causas`);

  const has = (holder: EntityRef, what: "goods" | "money") =>
    input.ledger
      .holdings(holderAccount(holder as HolderRef))
      .some((h) => isMoney(h.unit) === (what === "money"));
  const roll = attempt({ ...input, has });

  const fullPath =
    def.resolver === "move" && input.destination !== undefined
      ? hexPath(input.map, actor.hex, input.destination)
      : [];
  const walk = input.walkFactor ?? 1;
  const path = legOf(input.map, fullPath, walk);
  const pathSeconds = path.reduce((s, h) => s + (input.map.crossSeconds[h] ?? 0) * walk, 0);
  const nominal = actionDuration(def, node, input.planManner, pathSeconds);
  const ctx: Ctx = {
    input,
    roll,
    degree: degreeOf(roll.margin),
    nominal,
    path,
    rng: input.rng.fork("resolve", actor.id, def.id, input.tick),
  };
  const run = RESOLVE[def.resolver];
  const truth = run(ctx);

  const verdict = truth.override ?? truth.verdict;
  const outcome = verdict?.outcome ?? roll.outcome;
  const failure = truth.override?.failure ?? truth.verdict?.failure ?? roll.failure;
  const believed = verdict?.believed ?? roll.believed;
  const noticedBy = unique([...roll.noticedBy, ...(truth.noticedBy ?? [])]);

  // Lo creído: si el actor no notó que falló (o que salió a medias), cree el efecto de un
  // resultado bueno; si no, ve lo que pasó. Recolectar es la excepción: lo juntado se ve.
  const fooled =
    (outcome === "failure_unnoticed" || (roll.outcome === "partial" && believed === "success")) &&
    def.resolver !== "gather" &&
    def.resolver !== "cook";
  const selfEffect = fooled
    ? run({
        ...ctx,
        roll: { ...roll, outcome: "success", failure: null, margin: SUCCESS_MARGIN },
        degree: degreeOf(SUCCESS_MARGIN),
        rng: ctx.rng.fork("believed"),
      }).effect
    : believedView(truth.effect);

  const seconds = roll.unmet
    ? Math.min(nominal, def.checkpoint)
    : Math.max(1, Math.round(truth.seconds));
  const k = activeManners(def, node, input.planManner).reduce((p, m) => p * m.emissions, 1);
  const barely = roll.unmet ? 0.3 : 1;
  const emissions: ActionEmissions = {
    sight: clamp01(def.emissions.sight * k * barely),
    sound: clamp01(def.emissions.sound * k * barely * (truth.loud ?? 1)),
  };

  const parties = unique(
    Object.values(input.parties)
      .map((p) => p.id)
      .filter((id) => id !== actor.id),
  );
  const event: EventDraft & { outcome: Outcome } = {
    kind: `action.${def.id}`,
    actors: [actor.id, ...parties],
    place: input.place,
    outcome,
    data: {
      verb: def.id,
      manner: activeManners(def, node, input.planManner).map((m) => m.id),
      margin: roll.margin,
      degree: ctx.degree,
      failure,
      seconds,
      noticedBy,
      effect: truth.effect,
    },
    emissions,
    causes: input.causes,
  };
  const transfers = (truth.transfers ?? []).filter((t) => t.amount > 0);
  const postings: PostingDraft[] =
    transfers.length > 0
      ? [
          {
            event: draftEvent(0),
            transfers: transfers.map((t) => ({
              unit: t.unit,
              from: t.source ?? holderAccount(t.from),
              to: t.to ?? holderAccount(actor.id as HolderRef),
              amount: t.amount,
            })),
          },
        ]
      : [];

  return {
    // El oficio aprende de lo que salió de la sesión, no de la tirada que no se usó.
    attempt: truth.verdict ? { ...roll, outcome, failure, believed } : roll,
    outcome,
    failure,
    degree: ctx.degree,
    seconds,
    effect: truth.effect,
    emissions,
    changes: truth.changes ?? [],
    events: [event],
    postings,
    self: { believed, cues: roll.cues, effect: selfEffect },
  };
}

/** Lo que el actor ve de un efecto cuando sabe cómo le fue: todo, salvo dónde quedó si se perdió. */
function believedView(effect: VerbEffect): VerbEffect {
  if (effect.kind === "move" && effect.believedAt !== undefined) {
    // Se torció del rumbo sin notarlo: cree estar donde iba.
    return { ...effect, reached: effect.believedAt };
  }
  if (effect.kind === "move" && effect.reached !== effect.to) {
    // A mitad de viaje sabe dónde está; se cayó: también. Se perdió: no.
    return effect.stumbled || effect.onTheWay ? effect : { ...effect, reached: null };
  }
  if (effect.kind === "search" && !effect.found && !effect.glimpsed) {
    // No lo encontró: cree que no está, esté o no.
    return { ...effect, present: false };
  }
  if (effect.kind === "cook") {
    // Ve cuánto sacó, pero la calidad la juzga con sus sentidos, no con la verdad.
    return { ...effect, quality: effect.perceived, state: null };
  }
  return effect;
}

// ---------------------------------------------------------------------------------------------
// Por verbo

const none: Resolver = (c) => ({ effect: { kind: "none" }, seconds: c.nominal });

/**
 * Suponer: darle forma a una idea sobre cómo anda el mundo. El resolver solo deja lo supuesto en
 * las palabras del jugador; qué hipótesis del catálogo es (o si no se puede formular) lo decide
 * `game` (discovery §14), y la confianza la mueve solo la evidencia.
 */
const ponder: Resolver = (c) => ({
  effect: { kind: "ponder", about: argText(c, "about") },
  seconds: c.nominal,
});

/** Cuánto se camina de una vez: el viaje se parte en tramos que se pueden interrumpir (travel §2). */
export const LEG_SECONDS = 1800;

/** El primer tramo de un camino: hexes hasta juntar `LEG_SECONDS` de marcha, al menos uno. */
export function legOf(map: LocalMap, path: readonly number[], walk = 1): number[] {
  const leg: number[] = [];
  let seconds = 0;
  for (const h of path) {
    leg.push(h);
    seconds += (map.crossSeconds[h] ?? 0) * walk;
    if (seconds >= LEG_SECONDS) break;
  }
  return leg;
}

/** Chance máxima de torcer el rumbo en un tramo a medias (se multiplica por `1 - grado`). */
export const VEER_CHANCE = 0.6;

/** Tope de la chance de torcer el rumbo, por mal que esté la visibilidad. */
const MAX_VEER = 0.95;

/** ¿Hay un hito a la vista desde `hex` (a `LANDMARK_SIGHT_HEXES` pasos como mucho)? */
function landmarkNear(c: Ctx, hex: number): boolean {
  const marks = c.input.bearing?.landmarks;
  if (!marks || marks.size === 0) return false;
  let ring = [hex];
  const seen = new Set(ring);
  for (let d = 0; ; d++) {
    if (ring.some((h) => marks.has(h))) return true;
    if (d === LANDMARK_SIGHT_HEXES) return false;
    const next: number[] = [];
    for (const h of ring) {
      for (const n of c.input.map.neighbors[h] ?? []) {
        if (seen.has(n)) continue;
        seen.add(n);
        next.push(n);
      }
    }
    ring = next;
  }
}

/** Un vecino de `hex` que no sea el destino ni el camino recto; si no hay, sigue en `hex`. */
function veerFrom(c: Ctx, hex: number, to: number): number {
  const options = (c.input.map.neighbors[hex] ?? []).filter((n) => n !== to && !c.path.includes(n));
  return options.length > 0 ? c.rng.pick([...options].sort((a, b) => a - b)) : hex;
}

const move: Resolver = (c) => {
  const { roll, path, rng, degree } = c;
  const from = c.input.actor.hex;
  const to = c.input.destination ?? from;
  const effect = (reached: number, stumbled: boolean): VerbEffect => ({
    kind: "move",
    from,
    to,
    reached,
    stumbled,
  });
  // El tramo termina donde termina el camino recortado; si no es el destino, sigue.
  const legEnd = path.length === 0 ? from : (path[path.length - 1] as number);
  const at = (hex: number): StateChange[] =>
    hex === from ? [] : [setComponent(LOCATION, c.input.actor.id, { hex })];

  if (roll.unmet || (path.length === 0 && to !== from)) {
    // No pudo ni salir, o no hay camino por tierra: se queda.
    return { effect: effect(from, false), seconds: c.nominal };
  }
  const m = roll.margin as number;
  if (m >= PARTIAL_MARGIN) {
    // Llega. Peor tirada, más lento; a medias, la forma dice por qué tardó.
    const slow = m >= SUCCESS_MARGIN ? 1 + 0.3 * (1 - degree) : roll.failure === "slip" ? 1.5 : 1.6;
    const stumbled = m < SUCCESS_MARGIN && roll.failure === "slip";
    const onTheWay = !stumbled && legEnd !== to;
    // Rumbo: un tramo que sale a medias en un viaje que sigue puede torcerse un hex sin que
    // el caminante lo note; el próximo tramo parte de donde está de verdad (travel §11.1).
    // La noche, el bosque y la lluvia lo hacen más probable; si ve un hito donde quedó, sabe
    // dónde está y no hay creencia equivocada.
    const chance = Math.min(MAX_VEER, VEER_CHANCE * (c.input.bearing?.factor ?? 1) * (1 - degree));
    const veer =
      onTheWay && m < SUCCESS_MARGIN && rng.float() < chance ? veerFrom(c, legEnd, to) : legEnd;
    const lost = veer !== legEnd && !landmarkNear(c, veer);
    return {
      effect: {
        ...effect(veer, stumbled),
        ...(onTheWay ? { onTheWay } : {}),
        ...(lost ? { believedAt: legEnd } : {}),
      },
      seconds: c.nominal * slow,
      changes: at(veer),
    };
  }
  if (roll.failure === "slip") {
    // Se cae a mitad de camino y se queda ahí, golpeado.
    const stop = Math.floor(path.length / 2);
    const reached = stop === 0 ? from : (path[stop - 1] as number);
    return { effect: effect(reached, true), seconds: c.nominal * 0.6, changes: at(reached) };
  }
  // Se pierde: anda un tramo bien y después se desvía; un desastre lo aleja más.
  const walked = Math.floor(path.length * (0.3 + 0.6 * rng.float()));
  let hex = walked === 0 ? from : (path[walked - 1] as number);
  const strays = m <= -CRITICAL_MARGIN ? 3 : 1;
  for (let i = 0; i < strays; i++) {
    const options = (c.input.map.neighbors[hex] ?? []).filter((n) => n !== to);
    if (options.length > 0) hex = rng.pick([...options].sort((a, b) => a - b));
  }
  return { effect: effect(hex, false), seconds: c.nominal * 1.5, changes: at(hex) };
};

const observe: Resolver = (c) => ({
  effect: { kind: "observe", acuity: c.degree },
  seconds: c.nominal,
});

const search: Resolver = (c) => {
  const target = argEntity(c, "target");
  const party = c.input.parties["target"];
  const present = party !== undefined && party.hex === c.input.actor.hex;
  const m = c.roll.margin;
  const base = { kind: "search", target, present } as const;
  if (c.roll.unmet) {
    return { effect: { ...base, found: false, glimpsed: false }, seconds: c.nominal };
  }
  if (!present) {
    // Buscó a quien no estaba: no hay tirada que lo encuentre, y vuelve sabiendo que no está.
    return {
      effect: { ...base, found: false, glimpsed: false },
      seconds: c.nominal,
      override: { outcome: "failure", failure: "not_here", believed: "failure" },
    };
  }
  const found = (m as number) >= SUCCESS_MARGIN;
  const glimpsed = !found && (m as number) >= PARTIAL_MARGIN;
  // Encontrar pronto es encontrar bien: el resto del tiempo no se gasta.
  const seconds = found ? c.nominal * (1 - 0.7 * c.degree) : c.nominal;
  return { effect: { ...base, found, glimpsed }, seconds };
};

const gather: Resolver = (c) => {
  const kinds = c.input.scene.placeKinds;
  const spec = c.input.def.yields.find((y) => kinds.includes(y.at));
  const what = argText(c, "what");
  if (c.roll.unmet || !spec) {
    return {
      effect: { kind: "gather", good: null, amount: 0, what, stumbled: false },
      seconds: c.nominal,
    };
  }
  const good = ledgerUnit(`good:${spec.good}`);
  const stumbled = c.roll.failure === "slip" && (c.roll.margin as number) < SUCCESS_MARGIN;
  // Un resultado medio rinde lo de tabla; uno muy bueno, casi el doble; una caída pierde la mitad.
  const hours = (c.nominal / 3600) * (stumbled ? 0.5 : 1);
  const wanted = Math.round(spec.perHour * hours * 2 * c.degree);
  const stock = c.input.ledger
    .holdings(holderAccount(c.input.place))
    .find((h) => h.unit === good)?.amount;
  const amount = Math.min(wanted, stock ?? 0);
  const effect: VerbEffect = { kind: "gather", good, amount, what, stumbled };
  if (amount === 0) {
    // Lo que el lugar tenía ya se lo llevaron (o se juntó tan mal que no hay nada): se ve.
    return {
      effect,
      seconds: c.nominal,
      override: { outcome: "failure", failure: "poor_yield", believed: "failure" },
    };
  }
  return { effect, seconds: c.nominal, transfers: [{ from: c.input.place, unit: good, amount }] };
};

const work: Resolver = (c) => {
  if (c.roll.unmet)
    return { effect: { kind: "work", effectiveSeconds: 0, hurt: false }, seconds: 0 };
  const m = c.roll.margin as number;
  // Un resultado medio rinde el tiempo trabajado; el mejor, la mitad más; un desastre lastima.
  const effectiveSeconds = Math.round(c.nominal * Math.min(1.5, 2 * c.degree));
  const mk = c.input.market;
  const effect: VerbEffect = {
    kind: "work",
    effectiveSeconds,
    hurt: m <= -CRITICAL_MARGIN,
    ...(mk?.harvestGood && mk.harvestGramsPerHour ? { gramsPerHour: mk.harvestGramsPerHour } : {}),
  };
  // La tierra paga lo trabajado: el grano sale de la cosecha (fuente externa) y queda en el bolsillo.
  const grams =
    mk?.harvestGood && mk.harvestGramsPerHour
      ? Math.floor((mk.harvestGramsPerHour * effectiveSeconds) / 3600)
      : 0;
  if (!mk?.harvestGood || grams <= 0) return { effect, seconds: c.nominal };
  return {
    effect,
    seconds: c.nominal,
    transfers: [
      {
        from: c.input.actor.id as HolderRef,
        source: externalAccount(HARVEST),
        unit: mk.harvestGood,
        amount: grams,
      },
    ],
  };
};

const speak: Resolver = (c) => {
  const to = argEntity(c, "to");
  const text = argText(c, "content");
  const m = c.roll.margin;
  const delivered = m !== null && !(m < PARTIAL_MARGIN && c.roll.failure === "hesitate");
  return {
    effect: {
      kind: "speak",
      to,
      delivered,
      clarity: delivered ? c.degree : 0,
      text,
      act: actOf(c, "content"),
    },
    // Si no lo dijo, se fue antes.
    seconds: delivered ? c.nominal : c.nominal / 3,
  };
};

const strike: Resolver = (c) => {
  const target = argEntity(c, "target");
  const m = c.roll.margin;
  const committed = m !== null && !(m < PARTIAL_MARGIN && c.roll.failure === "hesitate");
  const hit = committed && (m as number) >= PARTIAL_MARGIN;
  const glancing = hit && (m as number) < SUCCESS_MARGIN;
  // La fuerza sale del cuerpo (constitución, la capacidad de fuerza) y de cuán limpio entró.
  const body = clamp01(0.5 + 0.2 * (c.input.actor.z["constitution"] ?? 0));
  const strength = c.input.actor.capabilities.strength ?? 1;
  const force = hit ? clamp01(body * strength * (glancing ? 0.4 : 0.6 + 0.4 * c.degree)) : 0;
  return {
    effect: {
      kind: "strike",
      target,
      committed,
      hit,
      glancing,
      force,
      offBalance: committed && (m as number) <= -CRITICAL_MARGIN,
    },
    seconds: c.nominal,
    loud: hit ? 1 + force : committed ? 1 : 0.3,
  };
};

const spare: Resolver = (c) => ({
  effect: { kind: "spare", target: argEntity(c, "target") },
  seconds: c.nominal,
});

/** Con menos días de comida que esto, el comprador gasta todo lo que tiene (tope urgente). */
const URGENT_FOOD_DAYS = 7;

const trade: Resolver = (c) => {
  const other = argEntity(c, "with");
  const m = c.roll.margin;
  // Cerrar mal también es cerrar: la torpeza deja un mal trato; la duda o la falta de algo, ninguno.
  const deal = m !== null && (m >= PARTIAL_MARGIN || c.roll.failure === "clumsy");
  const lean = deferenceEdge(c.input.market?.ranks?.actor, c.input.market?.ranks?.other);
  const shun = notorietyEdge(c.input.market?.fame ?? 0);
  const edge = deal
    ? round3(Math.max(-0.3, Math.min(0.3, 0.3 * (2 * c.degree - 1) + lean + shun)))
    : 0;
  const idle = (closed: boolean): VerbEffect => ({
    kind: "trade",
    with: other,
    deal: closed,
    edge: closed ? edge : 0,
    direction: null,
    good: null,
    grams: 0,
    coins: 0,
  });
  const mk = c.input.market;
  if (!deal || !mk || other === null) {
    return {
      effect: idle(deal && (!mk || other === null)),
      seconds: deal ? c.nominal : c.nominal / 2,
    };
  }
  const found = bargain(c, other, mk, edge);
  const strain = mk.other?.budget ? strainOf(mk.other.budget.standing) : undefined;
  const withStrain = (e: VerbEffect, unsold?: Unsold): VerbEffect =>
    e.kind === "trade"
      ? {
          ...e,
          ...(unsold === undefined ? {} : { unsold }),
          ...(strain === undefined ? {} : { strain }),
        }
      : e;
  if (typeof found === "string" || "failure" in found) {
    // Sin trato: o no hay con qué (nada que dar, o sin monedas), o hay pero no coinciden en el precio.
    const failure = typeof found === "string" ? found : found.failure;
    const unsold = typeof found === "string" ? undefined : found.unsold;
    return {
      effect: withStrain(idle(false), unsold),
      seconds: c.nominal / 2,
      override: { outcome: "failure", failure, believed: "failure" },
    };
  }
  return {
    effect: withStrain({
      kind: "trade",
      with: other,
      deal: true,
      edge,
      direction: found.direction,
      good: found.unit,
      grams: found.grams,
      coins: found.coins,
      quality: found.quality,
    }),
    seconds: c.nominal,
    transfers: found.transfers,
  };
};

/** Lo que come una casa en días: cuánta comida tiene (kcal) sobre lo que gasta por día. */
function foodDays(
  rows: readonly Holding[],
  foods: ReadonlyMap<LedgerUnit, Nutrition>,
  members: number,
): number {
  return kcalOf(rows, foods) / (DAILY_KCAL * Math.max(1, members));
}

function kcalOf(rows: readonly Holding[], foods: ReadonlyMap<LedgerUnit, Nutrition>): number {
  let kcal = 0;
  for (const r of rows) kcal += r.amount * (foods.get(r.unit)?.kcalPerGram ?? 0);
  return kcal;
}

/**
 * La cotización de una parte para un bien (pedido y oferta por kilo): su base sale de lo que cree
 * (con la fe aflojada) o del precio de contenido, escalada por la calidad.
 */
function quoteOf(
  mk: Market,
  who: "actor" | "other",
  unit: LedgerUnit,
  ref: number,
  ownDays: number,
  opts: QuoteOptions,
): HouseholdQuote {
  return householdQuote(mk.beliefs?.[who], unit, ref, mk.beliefs?.day ?? 0, ownDays, opts);
}

/**
 * El precio de un lote según su calidad: quien vende sabe la real; quien compra la percibe con el
 * error de su ojo (`eye`, 0-1) si el lote tiene calidad registrada. Sin registro, factor 1.
 */
function qualityFactors(
  c: Ctx,
  mk: Market,
  sellerIs: "actor" | "other",
  unit: LedgerUnit,
  buyerEye: number,
): { seller: number; buyer: number; quality: number } {
  const lots = mk.lots?.[sellerIs];
  if (lots?.[unit] === undefined)
    return { seller: 1, buyer: 1, quality: qualityOfUnit(lots, unit) };
  const real = qualityOfUnit(lots, unit);
  const seen = perceivedQuality(real, buyerEye, c.rng.fork("eye").normal(0, 1));
  return { seller: qualityPriceFactor(real), buyer: qualityPriceFactor(seen), quality: real };
}

/** Lo que un vendedor ofreció y no pudo vender (los gramos que tenía a la venta). */
export interface Unsold {
  readonly seller: "actor" | "other";
  readonly good: LedgerUnit;
  readonly grams: number;
}

interface NoDeal {
  readonly failure: "no_deal";
  readonly unsold?: Unsold;
}

interface Bargain {
  readonly quality: number;
  readonly direction: "buy" | "sell";
  readonly unit: LedgerUnit;
  readonly grams: number;
  readonly coins: number;
  readonly transfers: NonNullable<VerbResult["transfers"]>;
}

/**
 * El trato entre el actor y el otro (economy §4, §5). Cada parte tiene una reserva que sale de lo
 * que le queda para comer: nadie vende lo que necesita en los próximos meses ni compra de más. Si
 * el actor nombra lo que tiene encima, vende; si no, compra lo que el otro puede dar.
 */
function bargain(
  c: Ctx,
  other: EntityRef,
  mk: Market,
  edge: number,
): Bargain | "no_means" | NoDeal {
  const foods = c.input.foods ?? new Map<LedgerUnit, Nutrition>();
  const me = c.input.actor.id as HolderRef;
  const you = other as HolderRef;
  const rowsOf = (h: HolderRef | null | undefined): Holding[] =>
    h ? [...c.input.ledger.holdings(holderAccount(h))] : [];
  const priced = (rows: readonly Holding[]) => rows.filter((r) => mk.priceCopperPerKg.has(r.unit));
  const coinsOf = (rows: readonly Holding[]) => rows.find((r) => r.unit === COPPER)?.amount ?? 0;
  const merge = (...lists: Holding[][]): Holding[] => {
    const sum = new Map<LedgerUnit, number>();
    for (const l of lists) for (const r of l) sum.set(r.unit, (sum.get(r.unit) ?? 0) + r.amount);
    return [...sum].map(([unit, amount]) => ({ unit, amount }));
  };
  const myRows = rowsOf(me);
  const myLarder = rowsOf(c.input.larder);
  const yourPocket = rowsOf(you);
  const yourLarder = rowsOf(mk.other?.larder);
  const myGoods = priced(myRows);
  const yourGoods = priced(merge(yourPocket, yourLarder));
  const what = argText(c, "what");
  const wantGrams = gramsIn(what);
  const names = (rows: readonly Holding[]) => {
    const words = what === null ? [] : refTokens(what);
    return rows.some((h) => words.some((w) => unitTokens(h.unit, c.input.unitNames).includes(w)));
  };
  const sells = myGoods.length > 0 && (yourGoods.length === 0 || names(myGoods));
  const buyerCoinsOf = (rows: readonly Holding[]) => coinsOf(rows);
  const theirs = mk.other?.budget;

  if (sells) {
    const row = pickWanted(myGoods, what, c.input.unitNames) as Holding;
    const ref = mk.priceCopperPerKg.get(row.unit) as number;
    const qf = qualityFactors(c, mk, "actor", row.unit, 0.5);
    const kcalPerGram = foods.get(row.unit)?.kcalPerGram ?? 0;
    const myDays = foodDays(merge(myRows, myLarder), foods, mk.ownMembers);
    const ask = quoteOf(mk, "actor", row.unit, ref, myDays, { quality: qf.seller }).ask;
    // Lo que puede entregar: lo que lleva encima, sin tocar lo que guarda para comer.
    const keep = Math.max(0, KEEP_DAYS * DAILY_KCAL * mk.ownMembers - kcalOf(myLarder, foods));
    const spare =
      kcalPerGram > 0 ? Math.max(0, kcalOf(myRows, foods) - keep) / kcalPerGram : row.amount;
    const room =
      kcalPerGram > 0
        ? Math.max(
            0,
            WANT_DAYS * DAILY_KCAL * (mk.other?.members ?? 1) -
              kcalOf(merge(yourPocket, yourLarder), foods),
          ) / kcalPerGram
        : row.amount;
    // El comprador es el otro: no gasta más que su tope (lo urgente, si le falta comida) y, si anda
    // apretado, regatea más duro.
    const theirDays = foodDays(merge(yourPocket, yourLarder), foods, mk.other?.members ?? 1);
    const theirCoins = theirs
      ? Math.min(
          buyerCoinsOf(yourPocket),
          theirDays < URGENT_FOOD_DAYS ? theirs.urgentCeiling : theirs.coinCeiling,
        )
      : buyerCoinsOf(yourPocket);
    const deal = strikeDeal({
      wantGrams: Math.min(wantGrams, room),
      askPerKg: ask,
      maxPerKg:
        quoteOf(mk, "other", row.unit, ref, theirDays, {
          quality: qf.buyer,
          carryDays: foodDays(yourPocket, foods, mk.other?.members ?? 1),
        }).bid * (theirs ? DISTRESS_BID_FACTOR[theirs.standing] : 1),
      edge,
      availableGrams: Math.min(row.amount, spare),
      buyerCoins: theirCoins,
      actorBuys: false,
    });
    if (!deal) {
      if (!(spare > 0 && room > 0 && theirCoins > 0)) return "no_means";
      return {
        failure: "no_deal",
        unsold: { seller: "actor", good: row.unit, grams: Math.min(row.amount, spare) },
      };
    }

    return {
      quality: qf.quality,
      direction: "sell",
      unit: row.unit,
      grams: deal.grams,
      coins: deal.coins,
      transfers: [
        { from: me, unit: row.unit, amount: deal.grams, to: holderAccount(you) },
        { from: you, unit: COPPER, amount: deal.coins, to: holderAccount(me) },
      ],
    };
  }

  if (yourGoods.length === 0 || coinsOf(myRows) === 0) return "no_means";
  const row = pickWanted(yourGoods, what, c.input.unitNames) as Holding;
  const ref = mk.priceCopperPerKg.get(row.unit) as number;
  const qf = qualityFactors(
    c,
    mk,
    "other",
    row.unit,
    handsOf(c.input.actor.skill ?? 0, c.input.actor.z).senses,
  );
  const kcalPerGram = foods.get(row.unit)?.kcalPerGram ?? 0;
  const yourMembers = mk.other?.members ?? 1;
  const keep = KEEP_DAYS * DAILY_KCAL * yourMembers;
  const spare =
    kcalPerGram > 0
      ? Math.max(0, kcalOf(merge(yourPocket, yourLarder), foods) - keep) / kcalPerGram
      : row.amount;
  const deal = strikeDeal({
    wantGrams,
    askPerKg:
      quoteOf(
        mk,
        "other",
        row.unit,
        ref,
        foodDays(merge(yourPocket, yourLarder), foods, yourMembers),
        { quality: qf.seller },
      ).ask * (theirs ? DISTRESS_ASK_FACTOR[theirs.standing] : 1),
    maxPerKg: quoteOf(
      mk,
      "actor",
      row.unit,
      ref,
      foodDays(merge(myRows, myLarder), foods, mk.ownMembers),
      { quality: qf.buyer, carryDays: foodDays(myRows, foods, mk.ownMembers) },
    ).bid,
    edge,
    availableGrams: Math.min(row.amount, spare),
    buyerCoins: coinsOf(myRows),
    actorBuys: true,
  });
  if (!deal) {
    if (!(spare > 0)) return "no_means";
    return {
      failure: "no_deal",
      unsold: { seller: "other", good: row.unit, grams: Math.min(row.amount, spare) },
    };
  }

  // Entrega primero lo que lleva encima y, si no alcanza, lo de la despensa.
  const pocket = yourPocket.find((r) => r.unit === row.unit)?.amount ?? 0;
  const fromPocket = Math.min(pocket, deal.grams);
  const fromLarder = deal.grams - fromPocket;
  const transfers: NonNullable<VerbResult["transfers"]> = [
    ...(fromPocket > 0 ? [{ from: you, unit: row.unit, amount: fromPocket }] : []),
    ...(fromLarder > 0 && mk.other?.larder
      ? [{ from: mk.other.larder, unit: row.unit, amount: fromLarder }]
      : []),
    { from: me, unit: COPPER, amount: deal.coins, to: holderAccount(you) },
  ];
  return {
    quality: qf.quality,
    direction: "buy",
    unit: row.unit,
    grams: deal.grams,
    coins: deal.coins,
    transfers,
  };
}

const take: Resolver = (c) => {
  const fromEntity = argEntity(c, "from");
  const from: HolderRef = (fromEntity as HolderRef | null) ?? c.input.place;
  const held = c.input.ledger.holdings(holderAccount(from));
  const wantedRow = pickWanted(held, argText(c, "what"), c.input.unitNames);
  const wanted = wantedRow?.unit ?? null;
  const effect = (got: Holding[]): VerbEffect => ({ kind: "take", from, wanted, got });
  if (c.roll.unmet || !wantedRow) return { effect: effect([]), seconds: c.nominal };

  const m = c.roll.margin as number;
  let got: Holding[] = [];
  if (m >= SUCCESS_MARGIN) got = [wantedRow];
  else if (m >= PARTIAL_MARGIN) {
    // A medias: se lleva una parte (un puñado, no la bolsa entera).
    got = [{ unit: wantedRow.unit, amount: Math.max(1, Math.round(wantedRow.amount * c.degree)) }];
  } else if (c.roll.failure === "wrong_target") {
    // En la penumbra agarra otra cosa: lo más chico que haya, si hay otra cosa.
    const other = held
      .filter((h) => h.unit !== wantedRow.unit)
      .sort((a, b) => a.amount - b.amount)[0];
    if (other) got = [{ unit: other.unit, amount: Math.max(1, Math.round(other.amount / 2)) }];
  }
  // Un desastre con alguien al lado: lo agarran con la mano adentro.
  const caught = m <= -CRITICAL_MARGIN && fromEntity !== null ? [fromEntity] : [];
  return {
    effect: effect(got),
    seconds: c.nominal,
    transfers: got.map((g) => ({ from, unit: g.unit, amount: g.amount })),
    noticedBy: caught,
    loud: c.roll.failure === "clumsy" && m < PARTIAL_MARGIN ? 2.5 : 1,
  };
};

const eat: Resolver = (c) => {
  const foods = c.input.foods ?? new Map<LedgerUnit, Nutrition>();
  const edible = (holder: HolderRef | undefined) =>
    holder === undefined
      ? []
      : c.input.ledger.holdings(holderAccount(holder)).filter((h) => foods.has(h.unit));
  const own = edible(c.input.actor.id as HolderRef);
  // Lo que lleva encima primero; si no tiene nada, la despensa de la casa.
  const from: HolderRef | null =
    own.length > 0 ? (c.input.actor.id as HolderRef) : (c.input.larder ?? null);
  const pool = own.length > 0 ? own : edible(c.input.larder);
  const row = pickWanted(pool, argText(c, "what"), c.input.unitNames);
  const empty: VerbEffect = { kind: "eat", good: null, from, grams: 0, kcal: 0, water: 0 };
  if (c.roll.unmet) return { effect: empty, seconds: c.nominal };
  if (!row || from === null) {
    return {
      effect: empty,
      seconds: Math.min(c.nominal, 60),
      override: { outcome: "failure", failure: "no_means", believed: "failure" },
    };
  }
  const n = foods.get(row.unit) as Nutrition;
  const grams = Math.min(
    row.amount,
    n.kcalPerGram > 0 ? Math.ceil(MEAL_KCAL / n.kcalPerGram) : row.amount,
  );
  const effect: VerbEffect = {
    kind: "eat",
    good: row.unit,
    from,
    grams,
    kcal: Math.round(grams * n.kcalPerGram),
    water: round3(grams * n.waterPerGram),
  };
  return {
    effect,
    seconds: c.nominal,
    transfers: [{ from, unit: row.unit, amount: grams, to: externalAccount(EATEN) }],
  };
};

/** Deja en la despensa de la casa lo que lleva encima (lo que nombra, o todo lo que sea bien). */
const store: Resolver = (c) => {
  const larder = c.input.larder;
  const what = argText(c, "what");
  const carried = c.input.ledger
    .holdings(holderAccount(c.input.actor.id as HolderRef))
    .filter((h) => !isMoney(h.unit) && h.amount > 0);
  const words = what === null ? [] : refTokens(what);
  const named = carried.filter((h) =>
    words.some((w) => unitTokens(h.unit, c.input.unitNames).includes(w)),
  );
  const rows = words.length > 0 && named.length > 0 ? named : carried;
  if (c.roll.unmet) return { effect: { kind: "store", got: [] }, seconds: c.nominal };
  if (larder === undefined || rows.length === 0) {
    return {
      effect: { kind: "store", got: [] },
      seconds: Math.min(c.nominal, 60),
      override: { outcome: "failure", failure: "no_means", believed: "failure" },
    };
  }
  return {
    effect: { kind: "store", got: rows },
    seconds: c.nominal,
    transfers: rows.map((r) => ({
      from: c.input.actor.id as HolderRef,
      unit: r.unit,
      amount: r.amount,
      to: holderAccount(larder),
    })),
  };
};

/** Calidad mínima para decir que salió bien, y para decir que salió a medias. */
const COOK_GOOD = 0.7;
const COOK_PASSABLE = 0.35;
/** Menos que esta fracción de la tanda no vale el fuego. */
const COOK_MIN_BATCH = 0.25;

const cook: Resolver = (c) => {
  const none: VerbResult = {
    effect: {
      kind: "cook",
      recipe: null,
      from: null,
      good: null,
      grams: 0,
      used: 0,
      quality: 0,
      perceived: 0,
      state: null,
    },
    seconds: c.nominal,
  };
  if (c.roll.unmet) return none;
  const noMeans: VerbResult = {
    ...none,
    seconds: Math.min(c.nominal, 60),
    override: { outcome: "failure", failure: "no_means", believed: "failure" },
  };
  const recipes = c.input.recipes ?? [];
  const what = argText(c, "what");
  const words = what === null ? [] : refTokens(what);
  const named = recipes.filter((r) => {
    const tokens = refTokens(`${r.id.replace(/_/g, " ")} ${r.name}`);
    return words.some((w) => tokens.includes(w));
  });
  const recipe = named[0] ?? recipes[0];
  if (!recipe) return noMeans;

  // Los insumos: de lo que lleva encima si le alcanza, y si no, de la despensa de la casa.
  const actorId = c.input.actor.id as HolderRef;
  const stock = (holder: HolderRef | undefined): number | null => {
    if (holder === undefined) return null;
    const held = c.input.ledger.holdings(holderAccount(holder));
    const scales = recipe.inputs.map(
      (i) => (held.find((h) => h.unit === recipeUnit(i.good))?.amount ?? 0) / i.grams,
    );
    return Math.min(1, ...scales);
  };
  const own = stock(actorId);
  const larder = stock(c.input.larder);
  const from = (own ?? 0) >= COOK_MIN_BATCH ? actorId : (c.input.larder ?? null);
  const scale = from === actorId ? own : larder;
  if (from === null || scale === null || scale < COOK_MIN_BATCH) return noMeans;

  const s = runSession({
    recipe,
    hands: handsOf(c.input.actor.skill ?? 0, c.input.actor.z),
    rng: c.rng,
    who: c.input.actor.id,
    tick: c.input.tick,
  });
  const used = recipe.inputs.map((i) => ({
    unit: recipeUnit(i.good),
    amount: Math.floor(i.grams * scale),
  }));
  const inGrams = used.reduce((sum, u) => sum + u.amount, 0);
  const outUnit = recipeUnit(recipe.output.good);
  const grams = Math.floor(inGrams * s.yield);
  const state: "done" | "raw" | "dry" | "burnt" =
    s.work.scorch >= 0.4
      ? "burnt"
      : s.work.doneness < 0.85
        ? "raw"
        : s.work.doneness > 1.25
          ? "dry"
          : "done";
  const grade = (q: number): "success" | "partial" | "failure" =>
    q >= COOK_GOOD ? "success" : q >= COOK_PASSABLE ? "partial" : "failure";
  const truth = grade(s.quality);
  const believed = grade(s.perceivedQuality);
  const outcome: Outcome =
    truth === "failure" && believed === "success"
      ? "failure_unnoticed"
      : truth === "failure" && believed === "partial"
        ? "failure_suspected"
        : truth;
  return {
    effect: {
      kind: "cook",
      recipe: recipe.id,
      from,
      good: outUnit,
      grams,
      used: inGrams,
      quality: round3(s.quality),
      perceived: round3(s.perceivedQuality),
      state,
      defects: defectsOf(recipe, s).map((d) => ({ ...d, severity: round3(d.severity) })),
    },
    seconds: s.seconds,
    verdict: {
      outcome,
      failure: truth === "success" ? null : state === "burnt" ? "poor_yield" : "clumsy",
      believed,
    },
    transfers: [
      ...used.map((u) => ({
        from,
        unit: u.unit,
        amount: u.amount,
        to: externalAccount(COOKED),
      })),
      {
        from,
        unit: outUnit,
        amount: grams,
        source: externalAccount(COOKED),
        to: holderAccount(from),
      },
    ],
    // El horno hace ruido y humo, no más.
    loud: 1.2,
  };
};

/** La unidad del ledger de un bien de receta (`good:<id>`). */
function recipeUnit(good: string): LedgerUnit {
  return ledgerUnit(`good:${good}`);
}

const drink: Resolver = (c) => ({
  // El agua del pozo o del río no se cuenta en el ledger todavía (weather §4 la llevará).
  effect: { kind: "drink", liters: c.roll.unmet ? 0 : DRINK_LITERS },
  seconds: c.nominal,
});

const tend: Resolver = (c) => {
  const target = argEntity(c, "target") ?? c.input.actor.id;
  const m = c.roll.margin;
  const done = m !== null && m >= PARTIAL_MARGIN;
  return {
    effect: { kind: "tend", target, done, care: done ? c.degree : 0 },
    // Si sale mal, se deja antes.
    seconds: done ? c.nominal : c.nominal / 2,
  };
};

/**
 * Pasa algo de su bolsillo al del otro: lo que nombra (con cantidad si la dice) o, si no, lo que
 * le debe; y si no le debe nada, lo que más lleva. «Le devuelvo el grano» salda la deuda y no más.
 */
const give: Resolver = (c) => {
  const to = argEntity(c, "to");
  const what = argText(c, "what");
  const none = (): VerbResult => ({
    effect: { kind: "give", to, good: null, grams: 0 },
    seconds: Math.min(c.nominal, 60),
    override: { outcome: "failure", failure: "no_means", believed: "failure" },
  });
  if (c.roll.unmet)
    return { effect: { kind: "give", to, good: null, grams: 0 }, seconds: c.nominal };
  if (to === null) return none();
  const carried = c.input.ledger
    .holdings(holderAccount(c.input.actor.id as HolderRef))
    .filter((h) => h.amount > 0);
  const words = what === null ? [] : refTokens(what);
  const named = carried.filter((h) =>
    words.some((w) => unitTokens(h.unit, c.input.unitNames).includes(w)),
  );
  const owed = c.input.owed ?? new Map<LedgerUnit, number>();
  const debts = carried.filter((h) => (owed.get(h.unit) ?? 0) > 0);
  const pool = named.length > 0 ? named : debts.length > 0 ? debts : carried;
  const row = pickWanted(pool, null);
  if (!row) return none();
  const asked = gramsIn(what, 0);
  const due = owed.get(row.unit) ?? 0;
  const grams = Math.floor(Math.min(row.amount, asked > 0 ? asked : due > 0 ? due : row.amount));
  if (grams <= 0) return none();
  return {
    effect: { kind: "give", to, good: row.unit, grams },
    seconds: c.nominal,
    transfers: [
      {
        from: c.input.actor.id as HolderRef,
        to: holderAccount(to as HolderRef),
        unit: row.unit,
        amount: grams,
      },
    ],
  };
};

/** Cuántas monedas ofreció: el número que dice en `offer` (una si no dice) sin pasar de lo que lleva. */
function coinsOffered(text: string | null, held: number): number {
  const m = text === null ? null : /(\d+)/.exec(text);
  const n = m ? Number(m[1]) : 1;
  return Math.min(held, Math.max(1, Number.isFinite(n) ? n : 1));
}

/**
 * Consultar: pagar al adivino y preguntarle. Sin plata no hay consulta (los adivinos cobran);
 * si la duda lo frena, se va con la plata en el bolsillo.
 */
const consult: Resolver = (c) => {
  const other = argEntity(c, "with");
  const asked = argText(c, "about");
  const purse = c.input.ledger
    .holdings(holderAccount(c.input.actor.id as HolderRef))
    .filter((h) => h.amount > 0 && isMoney(h.unit))
    .sort((a, b) => b.amount - a.amount || (a.unit < b.unit ? -1 : 1))[0];
  const stay = (seconds: number, override?: VerbResult["override"]): VerbResult => ({
    effect: { kind: "consult", with: other, delivered: false, asked, paid: null },
    seconds,
    ...(override ? { override } : {}),
  });
  if (c.roll.unmet) return stay(c.nominal);
  if (other === null || !purse)
    return stay(Math.min(c.nominal, 60), {
      outcome: "failure",
      failure: "no_means",
      believed: "failure",
    });
  const m = c.roll.margin;
  if (m === null || (m < PARTIAL_MARGIN && c.roll.failure === "hesitate"))
    return stay(c.nominal / 3);
  const amount = coinsOffered(argText(c, "offer"), Math.floor(purse.amount));
  return {
    effect: {
      kind: "consult",
      with: other,
      delivered: true,
      asked,
      paid: { unit: purse.unit, amount },
    },
    seconds: c.nominal,
    transfers: [
      {
        from: c.input.actor.id as HolderRef,
        to: holderAccount(other as HolderRef),
        unit: purse.unit,
        amount,
      },
    ],
  };
};

const RESOLVE: Readonly<Record<ResolveKey, Resolver>> = {
  none,
  move,
  observe,
  search,
  gather,
  work,
  speak,
  strike,
  spare,
  trade,
  give,
  take,
  store,
  eat,
  cook,
  drink,
  tend,
  consult,
  ponder,
};
type ResolveKey = ResolveInput["def"]["resolver"];

// ---------------------------------------------------------------------------------------------

/** La plata se distingue de los bienes por la unidad hasta que economy tenga su catálogo. */
export function isMoney(unit: LedgerUnit): boolean {
  return unit === "coin" || unit.startsWith("coin:");
}

/** Las palabras con que se puede nombrar una unidad: su id y su nombre en la lengua del jugador. */
function unitTokens(unit: LedgerUnit, names?: ReadonlyMap<LedgerUnit, string>): string[] {
  const id = refTokens(unit.replace(/^[a-z]+:/, "").replace(/_/g, " "));
  const name = names?.get(unit);
  return name === undefined ? id : [...id, ...refTokens(name)];
}

/**
 * Lo que quiere llevarse: lo que nombra (por palabras, contra el nombre de la unidad) o, si no
 * nombra nada que haya, lo que más hay. Determinista: desempata por unidad.
 */
function pickWanted(
  held: readonly Holding[],
  what: string | null,
  names?: ReadonlyMap<LedgerUnit, string>,
): Holding | undefined {
  if (held.length === 0) return undefined;
  const words = what === null ? [] : refTokens(what);
  const named = held.filter((h) => {
    const unit = unitTokens(h.unit, names);
    return words.some((w) => unit.includes(w));
  });
  const pool = named.length > 0 ? named : held;
  return [...pool].sort((a, b) => b.amount - a.amount || (a.unit < b.unit ? -1 : 1))[0];
}

function argEntity(c: Ctx, role: string): EntityRef | null {
  const a = c.input.node.args.find((x) => x.role === role);
  return a && "entity" in a ? a.entity : null;
}

function argText(c: Ctx, role: string): string | null {
  const a = c.input.node.args.find((x) => x.role === role);
  return a && "text" in a ? a.text : null;
}

function actOf(c: Ctx, role: string): SpeakAct | null {
  const a = c.input.node.args.find((x) => x.role === role);
  return a && "text" in a ? (a.act ?? null) : null;
}

function unique<T>(xs: readonly T[]): T[] {
  return [...new Set(xs)];
}

function clamp01(x: number): number {
  return x < 0 ? 0 : x > 1 ? 1 : x;
}

function round3(x: number): number {
  return Math.round(x * 1000) / 1000;
}

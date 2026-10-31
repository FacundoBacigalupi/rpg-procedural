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
  type AgentId,
  type CauseRef,
  type EntityRef,
  externalAccount,
  type HolderRef,
  holderAccount,
  type ItemId,
  type LedgerAccount,
  type LedgerUnit,
  ledgerUnit,
  logistic,
  type PlaceRef,
  type SpaceKey,
} from "../../core/index.ts";
import {
  defectsOf,
  handsOf,
  type RecipeDef,
  type RecipeDefect,
  runSession,
} from "../crafts/index.ts";
import {
  believedQuality,
  COPPER,
  claimedQuality,
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
import type { ActionDef, FactorKey, FailureModeId } from "./catalog.ts";
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
  /** Replay de motores viejos: `speak` dura lo fijo del catálogo, sin mirar el acto ni las palabras. */
  readonly fixedSpeech?: boolean;
  /** El hex adonde va `move` (el del lugar del argumento, ya elegido por quien arma el paso). */
  readonly destination?: number | undefined;
  /** El actor está detrás de una puerta trabada: de ahí no sale caminando (settlements §7). */
  readonly shut?: boolean | undefined;
  /**
   * `move` hacia un espacio del sitio (de la casa a la plaza, a la casa del vecino): al llegar al
   * hex queda en `space`. Si ya está en ese hex es un paso de metros, sin rumbo que perder: no se
   * tira, tarda `seconds` y solo lo frena no poder caminar o la puerta trabada (`leaving`: sale de
   * un cuarto).
   */
  readonly withinSite?:
    | { readonly space: SpaceKey; readonly seconds: number; readonly leaving: boolean }
    | undefined;
  /** Cuánto más cuesta caminar hoy por el tiempo (1 = seco y templado; `walkingFactor`). */
  readonly walkFactor?: number | undefined;
  /** Qué tan fácil es torcer el rumbo hoy (1 = día claro; `bearingFactor`) y qué hitos se ven. */
  readonly bearing?: Bearing | undefined;
  /** Lo que tiene cada titular: de acá sale qué hay para tomar, ofrecer o sacar del lugar. */
  readonly ledger: Pick<ReadonlyLedger, "holdings">;
  /** Opt-in económico: `take` sin bienes disponibles falla por medios reales y el actor lo sabe. */
  readonly takeEmptyFailure?: boolean | undefined;
  /** Opt-in (`wildFirewood`): `gather` elige la salida que nombra `what` («junto leña»); apagado, la primera. */
  readonly gatherByWords?: boolean | undefined;
  /**
   * Opt-in de claims de ítems: `take` va por un objeto con identidad. `available` es lo que el mundo
   * dice (existe y está al alcance); la tirada decide si el intento alcanza para disputarlo.
   */
  /**
   * La herramienta que el actor lleva y usa de instrumento (`with`, use-tools) y su forma. Solo la
   * pone quien la vio en la mano del actor; sin esto, el verbo rinde lo de siempre.
   */
  readonly instrument?:
    | {
        readonly item: ItemId;
        readonly shape: string;
        /** Su desgaste (0 nueva, 1 gastada; use-tools-wear). Sin él, la herramienta no se gasta. */
        readonly wear?: number;
      }
    | undefined;
  readonly takeItem?:
    | {
        readonly item: ItemId;
        readonly available: boolean;
        /** Nadie la tiene encima (está en un lugar o guardada): alcanza un resultado parcial. */
        readonly loose?: boolean;
      }
    | undefined;
  /** Opt-in de claims de ítems: `give` entrega un objeto con identidad (solo la posesión física). */
  readonly giveItem?: { readonly item: ItemId; readonly available: boolean } | undefined;
  /** Opt-in (livestock-tenure-gift): `give` entrega un animal de la casa que nombró y tiene al lado. */
  readonly giveAnimal?: { readonly animal: string } | undefined;
  /** Opt-in (livestock-tenure-theft): `take` se lleva el animal ajeno que nombró y tiene al lado. */
  readonly takeAnimal?: { readonly animal: string; readonly from: HolderRef } | undefined;
  /**
   * `use` con `well.draw_water` (use-well): el pozo, lo que le queda hoy (litros), su condición y
   * el recipiente que el actor lleva con lo que le cabe todavía. Sin esto, `use` no hace nada (el
   * replay de motores anteriores a `life-47`).
   */
  readonly drawWater?:
    | {
        readonly well: EntityRef;
        readonly left: number;
        readonly condition: number;
        readonly vessel?: { readonly item: ItemId; readonly room: number };
      }
    | undefined;
  /**
   * `use` con `hearth.warm` (use-hearth-warm): el fogón nombrado (id de la fila de `HEARTH`) y si
   * arde en el espacio del actor. Sin esto, `use` no calienta.
   */
  readonly warmHearth?: { readonly hearth: EntityRef; readonly lit: boolean } | undefined;
  /**
   * `use` con `tool.sharpen` (use-tools-mend-sharpen): la herramienta nombrada, si la lleva, su
   * desgaste y el metal ya comido, y si lleva con qué afilarla. Sin esto, `use` no afila (el replay
   * de motores anteriores a `life-51`).
   */
  readonly sharpen?:
    | {
        readonly tool: ItemId;
        readonly held: boolean;
        readonly wear: number;
        readonly ground: number;
        readonly stone: boolean;
      }
    | undefined;
  /**
   * `trade` nombrando una herramienta que lleva en la mano uno de los dos (use-tools-mend-trade-sell):
   * cuál, quién la vende, lo que vale según el desgaste visto, el cobre de quien compra y si el otro
   * la quiere (comprador) o puede soltarla (vendedor).
   */
  readonly usedTool?:
    | {
        readonly item: ItemId;
        readonly name: string;
        readonly direction: "buy" | "sell";
        readonly price: number;
        readonly buyerCopper: number;
        readonly wants: boolean;
        readonly spare: boolean;
        readonly unit: LedgerUnit;
      }
    | undefined;
  /**
   * `trade` nombrando un animal (livestock-tenure-sell): cuál, quién lo vende, lo que vale, el cobre
   * de quien compra y si el otro lo quiere (comprador) o puede largarlo (vendedor). `payers`
   * (livestock-tenure-sell-household): de quiénes sale el cobre, en orden, con lo que tiene cada
   * uno (`buyerCopper` es la suma); sin esto, todo de quien compra.
   */
  readonly animalSale?:
    | {
        readonly animal: string;
        readonly name: string;
        readonly direction: "buy" | "sell";
        readonly price: number;
        readonly buyerCopper: number;
        readonly wants: boolean;
        readonly spare: boolean;
        readonly unit: LedgerUnit;
        readonly payers?: readonly { readonly holder: HolderRef; readonly copper: number }[];
      }
    | undefined;
  /**
   * `trade` con el herrero nombrando una herramienta que forja (use-tools-mend-trade-buy): cuál, lo
   * que cobra, el hierro que lleva y el que hay en su hogar, y el cobre del actor.
   */
  readonly forge?:
    | {
        readonly tool: string;
        /** Cómo se llama la herramienta (para narrarla). */
        readonly name: string;
        readonly price: number;
        readonly ironNeed: number;
        readonly ironHave: number;
        readonly ironFrom: HolderRef;
        readonly copper: number;
        readonly units: { readonly copper: LedgerUnit; readonly iron: LedgerUnit };
        readonly ironSink: LedgerAccount;
      }
    | undefined;
  /**
   * `use` con `tool.mend` (use-tools-mend-smith): la herramienta, si la lleva, cómo está, y el herrero
   * si está en el mismo espacio, con lo bueno que es, el hierro de su hogar y lo que cobra.
   */
  readonly mend?:
    | {
        readonly tool: ItemId;
        readonly held: boolean;
        readonly wear: number;
        readonly ground: number;
        readonly smith?: {
          readonly who: AgentId;
          readonly level: number;
          /** De dónde sale el hierro (el hogar del herrero) y cuánto hay. */
          readonly ironFrom: HolderRef;
          readonly iron: number;
        };
        /** El cobre que el actor tiene en la bolsa. */
        readonly copper: number;
        readonly units: { readonly copper: LedgerUnit; readonly iron: LedgerUnit };
        /** Adonde va el hierro que queda en la herramienta (fuera del ledger). */
        readonly ironSink: LedgerAccount;
      }
    | undefined;
  /**
   * Opt-in de claims de ítems: `drop` suelta un objeto con identidad que lleva encima
   * (play-refs-objects-source-drop); `available` dice si de verdad lo lleva.
   */
  readonly dropItem?: { readonly item: ItemId; readonly available: boolean } | undefined;
  /** La contraparte de `trade` (o el destinatario de `give`) ya terminó (`ENTITY.endedAt`): no hay trato ni regalo aunque su cuenta exista. */
  readonly counterpartyGone?: boolean | undefined;
  /** Dónde está el actor: el lugar del evento y el titular del stock que se recolecta. */
  readonly place: PlaceRef;
  /** Por qué: las causas del plan (la intención, las creencias que la sostienen). */
  readonly causes: readonly CauseRef[];
  /** Lo que se come, por unidad del ledger (`good:<id>`): lo pone quien carga `content/foods`. */
  readonly foods?: ReadonlyMap<LedgerUnit, Nutrition>;
  /** La despensa del hogar del actor: de ahí come si no lleva nada encima. */
  readonly larder?: HolderRef | undefined;
  /**
   * La despensa a mano: el actor está adentro de su casa (play-refs-objects-larder). Un `take` sin
   * `from` que no encuentra lo que nombra suelto en el lugar lo saca de acá.
   */
  readonly homeLarder?: HolderRef | undefined;
  /**
   * La despensa ajena a la vista: el actor está adentro de la casa de otro hogar
   * (play-refs-objects-host). Un `take` sin `from` que nombra algo que no está suelto en el lugar
   * lo saca de acá (es de ese hogar: quien lo vea, lo ve llevárselo).
   */
  readonly hostLarder?: HolderRef | undefined;
  /** Opt-in: el combustible que gasta `boil` (unidad del ledger y gramos por tanda); sin esto no hay con qué hervir. */
  readonly boilFuel?: { readonly unit: LedgerUnit; readonly grams: number } | undefined;
  /** Opt-in: el material filtrante que gasta `filter` (unidad del ledger y gramos por tanda); sin esto no hay con qué filtrar. */
  readonly filterMaterial?: { readonly unit: LedgerUnit; readonly grams: number } | undefined;
  /**
   * Opt-in (`kindle`/`douse`): el hogar del espacio donde está el actor (fila de `HEARTH`, la cuenta
   * de donde quema leña, la unidad, y si ya arde). Sin esto no hay hogar que encender ni apagar.
   */
  readonly hearthAt?:
    | {
        readonly hearth: string;
        readonly holder: HolderRef;
        readonly fuelUnit: LedgerUnit;
        readonly lit: boolean;
      }
    | undefined;
  /** Opt-in: las unidades que son sustancias de consumo (`consume`: una unidad, una dosis); sin esto no hay qué tomar. */
  readonly consumables?: ReadonlySet<LedgerUnit> | undefined;
  /**
   * Opt-in (`slaughter`, livestock-slaughter): el animal de su casa que nombró y tiene al lado, la
   * despensa adonde va lo que deja y los gramos de cada bien (carne, piel). Sin esto no hay qué carnear.
   */
  readonly slaughterTarget?:
    | {
        readonly animal: string;
        readonly holder: HolderRef;
        readonly source: LedgerAccount;
        readonly yields: readonly { readonly unit: LedgerUnit; readonly grams: number }[];
      }
    | undefined;
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
  /** Empuje de precio de una escasez de comida (`FAMINE.pricePush`) sobre un bien; sin esto, 1. */
  readonly pricePush?: { readonly unit: LedgerUnit; readonly factor: number } | undefined;
  /** Opt-in: factor del gusto de cada parte sobre lo máximo que paga por un bien (`tasteDemandFactor`); sin esto, 1. */
  readonly tasteBid?:
    | {
        readonly actor: (unit: LedgerUnit) => number;
        readonly other: (unit: LedgerUnit) => number;
      }
    | undefined;
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
  /**
   * Estafa (economy §6): cuánto infla cada vendedor lo que dice de su lote (0 = honesto) y cuánto
   * confía en él quien le compra (0-1, por vendedor). El comprador cotiza por lo que cree (`believedQuality`); el
   * lote que cambia de manos sigue con su calidad real. Sin esto, el comprador solo ve con su ojo.
   */
  readonly scam?:
    | {
        readonly inflate: { readonly actor: number; readonly other: number };
        readonly trust: { readonly actor: number; readonly other: number };
      }
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
/** Adonde va el combustible que se quema al hervir (como el de `life.hearth`); quien arma el ledger lo declara con esa unidad. */
export const BURNED = "burned";
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
      /** La puerta trabada no lo dejó salir: se queda donde estaba. */
      readonly blocked?: "jammed_door";
      /** El espacio del sitio donde quedó (la plaza, una casa), si iba a uno. */
      readonly space?: SpaceKey;
      /** Terminó un tramo bien y sigue hacia `to`: la misma hoja del plan sigue en el próximo. */
      readonly onTheWay?: boolean;
      /** Se torció del rumbo sin notarlo: el hex donde cree estar (`reached` es donde está). */
      readonly believedAt?: number;
    }
  | {
      readonly kind: "observe";
      /** Cuán bien miró, 0-1: perception lo usa como atención sobre la escena. */
      readonly acuity: number;
      /** Lo que miró en particular, si nombró algo («miro la canasta»). */
      readonly target?: EntityRef;
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
      /** La herramienta que rindió (use-tools). */
      readonly tool?: ItemId;
      /** Cuánto se gastó la herramienta en el paso y si quedó gastada del todo (use-tools-wear). */
      readonly toolWear?: number;
      readonly toolWorn?: boolean;
    }
  | {
      readonly kind: "work";
      /** Trabajo que rindió, en segundos de trabajo medio: lo que la tierra o el oficio cobran. */
      readonly effectiveSeconds: number;
      /** Se lastimó trabajando. */
      readonly hurt: boolean;
      /** La herramienta que rindió (use-tools). */
      readonly tool?: ItemId;
      /** Cuánto se gastó la herramienta en el paso y si quedó gastada del todo (use-tools-wear). */
      readonly toolWear?: number;
      readonly toolWorn?: boolean;
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
      /** Con estafa: lo que el comprador creyó del lote al pagar (0-1); solo si el vendedor infló. */
      readonly believed?: number;
      /** Sin trato por el precio: lo que quien vende sacó a la venta y no vendió (cierre del día). */
      readonly unsold?: Unsold;
      /** El otro anda apretado o en la ruina: pesó en el precio o en lo que podía pagar. */
      readonly strain?: "tight" | "broke";
      /** Compra al herrero: la herramienta (id de contenido) que forjó y el hierro que puso. */
      readonly forged?: string;
      readonly forgedName?: string;
      readonly iron?: number;
      /** Compra al herrero que no se hizo: qué faltó. */
      readonly lack?: "copper" | "iron" | "want" | "spare";
      /** Herramienta usada que cambió (o no) de manos (use-tools-mend-trade-sell). */
      readonly usedItem?: ItemId;
      /** Animal que cambió (o no) de manos (livestock-tenure-sell). */
      readonly animal?: string;
    }
  | {
      readonly kind: "give";
      readonly to: EntityRef | null;
      /** Lo que pasó de un bolsillo al otro (nada si no llevaba o no estaba). */
      readonly good: LedgerUnit | null;
      readonly grams: number;
      /** Opt-in (`giveItem`): el ítem con identidad entregado; la donación normativa no va acá. */
      readonly item?: ItemId;
      /** Opt-in (`giveAnimal`): el animal entregado. */
      readonly animal?: string;
      readonly delivered?: boolean;
    }
  | {
      readonly kind: "take";
      readonly from: HolderRef;
      /** Lo que quería llevarse. */
      readonly wanted: LedgerUnit | null;
      readonly got: readonly Holding[];
      /** Opt-in (`takeItem`): el ítem con identidad que fue por, y si su intento alcanzó para disputarlo. */
      readonly item?: ItemId;
      readonly claimed?: boolean;
      /** Opt-in (`takeAnimal`): el animal ajeno que fue por; `claimed` dice si se lo llevó. */
      readonly animal?: string;
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
      readonly kind: "boil";
      /** El combustible que quemó (null si no tenía o no pudo). */
      readonly fuel: LedgerUnit | null;
      /** Gramos quemados. */
      readonly grams: number;
    }
  | {
      readonly kind: "filter";
      /** El material filtrante que gastó (null si no tenía o no pudo). */
      readonly material: LedgerUnit | null;
      /** Gramos gastados. */
      readonly grams: number;
    }
  | {
      readonly kind: "kindle";
      /** El hogar que encendió o avivó (null si no había hogar o leña). */
      readonly hearth: string | null;
      /** Gramos de leña que llevaba encima y dejó en la pila del hogar. */
      readonly moved: number;
      /** Gramos que tiene el hogar para quemar después (pila más lo que dejó). */
      readonly fuelG: number;
    }
  | {
      readonly kind: "douse";
      /** El hogar que apagó (null si no había uno encendido). */
      readonly hearth: string | null;
    }
  | {
      readonly kind: "slaughter";
      /** El animal que quiso carnear (null si no había uno suyo al lado). */
      readonly animal: string | null;
      /** Lo carneó: si sale mal, el animal sigue vivo. */
      readonly done: boolean;
      /** Gramos que dejó en la despensa, sumando todos los bienes. */
      readonly grams: number;
    }
  | {
      readonly kind: "consume";
      /** La sustancia que tomó (null si no tenía o no pudo). */
      readonly good: LedgerUnit | null;
      readonly from: HolderRef | null;
      /** Unidades gastadas: cada una es una dosis. */
      readonly units: number;
    }
  | {
      readonly kind: "store";
      /** Lo que dejó en la despensa de la casa (nada si no llevaba o no podía). */
      readonly got: readonly Holding[];
    }
  | {
      readonly kind: "drop";
      /** Lo que soltó (nada si no llevaba o no podía): queda sin dueño en el lugar. */
      readonly got: readonly Holding[];
      /** Dónde quedó: el mismo lugar del que `take` sin `from` levanta. */
      readonly at: HolderRef;
      /** Opt-in (`dropItem`): el objeto con identidad que soltó, y si de verdad lo soltó. */
      readonly item?: ItemId;
      readonly dropped?: boolean;
    }
  | { readonly kind: "drink"; readonly liters: number }
  | {
      readonly kind: "use";
      /** La función que se jugó (`well.draw_water`, `tool.sharpen`). */
      readonly how: string;
      /** El pozo del que sacó (`well.draw_water`). */
      readonly well?: EntityRef;
      /** El recipiente que llenó (o que quiso llenar). */
      readonly item?: ItemId;
      readonly liters: number;
      /** `tool.sharpen`: la herramienta, cómo quedó (desgaste y metal comido) y cuánto filo recuperó. */
      readonly tool?: ItemId;
      readonly wear?: number;
      readonly ground?: number;
      readonly honed?: number;
      /** `tool.sharpen`: si tenía la herramienta y con qué afilarla. */
      readonly means?: boolean;
      /** `tool.mend`: el herrero, lo que cobró, el hierro que puso y, si no se pudo, qué faltó. */
      readonly smith?: AgentId;
      readonly paid?: number;
      readonly iron?: number;
      readonly mended?: boolean;
      readonly lack?: "tool" | "smith" | "copper" | "iron";
      /** `hearth.warm`: el fogón y si se quedó arrimado al fuego. */
      readonly hearth?: EntityRef;
      readonly warmed?: boolean;
      /** `bench.sit`: el banco donde se sentó. */
      readonly bench?: EntityRef;
      readonly sat?: boolean;
    }
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
    }
  | {
      /** Copiar la marca de otro en un lote propio: lo hace `game` (economy §6, `life.marks`). */
      readonly kind: "forge";
      readonly of: EntityRef | null;
      /** El lote que nombró, en sus palabras. */
      readonly what: string | null;
    }
  | {
      /** Ofrecer jornal a un oficial o jornalero: el pago y el trabajo los resuelve `game`. */
      readonly kind: "hire";
      readonly who: EntityRef | null;
      /** El trabajo o el oficio que nombró, en sus palabras. */
      readonly what: string | null;
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
  /** La herramienta que sirve de instrumento en este paso, con lo que multiplica el rinde. */
  readonly tool?: Tool | undefined;
}

/** La herramienta en uso: lo que multiplica, su desgaste y cuánto se gasta por segundo. */
interface Tool {
  readonly item: ItemId;
  readonly rate: number;
  readonly ease: number;
  readonly wear?: number;
  readonly perSecond: number;
}

/** Lo que el paso le deja a la herramienta: el desgaste sumado (a millonésimas) y si se terminó. */
function toolMark(tool: Tool | undefined, seconds: number) {
  if (tool === undefined) return {};
  if (tool.wear === undefined) return { tool: tool.item };
  const toolWear = Math.round(seconds * tool.perSecond * 1e6) / 1e6;
  return {
    tool: tool.item,
    toolWear,
    ...(tool.wear + toolWear >= 1 ? { toolWorn: true } : {}),
  };
}

type Resolver = (c: Ctx) => VerbResult;

export function resolve(input: ResolveInput): ActionResolution {
  const { def, node, actor } = input;
  if (input.causes.length === 0) throw new RangeError(`${def.id}: un paso sin causas`);

  // Un ítem con identidad en la mano (o el animal de la casa que se regala) cuenta como bien
  // aunque no tenga cuenta en el ledger.
  const has = (holder: EntityRef, what: "goods" | "money") =>
    (what === "goods" &&
      (input.giveItem?.available === true || input.giveAnimal !== undefined) &&
      holder === actor.id) ||
    input.ledger
      .holdings(holderAccount(holder as HolderRef))
      .some((h) => isMoney(h.unit) === (what === "money"));
  const tool = toolFor(input);
  const roll = attempt({ ...input, has, ...(tool ? { toolEase: tool.ease } : {}) });

  const fullPath =
    def.resolver === "move" && input.destination !== undefined
      ? hexPath(input.map, actor.hex, input.destination)
      : [];
  const walk = input.walkFactor ?? 1;
  const path = legOf(input.map, fullPath, walk);
  const pathSeconds = path.reduce((s, h) => s + (input.map.crossSeconds[h] ?? 0) * walk, 0);
  const nominal = actionDuration(
    def,
    node,
    input.planManner,
    pathSeconds,
    input.fixedSpeech !== true,
  );
  const ctx: Ctx = {
    input,
    roll,
    degree: degreeOf(roll.margin),
    nominal,
    path,
    rng: input.rng.fork("resolve", actor.id, def.id, input.tick),
    ...(tool ? { tool } : {}),
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

/**
 * Falsificar: el resolver deja de quién copia la marca y qué lote nombró; la fidelidad sale de la
 * habilidad y de lo que conoce la marca original, y la marca falsa la escribe `game` (`life.marks`).
 */
const forge: Resolver = (c) => ({
  effect: { kind: "forge", of: argEntity(c, "of"), what: argText(c, "what") },
  seconds: c.nominal,
});

/** Contratar: el resolver deja a quién y para qué; el jornal y el trabajo salen de `game`. */
const hire: Resolver = (c) => ({
  effect: { kind: "hire", who: argEntity(c, "who"), what: argText(c, "what") },
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
  const within = c.input.withinSite;
  const at = (hex: number): StateChange[] =>
    within !== undefined && hex === to
      ? [setComponent(LOCATION, c.input.actor.id, { hex, space: within.space })]
      : hex === from
        ? []
        : [setComponent(LOCATION, c.input.actor.id, { hex })];

  if (within !== undefined && to === from) {
    // Unos pasos adentro del sitio: no hay rumbo que perder ni tirada que valga.
    if (c.input.shut === true && within.leaving) {
      return { effect: { ...effect(from, false), blocked: "jammed_door" }, seconds: 10 };
    }
    if (roll.unmet) return { effect: effect(from, false), seconds: within.seconds };
    return {
      effect: { ...effect(from, false), space: within.space },
      seconds: within.seconds,
      changes: at(from),
      verdict: { outcome: "success", failure: null, believed: "success" },
    };
  }

  if (c.input.shut === true && path.length > 0) {
    // Quiere salir y la puerta no cede: no hay tirada que valga, forcejea un rato y sigue adentro.
    return { effect: { ...effect(from, false), blocked: "jammed_door" }, seconds: c.nominal * 0.1 };
  }
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

const observe: Resolver = (c) => {
  const target = argEntity(c, "target");
  return {
    effect: { kind: "observe", acuity: c.degree, ...(target ? { target } : {}) },
    seconds: c.nominal,
  };
};

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

/**
 * Qué sale de `gather` en un lugar: la salida que el actor nombra («junto leña»), si la hay; si no,
 * la primera del lugar sin palabras (lo de siempre). Sin `what`, las salidas con palabras no salen.
 */
export function gatherYield(
  yields: ActionDef["yields"],
  kinds: readonly string[],
  what: string | null,
): ActionDef["yields"][number] | undefined {
  const here = yields.filter((y) => kinds.includes(y.at));
  if (what !== null) {
    const said = new Set(refTokens(what));
    const named = here.find((y) =>
      (y.words ?? []).some((w) => {
        const need = refTokens(w);
        return need.length > 0 && need.every((t) => said.has(t));
      }),
    );
    if (named) return named;
  }
  return here.find((y) => y.words === undefined);
}

/**
 * La herramienta de instrumento que vale para este paso (use-tools): la que el actor lleva, si el
 * verbo la acepta por su forma y, cuando la ata a una salida, si es la que se va a juntar.
 */
export function toolFor(
  input: Pick<ResolveInput, "def" | "node" | "instrument" | "scene" | "gatherByWords">,
): Tool | undefined {
  const inst = input.instrument;
  if (inst === undefined) return undefined;
  // Gastada del todo, ya no rinde de más: se trabaja como a mano.
  const wear = inst.wear;
  if (wear !== undefined && wear >= 1) return undefined;
  const { def } = input;
  const good =
    def.resolver === "gather"
      ? gatherYield(
          def.yields,
          input.scene.placeKinds,
          input.gatherByWords === true ? nodeText(input.node, "what") : null,
        )?.good
      : undefined;
  const spec = def.instruments.find(
    (t) => t.shapes.includes(inst.shape) && (t.good === undefined || t.good === good),
  );
  if (!spec) return undefined;
  // Lo que da de más se va perdiendo con el desgaste (el filo que se va, el mango flojo).
  const left = 1 - (wear ?? 0);
  return {
    item: inst.item,
    rate: 1 + (spec.rate - 1) * left,
    ease: spec.ease * left,
    ...(wear !== undefined ? { wear } : {}),
    perSecond: 1 / (spec.hours * 3600),
  };
}

const gather: Resolver = (c) => {
  const kinds = c.input.scene.placeKinds;
  const what = argText(c, "what");
  const spec = gatherYield(c.input.def.yields, kinds, c.input.gatherByWords === true ? what : null);
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
  const wanted = Math.round(spec.perHour * hours * 2 * c.degree * (c.tool?.rate ?? 1));
  const stock = c.input.ledger
    .holdings(holderAccount(c.input.place))
    .find((h) => h.unit === good)?.amount;
  const amount = Math.min(wanted, stock ?? 0);
  const effect: VerbEffect = {
    kind: "gather",
    good,
    amount,
    what,
    stumbled,
    ...toolMark(c.tool, c.nominal),
  };
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
  // Con herramienta (use-tools), la misma hora rinde más: la azada abre surco más rápido que las manos.
  const rate = c.tool?.rate ?? 1;
  const effectiveSeconds = Math.round(c.nominal * Math.min(1.5, 2 * c.degree) * rate);
  const mk = c.input.market;
  const effect: VerbEffect = {
    kind: "work",
    effectiveSeconds,
    hurt: m <= -CRITICAL_MARGIN,
    ...toolMark(c.tool, c.nominal),
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
  if (c.input.usedTool !== undefined && other !== null) {
    return deal
      ? usedTrade(c, other, c.input.usedTool, edge, { usedItem: c.input.usedTool.item })
      : { effect: idle(false), seconds: c.nominal / 2 };
  }
  if (c.input.animalSale !== undefined && other !== null) {
    return deal
      ? usedTrade(c, other, c.input.animalSale, edge, { animal: c.input.animalSale.animal })
      : { effect: idle(false), seconds: c.nominal / 2 };
  }
  if (c.input.forge !== undefined && other !== null) {
    return deal
      ? forgeBuy(c, other, c.input.forge, edge)
      : { effect: idle(false), seconds: c.nominal / 2 };
  }
  const mk = c.input.market;
  if (!deal || !mk || other === null) {
    return {
      effect: idle(deal && (!mk || other === null)),
      seconds: deal ? c.nominal : c.nominal / 2,
    };
  }
  const found = c.input.counterpartyGone ? "no_means" : bargain(c, other, mk, edge);
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
      ...(found.believed !== undefined ? { believed: found.believed } : {}),
    }),
    seconds: c.nominal,
    transfers: found.transfers,
  };
};

/** Segundos que tarda el herrero en forjar una herramienta mientras el comprador espera (sin calibrar). */
export const FORGE_SECONDS = 3600;

/** Una herramienta usada vale esta fracción de una nueva antes del desgaste (sin calibrar). */
export const USED_FACTOR = 0.7;

/** Lo que vale una herramienta usada: lo que cuesta nueva, con descuento de usada y menos el desgaste. Puro. */
export function usedPrice(newPrice: number, wear: number): number {
  return Math.max(1, Math.round(newPrice * USED_FACTOR * (1 - Math.min(1, Math.max(0, wear)))));
}

/**
 * Comprar o vender una herramienta usada (use-tools-mend-trade-sell): cerrado el trato, la ventaja
 * mueve el precio a favor del actor (vendiendo cobra más, comprando paga menos) y el cobre va de
 * quien compra a quien vende; el objeto lo cambia de manos quien aplica el efecto (`usedItem`). Sin
 * ganas del comprador, sin otra en la casa del vendedor o sin cobre no hay trato. Igual con un
 * animal (livestock-tenure-sell), que cambia de casa con `animal`.
 */
function usedTrade(
  c: Ctx,
  other: EntityRef,
  u: Omit<NonNullable<ResolveInput["usedTool"]>, "item"> & {
    readonly payers?: readonly { readonly holder: HolderRef; readonly copper: number }[];
  },
  edge: number,
  what: { readonly usedItem: ItemId } | { readonly animal: string },
): VerbResult {
  const price = Math.max(1, Math.round(u.price * (u.direction === "sell" ? 1 + edge : 1 - edge)));
  const base = {
    kind: "trade" as const,
    with: other,
    good: null,
    grams: 0,
    ...what,
    forgedName: u.name,
  };
  const lack: "copper" | "want" | "spare" | undefined = !u.wants
    ? "want"
    : !u.spare
      ? "spare"
      : u.buyerCopper < price
        ? "copper"
        : undefined;
  if (lack !== undefined) {
    return {
      effect: { ...base, deal: false, edge: 0, direction: null, coins: 0, lack },
      seconds: c.nominal / 2,
      override: { outcome: "failure", failure: "no_means", believed: "failure" },
    };
  }
  const actor = c.input.actor.id as HolderRef;
  const buyer = u.direction === "sell" ? (other as HolderRef) : actor;
  const seller = u.direction === "sell" ? actor : (other as HolderRef);
  // Lo paga quien compra o, con `payers`, cada uno lo que tiene hasta juntar el precio.
  let left = price;
  const transfers = (u.payers ?? [{ holder: buyer, copper: price }]).flatMap((p) => {
    const amount = Math.min(left, Math.max(0, Math.floor(p.copper)));
    left -= amount;
    return amount > 0 ? [{ from: p.holder, unit: u.unit, amount, to: holderAccount(seller) }] : [];
  });
  return {
    effect: { ...base, deal: true, edge, direction: u.direction, coins: price },
    seconds: c.nominal,
    transfers,
  };
}

/** Lo que paga por una herramienta nueva según la ventaja del trato (`edge`, -0,3 a 0,3). Puro. */
export function forgePrice(base: number, edge: number): number {
  return Math.max(1, Math.round(base * (1 - edge)));
}

/**
 * Comprarle una herramienta nueva al herrero (use-tools-mend-trade-buy): cerrado el trato, la forja
 * con hierro de su hogar y la cobra en cobre según la ventaja. Sin cobre para pagarla o sin hierro
 * para hacerla no hay trato. El objeto nuevo lo crea quien aplica el efecto (`forged`).
 */
function forgeBuy(
  c: Ctx,
  other: EntityRef,
  f: NonNullable<ResolveInput["forge"]>,
  edge: number,
): VerbResult {
  const price = forgePrice(f.price, edge);
  const base = {
    kind: "trade" as const,
    with: other,
    edge,
    good: null,
    grams: 0,
  };
  const fail = (lack: "copper" | "iron"): VerbResult => ({
    effect: { ...base, deal: false, edge: 0, direction: null, coins: 0, forgedName: f.name, lack },
    seconds: c.nominal / 2,
    override: { outcome: "failure", failure: "no_means", believed: "failure" },
  });
  if (f.copper < price) return fail("copper");
  if (f.ironHave < f.ironNeed) return fail("iron");
  return {
    effect: {
      ...base,
      deal: true,
      direction: "buy",
      coins: price,
      forged: f.tool,
      forgedName: f.name,
      iron: f.ironNeed,
    },
    seconds: c.nominal + FORGE_SECONDS,
    transfers: [
      {
        from: c.input.actor.id as HolderRef,
        unit: f.units.copper,
        amount: price,
        to: holderAccount(other as HolderRef),
      },
      { from: f.ironFrom, unit: f.units.iron, amount: f.ironNeed, to: f.ironSink },
    ],
  };
}

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
  const push = mk.pricePush?.unit === unit ? mk.pricePush.factor : undefined;
  const quote = householdQuote(
    mk.beliefs?.[who],
    unit,
    ref,
    mk.beliefs?.day ?? 0,
    ownDays,
    push === undefined ? opts : { ...opts, pricePush: push },
  );
  // El gusto solo corre lo que paga quien compra; lo que pide quien vende no cambia.
  const taste = mk.tasteBid?.[who](unit);
  return taste === undefined || taste === 1 ? quote : { ask: quote.ask, bid: quote.bid * taste };
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
): { seller: number; buyer: number; quality: number; believed?: number } {
  const lots = mk.lots?.[sellerIs];
  if (lots?.[unit] === undefined)
    return { seller: 1, buyer: 1, quality: qualityOfUnit(lots, unit) };
  const real = qualityOfUnit(lots, unit);
  const noise = c.rng.fork("eye").normal(0, 1);
  const inflate = mk.scam?.inflate[sellerIs] ?? 0;
  const seen =
    mk.scam && inflate > 0
      ? believedQuality(
          real,
          claimedQuality(real, inflate),
          buyerEye,
          noise,
          mk.scam.trust[sellerIs],
        )
      : perceivedQuality(real, buyerEye, noise);
  return {
    seller: qualityPriceFactor(real),
    buyer: qualityPriceFactor(seen),
    quality: real,
    ...(mk.scam && inflate > 0 ? { believed: seen } : {}),
  };
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
  readonly believed?: number;
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
      ...(qf.believed !== undefined ? { believed: qf.believed } : {}),
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
    ...(qf.believed !== undefined ? { believed: qf.believed } : {}),
    direction: "buy",
    unit: row.unit,
    grams: deal.grams,
    coins: deal.coins,
    transfers,
  };
}

const take: Resolver = (c) => {
  if (c.input.takeItem) return takeItem(c, c.input.takeItem);
  if (c.input.takeAnimal) {
    const t = c.input.takeAnimal;
    const effect = (claimed: boolean): VerbEffect => ({
      kind: "take",
      from: t.from,
      wanted: null,
      got: [],
      animal: t.animal,
      claimed,
    });
    if (c.roll.unmet) return { effect: effect(false), seconds: c.nominal };
    const m = c.roll.margin as number;
    return {
      effect: effect(m >= PARTIAL_MARGIN),
      seconds: c.nominal,
      loud: c.roll.failure === "clumsy" && m < PARTIAL_MARGIN ? 2.5 : 1,
    };
  }
  // Una cosa con identidad sin el servicio de ítems (`itemClaims` apagado): no se elige otro bien.
  if (argEntity(c, "what")?.startsWith("item:")) {
    const from = (argEntity(c, "from") as HolderRef | null) ?? c.input.place;
    return {
      effect: { kind: "take", from, wanted: null, got: [] },
      seconds: c.nominal,
      override: { outcome: "failure", failure: "no_means", believed: "failure" },
    };
  }
  const fromEntity = argEntity(c, "from");
  const what = argText(c, "what");
  const from: HolderRef = (fromEntity as HolderRef | null) ?? homeOrPlace(c, what);
  const held = c.input.ledger.holdings(holderAccount(from));
  const wantedRow = pickWanted(held, what, c.input.unitNames);
  const wanted = wantedRow?.unit ?? null;
  const effect = (got: Holding[]): VerbEffect => ({ kind: "take", from, wanted, got });
  if (c.roll.unmet) return { effect: effect([]), seconds: c.nominal };
  if (!wantedRow) {
    return {
      effect: effect([]),
      seconds: c.nominal,
      ...(c.input.takeEmptyFailure
        ? {
            override: {
              outcome: "failure" as const,
              failure: "no_means" as const,
              believed: "failure" as const,
            },
          }
        : {}),
    };
  }

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

/**
 * De dónde sale un `take` sin `from`: lo suelto en el lugar, salvo que en casa lo que nombra (o
 * cualquier cosa, si el lugar está vacío) solo esté en la despensa, o que en casa ajena lo que
 * nombra solo esté en la despensa de ese hogar.
 */
function homeOrPlace(c: Ctx, what: string | null): HolderRef {
  const place = c.input.place;
  const home = c.input.homeLarder;
  const host = c.input.hostLarder;
  if (host !== undefined) {
    // En casa ajena solo se saca de la despensa lo que se nombra y no está suelto.
    const names = c.input.unitNames;
    const loose = c.input.ledger.holdings(holderAccount(place));
    const stored = c.input.ledger.holdings(holderAccount(host));
    return !namesAny(loose, what, names) && namesAny(stored, what, names) ? host : place;
  }
  if (home === undefined) return place;
  const loose = c.input.ledger.holdings(holderAccount(place));
  const stored = c.input.ledger.holdings(holderAccount(home));
  if (stored.length === 0) return place;
  if (loose.length === 0) return home;
  const names = c.input.unitNames;
  return !namesAny(loose, what, names) && namesAny(stored, what, names) ? home : place;
}

function takeItem(c: Ctx, t: NonNullable<ResolveInput["takeItem"]>): VerbResult {
  const fromEntity = argEntity(c, "from");
  const from: HolderRef = (fromEntity as HolderRef | null) ?? c.input.place;
  const effect = (claimed: boolean): VerbEffect => ({
    kind: "take",
    from,
    wanted: null,
    got: [],
    item: t.item,
    claimed,
  });
  if (!t.available) {
    return {
      effect: effect(false),
      seconds: c.nominal,
      override: { outcome: "failure", failure: "no_means", believed: "failure" },
    };
  }
  // Arrebatarla de quien la lleva pide un éxito; levantarla de donde está, solo no errarle.
  const needs = t.loose === true ? PARTIAL_MARGIN : SUCCESS_MARGIN;
  const claimed = !c.roll.unmet && (c.roll.margin as number) >= needs;
  return { effect: effect(claimed), seconds: c.nominal };
}

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

/**
 * Filtra agua: gasta material filtrante (lo que lleva o la despensa, sale del ledger hacia `BURNED`)
 * y lleva su tiempo. Sin material no hay agua tratada.
 */
const filter: Resolver = (c) => {
  const cfg = c.input.filterMaterial;
  const empty: VerbEffect = { kind: "filter", material: null, grams: 0 };
  if (c.roll.unmet) return { effect: empty, seconds: c.nominal };
  const holders = [c.input.actor.id as HolderRef, ...(c.input.larder ? [c.input.larder] : [])];
  const from = cfg
    ? holders.find(
        (h) =>
          (c.input.ledger.holdings(holderAccount(h)).find((x) => x.unit === cfg.unit)?.amount ??
            0) >= cfg.grams,
      )
    : undefined;
  if (!cfg || from === undefined) {
    return {
      effect: empty,
      seconds: Math.min(c.nominal, 60),
      override: { outcome: "failure", failure: "no_means", believed: "failure" },
    };
  }
  return {
    effect: { kind: "filter", material: cfg.unit, grams: cfg.grams },
    seconds: c.nominal,
    transfers: [{ from, unit: cfg.unit, amount: cfg.grams, to: externalAccount(BURNED) }],
  };
};

/**
 * Hierve agua: quema combustible (lo que lleva encima o la despensa de la casa, sale del ledger
 * hacia `BURNED`) y lleva su tiempo. Sin combustible no hay agua tratada.
 */
const boil: Resolver = (c) => {
  const cfg = c.input.boilFuel;
  const empty: VerbEffect = { kind: "boil", fuel: null, grams: 0 };
  if (c.roll.unmet) return { effect: empty, seconds: c.nominal };
  const holders = [c.input.actor.id as HolderRef, ...(c.input.larder ? [c.input.larder] : [])];
  const from = cfg
    ? holders.find(
        (h) =>
          (c.input.ledger.holdings(holderAccount(h)).find((x) => x.unit === cfg.unit)?.amount ??
            0) >= cfg.grams,
      )
    : undefined;
  if (!cfg || from === undefined) {
    return {
      effect: empty,
      seconds: Math.min(c.nominal, 60),
      override: { outcome: "failure", failure: "no_means", believed: "failure" },
    };
  }
  return {
    effect: { kind: "boil", fuel: cfg.unit, grams: cfg.grams },
    seconds: c.nominal,
    transfers: [{ from, unit: cfg.unit, amount: cfg.grams, to: externalAccount(BURNED) }],
  };
};

/**
 * Enciende o aviva el hogar de la casa donde está: la leña que lleva encima pasa a la pila del hogar
 * (si el hogar es de otra cuenta) y el fuego arde de ahí. Sin hogar o sin leña en ningún lado, no
 * hay fuego.
 */
const kindle: Resolver = (c) => {
  const at = c.input.hearthAt;
  const empty: VerbEffect = { kind: "kindle", hearth: null, moved: 0, fuelG: 0 };
  if (c.roll.unmet) return { effect: empty, seconds: c.nominal };
  const balance = (h: HolderRef) =>
    at === undefined
      ? 0
      : (c.input.ledger.holdings(holderAccount(h)).find((x) => x.unit === at.fuelUnit)?.amount ??
        0);
  const me = c.input.actor.id as HolderRef;
  const carried = Math.floor(balance(me));
  const pile = at === undefined || at.holder === me ? 0 : Math.floor(balance(at.holder));
  if (at === undefined || carried + pile <= 0) {
    return {
      effect: empty,
      seconds: Math.min(c.nominal, 60),
      override: { outcome: "failure", failure: "no_means", believed: "failure" },
    };
  }
  const moved = at.holder === me ? 0 : carried;
  return {
    effect: { kind: "kindle", hearth: at.hearth, moved, fuelG: carried + pile },
    seconds: c.nominal,
    ...(moved > 0
      ? {
          transfers: [{ from: me, unit: at.fuelUnit, amount: moved, to: holderAccount(at.holder) }],
        }
      : {}),
  };
};

/** Apaga el hogar encendido del espacio donde está; sin uno que arda, no hay qué apagar. */
const douse: Resolver = (c) => {
  const at = c.input.hearthAt;
  if (c.roll.unmet) return { effect: { kind: "douse", hearth: null }, seconds: c.nominal };
  if (at === undefined || !at.lit) {
    return {
      effect: { kind: "douse", hearth: null },
      seconds: Math.min(c.nominal, 30),
      override: { outcome: "failure", failure: "no_means", believed: "failure" },
    };
  }
  return { effect: { kind: "douse", hearth: at.hearth }, seconds: c.nominal };
};

/**
 * Carnea el animal de su casa que tiene al lado: lo que deja el cuerpo va a la despensa. Si sale
 * mal (se le escapa, no se anima), el animal sigue vivo; sin uno suyo a mano, no hay qué carnear.
 */
const slaughter: Resolver = (c) => {
  const t = c.input.slaughterTarget;
  const none: VerbEffect = { kind: "slaughter", animal: null, done: false, grams: 0 };
  if (c.roll.unmet) return { effect: none, seconds: c.nominal };
  if (t === undefined) {
    return {
      effect: none,
      seconds: Math.min(c.nominal, 60),
      override: { outcome: "failure", failure: "no_means", believed: "failure" },
    };
  }
  if ((c.roll.margin as number) < PARTIAL_MARGIN) {
    return {
      effect: { kind: "slaughter", animal: t.animal, done: false, grams: 0 },
      seconds: c.nominal / 2,
    };
  }
  const yields = t.yields.filter((y) => y.grams > 0);
  return {
    effect: {
      kind: "slaughter",
      animal: t.animal,
      done: true,
      grams: yields.reduce((n, y) => n + y.grams, 0),
    },
    seconds: c.nominal,
    transfers: yields.map((y) => ({
      from: t.holder,
      source: t.source,
      to: holderAccount(t.holder),
      unit: y.unit,
      amount: y.grams,
    })),
  };
};

/** Toma una sustancia de consumo: lo que lleva encima o la despensa de la casa; gasta una unidad. */
const consume: Resolver = (c) => {
  const kinds = c.input.consumables ?? new Set<LedgerUnit>();
  const usable = (holder: HolderRef | undefined) =>
    holder === undefined
      ? []
      : c.input.ledger
          .holdings(holderAccount(holder))
          .filter((h) => kinds.has(h.unit) && h.amount >= 1);
  const own = usable(c.input.actor.id as HolderRef);
  const from: HolderRef | null =
    own.length > 0 ? (c.input.actor.id as HolderRef) : (c.input.larder ?? null);
  const row = pickWanted(
    own.length > 0 ? own : usable(c.input.larder),
    argText(c, "what"),
    c.input.unitNames,
  );
  const empty: VerbEffect = { kind: "consume", good: null, from, units: 0 };
  if (c.roll.unmet) return { effect: empty, seconds: c.nominal };
  if (!row || from === null) {
    return {
      effect: empty,
      seconds: Math.min(c.nominal, 60),
      override: { outcome: "failure", failure: "no_means", believed: "failure" },
    };
  }
  return {
    effect: { kind: "consume", good: row.unit, from, units: 1 },
    seconds: c.nominal,
    transfers: [{ from, unit: row.unit, amount: 1, to: externalAccount(EATEN) }],
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

/**
 * Soltar, tirar o dejar en el suelo: lo que lleva encima pasa por el ledger al lugar donde está
 * (`input.place`), donde queda como lote sin dueño con el evento del acto como origen; `take` sin
 * `from` lo levanta de ahí. Sin nombrar nada suelta todo menos la plata; con una cantidad
 * («200 gramos», «3 monedas») suelta solo eso de lo nombrado. Nombrar algo que no lleva no suelta otra cosa.
 */
const drop: Resolver = (c) => {
  const at = c.input.place;
  const what = argText(c, "what");
  const none = (): VerbResult => ({
    effect: { kind: "drop", got: [], at },
    seconds: Math.min(c.nominal, 5),
    override: { outcome: "failure", failure: "no_means", believed: "failure" },
  });
  const item = c.input.dropItem;
  if (item !== undefined) {
    const effect = (dropped: boolean): VerbEffect => ({
      kind: "drop",
      got: [],
      at,
      item: item.item,
      dropped,
    });
    if (!item.available) return { ...none(), effect: effect(false) };
    return { effect: effect(!c.roll.unmet), seconds: c.nominal };
  }
  // Un objeto con identidad sin claims no se suelta como lote: soltaría todo lo demás.
  if (argEntity(c, "what")?.startsWith("item:")) return none();
  if (c.roll.unmet) return { effect: { kind: "drop", got: [], at }, seconds: c.nominal };
  const carried = c.input.ledger
    .holdings(holderAccount(c.input.actor.id as HolderRef))
    .filter((h) => h.amount > 0);
  const words = what === null ? [] : refTokens(what);
  const named = carried.filter((h) =>
    words.some((w) => unitTokens(h.unit, c.input.unitNames).includes(w)),
  );
  const pool = words.length > 0 ? named : carried.filter((h) => !isMoney(h.unit));
  if (pool.length === 0) return none();
  const count = what === null ? null : /(\d+(?:[.,]\d+)?)/.exec(what);
  const rows: Holding[] =
    count !== null && pool.length === 1
      ? pool.map((h) => {
          const asked = isMoney(h.unit)
            ? Math.floor(Number((count[1] as string).replace(",", ".")))
            : gramsIn(what, 0);
          return { unit: h.unit, amount: Math.min(h.amount, asked > 0 ? asked : h.amount) };
        })
      : pool;
  return {
    effect: { kind: "drop", got: rows, at },
    seconds: c.nominal,
    transfers: rows.map((r) => ({
      from: c.input.actor.id as HolderRef,
      unit: r.unit,
      amount: r.amount,
      to: holderAccount(at),
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

/** Debajo de esta condición la soga o el brocal del pozo ya no dan para sacar agua. */
export const WELL_WORN = 0.15;

/** Cuánto metal se come el afilado por cada unidad de filo que recupera (sin calibrar). */
export const SHARPEN_GRIND = 0.05;
/** Los segundos de afilar una herramienta gastada del todo (sin calibrar); a una apenas mellada, poco. */
export const SHARPEN_SECONDS = 1800;

/**
 * `tool.sharpen` (use-tools-mend-sharpen): con la herramienta y la piedra encima, le saca filo. Lo
 * que recupera es lo gastado sobre el metal ya comido por el grado de la tirada (una buena afilada lo
 * deja casi como el metal da; una mala, a medias), y el metal comido sube `SHARPEN_GRIND` por cada
 * unidad recuperada: a fuerza de afiladas se acaba y pide herrero. Tarda según lo mellada que esté.
 */
function sharpenTool(c: Ctx): VerbResult {
  const s = c.input.sharpen;
  if (s === undefined) return { effect: { kind: "none" }, seconds: c.nominal };
  const base = { kind: "use" as const, how: "tool.sharpen", liters: 0, tool: s.tool };
  if (!s.held || !s.stone) {
    return {
      effect: { ...base, wear: s.wear, ground: s.ground, honed: 0, means: false },
      seconds: Math.min(c.nominal, 10),
      override: { outcome: "failure", failure: "no_means", believed: "failure" },
    };
  }
  const dull = Math.max(0, s.wear - s.ground);
  const seconds = c.nominal + SHARPEN_SECONDS * dull;
  const honed = c.roll.unmet ? 0 : Math.round(dull * Math.min(1, 0.5 + c.degree) * 1e6) / 1e6;
  const ground = Math.min(1, Math.round((s.ground + SHARPEN_GRIND * honed) * 1e6) / 1e6);
  const wear = Math.max(ground, Math.round((s.wear - honed) * 1e6) / 1e6);
  return { effect: { ...base, wear, ground, honed, means: true }, seconds };
}

/** Cuánto se queda sentado en el banco quien se sienta (s). */
export const BENCH_SECONDS = 900;

/**
 * `bench.sit` (fixtures-bench): se sienta en el banco nombrado un rato (`BENCH_SECONDS`), o lo que
 * diga `for`. El banco lo eligió la función de la cosa (el despacho de `use`), así que no falla.
 */
function sitOnBench(c: Ctx): VerbResult {
  const target = c.input.node.args.find((a) => a.role === "target");
  const bench = target !== undefined && "entity" in target ? target.entity : undefined;
  if (bench === undefined) return { effect: { kind: "none" }, seconds: c.nominal };
  return {
    effect: { kind: "use", how: "bench.sit", liters: 0, bench, sat: true },
    seconds: BENCH_SECONDS,
  };
}

/** Cuánto se queda arrimado al fuego quien sale a calentarse (s). */
export const WARM_SECONDS = 1800;

/**
 * `hearth.warm` (use-hearth-warm): con el fogón encendido, se queda arrimado `WARM_SECONDS`; el
 * calor lo pone `life.thermal` en ese tramo. Apagado, no hay de qué calentarse (lo nota enseguida).
 */
function warmAtHearth(c: Ctx): VerbResult {
  const h = c.input.warmHearth;
  if (h === undefined) return { effect: { kind: "none" }, seconds: c.nominal };
  const base = { kind: "use" as const, how: "hearth.warm", liters: 0, hearth: h.hearth };
  if (!h.lit) {
    return {
      effect: { ...base, warmed: false, means: false },
      seconds: Math.min(c.nominal, 10),
      override: { outcome: "failure", failure: "no_means", believed: "failure" },
    };
  }
  return { effect: { ...base, warmed: true, means: true }, seconds: WARM_SECONDS };
}

/** Qué parte del metal comido repone el herrero según su oficio (0,5 torpe, 0,9 maestro). */
export function mendRestores(level: number): number {
  return Math.round((0.5 + 0.4 * Math.min(1, Math.max(0, level))) * 1e6) / 1e6;
}
/** Hierro (g) que pone por unidad de metal repuesto y lo mínimo de un arreglo (sin calibrar). */
export const MEND_IRON = 600;
export const MEND_IRON_MIN = 50;
/** Cobre de un arreglo: lo fijo más lo que crece con el metal comido (sin calibrar). */
export const MEND_BASE_COST = 2;
export const MEND_GROUND_COST = 6;
/** Segundos del arreglo por unidad de filo y de metal a reponer (sin calibrar). */
export const MEND_EDGE_SECONDS = 1800;
export const MEND_METAL_SECONDS = 7200;

/** Lo que cobra y el hierro que pone el herrero por arreglar una herramienta así. Puro. */
export function mendQuote(
  wear: number,
  ground: number,
  level: number,
): { cost: number; iron: number; ground: number } {
  const after = Math.round(ground * (1 - mendRestores(level)) * 1e6) / 1e6;
  return {
    cost: MEND_BASE_COST + Math.ceil(MEND_GROUND_COST * ground - 1e-9),
    iron: Math.max(MEND_IRON_MIN, Math.round(MEND_IRON * (ground - after))),
    ground: after,
  };
}

/**
 * `tool.mend` (use-tools-mend-smith): el herrero repara la herramienta que el actor le lleva. Sin la
 * herramienta, sin herrero presente, sin cobre para pagarle o sin hierro en su hogar no se hace. Si
 * se hace, el resultado es el oficio del herrero y no la tirada del actor: repone parte del metal
 * comido (`mendRestores`) y le deja el filo entero (el desgaste baja hasta el metal que queda
 * comido); el cobre pasa del actor al herrero y el hierro queda en la herramienta.
 */
function mendTool(c: Ctx): VerbResult {
  const m = c.input.mend;
  if (m === undefined) return { effect: { kind: "none" }, seconds: c.nominal };
  const base = { kind: "use" as const, how: "tool.mend", liters: 0, tool: m.tool };
  const smith = m.smith;
  const fail = (lack: "tool" | "smith" | "copper" | "iron"): VerbResult => ({
    effect: {
      ...base,
      wear: m.wear,
      ground: m.ground,
      mended: false,
      lack,
      ...(smith ? { smith: smith.who } : {}),
    },
    seconds: Math.min(c.nominal, 10),
    override: {
      outcome: "failure",
      failure: lack === "smith" ? "not_here" : "no_means",
      believed: "failure",
    },
  });
  if (!m.held) return fail("tool");
  if (smith === undefined) return fail("smith");
  const quote = mendQuote(m.wear, m.ground, smith.level);
  const self = smith.who === c.input.actor.id;
  const cost = self ? 0 : quote.cost;
  if (m.copper < cost) return fail("copper");
  if (smith.iron < quote.iron) return fail("iron");
  const seconds = Math.round(
    c.nominal +
      MEND_EDGE_SECONDS * Math.max(0, m.wear - m.ground) +
      MEND_METAL_SECONDS * (m.ground - quote.ground),
  );
  return {
    effect: {
      ...base,
      wear: quote.ground,
      ground: quote.ground,
      mended: true,
      smith: smith.who,
      paid: cost,
      iron: quote.iron,
    },
    seconds,
    verdict: { outcome: "success", failure: null, believed: "success" },
    transfers: [
      ...(cost > 0
        ? [
            {
              from: c.input.actor.id as HolderRef,
              unit: m.units.copper,
              amount: cost,
              to: holderAccount(smith.who as unknown as HolderRef),
            },
          ]
        : []),
      { from: smith.ironFrom, unit: m.units.iron, amount: quote.iron, to: m.ironSink },
    ],
  };
}

/**
 * Usar una cosa con una función que no es otro verbo (actions, «Ampliación: `use`»):
 * `well.draw_water` llena el recipiente con lo que le cabe y el pozo da hoy (sin recipiente, con
 * el pozo seco o gastado, no hay con qué; si la tirada no alcanza, se le vuelca y no junta nada),
 * `tool.sharpen` afila (`sharpenTool`) y `tool.mend` la hace reparar al herrero (`mendTool`).
 */
const use: Resolver = (c) => {
  if (argText(c, "how") === "hearth.warm") return warmAtHearth(c);
  if (argText(c, "how") === "bench.sit") return sitOnBench(c);
  if (argText(c, "how") === "tool.sharpen") return sharpenTool(c);
  if (argText(c, "how") === "tool.mend") return mendTool(c);
  const d = c.input.drawWater;
  if (d === undefined || argText(c, "how") !== "well.draw_water") {
    return { effect: { kind: "none" }, seconds: c.nominal };
  }
  const effect = (liters: number): VerbEffect => ({
    kind: "use",
    how: "well.draw_water",
    well: d.well,
    ...(d.vessel ? { item: d.vessel.item } : {}),
    liters,
  });
  if (d.vessel === undefined || d.vessel.room <= 0 || d.left <= 0 || d.condition < WELL_WORN) {
    return {
      effect: effect(0),
      seconds: Math.min(c.nominal, 10),
      override: { outcome: "failure", failure: "no_means", believed: "failure" },
    };
  }
  if (c.roll.unmet) return { effect: effect(0), seconds: c.nominal };
  return { effect: effect(Math.min(d.vessel.room, d.left)), seconds: c.nominal };
};

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
  if (c.input.giveItem) {
    const g = c.input.giveItem;
    const effect = (delivered: boolean): VerbEffect => ({
      kind: "give",
      to,
      good: null,
      grams: 0,
      item: g.item,
      delivered,
    });
    if (c.roll.unmet) return { effect: effect(false), seconds: c.nominal };
    if (!g.available || to === null || c.input.counterpartyGone) {
      return {
        effect: effect(false),
        seconds: Math.min(c.nominal, 60),
        override: { outcome: "failure", failure: "no_means", believed: "failure" },
      };
    }
    return { effect: effect((c.roll.margin as number) >= SUCCESS_MARGIN), seconds: c.nominal };
  }
  if (c.input.giveAnimal) {
    const a = c.input.giveAnimal.animal;
    const effect = (delivered: boolean): VerbEffect => ({
      kind: "give",
      to,
      good: null,
      grams: 0,
      animal: a,
      delivered,
    });
    if (c.roll.unmet) return { effect: effect(false), seconds: c.nominal };
    if (to === null || c.input.counterpartyGone) {
      return {
        effect: effect(false),
        seconds: Math.min(c.nominal, 60),
        override: { outcome: "failure", failure: "no_means", believed: "failure" },
      };
    }
    return { effect: effect((c.roll.margin as number) >= PARTIAL_MARGIN), seconds: c.nominal };
  }
  const none = (): VerbResult => ({
    effect: { kind: "give", to, good: null, grams: 0 },
    seconds: Math.min(c.nominal, 60),
    override: { outcome: "failure", failure: "no_means", believed: "failure" },
  });
  if (c.roll.unmet)
    return { effect: { kind: "give", to, good: null, grams: 0 }, seconds: c.nominal };
  if (to === null || c.input.counterpartyGone) return none();
  // Una cosa con identidad sin el servicio de ítems: no se da otro bien en su lugar.
  if (argEntity(c, "what")?.startsWith("item:")) return none();
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
  drop,
  eat,
  consume,
  boil,
  filter,
  kindle,
  douse,
  cook,
  drink,
  use,
  tend,
  consult,
  forge,
  hire,
  slaughter,
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
/** Si alguna unidad de `held` responde a las palabras de `what`. */
function namesAny(
  held: readonly Holding[],
  what: string | null,
  names?: ReadonlyMap<LedgerUnit, string>,
): boolean {
  const words = what === null ? [] : refTokens(what);
  return held.some((h) => {
    const unit = unitTokens(h.unit, names);
    return words.some((w) => unit.includes(w));
  });
}

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
  return nodeText(c.input.node, role);
}

function nodeText(node: ResolveInput["node"], role: string): string | null {
  const a = node.args.find((x) => x.role === role);
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

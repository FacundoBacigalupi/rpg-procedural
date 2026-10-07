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
  type HolderRef,
  holderAccount,
  type LedgerUnit,
  ledgerUnit,
  logistic,
  type PlaceRef,
} from "../../core/index.ts";
import {
  draftEvent,
  type EventDraft,
  type PostingDraft,
  type ReadonlyLedger,
  type StateChange,
  setComponent,
} from "../scheduler/index.ts";
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
import { refTokens } from "./refs.ts";

/** Lo que el mundo le da al resolver además de lo que necesita la tirada. */
export interface ResolveInput extends Omit<AttemptInput, "has"> {
  readonly map: LocalMap;
  /** El hex adonde va `move` (el del lugar del argumento, ya elegido por quien arma el paso). */
  readonly destination?: number | undefined;
  /** Lo que tiene cada titular: de acá sale qué hay para tomar, ofrecer o sacar del lugar. */
  readonly ledger: Pick<ReadonlyLedger, "holdings">;
  /** Dónde está el actor: el lugar del evento y el titular del stock que se recolecta. */
  readonly place: PlaceRef;
  /** Por qué: las causas del plan (la intención, las creencias que la sostienen). */
  readonly causes: readonly CauseRef[];
}

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
    }
  | {
      readonly kind: "trade";
      readonly with: EntityRef | null;
      /** Si se llegó a un trato. */
      readonly deal: boolean;
      /** Ventaja sobre el precio que el otro cree justo, -0,3 a 0,3: economy cierra el trato. */
      readonly edge: number;
    }
  | {
      readonly kind: "take";
      readonly from: HolderRef;
      /** Lo que quería llevarse. */
      readonly wanted: LedgerUnit | null;
      readonly got: readonly Holding[];
    };

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
  readonly transfers?: readonly { from: HolderRef; unit: LedgerUnit; amount: number }[];
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

  const path =
    def.resolver === "move" && input.destination !== undefined
      ? hexPath(input.map, actor.hex, input.destination)
      : [];
  const pathSeconds = path.reduce((s, h) => s + (input.map.crossSeconds[h] ?? 0), 0);
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

  const outcome = truth.override?.outcome ?? roll.outcome;
  const failure = truth.override?.failure ?? roll.failure;
  const believed = truth.override?.believed ?? roll.believed;
  const noticedBy = unique([...roll.noticedBy, ...(truth.noticedBy ?? [])]);

  // Lo creído: si el actor no notó que falló (o que salió a medias), cree el efecto de un
  // resultado bueno; si no, ve lo que pasó. Recolectar es la excepción: lo juntado se ve.
  const fooled =
    (outcome === "failure_unnoticed" || (roll.outcome === "partial" && believed === "success")) &&
    def.resolver !== "gather";
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
              from: holderAccount(t.from),
              to: holderAccount(actor.id as HolderRef),
              amount: t.amount,
            })),
          },
        ]
      : [];

  return {
    attempt: roll,
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
  if (effect.kind === "move" && effect.reached !== effect.to) {
    // Se cayó en el camino: sabe dónde está. Se perdió: no.
    return effect.stumbled ? effect : { ...effect, reached: null };
  }
  if (effect.kind === "search" && !effect.found && !effect.glimpsed) {
    // No lo encontró: cree que no está, esté o no.
    return { ...effect, present: false };
  }
  return effect;
}

// ---------------------------------------------------------------------------------------------
// Por verbo

const none: Resolver = (c) => ({ effect: { kind: "none" }, seconds: c.nominal });

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
    return { effect: effect(to, stumbled), seconds: c.nominal * slow, changes: at(to) };
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
  return {
    effect: { kind: "work", effectiveSeconds, hurt: m <= -CRITICAL_MARGIN },
    seconds: c.nominal,
  };
};

const speak: Resolver = (c) => {
  const to = argEntity(c, "to");
  const text = argText(c, "content");
  const m = c.roll.margin;
  const delivered = m !== null && !(m < PARTIAL_MARGIN && c.roll.failure === "hesitate");
  return {
    effect: { kind: "speak", to, delivered, clarity: delivered ? c.degree : 0, text },
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

const trade: Resolver = (c) => {
  const other = argEntity(c, "with");
  const m = c.roll.margin;
  // Cerrar mal también es cerrar: la torpeza deja un mal trato; la duda o la falta de algo, ninguno.
  const deal = m !== null && (m >= PARTIAL_MARGIN || c.roll.failure === "clumsy");
  return {
    effect: {
      kind: "trade",
      with: other,
      deal,
      edge: deal ? round3(0.3 * (2 * c.degree - 1)) : 0,
    },
    seconds: deal ? c.nominal : c.nominal / 2,
  };
};

const take: Resolver = (c) => {
  const fromEntity = argEntity(c, "from");
  const from: HolderRef = (fromEntity as HolderRef | null) ?? c.input.place;
  const held = c.input.ledger.holdings(holderAccount(from));
  const wantedRow = pickWanted(held, argText(c, "what"));
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

const RESOLVE: Readonly<Record<ResolveKey, Resolver>> = {
  none,
  move,
  observe,
  search,
  gather,
  work,
  speak,
  strike,
  trade,
  take,
};
type ResolveKey = ResolveInput["def"]["resolver"];

// ---------------------------------------------------------------------------------------------

/** La plata se distingue de los bienes por la unidad hasta que economy tenga su catálogo. */
export function isMoney(unit: LedgerUnit): boolean {
  return unit === "coin" || unit.startsWith("coin:");
}

/**
 * Lo que quiere llevarse: lo que nombra (por palabras, contra el nombre de la unidad) o, si no
 * nombra nada que haya, lo que más hay. Determinista: desempata por unidad.
 */
function pickWanted(held: readonly Holding[], what: string | null): Holding | undefined {
  if (held.length === 0) return undefined;
  const words = what === null ? [] : refTokens(what);
  const named = held.filter((h) => {
    const unit = refTokens(h.unit.replace(/^[a-z]+:/, "").replace(/_/g, " "));
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

function unique<T>(xs: readonly T[]): T[] {
  return [...new Set(xs)];
}

function clamp01(x: number): number {
  return x < 0 ? 0 : x > 1 ? 1 : x;
}

function round3(x: number): number {
  return Math.round(x * 1000) / 1000;
}

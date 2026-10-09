// Cómo contesta alguien (dialogue §4, §5): la respuesta sale de lo que el oyente sabe, no de lo
// que es cierto. Sabe de primera mano lo que tiene delante; de lo demás, lo que le contaron; y si
// no tiene nada, dice que no sabe. Un pedido se concede si hay de sobra después de la reserva de
// la casa y el oyente quiere a quien pide (lee las dimensiones de su relación, no un booleano de
// parentesco: `warmth`, `isFormal`). La función es pura: devuelve qué decir y qué pasa.

import type { AgentId, Rng } from "../../core/index.ts";
import { CREDIT_LIMIT_GRAMS } from "../contracts/index.ts";
import type { TabooDef } from "../language/index.ts";
import type { DeedKind } from "../law/index.ts";
import type { Vector } from "../relations/index.ts";
import type { Offense } from "../social/index.ts";
import {
  type AccuseInput,
  type AccuseOutcome,
  decideDefense,
  hearAccusation,
} from "./accusations.ts";
import type { PromiseTerms, SpeechAct } from "./acts.ts";
import { NEUTRAL_TEMPER, NO_RECOLLECTION, type Recollection, type Temper } from "./disposition.ts";
import { type FormJudgeInput, type FormJudgement, judgeForm } from "./form.ts";
import type { HeardClaim } from "./knowledge.ts";
import {
  type CaughtLie,
  type DetectionInput,
  judgeStatement,
  type LieJudgement,
  recordCaught,
} from "./lies.ts";
import { type Params, type SpeechLine, sayLine, type Tone } from "./lines.ts";
import { dealHolds, MAX_ROUNDS, type Proposal, weighOffer } from "./offers.ts";
import {
  type FlatteryInput,
  type FlatteryResult,
  type InsultInput,
  insultOffense,
  judgeFlattery,
} from "./regard.ts";
import { askSecret, type KeeperState, type KeepResult } from "./secrets.ts";
import {
  type ThreatAftermath,
  type ThreatInput,
  type ThreatVerdict,
  threatAftermath,
  weighThreat,
} from "./threats.ts";

/** Gramos de un bien que se dan de una vez al que lo pide. */
export const GIFT_GRAMS = 500;
/** Calidez desde la que se da sin cuenta (un padre, un hijo, un cónyuge; no un compañero de casa). */
export const FREE_GIFT_WARMTH = 0.2;
/** Resentimiento (o desconfianza, en negativo) desde el que se niega todo pedido. */
export const GRUDGE_RESENTMENT = 0.4;
export const GRUDGE_DISTRUST = -0.3;
/** Respeto (con rango de más) y familiaridad que deciden el trato de usted. */
export const FORMAL_RESPECT = 0.3;
export const FORMAL_FAMILIARITY = 0.6;
/** Cuánto suma al respeto que quien habla tenga más rango y la cultura trate por rango. */
export const RANK_RESPECT = 0.3;
/** Tamaño de la ofensa desde el que un insulto duele y no se encoge de hombros. */
export const INSULT_HURT = 0.3;
/** Gramos por miembro que la casa no regala (la reserva para comer). */
export const RESERVE_GRAMS_PER_MEMBER = 3000;

export interface ReplyInput {
  readonly act: SpeechAct;
  readonly speaker: AgentId;
  readonly listener: AgentId;
  /** Lo que el oyente siente por quien habla, ya al día (`relationship(...).dims`). */
  readonly feel: Vector;
  /** La cultura trata por rango y quien habla está por encima: suma al respeto. */
  readonly rankAbove?: boolean;
  /** Lo que el oyente sabe de primera mano de `id`: dónde está (clave de lugar) o si murió. */
  readonly direct: (id: AgentId) => { readonly where: string } | { readonly dead: true } | null;
  readonly heard: readonly HeardClaim[];
  /** Lo peor que el oyente sabe que hizo quien habla (law §2): enfría el trato y cierra pedidos. */
  readonly reproach?: DeedKind | null;
  /** Lo que quien habla le debe ya al oyente de lo que pide, y si algo de eso está vencido. */
  readonly owes?: { readonly grams: number; readonly overdue: boolean };
  /** Temperamento del oyente (calidez, reactividad); sin él, neutro. */
  readonly temper?: Temper;
  /** Lo que el oyente recuerda de quien habla (`recollect`); sin él, nada. */
  readonly recollection?: Recollection;
  /** La propuesta que el oyente dejó planteada y espera que quien habla acepte o rechace. */
  readonly open?: Proposal;
  /** Cuántas contraofertas lleva ya la propuesta abierta entre los dos (regateo en curso). */
  readonly rounds?: number;
  /** Cuánto cree el oyente que vale el kilo de un bien (monedas); sin esto no valúa ofertas. */
  readonly worth?: (good: string) => number | null;
  /** Alternativas creídas y cara en juego del oyente al regatear (contracts §3); la desesperación sale de su despensa. */
  readonly bargain?: {
    /** 0-1, o según el bien y el lado: `buy` (le dan ese bien) o `sell` (se lo piden). */
    readonly alternatives: number | ((good: string, side: "buy" | "sell") => number);
    readonly face: number;
  };
  /** Gramos de un bien que quien habla tiene a mano (no puede ofrecer lo que no tiene). */
  readonly speakerHas?: (good: string) => number;
  /** Cómo llama el oyente a `id` y a un bien. */
  readonly nameOf: (id: AgentId) => string;
  readonly goodName: (good: string) => string;
  /**
   * Lo que el oyente puede leer de quien le cuenta algo (dialogue §3-§4): sin esto toma lo contado
   * por bueno; con esto lo juzga (`judgeStatement`) y puede dudar o acusar de mentir.
   */
  readonly detect?: DetectionInput;
  /**
   * El acto que quien habla declaró querer hacer (su intención): no pisa lo que el oyente entiende
   * de las palabras, pero si no captó nada («other») y no era eso lo que quería decir, pide que se
   * lo repitan (dialogue §2, §5).
   */
  readonly intended?: SpeechAct["kind"];
  /**
   * Lo que el oyente pone para pesar una amenaza, un halago o un insulto (dialogue §9, §10): sin
   * esto los toma como charla. `vindictiveness` (0-1) decide si guarda la venganza.
   */
  readonly regard?: {
    readonly threat?: ThreatInput;
    readonly vindictiveness?: number;
    readonly flattery?: FlatteryInput;
    readonly insult?: InsultInput;
  };
  /**
   * Si el oyente guarda un secreto sobre aquel por quien le preguntan (dialogue §7, §11): su estado
   * de ese momento, la habilidad de quien sonsaca, cuánto pega el tema y, con `trade_secret`, cuánto
   * vale el secreto ofrecido. Sin esto la pregunta es una pregunta común.
   */
  readonly keep?: {
    readonly state: KeeperState;
    readonly skill: number;
    readonly salience: number;
    readonly offered?: number;
    /** Lo que el oyente cree del secreto, si se puede decir en una palabra (vive o murió). */
    readonly fact?: "dead" | "alive";
  };
  /**
   * Lo que el oyente pone para contestar una acusación (dialogue §6): como oyente de un tercero
   * (pesa con `weighAccusation`) o como acusado (se defiende). Sin esto la toma como charla.
   */
  readonly accuse?: AccuseInput;
  /**
   * Cuánto le cree el oyente a la profecía que le cuentan (0-1, ya con credulidad, confianza en
   * quien cuenta y pérdida por salto: `transmit`). Sin esto la toma como charla.
   */
  readonly prophecy?: { readonly credence: number };
  /**
   * Cómo pesó el oyente el rumor que le pasan (information §3, `hearRumor`): ya hecho por quien
   * lo cablea porque necesita el estado y el sorteo. Sin esto el rumor no tiene respaldo (nada
   * que el oyente pueda ubicar en un hecho real) y lo toma como charla.
   */
  readonly hearsay?: { readonly verdict: Hearsay };
  /**
   * De dónde sabe el oyente aquello por lo que le preguntan «¿quién te lo dijo?» (`sourceOf`): lo
   * vio, se lo dijo alguien (el nombre ya como lo llama el oyente) o «dicen que». Sin esto, no sabe
   * de qué le hablan.
   */
  readonly source?:
    | { readonly kind: "saw" }
    | { readonly kind: "named"; readonly name: string; readonly voices: number }
    | { readonly kind: "crowd"; readonly voices: number };
  /**
   * Lo que el oyente recuerda de aquel por quien le preguntan (memorias propias, no la verdad):
   * el tono con que lo cuenta y si lo niega. Sin esto contesta que no sabe.
   */
  readonly recounted?: { readonly tone: "good" | "bad" | "plain"; readonly denied: boolean };
  /** Con qué juzga el oyente la forma del acto (`act.form`): los tabúes de la cultura y lo que cree. */
  readonly formJudge?: { readonly taboos: readonly TabooDef[]; readonly input: FormJudgeInput };
  /** Gramos de `good` que tiene la casa, y cuántos la componen. */
  readonly held: (good: string) => number;
  /** Si el bien es moneda: no se aparta reserva de la casa (la bolsa se gasta, no se raciona). */
  readonly isCoin?: (good: string) => boolean;
  readonly members: number;
  readonly lines: readonly SpeechLine[];
  readonly rng: Rng;
}

/** Cuánto suma a la calidez el tono de lo que se recuerda de quien habla (bias -1..1). */
export const MEMORY_WARMTH = 0.25;
/** Cuánto baja el umbral de dar sin cuenta un temperamento cálido (y sube uno frío). */
export const GENEROSITY_SHIFT = 0.08;
/** Cuánto bajan los umbrales de rencor un temperamento reactivo (y suben en uno calmo). */
export const TOUCHY_SHIFT = 0.12;
/** Tono y vividez de la memoria desde los que pesa en el trato (saludo, rencor). */
export const FOND_BIAS = 0.4;
export const FOND_VIVID = 0.2;
export const WARY_BIAS = -0.4;
/** Tono y vividez desde los que un recuerdo doloroso cierra los pedidos, aunque la relación no. */
export const GRIEVANCE_BIAS = -0.5;
export const GRIEVANCE_VIVID = 0.25;

/** Qué tanto quiere el oyente a quien habla: afecto, confianza, gratitud y dependencia. */
export function warmth(f: Vector): number {
  return 0.5 * f.affection + 0.3 * f.trust + 0.1 * f.gratitude + 0.1 * f.dependency;
}

/** Miedo desde el que se cede a un pedido, y cuánto lo baja el audaz (y sube el calmo): `reactivity`. */
export const FEAR_YIELDS = 0.5;
export const FEAR_SHIFT = 0.1;
/** Gratitud desde la que se devuelve el favor concediendo el pedido. */
export const GRATITUDE_RETURNS = 0.4;
/** Calidez desde la que las líneas suenan cálidas, y desde abajo (o con rencor) secas. */
export const WARM_TONE = 0.3;
export const DRY_TONE = 0.0;
export const DRY_RESENTMENT = 0.2;

/** El oyente le teme a quien habla lo bastante como para ceder (el temerario ya no tanto). */
export function yieldsToFear(f: Vector, reactivity = 0): boolean {
  return f.fear >= FEAR_YIELDS - FEAR_SHIFT * reactivity;
}

/** El oyente le debe un favor a quien habla (gratitud alta sin rencor de por medio). */
export function returnsFavor(f: Vector): boolean {
  return f.gratitude >= GRATITUDE_RETURNS && f.resentment < GRUDGE_RESENTMENT;
}

/** El tono de las líneas sale de la relación y no solo de la formalidad. */
export function toneOf(f: Vector): Tone {
  if (warmth(f) >= WARM_TONE) return "warm";
  if (warmth(f) < DRY_TONE || f.resentment >= DRY_RESENTMENT) return "dry";
  return "plain";
}

/** Rencor o desconfianza que cierra los pedidos; el reactivo (`reactivity` > 0) lo siente antes. */
export function holdsGrudge(f: Vector, reactivity = 0): boolean {
  const shift = TOUCHY_SHIFT * reactivity;
  return f.resentment >= GRUDGE_RESENTMENT - shift || f.trust <= GRUDGE_DISTRUST + shift;
}

/** Un recuerdo doloroso y vívido de quien pide: cierra el pedido aunque la relación esté al día. */
export function holdsGrievance(r: Recollection): boolean {
  return r.bias <= GRIEVANCE_BIAS && r.vivid >= GRIEVANCE_VIVID;
}

/** Se le habla de usted a quien se respeta (o tiene rango) y no se conoce tanto como para tutearlo. */
export function isFormal(f: Vector, rankAbove = false): boolean {
  return (
    f.respect + (rankAbove ? RANK_RESPECT : 0) >= FORMAL_RESPECT &&
    f.familiarity < FORMAL_FAMILIARITY
  );
}

export interface Reply {
  /** La clave de la línea que se usó (para tests y para el narrador). */
  readonly line: string;
  readonly text: string;
  /** Un pedido concedido: cuánto de qué sale de la casa del oyente. */
  readonly give?: { readonly good: string; readonly grams: number; readonly credit?: boolean };
  /** Lo que el oyente toma como dicho (queda en `Heard`, con duda si choca con lo que sabe). */
  readonly accepted?: HeardClaim;
  /** Un trato cerrado: lo que el oyente recibe y lo que da (mover los bienes es de quien lo cablea). */
  readonly deal?: Proposal;
  /** Una contraoferta que el oyente deja planteada (queda abierta hasta que se acepte o rechace). */
  readonly counter?: Proposal;
  /** Una promesa que el oyente toma por hecha: la anota en su libro (contracts `believePledge`). */
  readonly pledge?: {
    readonly good: string | null;
    readonly grams: number | null;
    readonly terms?: PromiseTerms;
    /** Un favor prometido (verbo del catálogo) o callar un secreto, en vez de dar. */
    readonly favor?: string;
    readonly silence?: true;
  };
  /** Cómo juzgó el oyente lo que le contaron (solo si `detect` estaba): confianza y memoria salen de acá. */
  readonly judgement?: LieJudgement;
  /** La amenaza pesada: qué eligió el oyente y lo que deja en la relación. */
  readonly threat?: { readonly verdict: ThreatVerdict; readonly aftermath: ThreatAftermath };
  /** El halago pesado (pleased/flat/hollow y lo que mueve). */
  readonly flattery?: FlatteryResult;
  /** El insulto como ofensa (tamaño, brecha, testigos); qué hace el ofendido es de quien lo cablea. */
  readonly offense?: Offense;
  /** Lo que el oyente le soltó a quien preguntó: queda como dicho en quien preguntó. */
  readonly told?: HeardClaim;
  /** La pregunta por un secreto: cómo la contestó quien lo guarda (`askSecret`) y sobre quién. */
  readonly secret?: { readonly about: AgentId; readonly result: KeepResult };
  /** Si cree haber sorprendido una mentira: lo que guarda (ver `recordCaught`). */
  readonly caught?: CaughtLie;
  /** La acusación pesada: cómo cayó en el oyente o cómo se defendió el acusado, y si iba sin respaldo. */
  readonly accusation?: AccuseOutcome;
  /** Cómo tomó el oyente la profecía que le contaron (solo si `prophecy` estaba). */
  readonly prophecy?: { readonly verdict: "believed" | "doubted" | "dismissed" };
  /** Cómo tomó el oyente el rumor que le pasaron (solo si `hearsay` estaba). */
  readonly rumor?: { readonly verdict: Hearsay };
  /** Cómo juzgó el oyente la forma en que le hablaron (registro y palabras vedadas), si venía. */
  readonly form?: FormJudgement;
}

/** Qué hizo el oyente con un rumor: lo creyó, lo duda, lo descarta o ya lo había oído. */
export type Hearsay = "believed" | "doubted" | "dismissed" | "known";

/** Crédito desde el que el oyente se toma en serio una profecía contada, y desde el que la duda. */
export const PROPHECY_BELIEVED = 0.45;
export const PROPHECY_DOUBTED = 0.2;

/** Confianza desde la que el oyente da por buena una promesa de quien habla. */
export const PROMISE_CREDENCE = 0.3;

/**
 * Cuánto le cree el oyente a una promesa de quien habla (0-1): su confianza y respeto, menos el
 * resentimiento y lo que lo traicionó o le debe vencido; lo vivido con esa persona suma o resta.
 */
export function credence(
  f: Vector,
  memory: Recollection,
  opts: { readonly overdue?: boolean; readonly reproach?: boolean } = {},
): number {
  const base = 0.5 + 0.6 * f.trust + 0.2 * f.respect - 0.5 * f.resentment + 0.2 * memory.bias;
  const hit = (opts.overdue ? 0.35 : 0) + (opts.reproach ? 0.3 : 0);
  return Math.round(Math.min(1, Math.max(0, base - hit)) * 1e6) / 1e6;
}

/** Líneas de un saludo, despedida o charla que se pisan cuando la forma ofendió. */
const FORM_SLIP_REPLACES = /^(greet|farewell|other$)/;

/**
 * La respuesta del oyente. Si el acto trae su forma (`act.form`) y el oyente la puede juzgar
 * (`formJudge`), el registro y las palabras vedadas pesan como ofensa (dialogue §10): `form` en la
 * respuesta; un saludo, una despedida o una charla ofendidos se contestan con la queja.
 */
export function decideReply(i: ReplyInput, at: number): Reply {
  const reply = decideBody(i, at);
  const form = i.act.form;
  if (!form || !i.formJudge) return reply;
  const judged = judgeForm(form, i.formJudge.taboos, i.formJudge.input);
  if (judged.faceLoss <= 0) return { ...reply, form: judged };
  if (judged.faceLoss >= INSULT_HURT && FORM_SLIP_REPLACES.test(reply.line)) {
    const line = "form.offended";
    const text = sayLine(i.lines, line, {}, i.rng.fork(line), isFormal(i.feel, i.rankAbove));
    return { line, text, form: judged };
  }
  return { ...reply, form: judged };
}

/** Lo que quiso decir no llegó: el oyente no captó ningún acto y pide que se lo repitan. */
export function misheard(i: Pick<ReplyInput, "act" | "intended">): boolean {
  return i.act.kind === "other" && i.intended !== undefined && i.intended !== "other";
}

function decideBody(i: ReplyInput, at: number): Reply {
  const say = (line: string, params: Params = {}): Reply => ({
    line,
    text: sayLine(
      i.lines,
      line,
      params,
      i.rng.fork(line),
      isFormal(i.feel, i.rankAbove),
      toneOf(i.feel),
    ),
  });
  const a = i.act;
  const temper = i.temper ?? NEUTRAL_TEMPER;
  const memory = i.recollection ?? NO_RECOLLECTION;
  if (misheard(i)) return say("misheard");
  switch (a.kind) {
    case "greet":
      if (i.reproach) return say(`greet.cold.${i.reproach}`);
      if (memory.bias >= FOND_BIAS && memory.vivid >= FOND_VIVID) return say("greet.fond");
      if (memory.bias <= WARY_BIAS && memory.vivid >= FOND_VIVID) return say("greet.wary");
      return say("greet");
    case "farewell":
      return say("farewell");
    case "ask": {
      if (a.about === null) return say("ask.unclear");
      const name = i.nameOf(a.about);
      if (i.keep) {
        const result = askSecret(
          i.keep.state,
          {
            technique: a.via ?? "direct",
            skill: i.keep.skill,
            ...(i.keep.offered !== undefined ? { offered: i.keep.offered } : {}),
          },
          i.keep.salience,
          i.rng.fork("keep"),
        );
        const line =
          result.outcome === "revealed"
            ? `ask.secret.revealed.${i.keep.fact ?? "other"}`
            : `ask.secret.${result.outcome}`;
        return {
          ...say(line, { name }),
          secret: { about: a.about, result },
          // Lo que soltó entero queda como dicho por él (con quién y cuándo), no como verdad.
          ...(result.outcome === "revealed" && i.keep.fact
            ? { told: { about: a.about, claim: i.keep.fact, from: i.listener, at } }
            : {}),
        };
      }
      const seen = i.direct(a.about);
      if (seen && "where" in seen) return say(`ask.at.${seen.where}`, { name });
      if (seen) return say("ask.dead", { name });
      const told = i.heard.find((c) => c.about === a.about);
      if (told?.claim === "dead") return say("ask.heard_dead", { name });
      // Sin saber dónde anda, cuenta (o niega) lo que recuerda de esa persona.
      if (i.recounted) {
        return say(
          i.recounted.denied ? "ask.recalled.denied" : `ask.recalled.${i.recounted.tone}`,
          {
            name,
          },
        );
      }
      return say("ask.unknown", { name });
    }
    case "tell": {
      const name = i.nameOf(a.about);
      const seen = i.direct(a.about);
      const contradicts = seen !== null && "dead" in seen !== (a.claim === "dead");
      if (contradicts) return say("tell.doubt", { name });
      if (i.detect) {
        const judgement = judgeStatement(i.detect, i.rng.fork("judge"));
        if (judgement.verdict !== "believed") {
          const caught = recordCaught(i.speaker, i.listener, at, judgement);
          return {
            ...say(judgement.verdict === "caught" ? "tell.caught" : "tell.doubted", { name }),
            judgement,
            ...(caught ? { caught } : {}),
          };
        }
        return {
          ...say(a.claim === "dead" ? "tell.dead" : "tell.alive", { name }),
          accepted: { about: a.about, claim: a.claim, from: i.speaker, at },
          judgement,
        };
      }
      return {
        ...say(a.claim === "dead" ? "tell.dead" : "tell.alive", { name }),
        accepted: { about: a.about, claim: a.claim, from: i.speaker, at },
      };
    }
    case "rumor": {
      if (!i.hearsay) return say("rumor.idle");
      return { ...say(`rumor.${i.hearsay.verdict}`), rumor: { verdict: i.hearsay.verdict } };
    }
    case "source": {
      const s = i.source;
      if (!s) return say("source.none");
      return say(`source.${s.kind}`, s.kind === "named" ? { name: s.name } : {});
    }
    case "request": {
      if (a.good === null) return say("request.unclear");
      const what = i.goodName(a.good);
      if (i.reproach) return say(`request.refuse.${i.reproach}`, { what });
      const spare = i.held(a.good) - i.members * RESERVE_GRAMS_PER_MEMBER;
      // Cede por miedo aunque lo odie: el rencor se traga (el audaz teme menos, el reactivo cede menos).
      if (yieldsToFear(i.feel, temper.reactivity)) {
        if (spare < GIFT_GRAMS) return say("request.short", { what });
        return {
          ...say("request.give.afraid", { what }),
          give: { good: a.good, grams: GIFT_GRAMS },
        };
      }
      if (holdsGrudge(i.feel, temper.reactivity)) return say("request.refuse.grudge", { what });
      if (holdsGrievance(memory)) return say("request.refuse.remembered", { what });
      // Devuelve el favor: la gratitud pesa lo que un regalo, aunque no haya tanto cariño.
      if (returnsFavor(i.feel)) {
        if (spare < GIFT_GRAMS) return say("request.short", { what });
        return {
          ...say("request.give.grateful", { what }),
          give: { good: a.good, grams: GIFT_GRAMS },
        };
      }
      const felt = warmth(i.feel) + MEMORY_WARMTH * memory.bias;
      if (felt >= FREE_GIFT_WARMTH - GENEROSITY_SHIFT * temper.warmth) {
        if (spare < GIFT_GRAMS) return say("request.short", { what });
        return { ...say("request.give", { what }), give: { good: a.good, grams: GIFT_GRAMS } };
      }
      // A quien no se quiere tanto no se le regala: se le fía (contracts, fiado), si no debe ya de más.
      const owes = i.owes ?? { grams: 0, overdue: false };
      if (owes.overdue) return say("request.refuse.owes", { what });
      if (owes.grams + GIFT_GRAMS > CREDIT_LIMIT_GRAMS)
        return say("request.refuse.limit", { what });
      if (spare < GIFT_GRAMS) return say("request.short", { what });
      return {
        ...say("request.credit", { what }),
        give: { good: a.good, grams: GIFT_GRAMS, credit: true },
      };
    }
    case "promise": {
      const service = a.favor !== undefined || a.silence === true;
      if (a.good === null && a.grams === null && !service) return say("promise.vague");
      const trust = credence(i.feel, memory, {
        overdue: i.owes?.overdue === true,
        reproach: Boolean(i.reproach),
      });
      if (trust < PROMISE_CREDENCE) return say("promise.doubt");
      const what = a.good === null ? "eso" : i.goodName(a.good);
      return {
        ...say("promise.accept", { what }),
        pledge: {
          good: a.good,
          grams: a.grams,
          ...(a.terms ? { terms: a.terms } : {}),
          ...(a.favor !== undefined ? { favor: a.favor } : {}),
          ...(a.silence ? { silence: true as const } : {}),
        },
      };
    }
    case "offer": {
      if (a.give === null && a.want === null) return say("offer.unclear");
      if (a.give === null && a.want !== null) {
        return decideBody({ ...i, act: { kind: "request", good: a.want.good } }, at);
      }
      const what = i.goodName((a.want ?? (a.give as { good: string })).good);
      if (i.reproach || holdsGrudge(i.feel, temper.reactivity) || holdsGrievance(memory)) {
        return say("offer.refuse.grudge", { what });
      }
      if (i.owes?.overdue) return say("request.refuse.owes", { what });
      const v = weighOffer({
        give: a.give,
        want: a.want,
        worth: i.worth ?? (() => null),
        spare: (g) => i.held(g) - (i.isCoin?.(g) ? 0 : i.members * RESERVE_GRAMS_PER_MEMBER),
        speakerHas: i.speakerHas ?? (() => 0),
        felt: warmth(i.feel) + MEMORY_WARMTH * memory.bias,
        leverage: {
          alternatives: ((alt) =>
            typeof alt === "function"
              ? a.give !== null
                ? alt(a.give.good, "buy")
                : a.want !== null
                  ? alt(a.want.good, "sell")
                  : 0
              : (alt ?? 0))(i.bargain?.alternatives),
          face: i.bargain?.face ?? 0,
          // Desesperado: lo que recibiría le falta a su casa (su despensa bajo la reserva).
          desperation:
            a.give === null
              ? 0
              : 1 -
                Math.min(
                  1,
                  i.held(a.give.good) / Math.max(1, i.members * RESERVE_GRAMS_PER_MEMBER),
                ),
        },
      });
      switch (v.kind) {
        case "unvalued":
          return say("offer.unvalued", { what });
        case "short":
          return say("offer.short", { what });
        case "gift":
          return { ...say("offer.gift", { what }), deal: v.deal };
        case "accept":
          return { ...say("offer.accept", { what }), deal: v.deal };
        case "counter": {
          // Tras varias rondas el oyente se cansa de regatear.
          if ((i.rounds ?? 0) >= MAX_ROUNDS) return say("offer.refuse.tired", { what });
          const grams = v.counter.gives?.grams ?? 0;
          return {
            ...say("offer.counter", { what, kilos: String(Math.round(grams / 100) / 10) }),
            counter: v.counter,
          };
        }
        case "reject":
          return say("offer.refuse.price", { what });
      }
      return say("other");
    }
    case "accept": {
      if (!i.open) return say("answer.nothing");
      if (i.reproach || holdsGrudge(i.feel, temper.reactivity)) return say("answer.nothing");
      // Entre la contraoferta y el sí pudo cambiar lo que cada uno tiene a mano.
      if (
        i.speakerHas &&
        !dealHolds(i.open, (g) => i.held(g) - i.members * RESERVE_GRAMS_PER_MEMBER, i.speakerHas)
      ) {
        return say("accept.short");
      }
      return { ...say("accept.thanks"), deal: i.open };
    }
    case "refuse":
      return say(i.open ? "refuse.ack" : "answer.nothing");
    case "argue":
      // Pesar la razón contra lo que le importa al oyente es del cableado (`persuade`); hasta
      // entonces se la toma como charla.
      return say("other");
    case "threaten": {
      const input = i.regard?.threat;
      if (!input) return say("other");
      // El costo real de la exigencia: cuánto de lo que tiene le piden (lo poco que le sobra pesa más).
      const demand = a.demand;
      const heldDemand = demand === undefined ? 0 : i.held(demand);
      const demandCost =
        demand === undefined
          ? input.demandCost
          : Math.min(1, Math.max(input.demandCost, GIFT_GRAMS / Math.max(GIFT_GRAMS, heldDemand)));
      const weighed = { ...input, harm: a.harm, demandCost };
      const verdict = weighThreat(weighed, i.rng.fork("threat"));
      const aftermath = threatAftermath(verdict, weighed, i.regard?.vindictiveness ?? 0);
      const threat = { verdict, aftermath };
      if (verdict.response === "yield" && demand !== undefined) {
        // Cede lo exigido si le sobra (la reserva de la casa no se toca); si no, no tiene con qué.
        const what = i.goodName(demand);
        const spare = heldDemand - i.members * RESERVE_GRAMS_PER_MEMBER;
        if (spare < GIFT_GRAMS) return { ...say("request.short", { what }), threat };
        return {
          ...say("threat.yield.give", { what }),
          give: { good: demand, grams: GIFT_GRAMS },
          threat,
        };
      }
      return { ...say(`threat.${verdict.response}`), threat };
    }
    case "flatter": {
      const input = i.regard?.flattery;
      if (!input) return say("other");
      const flattery = judgeFlattery({ ...input, excess: a.excess });
      return { ...say(`flatter.${flattery.kind}`), flattery };
    }
    case "insult": {
      const input = i.regard?.insult;
      if (!input) return say("other");
      const offense = insultOffense({ ...input, sting: a.sting });
      return { ...say(offense.size >= INSULT_HURT ? "insult.hurt" : "insult.shrug"), offense };
    }
    case "accuse": {
      const input = i.accuse;
      if (!input || a.accused === null) return say(input ? "accuse.unclear" : "other");
      if (input.as === "accused") {
        const defense = decideDefense(input.defense, i.rng.fork("defense"));
        return {
          ...say(`accuse.${defense}`),
          accusation: { accused: "listener", kind: a.deed, unbacked: false, defense },
        };
      }
      const accusation = {
        accuser: i.speaker,
        accused: input.accused,
        kind: a.deed,
        victim: a.victim === "speaker" ? i.speaker : a.victim,
        event: input.cited?.event ?? null,
        certainty: a.certainty,
      };
      const heard = hearAccusation(accusation, input.view, input.cited);
      return {
        ...say(`accuse.${heard.verdict}`, { name: i.nameOf(input.accused) }),
        accusation: { accused: input.accused, kind: a.deed, unbacked: input.cited === null, heard },
      };
    }
    case "prophesy": {
      if (a.about === null) return say("prophesy.unclear");
      const input = i.prophecy;
      if (!input) return say("other");
      const verdict =
        input.credence >= PROPHECY_BELIEVED
          ? "believed"
          : input.credence >= PROPHECY_DOUBTED
            ? "doubted"
            : "dismissed";
      const self = a.about === "you";
      return { ...say(`prophesy.${verdict}${self ? ".self" : ""}`), prophecy: { verdict } };
    }
    case "other":
      return say("other");
  }
}

// Los actos de habla de la conversación mínima (dialogue §2): lo que el oyente entiende de lo que
// le dijeron. El texto del personaje llega tal cual (el LLM no lo reinterpreta); entender es del
// oyente y es léxico: reconoce un saludo, una pregunta por alguien, un pedido de algo, algo que
// le cuentan. Lo que no encaja es `other`, y el oyente lo toma como charla.

import type { AgentId } from "../../core/index.ts";
import type { SpokenForm } from "./form.ts";
import type { Appeal } from "./persuasion.ts";
import type { ElicitTechnique } from "./secrets.ts";

export type SpeechAct = SpeechBody & {
  /** La forma en que se dijo (registro, tratamiento, palabras vedadas); sin ella, solo el contenido. */
  readonly form?: SpokenForm;
};

type SpeechBody =
  | { readonly kind: "greet" }
  | { readonly kind: "farewell" }
  /**
   * ¿Dónde está `about`? (null: no dijo de quién, o de alguien que el oyente no conoce). `via` es
   * la maniobra con que se pregunta (dialogue §11): sin ella, de frente; si el otro guarda un secreto
   * sobre `about`, es una pregunta por el secreto.
   */
  | { readonly kind: "ask"; readonly about: AgentId | null; readonly via?: ElicitTechnique }
  /** Un pedido de `good` (un id de bien); null si no se entiende qué. */
  | { readonly kind: "request"; readonly good: string | null }
  /** Le cuentan que `about` murió o sigue vivo. */
  | { readonly kind: "tell"; readonly about: AgentId; readonly claim: "dead" | "alive" }
  /**
   * Le cuentan una profecía (divination §5): que `about` (`"you"`: el propio oyente; null: no se
   * entiende de quién) llegará lejos, traerá ruina, morirá antes de tiempo o tendrá fortuna.
   */
  | {
      readonly kind: "prophesy";
      readonly about: AgentId | "you" | null;
      readonly claim: ProphesyKind;
    }
  /** Quien habla promete devolver o dar `good` (cuántos gramos si lo dijo; null si no). */
  | {
      readonly kind: "promise";
      readonly good: string | null;
      readonly grams: number | null;
      /** Términos sueltos de la frase («el doble», «en otoño», «cuando pueda»); ausentes si no dijo. */
      readonly terms?: PromiseTerms;
      /** Un favor prometido en vez de bienes («te ayudo»): el verbo del catálogo (contracts §4). */
      readonly favor?: string;
      /** Callar un secreto en vez de dar («no le digo a nadie»). */
      readonly silence?: true;
    }
  /** Una propuesta de intercambio (dialogue §2): lo que quien habla da y lo que quiere (null: nada). */
  | {
      readonly kind: "offer";
      readonly give: ExchangeTerm | null;
      readonly want: ExchangeTerm | null;
    }
  /** Acepta o rechaza la propuesta abierta entre los dos (la que el oyente dejó planteada). */
  | { readonly kind: "accept" | "refuse" }
  /** Un argumento para que el oyente haga o crea algo: a qué apunta (dialogue §6); `persuade` lo pesa. */
  | { readonly kind: "argue"; readonly reason: ArgueReason }
  /** Una amenaza: cuánto daño promete (0-1: la muerte 1, una paliza 0.5, quedar mal 0.1) (dialogue §9). */
  | { readonly kind: "threaten"; readonly harm: number }
  /** Un halago: cuánto exagera (0-1) (dialogue §10). */
  | { readonly kind: "flatter"; readonly excess: number }
  /** Un insulto: lo filoso que es (0-1) (dialogue §10). */
  | { readonly kind: "insult"; readonly sting: number }
  /**
   * Una acusación (dialogue §6, law §5): que `accused` hizo `deed` (`"you"`: el propio oyente; null:
   * no se entiende a quién) a `victim` (`"speaker"`: a quien habla; null: no dijo a quién), con
   * qué firmeza (0-1).
   */
  | {
      readonly kind: "accuse";
      readonly accused: AgentId | "you" | null;
      readonly deed: AccusedDeed;
      readonly victim: AgentId | "speaker" | null;
      readonly certainty: number;
    }
  | { readonly kind: "other" };

/** Lo que anuncia una profecía contada (los mismos de `ProphecyKind`; acá sin depender de divination). */
export type ProphesyKind = "greatness" | "ruin" | "death" | "fortune";

/** Lo que se acusa de haber hecho (los delitos que la aldea conoce, `DeedKind`). */
export type AccusedDeed = "theft" | "assault";

/**
 * La razón que se da, tal como se entiende de las palabras (dialogue §6). `face` sin `whose`
 * apunta a la cara del propio oyente; `relation` sin `with` no se entiende de quién.
 */
export type ArgueReason =
  | { readonly kind: "relation"; readonly with: AgentId | null }
  | { readonly kind: "norm"; readonly norm: string }
  | { readonly kind: "fear"; readonly danger: string }
  | { readonly kind: "face"; readonly whose: AgentId | null }
  | { readonly kind: "authority"; readonly source: string }
  | { readonly kind: "reciprocity"; readonly favor: string };

/** El `Appeal` de una razón dicha a `listener`; null si no queda claro a qué apunta. */
export function appealOf(reason: ArgueReason, listener: AgentId): Appeal | null {
  switch (reason.kind) {
    case "relation":
      return reason.with === null ? null : { kind: "relation", with: reason.with };
    case "norm":
      return { kind: "norm", norm: reason.norm };
    case "fear":
      return { kind: "fear", danger: reason.danger };
    case "face":
      return { kind: "face", whose: reason.whose ?? listener };
    case "authority":
      return { kind: "authority", source: reason.source };
    case "reciprocity":
      return { kind: "reciprocity", favor: reason.favor };
  }
}

/** Un término de intercambio: cuántos gramos de qué bien (dialogue §2, `ExchangeTerm`). */
export interface ExchangeTerm {
  readonly good: string;
  readonly grams: number;
}

/** Con qué palabras puede nombrar el oyente a alguien o algo. */
export interface Lexicon {
  readonly people: readonly { readonly id: AgentId; readonly names: readonly string[] }[];
  readonly goods: readonly {
    readonly id: string;
    readonly names: readonly string[];
    /** Es moneda: la cantidad se cuenta en piezas y no en gramos (`grams` guarda las piezas). */
    readonly coin?: boolean;
  }[];
}

const COIN_WORDS: Readonly<Record<string, number>> = {
  una: 1,
  un: 1,
  dos: 2,
  tres: 3,
  cuatro: 4,
  cinco: 5,
  seis: 6,
  diez: 10,
};
const COIN_AMOUNT = /\b(\d{1,6}|una|un|dos|tres|cuatro|cinco|seis|diez) (?:monedas?|cobres?)\b/;

/** Minúsculas, sin tildes ni signos, con espacios simples. */
export function normalize(text: string): string {
  return text
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

const GREET = /\b(hola|buen dia|buenos dias|buenas tardes|buenas noches|buenas|saludos|que tal)\b/;

/** ¿El texto (ya normalizado) abre con un saludo en algún lado? Declara el acto de saludar. */
export function greets(norm: string): boolean {
  return GREET.test(norm);
}

const FAREWELL = /\b(adios|chau|chao|hasta luego|hasta manana|nos vemos|me voy|que te vaya bien)\b/;
const ASK = /\b(donde (esta|anda|queda|se metio)|sabes donde|has visto a|viste a)\b/;
// Sonsacar (dialogue §11): pedir que cuente lo de alguien, y con qué maniobra.
const PROBE = /\b(contame|cuentame|decime|dime|que sabes de|que pasa con|que hay de|lo de)\b/;
const VIA_FEIGN =
  /\b(ya (me )?(contaron|dijeron|se|sabemos)|ya lo se|todos (lo )?saben|ya me entere)\b/;
const VIA_SIDEWAYS = /\b(de casualidad|por casualidad|de paso|de pasada|por curiosidad)\b/;
const VIA_TRADE = /\b(yo te cuento|a cambio te cuento|secreto por secreto|te cuento un secreto)\b/;
const REQUEST =
  /\b(dame|dam[eé]lo|podes darme|me das|me daria[sn]?|necesito|presta(me)?|pasame|regalame|dejame)\b/;
const DEAD = /\b(murio|esta muert[oa]|fallecio|lo mataron|la mataron)\b/;
const ALIVE = /\b(esta vivo|esta viva|sigue vivo|sigue viva|esta bien|no murio)\b/;
const TELL = /\b(te cuento|sabes que|me dijeron que|escuche que|te aviso|ya sabes)\b/;

// Profecías contadas (divination §5): la marca de que es lo que dijo un adivino o se dice por ahí,
// qué anuncia y si se le dice al propio oyente.
const PROPHECY_MARK =
  /\b(adivin[oa]|profecia|augurio|presagio|oraculo|vaticin\w*|predijo|predijeron|leyeron|dicen que|dijo que|dijeron que|me dijeron que|escuche que)\b/;
const PROPHECY_GREATNESS =
  /\b(llegara lejos|llegaras lejos|sera grande|seras grande|grandeza|se elevara|te elevaras|gran destino|sera alguien|seras alguien)\b/;
const PROPHECY_RUIN =
  /\b(traera ruina|traeras ruina|traera desgracia|traeras desgracia|ruina|desgracia|maldicion|sera la ruina)\b/;
const PROPHECY_DEATH =
  /\b(morira joven|moriras joven|morira pronto|moriras pronto|muerte temprana|morira antes|moriras antes|va a morir joven|vas a morir joven)\b/;
const PROPHECY_FORTUNE =
  /\b(tendra fortuna|tendras fortuna|sera rico|seras rico|sera feliz|seras feliz|prosperara|prosperaras|tendra suerte|tendras suerte)\b/;
const PROPHECY_SECOND =
  /\b(llegaras|seras|te elevaras|moriras|traeras|tendras|prosperaras|vas a morir|te espera)\b/;

/** Qué anuncia una profecía dicha en `norm`, o null si no anuncia nada. */
function prophecyIn(norm: string): ProphesyKind | null {
  if (!PROPHECY_MARK.test(norm)) return null;
  if (PROPHECY_DEATH.test(norm)) return "death";
  if (PROPHECY_RUIN.test(norm)) return "ruin";
  if (PROPHECY_GREATNESS.test(norm)) return "greatness";
  if (PROPHECY_FORTUNE.test(norm)) return "fortune";
  return null;
}

const PROMISE =
  /\b(te prometo|te juro|te doy mi palabra|palabra que|te lo devuelvo|te lo pago|te devuelvo|te pago|cuenta conmigo)\b/;
const PROMISE_LEAD = /\b(te prometo|te juro|te doy mi palabra|palabra que|cuenta conmigo)\b/;
const PROMISE_SILENCE =
  /\b(no (le )?(digo|dire|cuento|contare|voy a decir|voy a contar)( nada)?( a nadie)?|(guardo|guardare) (el|tu) secreto|me callo|no dire nada|ni una palabra)\b/;
/** Favores que se prometen en palabras y el verbo del catálogo en que se cumplen. */
const PROMISE_FAVORS: readonly [RegExp, string][] = [
  [/\b(te ayudo|te ayudare|te echo una mano|te doy una mano)\b/, "work"],
  [/\b(te acompano|te acompanare)\b/, "move"],
  [/\b(te defiendo|te defendere|te protejo|te protegere|te cuido)\b/, "strike"],
];

/** El favor o el callar que una promesa dice (sin bienes de por medio); null si es de dar. */
export function promisedService(
  norm: string,
): { readonly favor: string } | { readonly silence: true } | null {
  if (!PROMISE_LEAD.test(norm) || AMOUNT.test(norm)) return null;
  if (PROMISE_SILENCE.test(norm)) return { silence: true };
  for (const [re, verb] of PROMISE_FAVORS) if (re.test(norm)) return { favor: verb };
  return null;
}

/**
 * Lo que una promesa dice además de qué y cuánto (contracts §4): un múltiplo del monto, un plazo en
 * días y cuán precisa es (1: exacta; baja con «más o menos», «cuando pueda»). Todo opcional.
 */
export interface PromiseTerms {
  readonly times?: number;
  readonly dueDays?: number | null;
  readonly precision?: number;
}

const DAYS_PER_SEASON = 90;
const TIMES_WORDS: readonly [RegExp, number][] = [
  [/\b(el doble|doble)\b/, 2],
  [/\b(el triple|triple)\b/, 3],
  [/\b(la mitad)\b/, 0.5],
  [/\b(uno y medio|una vez y media)\b/, 1.5],
];
const DUE_SEASON =
  /\b(en|para|despues de|a la|con la) (otono|invierno|primavera|verano|cosecha|siembra)\b/;
const DUE_UNITS = /\ben (\d{1,3}|un|una|dos|tres) (dias?|semanas?|meses|mes)\b/;
const DUE_SOON = /\b(pronto|manana|esta semana|en unos dias)\b/;
const DUE_NEVER = /\b(cuando pueda|algun dia|cuando tenga|cuando me sea posible)\b/;
const HEDGE = /\b(mas o menos|creo que|tal vez|quiza|capaz|aproximadamente)\b/;
const SMALL: Record<string, number> = { un: 1, una: 1, dos: 2, tres: 3 };

/** Términos sueltos de una promesa dicha en palabras (texto ya normalizado, sin tildes). */
export function promiseTerms(norm: string): PromiseTerms | undefined {
  let times: number | undefined;
  for (const [re, n] of TIMES_WORDS) if (re.test(norm)) times = n;
  let dueDays: number | null | undefined;
  let precision = 1;
  const units = DUE_UNITS.exec(norm);
  if (units) {
    const raw = units[1] as string;
    const n = SMALL[raw] ?? Number(raw);
    const u = units[2] as string;
    dueDays = n * (u.startsWith("dia") ? 1 : u.startsWith("semana") ? 7 : 30);
  } else if (DUE_SEASON.test(norm)) {
    dueDays = DAYS_PER_SEASON;
    precision -= 0.25;
  } else if (DUE_SOON.test(norm)) {
    dueDays = 14;
    precision -= 0.1;
  } else if (DUE_NEVER.test(norm)) {
    dueDays = null;
    precision -= 0.5;
  }
  if (HEDGE.test(norm)) precision -= 0.2;
  const out: { times?: number; dueDays?: number | null; precision?: number } = {};
  if (times !== undefined) out.times = times;
  if (dueDays !== undefined) out.dueDays = dueDays;
  if (precision < 1) out.precision = Math.max(0.1, Math.round(precision * 100) / 100);
  return Object.keys(out).length > 0 ? out : undefined;
}

const AMOUNT = /\b(\d{1,6}) ?(kilos?|kg|gramos?|g)\b/;

const OFFER_GIVES = /\b(te ofrezco|te propongo|te doy|te cambio|te vendo|te dejo|trueque)\b/;
const OFFER_BUYS = /\b(te compro|te pago)\b/;
const SWAP = / (por|a cambio de) /;
const ACCEPT = /\b(acepto|trato hecho|de acuerdo|me parece bien|hecho|dale|esta bien)\b/;
const REFUSE = /\b(no acepto|no gracias|olvidalo|no me interesa|ni hablar|no quiero)\b/;
const SHORT_UTTERANCE_WORDS = 6;

// Amenazas, halagos e insultos (dialogue §9, §10): léxico del daño prometido y de lo que se dice.
const THREAT_DEADLY =
  /\b(te voy a matar|te mato|o te mato|vas a morir por esto|te vas a morir|te voy a destruir)\b/;
const THREAT_BEATING =
  /\b(te voy a (pegar|romper|golpear|cortar)|te rompo|te pego|te golpeo|o te (rompo|pego|golpeo))\b/;
const THREAT_PAYING =
  /\b(me las vas a pagar|vas a pagar caro|te voy a hacer pagar|te hago pagar|ay de (vos|ti))\b/;
const FLATTER_BOLD = /\b(no hay nadie como (vos|tu|ti)|nadie se compara|todos te admiran)\b/;
const FLATTER_PLAIN =
  /\b((eres|sos) (el|la) mejor|(eres|sos) (increible|admirable|asombros[oa]|sabi[oa]|valiente|talentos[oa])|que (sabi[oa]|valiente|talentos[oa]|inteligente) (eres|sos)|que bien lo haces)\b/;
const INSULT_CUTTING =
  /\b(cobarde|inutil|basura|miserable|no vales nada|sos un[a]? nada|eres un[a]? nada)\b/;
const INSULT_PLAIN = /\b(idiota|estupid[oa]|imbecil|bestia|asqueros[oa]|maldit[oa]|pedazo de)\b/;
// Acusaciones (dialogue §6): qué se le achaca a quién, a quién se lo hizo y con qué firmeza.
const ACCUSE_THEFT =
  /\b(robo|robaste|robaron|ladron|ladrona|hurto|hurtaste|se llevo (mi|mis|el|la|los|las))\b/;
const ACCUSE_ASSAULT =
  /\b(me pego|le pego|pegaste|le pegaste|golpeo|golpeaste|hirio|hiriste|lastimo|lastimaste|ataco|atacaste|agredio|agrediste)\b/;
const ACCUSE_SECOND =
  /\b(robaste|hurtaste|pegaste|golpeaste|hiriste|lastimaste|atacaste|agrediste|sos un[a]? (ladron|ladrona))\b/;
const ACCUSE_ME =
  /\bme (robo|robaste|robaron|hurto|hurtaste|pego|pegaste|golpeo|golpeaste|hirio|hiriste|lastimo|lastimaste|ataco|atacaste|agredio|agrediste)\b/;
const ACCUSE_SURE = /\b(seguro|estoy seguro|estoy segura|lo vi|te vi|juro|sin duda|se que)\b/;
const ACCUSE_HEDGE =
  /\b(creo que|me parece|dicen que|capaz|quizas|tal vez|parece que|puede ser que)\b/;
const ACCUSE_SURE_CERTAINTY = 0.9;
const ACCUSE_PLAIN_CERTAINTY = 0.7;
const ACCUSE_HEDGE_CERTAINTY = 0.4;
const THREAT_PAYING_HARM = 0.4;
const THREAT_BEATING_HARM = 0.5;
const FLATTER_BOLD_EXCESS = 0.8;
const FLATTER_PLAIN_EXCESS = 0.5;
const INSULT_CUTTING_STING = 0.7;
const INSULT_PLAIN_STING = 0.5;

// El léxico de razones (dialogue §6): las frases con que se da un motivo, no un orden.
const REASON_RELATION =
  /\b(hazlo por|hacelo por|por el bien de|piensa en|pensa en|hazlo pensando en)\b/;
const REASON_NORM =
  /\b(es la costumbre|es costumbre|se acostumbra|es lo que se hace|asi se hace|es la tradicion|es lo correcto|es lo justo)\b/;
const REASON_FEAR =
  /\b(te van a matar|te vas a morir|vas a morir|te va a pasar algo|es peligroso|corres peligro|te van a hacer dano|te va a ir mal)\b/;
const REASON_FACE =
  /\b(quedas mal|quedaras mal|que van a decir|que diran|tu honor|tu nombre|tu fama|te vas a avergonzar|por tu reputacion)\b/;
const REASON_AUTHORITY =
  /\b(lo manda|lo ordena|lo dice el (anciano|jefe|senor|maestro|sacerdote)|lo dijo el (anciano|jefe|senor|maestro|sacerdote)|es una orden)\b/;
const REASON_RECIPROCITY =
  /\b(me debes|me lo debes|te ayude|te hice un favor|acordate de lo que hice|despues de todo lo que hice)\b/;
const AUTHORITY_SOURCE = /\b(anciano|jefe|senor|maestro|sacerdote)\b/;

/** La razón que se da en `norm` (ya normalizado), o null si no da ninguna. */
function reasonIn(norm: string, who: AgentId | null): ArgueReason | null {
  if (REASON_FEAR.test(norm)) return { kind: "fear", danger: "death" };
  if (REASON_FACE.test(norm)) return { kind: "face", whose: null };
  if (REASON_AUTHORITY.test(norm)) {
    return { kind: "authority", source: AUTHORITY_SOURCE.exec(norm)?.[1] ?? "command" };
  }
  if (REASON_RECIPROCITY.test(norm)) return { kind: "reciprocity", favor: "past_favor" };
  if (REASON_NORM.test(norm)) return { kind: "norm", norm: "custom" };
  if (REASON_RELATION.test(norm)) return { kind: "relation", with: who };
  return null;
}

function mentions(norm: string, names: readonly string[]): boolean {
  return names.some((n) => {
    const w = normalize(n);
    return w.length > 0 && new RegExp(`(^| )${w}( |$)`).test(norm);
  });
}

/** El bien y la cantidad (mil gramos si no dice) que nombra un tramo de frase. */
function termIn(seg: string, lex: Lexicon): ExchangeTerm | null {
  const found = lex.goods.find((g) => mentions(seg, g.names));
  const good = found?.id;
  if (good === undefined) return null;
  if (found?.coin) {
    // Las monedas se cuentan en piezas («dos monedas»); sin número, una.
    const c = COIN_AMOUNT.exec(seg)?.[1];
    return { good, grams: c === undefined ? 1 : (COIN_WORDS[c] ?? Number(c)) };
  }
  const m = AMOUNT.exec(seg);
  const grams = m ? Number(m[1]) * (m[2]?.startsWith("k") ? 1000 : 1) : 1000;
  return { good, grams };
}

const LOOSE_SCALES: readonly [RegExp, number][] = [
  [/\b(la mitad|mitad)\b/, 0.5],
  [/\b(un tercio)\b/, 1 / 3],
  [/\b(el doble|doble)\b/, 2],
  [/\b(un poco menos|algo menos|menos)\b/, 0.8],
  [/\b(un poco mas|algo mas|mas)\b/, 1.2],
];
const LOOSE_ASKS = /\b(dame|damelo|quiero|pido|pedime|dejame)\b/;
const LOOSE_SWAP = /\b(pero con|en vez de|en lugar de|mejor con|con)\b (.+)$/;

/**
 * Una contraoferta con términos sueltos («te doy la mitad», «por lo mismo pero con sal»): se lee
 * contra la propuesta abierta (`open`, vista de quien contesta: `gets` lo que él recibiría, `gives`
 * lo que daría) y se vuelve una oferta explícita de quien habla. Sin términos sueltos o sin trato
 * abierto devuelve el acto tal cual. La escala vale para lo que da quien habla, salvo que pida.
 */
export function looseCounter(
  text: string,
  act: SpeechAct,
  open: { readonly gets: ExchangeTerm | null; readonly gives: ExchangeTerm | null } | undefined,
  lex: Lexicon,
): SpeechAct {
  if (!open) return act;
  const emptyOffer = act.kind === "offer" && act.give === null && act.want === null;
  if (!emptyOffer && act.kind !== "other" && act.kind !== "request") return act;
  const norm = normalize(text);
  const scale = LOOSE_SCALES.find(([re]) => re.test(norm))?.[1];
  const swap = LOOSE_SWAP.exec(norm);
  const swapped = swap ? termIn(swap[2] ?? "", lex) : null;
  if (scale === undefined && swapped === null) return act;
  const asks = LOOSE_ASKS.test(norm);
  let give = open.gets;
  let want = open.gives;
  if (give === null && want === null) return act;
  const scaled = (t: ExchangeTerm | null): ExchangeTerm | null =>
    t === null || scale === undefined
      ? t
      : lex.goods.find((g) => g.id === t.good)?.coin
        ? { good: t.good, grams: Math.max(1, Math.round(t.grams * scale)) }
        : { good: t.good, grams: Math.max(10, Math.round((t.grams * scale) / 10) * 10) };
  if (asks) want = scaled(want);
  else give = scaled(give);
  if (swapped !== null && give !== null) {
    const said = AMOUNT.test(swap?.[2] ?? "");
    give = { good: swapped.good, grams: said ? swapped.grams : give.grams };
  }
  return { kind: "offer", give, want };
}

/** Con la voz turbia llega que da una razón, pero no el detalle de quién. */
function blurred(r: ArgueReason): ArgueReason {
  return r.kind === "relation" ? { kind: "relation", with: null } : r;
}

/** La maniobra con que se pregunta, si se nota una (dialogue §11); de frente no lleva marca. */
function viaOf(norm: string): { readonly via?: ElicitTechnique } {
  if (VIA_TRADE.test(norm)) return { via: "trade_secret" };
  if (VIA_FEIGN.test(norm)) return { via: "feign_knowledge" };
  if (VIA_SIDEWAYS.test(norm)) return { via: "sideways" };
  return {};
}

/**
 * Lo que el oyente entiende de `text`; con `clarity` baja, solo capta lo grueso (dialogue §5). Con
 * `form` el acto lleva además cómo se dijo (la forma la arma quien habla, `speechForm`).
 */
export function understand(text: string, lex: Lexicon, clarity = 1, form?: SpokenForm): SpeechAct {
  const body = understandBody(text, lex, clarity);
  return form ? { ...body, form } : body;
}

function understandBody(text: string, lex: Lexicon, clarity: number): SpeechBody {
  const norm = normalize(text);
  const who = lex.people.find((p) => mentions(norm, p.names))?.id ?? null;
  const good = lex.goods.find((g) => mentions(norm, g.names))?.id ?? null;
  // Con la voz turbia se entiende una cosa u otra, pero no el detalle: ni de quién ni de qué.
  const blur = clarity < 0.35;
  // Una amenaza gana sobre el pedido que la acompaña («dame el grano o te mato»).
  if (THREAT_DEADLY.test(norm)) return { kind: "threaten", harm: 1 };
  if (THREAT_BEATING.test(norm)) return { kind: "threaten", harm: THREAT_BEATING_HARM };
  if (THREAT_PAYING.test(norm)) return { kind: "threaten", harm: THREAT_PAYING_HARM };
  const theft = ACCUSE_THEFT.test(norm);
  if (theft || ACCUSE_ASSAULT.test(norm)) {
    const you = ACCUSE_SECOND.test(norm);
    return {
      kind: "accuse",
      accused: blur ? null : you ? "you" : who,
      deed: theft ? "theft" : "assault",
      victim: blur ? null : ACCUSE_ME.test(norm) ? "speaker" : null,
      certainty: ACCUSE_SURE.test(norm)
        ? ACCUSE_SURE_CERTAINTY
        : ACCUSE_HEDGE.test(norm)
          ? ACCUSE_HEDGE_CERTAINTY
          : ACCUSE_PLAIN_CERTAINTY,
    };
  }
  if (REQUEST.test(norm)) return { kind: "request", good: blur ? null : good };
  const service = blur ? null : promisedService(norm);
  if (service) {
    const terms = promiseTerms(norm);
    return { kind: "promise", good: null, grams: null, ...service, ...(terms ? { terms } : {}) };
  }
  if (PROMISE.test(norm)) {
    const m = AMOUNT.exec(norm);
    const n = m ? Number(m[1]) * (m[2]?.startsWith("k") ? 1000 : 1) : null;
    const terms = blur ? undefined : promiseTerms(norm);
    return {
      kind: "promise",
      good: blur ? null : good,
      grams: blur ? null : n,
      ...(terms ? { terms } : {}),
    };
  }
  const gives = OFFER_GIVES.test(norm);
  if (gives || OFFER_BUYS.test(norm)) {
    // "te doy A por B": quien habla da A y quiere B; "te compro A por B": quiere A y da B.
    const [left = "", right = ""] = norm.split(SWAP).filter((_p, i) => i !== 1);
    const a = blur ? null : termIn(left, lex);
    const b = blur ? null : termIn(right, lex);
    return gives ? { kind: "offer", give: a, want: b } : { kind: "offer", give: b, want: a };
  }
  const prophecy = prophecyIn(norm);
  if (prophecy !== null) {
    const second = PROPHECY_SECOND.test(norm);
    return {
      kind: "prophesy",
      about: blur ? null : (who ?? (second ? "you" : null)),
      claim: prophecy,
    };
  }
  if (ASK.test(norm)) return { kind: "ask", about: blur ? null : who, ...viaOf(norm) };
  if (who !== null && !blur && (DEAD.test(norm) || (TELL.test(norm) && ALIVE.test(norm)))) {
    return { kind: "tell", about: who, claim: DEAD.test(norm) ? "dead" : "alive" };
  }
  if (who !== null && !blur && PROBE.test(norm)) return { kind: "ask", about: who, ...viaOf(norm) };
  if (INSULT_CUTTING.test(norm)) return { kind: "insult", sting: INSULT_CUTTING_STING };
  if (INSULT_PLAIN.test(norm)) return { kind: "insult", sting: INSULT_PLAIN_STING };
  if (FLATTER_BOLD.test(norm)) return { kind: "flatter", excess: FLATTER_BOLD_EXCESS };
  if (FLATTER_PLAIN.test(norm)) return { kind: "flatter", excess: FLATTER_PLAIN_EXCESS };
  const reason = reasonIn(norm, blur ? null : who);
  if (reason !== null) return { kind: "argue", reason: blur ? blurred(reason) : reason };
  const brief = norm.split(" ").length <= SHORT_UTTERANCE_WORDS;
  if (REFUSE.test(norm) && brief) return { kind: "refuse" };
  if (ACCEPT.test(norm) && brief) return { kind: "accept" };
  if (FAREWELL.test(norm)) return { kind: "farewell" };
  if (GREET.test(norm)) return { kind: "greet" };
  return { kind: "other" };
}

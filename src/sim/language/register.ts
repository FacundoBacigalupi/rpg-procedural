// Registros, tratamientos y tabúes de palabra (language §7). Una cultura declara en `content/` qué
// tan formal es cada situación (la casa, el mercado, el templo), cómo se nombra a cada tipo de
// destinatario según la formalidad (forma de tratamiento, hecha con conceptos de la lengua, así que
// la forma sale del léxico y no de un texto escrito a mano) y qué palabras no se dicen y con qué
// rodeo se reemplazan. Todo es puro: quien lo usa (el diálogo) decide cuándo y con qué consecuencias.
//
// Todavía sin tabúes que nacen en juego (el nombre de un muerto o de un soberano con su evento
// de origen y el rodeo que se vuelve la palabra normal), ni jergas, ni el acento ni los errores de
// quien habla mal; ver ROADMAP.

import { contentId, defineContent, z } from "../../core/index.ts";
import type { Language } from "./language.ts";

export const REGISTER_SETTINGS = ["home", "market", "temple", "court", "sect"] as const;
export type RegisterSetting = (typeof REGISTER_SETTINGS)[number];

/** A quién se le habla: de eso depende, junto con la situación, cuánta formalidad se debe. */
export const RECIPIENTS = ["intimate", "peer", "inferior", "elder", "superior", "master"] as const;
export type Recipient = (typeof RECIPIENTS)[number];

const unit = z.number().min(0).max(1);

export const RegisterDef = z.strictObject({
  id: contentId,
  name: z.string().min(1),
  culture: contentId,
  setting: z.enum(REGISTER_SETTINGS),
  /** 0-1: cuánta formalidad pide hablar en esta situación, sea quien sea el otro. */
  formality: unit,
});
export type RegisterDef = z.infer<typeof RegisterDef>;
export const REGISTERS = defineContent("language-registers", RegisterDef, (r) => [
  { kind: "cultures", id: r.culture, at: "culture" },
]);

export const AddressDef = z.strictObject({
  id: contentId,
  name: z.string().min(1),
  culture: contentId,
  recipient: z.enum(RECIPIENTS),
  /** 0-1: desde qué formalidad pedida se usa esta forma (la más alta que no pase de lo pedido gana). */
  formality: unit,
  /** El honorífico como conceptos de la lengua, en orden de lectura; vacío es el nombre a secas. */
  concepts: z.array(contentId),
});
export type AddressDef = z.infer<typeof AddressDef>;
export const ADDRESSES = defineContent("language-address", AddressDef, (a) => [
  { kind: "cultures", id: a.culture, at: "culture" },
]);

export const TABOO_KINDS = ["dead", "ruler", "beast", "god"] as const;
export type TabooKind = (typeof TABOO_KINDS)[number];

export const TabooDef = z.strictObject({
  id: contentId,
  name: z.string().min(1),
  culture: contentId,
  kind: z.enum(TABOO_KINDS),
  /** La palabra prohibida, como conceptos de la lengua. */
  concepts: z.array(contentId).min(1),
  /** El rodeo ("el viejo de la montaña"), también como conceptos. */
  circumlocution: z.array(contentId).min(1),
  /** 0-1: lo grave de decirla, a solas y ante quien no la teme. */
  severity: z.number().gt(0).max(1),
  /** Por qué no se dice (texto del inspector; el motivo causal vive en la cultura). */
  reason: z.string().min(1),
});
export type TabooDef = z.infer<typeof TabooDef>;
export const TABOOS = defineContent("language-taboos", TabooDef, (t) => [
  { kind: "cultures", id: t.culture, at: "culture" },
]);

const clamp01 = (x: number): number => Math.max(0, Math.min(1, x));

/** Lo mínimo de formalidad que cada destinatario pide por sí mismo (a un maestro, mucha). */
export const RECIPIENT_FORMALITY: Readonly<Record<Recipient, number>> = {
  intimate: 0,
  peer: 0.1,
  inferior: 0,
  elder: 0.5,
  superior: 0.6,
  master: 0.7,
};

/** La formalidad que pide una situación hablándole a alguien: la mayor de las dos exigencias. */
export function demandedFormality(register: Pick<RegisterDef, "formality">, to: Recipient): number {
  return Math.max(register.formality, RECIPIENT_FORMALITY[to]);
}

/**
 * La forma de tratamiento que corresponde: entre las de la cultura para ese destinatario, la más
 * formal que no pase de lo pedido. Sin ninguna, `undefined`: se le dice el nombre a secas.
 */
export function chooseAddress(
  forms: readonly AddressDef[],
  culture: string,
  to: Recipient,
  formality: number,
): AddressDef | undefined {
  let best: AddressDef | undefined;
  for (const f of forms) {
    if (f.culture !== culture || f.recipient !== to || f.formality > formality) continue;
    if (
      !best ||
      f.formality > best.formality ||
      (f.formality === best.formality && f.id < best.id)
    ) {
      best = f;
    }
  }
  return best;
}

/** Cómo se dice: el honorífico (si lo hay) delante del nombre de pila; todo sale del léxico. */
export function renderAddress(language: Language, form: AddressDef | undefined, given: string) {
  if (!form || form.concepts.length === 0) return given;
  const honorific = language.compound(form.concepts).text;
  return `${honorific} ${given}`;
}

export type RegisterDirection = "too-casual" | "too-formal";

export interface RegisterSlip {
  readonly direction: RegisterDirection;
  /** 0-1: lo que se nota. */
  readonly size: number;
  /** Lo pedido y lo usado, para el inspector. */
  readonly demanded: number;
  readonly used: number;
}

/** Cuánto se tolera de diferencia hacia abajo (la confianza) y hacia arriba (la ceremonia). */
export const CASUAL_TOLERANCE = 0.15;
export const FORMAL_TOLERANCE = 0.35;
/** Lo que atenúa una falta quien no conoce el registro (honesta ignorancia). */
export const REGISTER_IGNORANCE_MITIGATION = 0.5;

/**
 * ¿Se habló en el registro equivocado? Quedarse corto ante quien pide formalidad es la falta; pasarse
 * de ceremonioso se nota menos (y puede ser burla o servilismo, eso lo lee quien escucha). La
 * ignorancia honesta de ese registro lo atenúa. `null` si cae dentro de lo tolerable.
 */
export function judgeRegister(
  demanded: number,
  used: number,
  speakerKnowsRegister: number,
): RegisterSlip | null {
  const mitigation = 1 - REGISTER_IGNORANCE_MITIGATION * (1 - clamp01(speakerKnowsRegister));
  const low = demanded - used;
  if (low > CASUAL_TOLERANCE) {
    return { direction: "too-casual", size: clamp01(low * mitigation), demanded, used };
  }
  const high = used - demanded;
  if (high > FORMAL_TOLERANCE) {
    return {
      direction: "too-formal",
      size: clamp01((high - FORMAL_TOLERANCE) * mitigation),
      demanded,
      used,
    };
  }
  return null;
}

/** El mismo conjunto de conceptos, para comparar palabras sin importar cómo se pidieron. */
const same = (a: readonly string[], b: readonly string[]): boolean =>
  a.length === b.length && a.every((x, i) => x === b[i]);

/** El tabú de la cultura que veda esta palabra, si hay. */
export function tabooOf(
  taboos: readonly TabooDef[],
  culture: string,
  concepts: readonly string[],
): TabooDef | undefined {
  return taboos.find((t) => t.culture === culture && same(t.concepts, concepts));
}

export interface Utterance {
  /** La forma romanizada que sale. */
  readonly text: string;
  /** Si lo dicho rompe un tabú: cuál. Solo ocurre cuando quien habla no lo evitó. */
  readonly broke?: TabooDef;
  readonly via: "direct" | "circumlocution";
}

/**
 * Decir una palabra en la cultura de quien escucha. Quien conoce el tabú da el rodeo; quien no, la
 * dice como es y la rompe sin saber (la ofensa la mide `tabooOffense`).
 */
export function speakWord(
  language: Language,
  taboos: readonly TabooDef[],
  culture: string,
  concepts: readonly string[],
  speakerKnowsTaboo: boolean,
): Utterance {
  const taboo = tabooOf(taboos, culture, concepts);
  if (taboo && speakerKnowsTaboo) {
    return { text: language.compound(taboo.circumlocution).text, via: "circumlocution" };
  }
  const text = language.compound(concepts).text;
  return taboo ? { text, broke: taboo, via: "direct" } : { text, via: "direct" };
}

export const TABOO_WITNESS_GROWTH = 0.25;
export const TABOO_WITNESS_CAP = 4;
export const TABOO_IGNORANCE_MITIGATION = 0.4;

/**
 * Lo grave de decir la palabra vedada: crece con los testigos, se atenúa si quien habla no sabía,
 * y se agrava con la reverencia de quien oye (0-1: cuánto le importa el tabú).
 */
export function tabooOffense(
  taboo: Pick<TabooDef, "severity">,
  witnesses: number,
  hearerReverence: number,
  speakerKnew: boolean,
): number {
  const w = Math.min(Math.max(0, Math.floor(witnesses)), TABOO_WITNESS_CAP);
  const base =
    taboo.severity * (0.5 + 0.5 * clamp01(hearerReverence)) * (1 + TABOO_WITNESS_GROWTH * w);
  return clamp01(speakerKnew ? base : base * (1 - TABOO_IGNORANCE_MITIGATION));
}

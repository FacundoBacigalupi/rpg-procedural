// La forma de lo dicho (dialogue §2, §10; language §7). Un acto de habla no es solo su contenido:
// también declara en qué registro se habló y con qué tratamiento se nombró al otro. Quien habla
// elige la forma (según la formalidad que decidió usar y a quién le habla); quien escucha la juzga
// contra lo que la situación pide de acuerdo con el rango que él cree que el otro tiene
// (social-structure §4): la falta es una ofensa con la misma `faceLoss` que cualquier otra. Si en
// lo dicho se coló una palabra vedada, ofende aparte. El narrador recibe solo las palabras que
// salieron del léxico (la lista blanca), nunca un honorífico escrito a mano.

import type { AddressDef, Language, Recipient, RegisterDef, TabooDef } from "../language/index.ts";
import {
  chooseAddress,
  demandedFormality,
  judgeRegister,
  renderAddress,
  speakWord,
  tabooOffense,
} from "../language/index.ts";
import {
  type EtiquetteNorm,
  faceLoss,
  judgeBreach,
  type Offense,
  type StandingBelief,
} from "../social/index.ts";
import { registerOffense } from "./regard.ts";

/** Lo que quien habla decide de la forma. */
export interface FormIntent {
  readonly register: Pick<RegisterDef, "id" | "formality">;
  readonly recipient: Recipient;
  /** 0-1: la formalidad con que decide hablar (puede quedarse corto o pasarse). */
  readonly formality: number;
  /** El nombre de pila del otro, ya hecho con el léxico. */
  readonly given: string;
  /** Palabras (como conceptos) que dice en el acto; alguna puede ser vedada. */
  readonly words?: readonly (readonly string[])[];
  /** Si conoce los tabúes de quien escucha. */
  readonly knowsTaboos?: boolean;
  /** Si abrió saludando (el saludo debido a quien está arriba, social-structure §4). */
  readonly greeted?: boolean;
}

/** Lo que el acto declara haber hecho, para que el oyente lo mida contra las normas de etiqueta. */
export interface DeclaredActs {
  /** Usó un tratamiento con honorífico («usted»). */
  readonly address: boolean;
  /** Saludó. */
  readonly greet: boolean;
}

/** La forma del acto, declarada junto al contenido. */
export interface SpokenForm {
  readonly registerId: string;
  readonly recipient: Recipient;
  /** La formalidad realmente usada (0-1). */
  readonly used: number;
  readonly addressId: string | null;
  /** Los actos de etiqueta que hizo (usted, saludo); sin esto no se mide contra las normas. */
  readonly acts?: DeclaredActs;
  /** Cómo nombró al otro (honorífico + nombre de pila). */
  readonly address: string;
  /** Palabras que salieron, en orden, con si fueron por rodeo o rompieron un tabú. */
  readonly words: readonly {
    readonly text: string;
    readonly via: "direct" | "circumlocution";
    readonly broke: string | null;
  }[];
}

/** Quien habla arma la forma de lo que dice: el tratamiento sale del léxico, el tabú del rodeo. */
export function speechForm(
  language: Language,
  forms: readonly AddressDef[],
  taboos: readonly TabooDef[],
  culture: string,
  intent: FormIntent,
): SpokenForm {
  const used = Math.min(1, Math.max(0, intent.formality));
  const form = chooseAddress(forms, culture, intent.recipient, used);
  const words = (intent.words ?? []).map((w) => {
    const u = speakWord(language, taboos, culture, w, intent.knowsTaboos ?? false);
    return { text: u.text, via: u.via, broke: u.broke?.id ?? null };
  });
  return {
    registerId: intent.register.id,
    recipient: intent.recipient,
    used,
    addressId: form?.id ?? null,
    acts: { address: (form?.concepts.length ?? 0) > 0, greet: intent.greeted ?? false },
    address: renderAddress(language, form, intent.given),
    words,
  };
}

/** Lo que quien escucha sabe y cree para juzgar. */
export interface FormJudgeInput {
  readonly register: Pick<RegisterDef, "formality">;
  /** Qué es el oyente para el hablante según el rango que el oyente cree que este le da. */
  readonly asRecipient: Recipient;
  /** 0-1: cuánto conoce el hablante este registro (la ignorancia honesta atenúa). */
  readonly speakerKnowsRegister: number;
  /** Escalones de rango que el oyente cree que hay entre ambos (positivo: el hablante es inferior). */
  readonly gap: number;
  readonly witnesses: number;
  /** 0-1: cuánto le importan los tabúes al oyente. */
  readonly hearerReverence: number;
  readonly speakerKnewTaboos: boolean;
  /**
   * Las normas de etiqueta de la cultura contra lo que el acto declaró (acts): el oyente las
   * mide con lo que CREE del rango del otro, nunca con la verdad; sin lectura no hay ofensa.
   */
  readonly etiquette?: {
    readonly norms: readonly EtiquetteNorm[];
    readonly offendedRank: number;
    readonly believedActor: Pick<StandingBelief, "rank" | "confidence"> | undefined;
    /** 0-1: cuánto conoce quien habla la etiqueta de este estrato. */
    readonly actorKnowsEtiquette: number;
  };
}

export interface FormJudgement {
  /** La falta de registro como ofensa, o `null` si cae en lo tolerable. */
  readonly register: Offense | null;
  /** Una por cada palabra vedada que se rompió (tabú y tamaño 0-1). */
  readonly taboos: readonly { readonly taboo: string; readonly size: number }[];
  /** Las normas de etiqueta omitidas que el oyente tomó por ofensa (usted, saludo debido). */
  readonly breaches: readonly Offense[];
  /** La cara que pierde el oyente por todo junto (0-1). */
  readonly faceLoss: number;
}

/** El oyente juzga la forma: el registro contra lo pedido, las palabras vedadas contra su reverencia. */
export function judgeForm(
  form: SpokenForm,
  taboos: readonly TabooDef[],
  i: FormJudgeInput,
): FormJudgement {
  const demanded = demandedFormality(i.register, i.asRecipient);
  const slip = judgeRegister(demanded, form.used, i.speakerKnowsRegister);
  const register = slip ? registerOffense({ slip, gap: i.gap, witnesses: i.witnesses }) : null;
  const broken = form.words.flatMap((w) => {
    const t = w.broke ? taboos.find((x) => x.id === w.broke) : undefined;
    if (!t) return [];
    return [
      {
        taboo: t.id,
        size: tabooOffense(t, i.witnesses, i.hearerReverence, i.speakerKnewTaboos),
      },
    ];
  });
  const breaches = etiquetteBreaches(form, i);
  const loss =
    (register ? faceLoss(register) : 0) +
    breaches.reduce((s, b) => s + faceLoss(b), 0) +
    broken.reduce(
      (s, b) => s + faceLoss({ norm: b.taboo, size: b.size, gap: 0, witnesses: i.witnesses }),
      0,
    );
  return {
    register,
    taboos: broken,
    breaches,
    faceLoss: Math.round(Math.min(1, loss) * 1e6) / 1e6,
  };
}

/** Las normas que el acto declaró no cumplir y que el oyente, por lo que cree del rango, tomó a mal. */
function etiquetteBreaches(form: SpokenForm, i: FormJudgeInput): Offense[] {
  const e = i.etiquette;
  if (!e || !form.acts) return [];
  const out: Offense[] = [];
  for (const norm of e.norms) {
    const done =
      norm.act === "address" ? form.acts.address : norm.act === "greet" ? form.acts.greet : true;
    if (done) continue;
    const offense = judgeBreach(norm, {
      offendedRank: e.offendedRank,
      believedActor: e.believedActor,
      actorKnowsEtiquette: e.actorKnowsEtiquette,
      witnesses: i.witnesses,
    });
    if (offense) out.push(offense);
  }
  return out;
}

/** Lo que suman o restan al registro las marcas del texto (cortesía o grosería), sin calibrar. */
export const FORMAL_MARK_SHIFT = 0.3;
export const CRUDE_MARK_SHIFT = -0.3;
const FORMAL_MARKS =
  /\b(usted|senor|senora|don|dona|disculpe|perdone|con su permiso|por favor|si me permite|respetuosamente)\b/;
const CRUDE_MARKS =
  /\b(idiota|estupid[oa]|imbecil|cobarde|inutil|basura|maldit[oa]|asqueros[oa]|te mato|callate|largo de aca)\b/;

/** Cuánto corre el texto (ya normalizado) el registro: cortés suma, grosero resta, neutro 0. */
export function formalityShift(norm: string): number {
  if (CRUDE_MARKS.test(norm)) return CRUDE_MARK_SHIFT;
  if (FORMAL_MARKS.test(norm)) return FORMAL_MARK_SHIFT;
  return 0;
}

/**
 * Qué es para el que habla el que escucha, según los rangos que el hablante cree (quien escucha
 * arriba: superior; igual: par; abajo: inferior); entre los de una misma casa, íntimos.
 */
export function recipientBetween(
  speakerRank: number,
  hearerRankRead: number,
  sameHousehold: boolean,
): Recipient {
  if (sameHousehold) return "intimate";
  if (hearerRankRead > speakerRank) return "superior";
  if (hearerRankRead < speakerRank) return "inferior";
  return "peer";
}

/**
 * Los tabúes de la cultura nombrados en el texto (ya normalizado): todos los conceptos del tabú
 * aparecen con su glosa en castellano. Lo que el jugador escribió es lo que dijo.
 */
export function spokenTaboos(
  norm: string,
  taboos: readonly TabooDef[],
  culture: string,
  gloss: (concept: string) => string | undefined,
): TabooDef[] {
  return taboos.filter((t) => {
    if (t.culture !== culture) return false;
    return t.concepts.every((c) => {
      const g = gloss(c);
      if (!g) return false;
      const w = g
        .toLowerCase()
        .normalize("NFD")
        .replace(/\p{M}/gu, "")
        .replace(/[^\p{L}\p{N}\s]/gu, " ")
        .trim();
      return w.length > 0 && new RegExp(`(^| )${w}( |$)`).test(norm);
    });
  });
}

/** Las palabras que el narrador puede citar de la forma: el tratamiento y lo dicho, nada más. */
export function formWhitelist(form: SpokenForm): string[] {
  return [form.address, ...form.words.map((w) => w.text)];
}

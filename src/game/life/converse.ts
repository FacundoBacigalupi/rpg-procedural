// La conversación mínima (dialogue §4, §5, §18): cuando el personaje le dice algo a alguien, el
// oyente contesta al terminar de oír. El paso `speak` deja lo dicho en el oyente (`PENDING`) y
// agenda este proceso para cuando termina; acá el oyente lo entiende (léxico, `understand`), lo
// piensa con lo que sabe (`decideReply`) y contesta con un `action.speak` suyo, que el resto del
// juego percibe como cualquier otro. Si pidió algo y le dan, sale del ledger con ese evento.

import {
  type AgentId,
  type Duration,
  type EntityRef,
  type EventId,
  type HolderRef,
  holderAccount,
  type LedgerUnit,
  type PlaceRef,
  type Rng,
  type Tick,
} from "../../core/index.ts";
import {
  ACCUSE_TRUST_BELIEVED,
  ACCUSE_TRUST_SLANDER,
  ACCUSE_TRUST_UNBACKED,
  type AccuseInput,
  type ActionCatalog,
  type AddressDef,
  AMENDS,
  adjustFace,
  alternativesAmong,
  BELIEFS,
  BELIEVED_AT,
  type Belief,
  BODY_STATE,
  type BondDef,
  bargainFace,
  beliefAbout,
  beliefConfidenceAt,
  believed,
  type ConceptDef,
  CREDIT,
  type Credit,
  callName,
  clampTemper,
  credulity,
  DEFAULT_FACE,
  DEFENSE_DELTAS,
  type Deed,
  type DetectionInput,
  type DimensionDef,
  decideReply,
  deedsBy,
  deleteComponent,
  demandedFormality,
  didDeed,
  dominantVariant,
  draftEvent,
  ENTITY,
  type EtiquetteNorm,
  type EventDraft,
  FACE,
  type FormJudgeInput,
  type FormJudgement,
  formalityShift,
  GIFT_GRAMS,
  type GoodDef,
  goodUnit,
  greets,
  HEARD,
  type HeardProphecy,
  type HeardRumor,
  hear,
  hearRumor,
  holdsGrudge,
  honestyShift,
  INNATE,
  KNOWN_DEEDS,
  type KnownDeeds,
  keepRumor,
  type Language,
  type Lexicon,
  LOCATION,
  learnDeed,
  liveBetween,
  looseCounter,
  MEMORIES,
  MIND,
  memoriesAbout,
  normalize,
  type Offense,
  OWN_DEEDS,
  PERSON,
  PERSON_NAME,
  PROPHECY_BELIEFS,
  type ProcessContext,
  type ProcessDef,
  type PromiseTerms,
  type Proposal,
  RELATIONS,
  RELIGIOUS_IDENTITY,
  RESERVE_GRAMS_PER_MEMBER,
  type ReadonlyWorldTruth,
  type Recipient,
  type RegisterDef,
  RUMORS,
  rankOf,
  recipientBetween,
  recollect,
  relationship,
  respondToOffense,
  rumorAsKnown,
  type ScheduleRequest,
  SECRETS,
  type SpaceGraph,
  type SpeakAct,
  type SpeechAct,
  type SpeechLine,
  type SpokenForm,
  STANDING_BELIEFS,
  STATUS,
  type StateChange,
  type StatusDef,
  sameValue,
  secretAbout,
  setComponent,
  sincerityOf,
  sourceOf,
  speechForm,
  spoken,
  spokenTaboos,
  stakesAt,
  stanceOf,
  standardize,
  type TabooDef,
  type Trait,
  table,
  threatCredibility,
  threatFaceDelta,
  transmit,
  understand,
  utter,
  villageCulture,
  worstDeed,
} from "../../sim/index.ts";
import { registerKnowledge } from "./accent.ts";
import { coinCeilingOf, householdFlowsOf, standingOf } from "./budget.ts";
import { candidatesOf, RUMOR_TOLD_EVENT } from "./gossip.ts";
import { LOANS, loansOf } from "./loans.ts";
import { FLATTERY_MEMORY_KIND } from "./memories.ts";
import { rentsOf } from "./rents.ts";
import { liveTaboos } from "./taboos.ts";
import { recountOf, recountTone, weighedMemories } from "./talkmemory.ts";
import { INQUIRY_EVENT, type InquiryData } from "./testify.ts";
import { incomeOfHousehold } from "./trades.ts";

export const CONVERSE_PROCESS = "life.converse";

/** Lo que le dijeron y todavía no contestó (se borra al contestar). */
export interface PendingSpeech {
  readonly from: AgentId;
  readonly text: string;
  readonly clarity: number;
  readonly key: string;
  /** La forma de tratar que el hablante declaró («le hablo de usted»); sin ella, la que sale sola. */
  readonly style?: SpeechStyle;
  /** El acto que declaró querer hacer (su intención); no pisa lo que el oyente entiende. */
  readonly intended?: SpeechAct["kind"];
  /** El acto declarado completo (con de qué, de quién y los términos): lo que el parser estructuró. */
  readonly declared?: SpeakAct;
}

/** Por debajo de esta claridad el oyente no capta el detalle y el acto declarado no le llega. */
const DECLARED_CLARITY = 0.35;

/**
 * El acto que el oyente entiende cuando quien habla lo declaró (dialogue §14): las palabras mandan,
 * pero si no captaron nada (`other`) el oyente toma el acto declarado, y si captaron el mismo tipo
 * pero sin detalle (de quién, qué bien, los términos de la promesa) se completa con lo declarado.
 * Con voz turbia no llega nada de eso.
 */
export function withDeclared(
  heard: SpeechAct,
  declared: SpeakAct | undefined,
  lex: Lexicon,
  clarity: number,
): SpeechAct {
  if (!declared || clarity < DECLARED_CLARITY) return heard;
  const goodOf = (what: string | null): string | null => {
    if (what === null) return null;
    const norm = normalize(what);
    const hit = lex.goods.find((g) =>
      g.names.some((n) => {
        const w = normalize(n);
        return w.length > 0 && new RegExp(`(^| )${w}( |$)`).test(norm);
      }),
    );
    return hit?.id ?? null;
  };
  const known = (e: EntityRef | null): AgentId | null =>
    e !== null && lex.people.some((p) => p.id === e) ? (e as AgentId) : null;
  const form = heard.form ? { form: heard.form } : {};
  if (heard.kind === "other") {
    switch (declared.kind) {
      case "greet":
      case "farewell":
        return { kind: declared.kind, ...form };
      case "ask":
        return { kind: "ask", about: known(declared.about), ...form };
      case "request":
        return { kind: "request", good: goodOf(declared.what), ...form };
      case "tell": {
        const about = known(declared.about);
        if (!about) return heard;
        // Un rumor de un hecho (`theft`/`assault`): lo que dice de quién lo hizo y a quién.
        if (declared.claim === "theft" || declared.claim === "assault") {
          return {
            kind: "rumor",
            deed: declared.claim,
            by: about,
            victim: known(declared.victim ?? null),
            ...form,
          };
        }
        return { kind: "tell", about, claim: declared.claim, ...form };
      }
      case "promise": {
        const terms = declaredTerms(declared);
        return {
          kind: "promise",
          good: goodOf(declared.what),
          grams: null,
          ...(terms ? { terms } : {}),
          ...form,
        };
      }
    }
  }
  if (heard.kind === "ask" && declared.kind === "ask" && heard.about === null) {
    const about = known(declared.about);
    return about ? { ...heard, about } : heard;
  }
  if (heard.kind === "request" && declared.kind === "request" && heard.good === null) {
    return { ...heard, good: goodOf(declared.what) };
  }
  if (heard.kind === "promise" && declared.kind === "promise") {
    const terms = declaredTerms(declared);
    return {
      ...heard,
      good: heard.good ?? goodOf(declared.what),
      ...(heard.terms === undefined && terms ? { terms } : {}),
    };
  }
  return heard;
}

function declaredTerms(p: Extract<SpeakAct, { kind: "promise" }>): PromiseTerms | undefined {
  if (p.times === undefined && p.dueDays === undefined && p.precision === undefined) {
    return undefined;
  }
  return {
    ...(p.times !== undefined ? { times: p.times } : {}),
    ...(p.dueDays !== undefined ? { dueDays: p.dueDays } : {}),
    ...(p.precision !== undefined ? { precision: p.precision } : {}),
  };
}

/** Lo que el jugador declara de cómo trata al otro (manners `formal` y `casual` de hablar). */
export type SpeechStyle = "formal" | "casual";

export function declaredStyle(manner: readonly string[]): SpeechStyle | undefined {
  return manner.includes("formal") ? "formal" : manner.includes("casual") ? "casual" : undefined;
}

export const PENDING = table<PendingSpeech>("life.pending_speech");

/**
 * La propuesta que alguien dejó planteada (una contraoferta) y espera que `with` acepte, rechace o
 * conteste con otra (dialogue §8, contracts §3): `gets`/`gives` desde quien la planteó. Vive un
 * día de mundo; cada contraoferta suma una ronda.
 */
export interface OpenDeal {
  readonly with: AgentId;
  readonly deal: Proposal;
  readonly at: Tick;
  readonly rounds: number;
}

export const OPEN_DEALS = table<OpenDeal>("life.open_deal");

export interface ConverseOptions {
  readonly spaces: SpaceGraph;
  readonly catalog: ActionCatalog;
  readonly goods: readonly GoodDef[];
  readonly statuses: readonly StatusDef[];
  /** Las dimensiones y vínculos para leer lo que el oyente siente por quien habla. */
  readonly dims: readonly DimensionDef[];
  readonly bonds: readonly BondDef[];
  readonly lines: readonly SpeechLine[];
  /** Los rasgos del genoma, para leer el temperamento del oyente. */
  readonly traits: readonly Trait[];
  readonly placeOf: (truth: ReadonlyWorldTruth, who: AgentId) => PlaceRef;
  /** Ticks por día de mundo (los plazos del fiado se cuentan en días). */
  readonly day: Duration;
  /** Duración del año (para separar chicos y viejos en el presupuesto del hogar). */
  readonly year?: Duration;
  /** La lengua y la etiqueta de habla de la aldea; sin esto el acto va sin forma (solo contenido). */
  readonly form?: ConverseForm;
}

/**
 * Con qué se arma y se juzga la forma de lo dicho (dialogue §10, language §7): la lengua de la
 * aldea hace el tratamiento y las palabras, las glosas dicen qué palabra del texto es qué concepto.
 */
export interface ConverseForm {
  readonly language: Language;
  readonly concepts: readonly ConceptDef[];
  readonly registers: readonly RegisterDef[];
  readonly addresses: readonly AddressDef[];
  readonly taboos: readonly TabooDef[];
  /** Las normas de etiqueta de la cultura (usted, saludo debido); sin ellas solo pesa el registro. */
  readonly etiquette?: readonly EtiquetteNorm[];
  readonly culture: string;
}

/** Lo que la falta de forma le saca al afecto, al respeto y le suma al rencor, por punto de cara (sin calibrar). */
/** Valor por «kilo» de una moneda de cobre: `grams` cuenta piezas, así una pieza vale un cobre. */
const COIN_WORTH_PER_KILO = 1000;
const FORM_RESENTMENT = 0.4;
const FORM_RESPECT = 0.2;
/** Reverencia por los tabúes de quien oye si no tiene fe anotada. */
const DEFAULT_REVERENCE = 0.5;

/** Cara que pierde quien ofendió si el ofendido lo reprende o lo castiga, por punto de cara (sin calibrar). */
const OFFENDER_SHAME_REBUKED = 0.5;
const OFFENDER_SHAME_PUNISHED = 1;

/** La peor falta de la forma (registro, etiqueta omitida o palabra vedada), o nada. */
function worstOffense(j: FormJudgement): Offense | undefined {
  const all: Offense[] = [
    ...(j.register ? [j.register] : []),
    ...j.breaches,
    ...j.taboos.map((t) => ({ norm: t.taboo, size: t.size, gap: 0, witnesses: 0 })),
  ];
  return all.reduce<Offense | undefined>((w, x) => (!w || x.size > w.size ? x : w), undefined);
}

/** La huella de acusar de lo que no ocurrió (law §5). */
export const FALSE_ACCUSATION_EVENT = "law.false_accusation";

/**
 * El hecho por el que pregunta quien pregunta: con una persona de por medio, el último hecho que
 * conoce en que ella hizo o sufrió algo; sin ella, el último cuyo autor no sabe. Nunca uno que lo
 * tenga a él por autor ni a quien responde (a quien se acusa no se lo interroga como testigo).
 */
export function deedAsked(
  known: KnownDeeds | undefined,
  about: AgentId | null,
  witness: AgentId,
): Deed | null {
  const fit = (known?.deeds ?? []).filter((d) =>
    about === null ? d.by === null : d.by === about || d.victim === about,
  );
  const sorted = [...fit].sort((a, b) => b.at - a.at || (a.event < b.event ? -1 : 1));
  return sorted.find((d) => d.by !== witness) ?? null;
}

/** La gente que está donde ellos hablan, sin contarlos: los testigos de lo dicho. */
function witnessesOf(truth: ReadonlyWorldTruth, me: AgentId, speaker: AgentId): number {
  return truth
    .ids(PERSON)
    .map((id) => id as AgentId)
    .filter((id) => id !== me && id !== speaker && alive(truth, id) && sameSpot(truth, id, me))
    .length;
}

/**
 * La forma del acto y cómo la juzga el oyente (dialogue §10): quien habla elige el registro del
 * lugar, el tratamiento según el rango que cree que tiene el otro y la formalidad que su texto
 * deja ver; el oyente la mide contra lo que cree que él es para el hablante (su lectura del rango
 * de quien le habla, no el estatus real) y su reverencia por los tabúes (su fe anotada).
 */
function formOf(
  truth: ReadonlyWorldTruth,
  f: ConverseForm,
  ctx: {
    me: AgentId;
    speaker: AgentId;
    text: string;
    now: Tick;
    indoor: boolean;
    hearerRank: number;
    /** Lo que el oyente cree del rango de quien habla. */
    readRank: number;
    speakerRank: number;
    /** Lo que quien habla cree del rango del oyente. */
    speakerReads: number;
    /** La lectura del oyente sobre quien habla (rango y confianza); sin ella, la etiqueta no ofende. */
    reading?: { rank: number; confidence: number };
    /** La forma de tratar que el hablante declaró; pisa la que saldría de su lectura. */
    style?: SpeechStyle | undefined;
  },
): { spoken: SpokenForm; judge: FormJudgeInput } | undefined {
  const { me, speaker, text } = ctx;
  const setting = ctx.indoor ? "home" : "market";
  const register = f.registers.find((r) => r.culture === f.culture && r.setting === setting);
  if (!register) return undefined;
  const kin = householdOf(truth, me) === householdOf(truth, speaker);
  const norm = normalize(text);
  // Los tabúes de la cultura y los que nacieron de las muertes de la aldea y siguen vivos.
  const live = liveTaboos(truth, f, ctx.now);
  const taboos = spokenTaboos(norm, live, f.culture, (c) => f.concepts.find((x) => x.id === c)?.es);
  // Quien habla elige el trato por lo que cree del otro; el oyente juzga por lo que cree que
  // el otro cree que él es (su propia lectura de quien le habla).
  const read = recipientBetween(ctx.speakerRank, ctx.speakerReads, kin);
  // «De usted» lo trata como a un superior aunque no lo crea; «de vos», como a un igual.
  const recipient: Recipient = ctx.style === "formal" && !kin ? "superior" : read;
  const asRecipient = recipientBetween(ctx.readRank, ctx.hearerRank, kin);
  const used =
    ctx.style === "casual"
      ? 0
      : Math.min(1, Math.max(0, demandedFormality(register, recipient) + formalityShift(norm)));
  const spoken = speechForm(f.language, f.addresses, live, f.culture, {
    register,
    recipient,
    formality: used,
    given: givenName(truth, me) ?? "",
    words: taboos.map((t) => t.concepts),
    knowsTaboos: false,
    greeted: greets(norm),
  });
  const faith = truth.get(RELIGIOUS_IDENTITY, me)?.affiliations[0];
  return {
    spoken,
    judge: {
      register,
      asRecipient,
      speakerKnowsRegister: registerKnowledge(truth, speaker),
      gap: Math.max(0, ctx.hearerRank - ctx.readRank),
      witnesses: witnessesOf(truth, me, speaker),
      hearerReverence: faith ? unit(0.5 * faith.belief + 0.5 * faith.practice) : DEFAULT_REVERENCE,
      speakerKnewTaboos: true,
      ...(f.etiquette
        ? {
            etiquette: {
              norms: f.etiquette.filter((n) => n.culture === f.culture),
              offendedRank: ctx.hearerRank,
              believedActor: ctx.reading,
              actorKnowsEtiquette: 1,
            },
          }
        : {}),
    },
  };
}

/** Lo que se entiende de hablarle a alguien sin decirle nada en particular: un saludo. */
export const BARE_ADDRESS = "Hola";

export const replyKey = (from: AgentId, at: Tick) => `reply:${from}:${at}`;

/** Lo que el paso `speak` deja hecho para que el oyente conteste cuando termine de oír. */
export function listenTo(
  speaker: AgentId,
  listener: EntityRef,
  text: string | null,
  clarity: number,
  at: Tick,
  end: Tick,
  style?: SpeechStyle,
  intended?: SpeechAct["kind"],
  declared?: SpeakAct,
): { changes: StateChange[]; schedule: ScheduleRequest[] } {
  if (!listener.startsWith("agent:") || listener === speaker) {
    return { changes: [], schedule: [] };
  }
  const key = replyKey(speaker, at);
  return {
    changes: [
      setComponent(PENDING, listener, {
        from: speaker,
        text: text ?? BARE_ADDRESS,
        clarity,
        key,
        ...(style ? { style } : {}),
        ...(intended ? { intended } : {}),
        ...(declared ? { declared } : {}),
      }),
    ],
    schedule: [
      {
        at: end,
        phase: "decide",
        process: CONVERSE_PROCESS,
        scope: listener as AgentId,
        reason: { kind: "state", entity: listener, key },
      },
    ],
  };
}

/** Lo que `speaker` le debe a `me` y si ya venció: lo que decide si se le vuelve a fiar. */
function owesOf(
  truth: ReadonlyWorldTruth,
  me: AgentId,
  speaker: AgentId,
  now: Tick,
  day: Duration,
): { grams: number; overdue: boolean } {
  const rows = truth.ids(CREDIT).map((id) => ({ id, credit: truth.get(CREDIT, id) as Credit }));
  const live = liveBetween(rows, speaker, me);
  return {
    grams: live.reduce((sum, r) => sum + r.credit.owed, 0),
    overdue: live.some((r) => r.credit.status === "defaulted" || now > r.credit.due),
  };
}

function householdOf(truth: ReadonlyWorldTruth, id: AgentId): string | undefined {
  return truth.get(PERSON, id)?.household;
}

function alive(truth: ReadonlyWorldTruth, id: AgentId): boolean {
  return truth.get(ENTITY, id)?.endedAt === undefined;
}

function sameHex(truth: ReadonlyWorldTruth, a: AgentId, b: AgentId): boolean {
  const x = truth.get(LOCATION, a);
  const y = truth.get(LOCATION, b);
  return x !== undefined && y !== undefined && x.hex === y.hex;
}

function sameSpot(truth: ReadonlyWorldTruth, a: AgentId, b: AgentId): boolean {
  const x = truth.get(LOCATION, a);
  const y = truth.get(LOCATION, b);
  return x !== undefined && y !== undefined && x.hex === y.hex && x.space === y.space;
}

function givenName(truth: ReadonlyWorldTruth, id: AgentId): string | undefined {
  const name = truth.get(PERSON_NAME, id);
  return name ? callName(name) : undefined;
}

/** Con qué palabras puede nombrar `listener` a la gente que conoce, vista desde `speaker`. */
function lexiconOf(
  truth: ReadonlyWorldTruth,
  o: ConverseOptions,
  listener: AgentId,
  speaker: AgentId,
): Lexicon {
  const home = householdOf(truth, listener);
  const me = truth.get(PERSON, speaker);
  const told = truth.get(HEARD, listener)?.claims ?? [];
  const people = truth
    .ids(PERSON)
    .map((id) => id as AgentId)
    .filter((id) => id !== listener && id !== speaker)
    .flatMap((id) => {
      const p = truth.get(PERSON, id);
      if (!p) return [];
      const known = p.household === home || sameSpot(truth, id, listener);
      if (!known && !told.some((c) => c.about === id)) return [];
      const given = givenName(truth, id);
      const kin: string[] = [];
      if (me?.mother === id) kin.push("madre", "mama");
      if (me?.father === id) kin.push("padre", "papa");
      if (me && p.household === me.household && me.mother !== id && me.father !== id) {
        kin.push(p.sex === "female" ? "hermana" : "hermano");
      }
      return [{ id: id as AgentId, names: [...(given ? [given] : []), ...kin] }];
    });
  const goods = o.goods.map((g) =>
    g.form === "coin"
      ? { id: g.id, names: ["moneda", "monedas", "cobre", "cobres"], coin: true }
      : { id: g.id, names: [g.name, g.id] },
  );
  return { people, goods };
}

/** Lo que `who` cree de si `about` vive: su creencia, o lo que ve de primera mano, o lo que oyó. */
function ownBelief(
  truth: ReadonlyWorldTruth,
  who: AgentId,
  about: AgentId,
  now: Tick,
): Belief | undefined {
  const held = believed(truth.get(BELIEFS, who), about, "alive");
  if (held) return held;
  const known =
    householdOf(truth, who) === householdOf(truth, about) || sameSpot(truth, who, about)
      ? alive(truth, about)
      : truth.get(HEARD, who)?.claims.find((c) => c.about === about)?.claim === "dead"
        ? false
        : truth.get(HEARD, who)?.claims.find((c) => c.about === about)?.claim === "alive"
          ? true
          : undefined;
  if (known === undefined) return undefined;
  return {
    prop: { kind: "attr", subject: about, attr: "alive" },
    value: known,
    confidence: 1,
    asOf: now,
    learnedAt: now,
    sources: [],
    salience: 1,
    measured: now,
  };
}

const unit = (x: number) => Math.min(1, Math.max(0, x));

/**
 * Lo que el oyente puede leer de quien le cuenta que `about` murió o vive (dialogue §3-§4): si
 * miente se mide contra lo que el hablante cree, y las señales salen del temperamento de ambos,
 * de la relación, de lo que el oyente ya cree y de lo que le suena. La habilidad de mentir
 * todavía no pesa (control sale del temperamento).
 */
function detectionOf(
  truth: ReadonlyWorldTruth,
  o: ConverseOptions,
  act: Extract<SpeechAct, { kind: "tell" }>,
  ctx: { me: AgentId; speaker: AgentId; now: Tick },
  feel: { trust: number; familiarity: number },
  recollection: { bias: number },
  listenerZ: Readonly<Record<string, number>>,
): DetectionInput {
  const { me, speaker, now } = ctx;
  const said = act.claim === "alive";
  const sincerity = sincerityOf(
    { value: said, own: ownBelief(truth, speaker, act.about, now) },
    now,
  );
  const innate = truth.get(INNATE, speaker);
  const sz = innate
    ? standardize(innate, o.traits, truth.get(PERSON, speaker)?.sex ?? "female")
    : {};
  const own = believed(truth.get(BELIEFS, me), act.about, "alive");
  const beliefClash = own && !sameValue(own.value, said) ? unit(beliefConfidenceAt(own, now)) : 0;
  const heardClash = (truth.get(HEARD, me)?.claims ?? []).some(
    (c) => c.about === act.about && c.claim !== act.claim,
  )
    ? 0.5
    : 0;
  return {
    lying: sincerity === "lie",
    control: unit(0.5 + 0.5 * clampTemper(sz["control"] ?? 0)),
    nerves: unit(0.25 + 0.25 * clampTemper(sz["reactivity"] ?? 0)),
    insight: unit(0.5 + 0.5 * clampTemper(listenerZ["perception"] ?? 0)),
    familiarity: unit(feel.familiarity),
    conflict: Math.max(beliefClash, heardClash),
    implausibility: act.claim === "dead" ? 0.25 : 0.05,
    trust: unit(feel.trust),
    wariness: unit(
      0.2 +
        0.3 * Math.max(0, -recollection.bias) +
        0.2 * Math.max(0, -(listenerZ["warmth"] ?? 0) / 2),
    ),
  };
}

/**
 * El rumor que el personaje pasa (information §3): solo vale si lo que dice es un hecho que él
 * conoce (`KNOWN_DEEDS`/`RUMORS`); la raíz es ese evento real, no lo que él escribe. El oyente lo
 * pesa con `hearRumor` por lo que confía en quien se lo cuenta y lo que quiere al acusado. Sin un
 * hecho que lo respalde no hay rumor: el oyente lo toma como charla.
 */
function rumorOf(
  truth: ReadonlyWorldTruth,
  o: ConverseOptions,
  act: Extract<SpeechAct, { kind: "rumor" }>,
  ctx: { me: AgentId; speaker: AgentId; now: Tick },
  feel: { trust: number },
  listenerZ: Readonly<Record<string, number>>,
  rng: Rng,
): { told: HeardRumor; prev: HeardRumor | undefined; heard: HeardRumor } | undefined {
  const { me, speaker, now } = ctx;
  const victim = act.victim === "speaker" ? speaker : act.victim;
  const grounded = candidatesOf(
    speaker,
    truth.get(RUMORS, speaker),
    truth.get(KNOWN_DEEDS, speaker),
  )
    .filter(
      (h) =>
        h.content.kind === act.deed &&
        (act.by === null ? h.content.by === null : h.content.by === act.by) &&
        (victim === null || h.content.victim === victim),
    )
    .sort((a, b) => b.at - a.at || (a.root < b.root ? -1 : 1))[0];
  // A quien se le cuenta que él mismo lo hizo no es un rumor sino una acusación.
  if (!grounded || grounded.content.by === me) return undefined;
  const told = spoken(grounded, grounded.content);
  const prev = truth.get(RUMORS, me)?.items.find((x) => x.root === grounded.root);
  const doer = told.content.by;
  const toDoer = doer
    ? relationship(truth.get(RELATIONS, me), doer, now, {
        dims: o.dims,
        bonds: o.bonds,
        schemaStrength: (s) => truth.get(MIND, me)?.schemas[s]?.strength ?? 0,
      }).dims.affection
    : 0;
  const heard = hearRumor(
    prev,
    told,
    speaker,
    me,
    {
      trustInTeller: feel.trust,
      affectionToDoer: toDoer,
      credulity: unit(0.5 - 0.2 * clampTemper(listenerZ["curiosity"] ?? 0)),
      attention: unit(0.5 + 0.25 * clampTemper(listenerZ["memory"] ?? 0)),
    },
    now,
    rng,
  );
  return { told, prev, heard };
}

/**
 * Lo que `me` sabe de dónde le llegó lo de `about` (o lo último que supo): lo vio, se lo dijo
 * alguien o «dicen que» (`sourceOf`). Solo lo que recuerda, no la cadena real.
 */
function sourceKnown(
  truth: ReadonlyWorldTruth,
  me: AgentId,
  about: AgentId | null,
):
  | { kind: "saw" }
  | { kind: "named"; name: string; voices: number }
  | { kind: "crowd"; voices: number }
  | undefined {
  const mine = candidatesOf(me, truth.get(RUMORS, me), truth.get(KNOWN_DEEDS, me)).filter(
    (h) => about === null || h.content.by === about || h.content.victim === about,
  );
  const last = [...mine].sort((a, b) => b.heardAt - a.heardAt || (a.root < b.root ? -1 : 1))[0];
  if (!last) return undefined;
  const src = sourceOf(last);
  if (src.kind === "named") {
    return { kind: "named", name: givenName(truth, src.teller) ?? "alguien", voices: src.voices };
  }
  return src;
}

/**
 * Lo que el oyente pone para pesar una amenaza, un halago o un insulto (dialogue §9, §10): lo que
 * cree de la capacidad y la disposición de quien habla sale de la relación (miedo, respeto, trato) y
 * de lo vivido y sabido de él; la valentía, el orgullo y la vanidad, del temperamento; los testigos,
 * de la gente que está en el lugar. Sin ley todavía en la aldea: el recurso a la autoridad es chico.
 */
function regardOf(
  truth: ReadonlyWorldTruth,
  ctx: { me: AgentId; speaker: AgentId; now: Tick; dealWith: AgentId | undefined },
  feel: { fear: number; respect: number; trust: number; familiarity: number },
  recollection: { bias: number },
  reproach: boolean,
  z: Readonly<Record<string, number>>,
  gap: number,
): NonNullable<Parameters<typeof decideReply>[0]["regard"]> {
  const { me, speaker } = ctx;
  const mind = truth.get(MIND, me);
  // Los halagos de este mismo que recuerda (el desgaste) y si cree que quiere algo (un trato abierto).
  const flatteries = memoriesAbout(truth.get(MEMORIES, me), speaker, ctx.now).filter(
    (s) => s.memory.perceived.kind === FLATTERY_MEMORY_KIND,
  ).length;
  const present = truth
    .ids(PERSON)
    .map((id) => id as AgentId)
    .filter((id) => id !== me && id !== speaker && alive(truth, id) && sameSpot(truth, id, me));
  const witnesses = present.length;
  const sure = unit(0.3 + 0.7 * feel.familiarity);
  const bold = clampTemper(z["boldness"] ?? 0);
  const touchy = clampTemper(z["reactivity"] ?? 0);
  return {
    threat: {
      credibility: threatCredibility({
        capability: { level: unit(0.4 + 0.5 * feel.fear + 0.2 * feel.respect), confidence: sure },
        disposition: {
          level: unit(0.4 + 0.5 * Math.max(0, -recollection.bias) + (reproach ? 0.3 : 0)),
          confidence: sure,
        },
        shown: shownBy(truth, me, speaker, ctx.now),
      }),
      harm: 0,
      demandCost: THREAT_DEMAND_COST,
      courage: unit(0.5 + 0.25 * bold + 0.15 * clampTemper(z["willpower"] ?? 0)),
      pride: unit(0.4 + 0.2 * touchy),
      witnesses,
      selfConfidence: unit(0.4 + 0.2 * bold + 0.1 * clampTemper(z["constitution"] ?? 0)),
      escape: THREAT_ESCAPE,
      help: unit(THREAT_HELP_BASE + THREAT_HELP_EACH * witnesses),
      recourse: THREAT_RECOURSE,
    },
    vindictiveness: unit(0.5 + 0.25 * touchy - 0.15 * clampTemper(z["warmth"] ?? 0)),
    flattery: {
      // Vanidad: sociabilidad más lo que su mente cree de sí (vale por su fuerza, o se siente indigno y busca aprobación).
      vanity: unit(
        0.45 +
          0.2 * clampTemper(z["sociability"] ?? 0) +
          VANITY_SCHEMA * (mind?.schemas["strength_is_worth"]?.strength ?? 0) +
          VANITY_SCHEMA * (mind?.schemas["i_am_unworthy"]?.strength ?? 0),
      ),
      excess: 0,
      insight: unit(0.5 + 0.5 * clampTemper(z["perception"] ?? 0)),
      trust: unit(feel.trust),
      motiveKnown: ctx.dealWith === speaker,
      recent: flatteries,
    },
    insult: { sting: 0, truth: INSULT_TRUTH_GUESS, gap, witnesses },
  };
}

/**
 * Lo que el oyente pone para contestar una acusación (dialogue §6, law §5). Como oyente de un
 * tercero: cuánto confía en quien acusa, cuánto aprecia al acusado y qué sabía de él (su
 * `KNOWN_DEEDS`); el hecho citado es el que quien acusa conoce de verdad. Como acusado: si de
 * verdad lo hizo (lo recuerda como propio en `OWN_DEEDS`, lo haya visto alguien o no), su
 * honestidad (movida por lo que decidió hacer con su culpa), su orgullo y si sabe algo de quien acusa.
 */
function accuseOf(
  truth: ReadonlyWorldTruth,
  o: ConverseOptions,
  act: Extract<SpeechAct, { kind: "accuse" }>,
  ctx: { me: AgentId; speaker: AgentId; now: Tick },
  feel: { trust: number; resentment: number },
  z: Readonly<Record<string, number>>,
): AccuseInput | undefined {
  const { me, speaker, now } = ctx;
  if (act.accused === null) return undefined;
  if (act.accused === "you") {
    const victim = act.victim === "speaker" ? speaker : act.victim;
    // Lo hizo de verdad si lo recuerda como suyo (`OWN_DEEDS`), lo haya visto alguien o no; y lo
    // que decidió hacer con su culpa (`AMENDS`) corre su honestidad: confesar la sube, desviar la baja.
    const own = didDeed(truth.get(OWN_DEEDS, me), act.deed, victim);
    const guilty = own !== undefined;
    const shift = own ? honestyShift(stanceOf(truth.get(AMENDS, me), own.event)) : 0;
    return {
      as: "accused",
      defense: {
        guilty,
        honesty: unit(0.5 + 0.25 * clampTemper(z["willpower"] ?? 0) + shift),
        justification: unit(ACCUSED_EXCUSE_BASE + ACCUSED_EXCUSE_GRUDGE * feel.resentment),
        pride: unit(0.4 + 0.2 * clampTemper(z["reactivity"] ?? 0)),
        counterable: worstDeed(truth.get(KNOWN_DEEDS, me), speaker) !== undefined,
      },
    };
  }
  const accused = act.accused;
  const toward = relationship(truth.get(RELATIONS, me), accused, now, {
    dims: o.dims,
    bonds: o.bonds,
    schemaStrength: (s) => truth.get(MIND, me)?.schemas[s]?.strength ?? 0,
  }).dims;
  return {
    as: "hearer",
    accused,
    cited:
      deedsBy(truth.get(KNOWN_DEEDS, speaker), accused).find((d) => d.kind === act.deed) ?? null,
    view: {
      trustInAccuser: unit(0.5 + 0.5 * feel.trust),
      affinityToAccused: Math.min(1, Math.max(-1, toward.affection)),
      ownKnowledge: worstDeed(truth.get(KNOWN_DEEDS, me), accused) ?? null,
      gullibility: unit(0.5 - 0.2 * clampTemper(z["perception"] ?? 0)),
      stake: unit(toward.resentment),
    },
  };
}

/**
 * Si lo acusado ocurrió de verdad (la verdad del mundo: el `OWN_DEEDS` del acusado, que es lo que
 * él hizo, lo haya visto alguien o no). Solo lo leen el inspector y la huella de la denuncia falsa;
 * ninguna decisión de un NPC pasa por acá. Null si no se entiende a quién se acusa.
 */
export function accusationOccurred(
  truth: ReadonlyWorldTruth,
  act: Extract<SpeechAct, { kind: "accuse" }>,
  ctx: { me: AgentId; speaker: AgentId },
): boolean | null {
  if (act.accused === null) return null;
  const accused = act.accused === "you" ? ctx.me : act.accused;
  const victim = act.victim === "speaker" ? ctx.speaker : act.victim;
  return didDeed(truth.get(OWN_DEEDS, accused), act.deed, victim) !== undefined;
}

/** Constantes sin calibrar: la excusa de base del acusado y cuánto la alimenta el rencor a quien acusa. */
const ACCUSED_EXCUSE_BASE = 0.2;
const ACCUSED_EXCUSE_GRUDGE = 0.5;

/**
 * Lo que el oyente pone al guardar un secreto cuando le preguntan por él (dialogue §7, §11): el
 * costo de que salga es el del secreto marcado; el dominio de sí y el olfato salen del
 * temperamento, la emoción de lo reactivo, el cansancio del cuerpo, y confianza y afecto de la
 * relación; la habilidad de quien sonsaca, de su sociabilidad. Sin secreto sobre ese alguien, nada.
 */
function keepOf(
  truth: ReadonlyWorldTruth,
  o: ConverseOptions,
  act: Extract<SpeechAct, { kind: "ask" }>,
  ctx: { me: AgentId; speaker: AgentId; now: Tick },
  feel: { trust: number; affection: number },
  z: Readonly<Record<string, number>>,
): NonNullable<Parameters<typeof decideReply>[0]["keep"]> | undefined {
  const { me, speaker, now } = ctx;
  if (act.about === null) return undefined;
  const secret = secretAbout(truth.get(SECRETS, me), act.about);
  if (!secret) return undefined;
  const innate = truth.get(INNATE, speaker);
  const sz = innate
    ? standardize(innate, o.traits, truth.get(PERSON, speaker)?.sex ?? "female")
    : {};
  const own = secret.attr === "alive" ? ownBelief(truth, me, act.about, now) : undefined;
  const side = (x: number) => Math.min(1, Math.max(-1, x));
  return {
    state: {
      stakes: unit(stakesAt(secret, now)),
      discipline: unit(0.5 + 0.5 * clampTemper(z["control"] ?? 0)),
      arousal: unit(KEEP_AROUSAL * Math.max(0, clampTemper(z["reactivity"] ?? 0))),
      intoxication: 0,
      fatigue: unit(truth.get(BODY_STATE, me)?.fatigue ?? 0),
      pain: 0,
      trust: side(feel.trust),
      affection: side(feel.affection),
      believesKnown: 0,
      insight: unit(0.5 + 0.5 * clampTemper(z["perception"] ?? 0)),
    },
    skill: unit(0.4 + 0.2 * clampTemper(sz["sociability"] ?? 0)),
    salience: KEEP_SALIENCE,
    offered: KEEP_OFFERED,
    ...(own && typeof own.value === "boolean" ? { fact: own.value ? "alive" : "dead" } : {}),
  } as const;
}

/** Constantes sin calibrar del sonsacar: emoción de lo reactivo, cuánto pega un nombre, secreto ofrecido. */
const KEEP_AROUSAL = 0.4;
const KEEP_SALIENCE = 0.8;
const KEEP_OFFERED = 0.5;

/** Constantes sin calibrar de lo que el oyente cree que puede hacer ante una amenaza. */
const THREAT_DEMAND_COST = 0.3;
const THREAT_ESCAPE = 0.4;
const THREAT_HELP_BASE = 0.2;
const THREAT_HELP_EACH = 0.2;
const THREAT_RECOURSE = 0.2;
const INSULT_TRUTH_GUESS = 0.2;
const THREAT_FACE_SEVERITY = 0.5;

/**
 * La demostración reciente de quien amenaza (dialogue §9): una pelea o remate que el oyente
 * recuerda con él y que lo dejó mal (valencia negativa) todavía fresca (saliencia): 0-1.
 */
export function shownBy(
  truth: ReadonlyWorldTruth,
  me: AgentId,
  speaker: AgentId,
  now: Tick,
): number {
  let best = 0;
  for (const s of memoriesAbout(truth.get(MEMORIES, me), speaker, now)) {
    if (s.memory.perceived.kind !== "combat.fight" && s.memory.perceived.kind !== "combat.finish") {
      continue;
    }
    best = Math.max(best, unit(s.salience * Math.max(0, -s.memory.valence)));
  }
  return best;
}
/** Cuánto suma a la vanidad la fuerza de un esquema de valía (sin calibrar). */
const VANITY_SCHEMA = 0.2;

/**
 * Lo que la amenaza, el halago o el insulto dejan en lo que el oyente siente por quien habló
 * (dialogue §9, §10): deltas de la relación y, en el inspector, qué hizo y cuánta cara se jugó.
 */
function regardEffect(
  reply: ReturnType<typeof decideReply>,
  witnesses: number,
): RegardEffect | undefined {
  if (reply.threat) {
    const { verdict, aftermath } = reply.threat;
    return {
      kind: "threat",
      response: verdict.response,
      faceLoss: aftermath.targetFaceLoss,
      vengeful: aftermath.vengeful,
      deltas: {
        fear: aftermath.fearDelta,
        resentment: aftermath.resentmentDelta,
        trust: aftermath.trustDelta,
      },
      // Quien amenaza gana poco de cara si cedieron (threatFaceDelta «obeyed»).
      // Si lo desafían y no cumple en el acto, pierde cara (threatFaceDelta «backed_down»).
      faceGain:
        verdict.response === "yield"
          ? threatFaceDelta("obeyed", witnesses, THREAT_FACE_SEVERITY)
          : verdict.response === "defy"
            ? threatFaceDelta("backed_down", witnesses, THREAT_FACE_SEVERITY)
            : 0,
    };
  }
  if (reply.flattery) {
    return {
      kind: "flattery",
      response: reply.flattery.kind,
      faceLoss: 0,
      vengeful: false,
      deltas: { affection: reply.flattery.warmthDelta, trust: reply.flattery.trustDelta },
    };
  }
  if (reply.accusation) return accusationEffect(reply.accusation, reply.line);
  if (reply.offense) {
    const size = reply.offense.size;
    return {
      kind: "insult",
      response: reply.line,
      faceLoss: size,
      vengeful: false,
      deltas: {
        resentment: INSULT_RESENTMENT * size,
        respect: -INSULT_RESPECT * size,
        affection: -INSULT_AFFECTION * size,
      },
    };
  }
  return undefined;
}

/**
 * Lo que una acusación deja en lo que el oyente siente por quien acusó: como oyente de un tercero
 * confía más si le creyó y menos si olió calumnia o iba sin respaldo; como acusado, según cómo se
 * defendió (dialogue §6).
 */
function accusationEffect(
  a: NonNullable<ReturnType<typeof decideReply>["accusation"]>,
  line: string,
): RegardEffect {
  const base = { kind: "accusation", response: line, faceLoss: 0, vengeful: false } as const;
  if (a.defense) return { ...base, deltas: { ...DEFENSE_DELTAS[a.defense] } };
  const verdict = a.heard?.verdict;
  const trust =
    verdict === "slander"
      ? ACCUSE_TRUST_SLANDER
      : a.unbacked
        ? ACCUSE_TRUST_UNBACKED
        : verdict === "doubt"
          ? 0
          : ACCUSE_TRUST_BELIEVED;
  return { ...base, deltas: { trust } };
}

/** Lo que cada punto de ofensa le saca al afecto y al respeto, y le suma al rencor (sin calibrar). */
const INSULT_RESENTMENT = 0.5;
const INSULT_RESPECT = 0.2;
const INSULT_AFFECTION = 0.3;

/** Lo que el `action.speak` del oyente deja dicho de una amenaza, un halago o un insulto. */
export interface RegardEffect {
  readonly kind: "threat" | "flattery" | "insult" | "accusation";
  readonly response: string;
  readonly faceLoss: number;
  readonly vengeful: boolean;
  readonly deltas: Readonly<Record<string, number>>;
  /** Cara que gana quien habló (amenaza obedecida); no está si no aplica. */
  readonly faceGain?: number;
}

/** Constantes sin calibrar de una profecía que quien habla se inventa o no sabe de dónde salió. */
const SPOKEN_INTENSITY = 0.5;
const SPOKEN_CONVICTION = 0.35;

/**
 * Lo que deja en el `action.speak` del oyente una profecía contada (divination §5): ya deformada
 * por `transmit` con un id de evento provisional (`life.retold` lo corrige con el evento real y
 * la anota en las creencias de los dos). `fresh`: quien habla no sabía de ninguna así, la dice de
 * su cabeza y nace con el evento (método `spoken`).
 */
export interface ToldProphecy {
  readonly speaker: AgentId;
  readonly listener: AgentId;
  readonly verdict: "believed" | "doubted" | "dismissed";
  readonly fresh: boolean;
  /** Lo que quien habla decía antes de contarla (la raíz de una profecía nueva sale de acá). */
  readonly told: HeardProphecy;
  readonly heard: HeardProphecy;
}

/** El evento que todavía no existe cuando se pesa lo contado. */
const PROVISIONAL = 0 as unknown as EventId;

/**
 * La profecía que `speaker` le cuenta a `me` (la que él cree o, si no sabe de ninguna así, la que
 * dice de su cabeza) tal como le llega: credulidad del oyente (curiosidad), confianza en quien
 * cuenta (la relación) y dramatismo de quien cuenta (su reactividad). Undefined si no se entiende
 * de quién es.
 */
function prophecyOf(
  truth: ReadonlyWorldTruth,
  o: ConverseOptions,
  act: Extract<SpeechAct, { kind: "prophesy" }>,
  ctx: { me: AgentId; speaker: AgentId; now: Tick },
  feel: { trust: number },
  z: Readonly<Record<string, number>>,
  rng: ProcessContext["rng"],
): { told: HeardProphecy; heard: HeardProphecy; fresh: boolean } | undefined {
  if (act.about === null) return undefined;
  const { me, speaker, now } = ctx;
  const subject = act.about === "you" ? me : act.about;
  const known = (truth.get(PROPHECY_BELIEFS, speaker)?.items ?? [])
    .filter((p) => p.claim.subject === subject && p.claim.kind === act.claim)
    .sort((a, b) => b.credence - a.credence || (a.id < b.id ? -1 : 1))[0];
  const told =
    known ??
    utter(
      speaker,
      { kind: act.claim, subject, intensity: SPOKEN_INTENSITY },
      "spoken",
      SPOKEN_CONVICTION,
      PROVISIONAL,
      now,
    );
  const curious = clampTemper(z["curiosity"] ?? 0);
  const innate = truth.get(INNATE, speaker);
  const sz = innate
    ? standardize(innate, o.traits, truth.get(PERSON, speaker)?.sex ?? "female")
    : {};
  const hearer = {
    id: me,
    credulity: credulity({ tradition: 0.5 - 0.5 * curious, curiosity: 0.5 + 0.5 * curious }),
    trustInTeller: Math.min(1, Math.max(-1, feel.trust)),
  };
  const drama = unit(0.5 + 0.5 * clampTemper(sz["reactivity"] ?? 0));
  const heard = transmit(told, speaker, hearer, drama, PROVISIONAL, now, rng);
  return { told, heard, fresh: known === undefined };
}

export function converseProcess(o: ConverseOptions): ProcessDef {
  const speak = o.catalog.verb("speak");
  return {
    id: CONVERSE_PROCESS,
    system: "life",
    scope: "agent",
    cadence: { local: "onEvent", scene: "onEvent" },
    representation: "individual",
    phase: "decide",
    reads: [
      PENDING.name,
      OPEN_DEALS.name,
      BELIEFS.name,
      HEARD.name,
      KNOWN_DEEDS.name,
      RUMORS.name,
      OWN_DEEDS.name,
      AMENDS.name,
      RELATIONS.name,
      MIND.name,
      MEMORIES.name,
      INNATE.name,
      CREDIT.name,
      LOANS.name,
      SECRETS.name,
      PROPHECY_BELIEFS.name,
      BODY_STATE.name,
      PERSON.name,
      PERSON_NAME.name,
      LOCATION.name,
      ENTITY.name,
      FACE.name,
      STATUS.name,
      STANDING_BELIEFS.name,
      RELIGIOUS_IDENTITY.name,
    ],
    writes: [PENDING.name, OPEN_DEALS.name, HEARD.name, KNOWN_DEEDS.name, RUMORS.name, FACE.name],
    run(ctx: ProcessContext) {
      const me = ctx.scope as AgentId;
      const pending = ctx.truth.get(PENDING, me);
      const reason = ctx.item?.reason;
      if (!pending || !reason || reason.kind !== "state" || reason.key !== pending.key) return {};
      const truth = ctx.truth;
      const clear = deleteComponent(PENDING, me);
      const speaker = pending.from;
      // Si uno de los dos ya no está, o se separaron, nadie contesta.
      if (!alive(truth, me) || !alive(truth, speaker) || !sameHex(truth, me, speaker)) {
        return { changes: [clear] };
      }
      const home = householdOf(truth, me) as string;
      const larder = home as unknown as HolderRef;
      const goodById = (id: string) => o.goods.find((g) => g.id === id);
      const members = Math.max(
        1,
        truth
          .ids(PERSON)
          .filter((id) => householdOf(truth, id as AgentId) === home && alive(truth, id as AgentId))
          .length,
      );
      const budget = householdFlowsOf(
        truth,
        {
          goods: o.goods,
          ledger: ctx.ledger,
          now: ctx.now,
          day: o.day,
          ...(o.year === undefined ? {} : { year: o.year }),
          incomePerDay: incomeOfHousehold(truth, home, Math.floor(ctx.now / o.day)),
          loans: loansOf(truth, holderAccount(larder)),
          rents: rentsOf(truth, home),
        },
        home,
      );
      // Tratar de usted a quien tiene más rango es una costumbre de la aldea (culture, etiquette).
      const byRank = dominantVariant(villageCulture(truth), "etiquette.address") !== "uniform";
      // Lo que el oyente cree del rango de quien le habla (`STANDING_BELIEFS`), no la verdad:
      // sin lectura no hay deferencia, y el impostor bien vestido recibe el usted (social §3).
      const myRank = rankOf(truth.get(STATUS, me), o.statuses) ?? 0;
      const reading = beliefAbout(truth.get(STANDING_BELIEFS, me), speaker);
      const readRank = reading?.rank;
      const above = byRank && readRank !== undefined && readRank > myRank;
      // Quién es el oyente (temperamento) y qué recuerda de quien le habla (dialogue §5).
      const innate = truth.get(INNATE, me);
      const z = innate ? standardize(innate, o.traits, truth.get(PERSON, me)?.sex ?? "female") : {};
      const theirRank = rankOf(truth.get(STATUS, speaker), o.statuses) ?? 0;
      // Cómo se lo dijeron: la forma del acto, armada por quien habla y juzgada por el oyente.
      const here = truth.get(LOCATION, me)?.space;
      const formed = o.form
        ? formOf(truth, o.form, {
            me,
            speaker,
            text: pending.text,
            now: ctx.now,
            indoor: o.spaces.spaces.find((s) => s.key === here)?.indoor ?? false,
            hearerRank: myRank,
            // Sin lectura del otro se lo supone de su mismo rango (no hay distancia).
            readRank: readRank ?? myRank,
            speakerRank: theirRank,
            speakerReads: beliefAbout(truth.get(STANDING_BELIEFS, speaker), me)?.rank ?? theirRank,
            ...(reading ? { reading } : {}),
            style: pending.style,
          })
        : undefined;
      // La propuesta que dejó planteada con este mismo interlocutor y sigue vigente.
      const stored = truth.get(OPEN_DEALS, me);
      const openWith =
        stored && stored.with === speaker && ctx.now - stored.at <= o.day ? stored : undefined;
      const lexicon = lexiconOf(truth, o, me, speaker);
      // Los términos sueltos de una contraoferta («la mitad», «pero con sal») se leen contra el trato abierto.
      const act = looseCounter(
        pending.text,
        withDeclared(
          understand(pending.text, lexicon, pending.clarity, formed?.spoken),
          pending.declared,
          lexicon,
          pending.clarity,
        ),
        openWith?.deal,
        lexicon,
      );
      const feel = relationship(truth.get(RELATIONS, me), speaker, ctx.now, {
        dims: o.dims,
        bonds: o.bonds,
        schemaStrength: (s) => truth.get(MIND, me)?.schemas[s]?.strength ?? 0,
      }).dims;
      const recollection = recollect(truth.get(MEMORIES, me), speaker, ctx.now);
      // Si le preguntan por alguien, lo que recuerda de esa persona (honestidad del temperamento).
      const recount =
        act.kind === "ask" && act.about !== null
          ? recountOf(truth.get(MEMORIES, me), act.about, ctx.now, {
              honesty: unit(0.5 + 0.35 * clampTemper(z["willpower"] ?? 0)),
              grudge: holdsGrudge(feel, clampTemper(z["reactivity"] ?? 0)),
            })
          : null;
      const prophecy =
        act.kind === "prophesy"
          ? prophecyOf(
              truth,
              o,
              act,
              { me, speaker, now: ctx.now },
              feel,
              z,
              ctx.rng.fork("prophecy", pending.key),
            )
          : undefined;
      const rumor =
        act.kind === "rumor"
          ? rumorOf(
              truth,
              o,
              act,
              { me, speaker, now: ctx.now },
              feel,
              z,
              ctx.rng.fork("hear", pending.key),
            )
          : undefined;
      const hearsayVerdict = rumor
        ? rumor.prev
          ? ("known" as const)
          : rumor.heard.confidence >= BELIEVED_AT
            ? ("believed" as const)
            : rumor.heard.confidence >= 0.1
              ? ("doubted" as const)
              : ("dismissed" as const)
        : undefined;
      const source = act.kind === "source" ? sourceKnown(truth, me, act.about) : undefined;
      const reply = decideReply(
        {
          act,
          speaker,
          listener: me,
          feel,
          ...(hearsayVerdict ? { hearsay: { verdict: hearsayVerdict } } : {}),
          ...(source ? { source } : {}),
          ...(prophecy ? { prophecy: { credence: prophecy.heard.credence } } : {}),
          ...(act.kind === "tell"
            ? {
                detect: detectionOf(
                  truth,
                  o,
                  act,
                  { me, speaker, now: ctx.now },
                  feel,
                  recollection,
                  z,
                ),
              }
            : {}),
          ...(act.kind === "threaten" || act.kind === "flatter" || act.kind === "insult"
            ? {
                regard: regardOf(
                  truth,
                  { me, speaker, now: ctx.now, dealWith: stored?.with },
                  feel,
                  recollection,
                  worstDeed(truth.get(KNOWN_DEEDS, me), speaker) !== undefined,
                  z,
                  // Sin lectura del otro se lo supone de su mismo rango (no hay distancia).
                  Math.max(0, myRank - (readRank ?? myRank)),
                ),
              }
            : {}),
          ...(act.kind === "accuse"
            ? (() => {
                const accuse = accuseOf(truth, o, act, { me, speaker, now: ctx.now }, feel, z);
                return accuse ? { accuse } : {};
              })()
            : {}),
          ...(act.kind === "ask"
            ? (() => {
                const keep = keepOf(truth, o, act, { me, speaker, now: ctx.now }, feel, z);
                return keep ? { keep } : {};
              })()
            : {}),
          ...(recount
            ? { recounted: { tone: recountTone(recount.valence), denied: recount.denied } }
            : {}),
          ...(pending.intended ? { intended: pending.intended } : {}),
          ...(formed && o.form
            ? { formJudge: { taboos: liveTaboos(truth, o.form, ctx.now), input: formed.judge } }
            : {}),
          rankAbove: above,
          temper: {
            warmth: clampTemper(z["warmth"] ?? 0),
            reactivity: clampTemper(z["reactivity"] ?? 0),
          },
          recollection,
          direct: (id) => {
            if (householdOf(truth, id) !== home && !sameSpot(truth, id, me)) return null;
            if (!alive(truth, id)) return { dead: true };
            const at = truth.get(LOCATION, id);
            return { where: o.spaces.spaces.find((s) => s.key === at?.space)?.kind ?? "open" };
          },
          ...(openWith ? { open: openWith.deal, rounds: openWith.rounds } : {}),
          heard: truth.get(HEARD, me)?.claims ?? [],
          owes: owesOf(truth, me, speaker, ctx.now, o.day),
          reproach: worstDeed(truth.get(KNOWN_DEEDS, me), speaker)?.kind ?? null,
          nameOf: (id) => givenName(truth, id) ?? "ese",
          goodName: (id) => goodById(id)?.name ?? id,
          held: (id) => {
            const g = goodById(id);
            if (!g) return 0;
            // Las monedas están en la bolsa de cada uno; los bienes, en la despensa de la casa.
            const holder = g.form === "coin" ? (me as unknown as HolderRef) : larder;
            return ctx.ledger?.balance(holderAccount(holder), goodUnit(g)) ?? 0;
          },
          members,
          // El regateo (contracts §3): otras casas con qué tratar y la cara ante los presentes.
          bargain: {
            alternatives: (id, side) => {
              const g = goodById(id);
              if (!g || !ctx.ledger) return 0;
              const speakerHome = householdOf(truth, speaker);
              const crowd = new Map<string, number>();
              for (const pid of truth.ids(PERSON)) {
                const h = householdOf(truth, pid as AgentId);
                if (h === undefined || h === home || h === speakerHome) continue;
                if (!alive(truth, pid as AgentId)) continue;
                crowd.set(h, (crowd.get(h) ?? 0) + 1);
              }
              const houses = [...crowd].map(([h, n]) => ({
                members: n,
                stock:
                  ctx.ledger?.balance(holderAccount(h as unknown as HolderRef), goodUnit(g)) ?? 0,
              }));
              return alternativesAmong(houses, side, RESERVE_GRAMS_PER_MEMBER, GIFT_GRAMS);
            },
            face: bargainFace(witnessesOf(truth, me, speaker), myRank, theirRank),
          },
          // Una moneda de cobre vale un cobre por pieza (`grams` cuenta piezas): mil por «kilo».
          worth: (id) => {
            const g = goodById(id);
            return g?.form === "coin" ? COIN_WORTH_PER_KILO : (g?.priceCopperPerKg ?? null);
          },
          isCoin: (id) => goodById(id)?.form === "coin",
          // El presupuesto del hogar: cuánto puede gastar sin tocar la comida y cómo está.
          coinCeiling: coinCeilingOf(budget, false),
          standing: standingOf(budget),
          speakerHas: (id) => {
            const g = goodById(id);
            return g
              ? (ctx.ledger?.balance(holderAccount(speaker as unknown as HolderRef), goodUnit(g)) ??
                  0)
              : 0;
          },
          lines: o.lines,
          rng: ctx.rng.fork("reply", pending.key),
        },
        ctx.now,
      );

      const changes: StateChange[] = [clear];
      const weighed =
        recollection.count > 0 ? weighedMemories(truth.get(MEMORIES, me), speaker, ctx.now) : [];
      const counted = recount && reply.line.startsWith("ask.recalled.") ? recount : undefined;
      // El regateo: una contraoferta queda abierta (una ronda más); cualquier otra cosa dicha sobre
      // el trato (aceptar, rechazar, cerrar, rechazar de plano) lo cierra, y uno vencido se descarta.
      if (reply.counter) {
        changes.push(
          setComponent(OPEN_DEALS, me, {
            with: speaker,
            deal: reply.counter,
            at: ctx.now,
            rounds: (openWith?.rounds ?? 0) + 1,
          }),
        );
      } else if (
        truth.get(OPEN_DEALS, me) &&
        (act.kind === "accept" || act.kind === "refuse" || act.kind === "offer")
      ) {
        changes.push(deleteComponent(OPEN_DEALS, me));
      }
      if (reply.accepted) {
        changes.push(setComponent(HEARD, me, hear(truth.get(HEARD, me), reply.accepted)));
      }
      // Lo que soltó entero queda como dicho en quien preguntó (con quién y cuándo, no como verdad).
      if (reply.told) {
        changes.push(setComponent(HEARD, speaker, hear(truth.get(HEARD, speaker), reply.told)));
      }
      // Una acusación creída con hecho citado: el hecho queda como contado (no pisa lo que vio).
      const learned = reply.accusation?.heard?.learned;
      if (learned) {
        changes.push(setComponent(KNOWN_DEEDS, me, learnDeed(truth.get(KNOWN_DEEDS, me), learned)));
      }
      // Un rumor que el personaje pasa: el oyente lo guarda con su salto y, si lo cree, como hecho `told`.
      let rumorEvent: EventDraft | undefined;
      if (rumor) {
        const { heard, told } = rumor;
        changes.push(setComponent(RUMORS, me, keepRumor(truth.get(RUMORS, me), heard)));
        const known = rumorAsKnown(heard, truth.get(KNOWN_DEEDS, me));
        if (known && known !== truth.get(KNOWN_DEEDS, me)) {
          changes.push(setComponent(KNOWN_DEEDS, me, known));
        }
        rumorEvent = {
          kind: RUMOR_TOLD_EVENT,
          actors: [speaker, me],
          place: o.placeOf(truth, me),
          data: {
            deed: heard.root,
            kind: heard.content.kind,
            accused: heard.content.by,
            victim: heard.content.victim,
            // `life.appraise` forma la memoria `told` del oyente desde este evento.
            byCharacter: true,
            hops: told.hops,
            credit: heard.confidence,
          },
          emissions: {},
          causes: [{ kind: "event", event: heard.root as EventId }],
        };
      }
      const good = reply.give ? goodById(reply.give.good) : undefined;
      const regard = regardEffect(reply, witnessesOf(truth, me, speaker));
      // La forma: lo dicho con su registro y tratamiento; la falta le cuesta cara al ofendido (FACE).
      const judged = reply.form;
      const formEffect =
        formed && judged
          ? {
              register: formed.spoken.registerId,
              recipient: formed.spoken.recipient,
              used: formed.spoken.used,
              address: formed.spoken.address,
              words: formed.spoken.words,
              faceLoss: judged.faceLoss,
              slip: judged.register
                ? { norm: judged.register.norm, size: judged.register.size }
                : null,
              taboos: judged.taboos,
              deltas:
                judged.faceLoss > 0
                  ? {
                      resentment: FORM_RESENTMENT * judged.faceLoss,
                      respect: -FORM_RESPECT * judged.faceLoss,
                    }
                  : {},
            }
          : undefined;
      // La cara de quien oye: la falta de forma y la amenaza o el insulto que lo dejó mal parado.
      const lostFace = (judged?.faceLoss ?? 0) + (regard?.faceLoss ?? 0);
      if (lostFace > 0) {
        changes.push(setComponent(FACE, me, adjustFace(truth.get(FACE, me), -lostFace, ctx.now)));
      }
      // La de quien habló: sube si le cedieron; la vergüenza de la ofensa de forma baja abajo.
      let speakerFace = regard?.faceGain ?? 0;
      // La ofensa con causa (social §4): la peor falta de la forma es un evento propio, con el acto
      // de habla como causa; el ofendido decide qué hace (ignorar, reprender, castigar) y quien la
      // cometió pierde cara si se la reprochan.
      const offense = judged && judged.faceLoss > 0 ? worstOffense(judged) : undefined;
      let offenseEvent: EventDraft | undefined;
      if (offense && judged) {
        const face = truth.get(FACE, me)?.value ?? DEFAULT_FACE;
        const response = respondToOffense(offense, {
          offendedRank: myRank,
          believedActorRank: readRank ?? myRank,
          face,
          magnanimity: unit(
            0.5 + 0.25 * (clampTemper(z["warmth"] ?? 0) - clampTemper(z["reactivity"] ?? 0)),
          ),
        });
        if (response !== "ignore") {
          const shame =
            (response === "punish" ? OFFENDER_SHAME_PUNISHED : OFFENDER_SHAME_REBUKED) *
            judged.faceLoss;
          speakerFace -= shame;
        }
        offenseEvent = {
          kind: "social.offense",
          actors: [speaker, me],
          place: o.placeOf(truth, me),
          data: {
            norm: offense.norm,
            size: offense.size,
            gap: offense.gap,
            witnesses: offense.witnesses,
            faceLoss: judged.faceLoss,
            response,
          },
          emissions: {},
          causes: [{ kind: "event", event: draftEvent(0) }],
        };
      }
      if (speakerFace !== 0) {
        changes.push(
          setComponent(FACE, speaker, adjustFace(truth.get(FACE, speaker), speakerFace, ctx.now)),
        );
      }
      // La pregunta por un hecho (law §5): quien pregunta lo hace por uno que conoce y el testigo
      // contesta en `life.testify` (causa: este acto de habla).
      const asked =
        act.kind === "ask" ? deedAsked(truth.get(KNOWN_DEEDS, speaker), act.about, me) : null;
      const inquiryEvent: EventDraft | undefined = asked
        ? {
            kind: INQUIRY_EVENT,
            actors: [speaker, me],
            place: o.placeOf(truth, me),
            data: { deed: asked.event } satisfies InquiryData,
            emissions: {},
            causes: [{ kind: "event", event: draftEvent(0) }],
          }
        : undefined;
      // La acusación y la verdad (law §5): quien acusa de lo que no ocurrió deja una huella propia,
      // con el acto de habla como causa; el inspector la distingue de una acusación cierta.
      const occurred =
        act.kind === "accuse" ? accusationOccurred(truth, act, { me, speaker }) : null;
      const falseAccusationEvent: EventDraft | undefined =
        act.kind === "accuse" && act.accused !== null && occurred === false && reply.accusation
          ? {
              kind: FALSE_ACCUSATION_EVENT,
              actors: [speaker, act.accused === "you" ? me : act.accused],
              place: o.placeOf(truth, me),
              data: {
                deed: act.deed,
                victim: act.victim === "speaker" ? speaker : act.victim,
                certainty: act.certainty,
                heardBy: me,
                unbacked: reply.accusation.unbacked,
              },
              emissions: {},
              causes: [{ kind: "event", event: draftEvent(0) }],
            }
          : undefined;
      const event: EventDraft = {
        kind: "action.speak",
        actors: [me, speaker],
        place: o.placeOf(truth, me),
        outcome: "success",
        data: {
          verb: "speak",
          manner: [],
          margin: null,
          degree: 1,
          failure: null,
          seconds: 0,
          noticedBy: [],
          effect: {
            kind: "speak",
            to: speaker,
            delivered: true,
            clarity: 1,
            text: reply.text,
            reply: reply.line,
            ...(reply.judgement
              ? {
                  judged: {
                    verdict: reply.judgement.verdict,
                    trustDelta: reply.judgement.trustDelta,
                    certain: reply.judgement.correct,
                  },
                }
              : {}),
            ...(regard ? { regard } : {}),
            ...(formEffect ? { form: formEffect } : {}),
            // Lo que pesó de lo recordado se refuerza, y lo contado a quien preguntó queda como
            // memoria suya de segunda mano: lo anota `life.appraise` (único dueño de MEMORIES).
            ...(weighed.length > 0 ? { recalled: weighed } : {}),
            ...(counted ? { recounted: counted } : {}),
            // La acusación y su huella: sin respaldo quien acusa no conocía ningún hecho así.
            ...(reply.accusation
              ? {
                  accusation: {
                    // Solo para el inspector: si lo acusado ocurrió de verdad.
                    truthOf: { occurred },
                    accused: reply.accusation.accused,
                    deed: reply.accusation.kind,
                    unbacked: reply.accusation.unbacked,
                    ...(reply.accusation.heard
                      ? {
                          verdict: reply.accusation.heard.verdict,
                          belief: reply.accusation.heard.belief,
                        }
                      : {}),
                    ...(reply.accusation.defense ? { defense: reply.accusation.defense } : {}),
                  },
                }
              : {}),
            // Una profecía contada: `life.retold` la anota en los dos con el salto en el linaje.
            ...(prophecy && reply.prophecy
              ? {
                  prophecy: {
                    speaker,
                    listener: me,
                    verdict: reply.prophecy.verdict,
                    fresh: prophecy.fresh,
                    told: prophecy.told,
                    heard: prophecy.heard,
                  } satisfies ToldProphecy,
                }
              : {}),
            ...(rumor && reply.rumor
              ? { rumor: { deed: rumor.heard.root, verdict: reply.rumor.verdict } }
              : {}),
            ...(source ? { source: source.kind } : {}),
            // Una promesa que tomó por hecha: `life.pledge` abre el compromiso con este dato.
            // Si es callar, de qué: el secreto de más costo que guarda quien lo oyó (o él mismo).
            ...(reply.pledge
              ? {
                  pledge: reply.pledge.silence
                    ? {
                        ...reply.pledge,
                        about: String(
                          [...(truth.get(SECRETS, me)?.items ?? [])].sort(
                            (a, b) => b.stakes - a.stakes,
                          )[0]?.about ?? me,
                        ),
                        stakes: [...(truth.get(SECRETS, me)?.items ?? [])].reduce(
                          (m, s) => Math.max(m, s.stakes),
                          0,
                        ),
                      }
                    : reply.pledge,
                }
              : {}),
            ...(reply.secret
              ? {
                  keep: {
                    about: reply.secret.about,
                    outcome: reply.secret.result.outcome,
                    chance: reply.secret.result.chance,
                    noticedProbing: reply.secret.result.noticedProbing,
                    trustDelta: reply.secret.result.trustDelta,
                    wariness: reply.secret.result.wariness,
                    tell: reply.secret.result.tell,
                  },
                }
              : {}),
          },
          // Un pedido fiado: el proceso del crédito abre la deuda con este dato.
          ...(reply.give?.credit && good
            ? { credit: { unit: goodUnit(good), grams: reply.give.grams } }
            : {}),
        },
        emissions: { sight: speak?.emissions.sight ?? 0, sound: speak?.emissions.sound ?? 0 },
        causes: [reason],
      };
      // Un trato cerrado: cada parte pasa lo suyo, de despensa a bolsillo y de bolsillo a despensa.
      const swaps: { unit: LedgerUnit; from: HolderRef; to: HolderRef; amount: number }[] = [];
      const mine = larder;
      const yours = speaker as unknown as HolderRef;
      for (const [term, from, to] of [
        [reply.deal?.gives, mine, yours],
        [reply.deal?.gets, yours, mine],
      ] as const) {
        const g = term ? goodById(term.good) : undefined;
        if (!term || !g) continue;
        // Las monedas salen y entran por la bolsa de quien trata, no por la despensa.
        const purse = me as unknown as HolderRef;
        swaps.push({
          unit: goodUnit(g),
          from: g.form === "coin" && from === mine ? purse : from,
          to: g.form === "coin" && to === mine ? purse : to,
          amount: term.grams,
        });
      }
      return {
        changes,
        events: [
          event,
          ...(offenseEvent ? [offenseEvent] : []),
          ...(inquiryEvent ? [inquiryEvent] : []),
          ...(falseAccusationEvent ? [falseAccusationEvent] : []),
          ...(rumorEvent ? [rumorEvent] : []),
        ],
        postings:
          swaps.length > 0
            ? [
                {
                  event: draftEvent(0),
                  transfers: swaps.map((t) => ({
                    unit: t.unit,
                    from: holderAccount(t.from),
                    to: holderAccount(t.to),
                    amount: t.amount,
                  })),
                },
              ]
            : reply.give && good
              ? [
                  {
                    event: draftEvent(0),
                    transfers: [
                      {
                        unit: goodUnit(good),
                        from: holderAccount(larder),
                        to: holderAccount(speaker as unknown as HolderRef),
                        amount: reply.give.grams,
                      },
                    ],
                  },
                ]
              : [],
      };
    },
  };
}

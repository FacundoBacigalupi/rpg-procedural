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
  BELIEFS,
  type Belief,
  BODY_STATE,
  type BondDef,
  beliefAbout,
  beliefConfidenceAt,
  believed,
  type ConceptDef,
  CREDIT,
  type Credit,
  callName,
  clampTemper,
  credulity,
  DEFENSE_DELTAS,
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
  type EventDraft,
  FACE,
  type FormJudgeInput,
  formalityShift,
  type GoodDef,
  goodUnit,
  HEARD,
  type HeardProphecy,
  hear,
  honestyShift,
  INNATE,
  KNOWN_DEEDS,
  type Language,
  type Lexicon,
  LOCATION,
  learnDeed,
  liveBetween,
  MEMORIES,
  MIND,
  normalize,
  OWN_DEEDS,
  PERSON,
  PERSON_NAME,
  PROPHECY_BELIEFS,
  type ProcessContext,
  type ProcessDef,
  type Proposal,
  RELATIONS,
  RELIGIOUS_IDENTITY,
  type ReadonlyWorldTruth,
  type RegisterDef,
  rankOf,
  recipientBetween,
  recollect,
  relationship,
  type ScheduleRequest,
  SECRETS,
  type SpaceGraph,
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
  speechForm,
  spokenTaboos,
  stanceOf,
  standardize,
  type TabooDef,
  type Trait,
  table,
  threatCredibility,
  transmit,
  understand,
  utter,
  villageCulture,
  worstDeed,
} from "../../sim/index.ts";
import { liveTaboos } from "./taboos.ts";

export const CONVERSE_PROCESS = "life.converse";

/** Lo que le dijeron y todavía no contestó (se borra al contestar). */
export interface PendingSpeech {
  readonly from: AgentId;
  readonly text: string;
  readonly clarity: number;
  readonly key: string;
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
  readonly culture: string;
}

/** Lo que la falta de forma le saca al afecto, al respeto y le suma al rencor, por punto de cara (sin calibrar). */
const FORM_RESENTMENT = 0.4;
const FORM_RESPECT = 0.2;
/** Reverencia por los tabúes de quien oye si no tiene fe anotada. */
const DEFAULT_REVERENCE = 0.5;

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
  const recipient = recipientBetween(ctx.speakerRank, ctx.speakerReads, kin);
  const asRecipient = recipientBetween(ctx.readRank, ctx.hearerRank, kin);
  const used = Math.min(
    1,
    Math.max(0, demandedFormality(register, recipient) + formalityShift(norm)),
  );
  const spoken = speechForm(f.language, f.addresses, live, f.culture, {
    register,
    recipient,
    formality: used,
    given: givenName(truth, me) ?? "",
    words: taboos.map((t) => t.concepts),
    knowsTaboos: false,
  });
  const faith = truth.get(RELIGIOUS_IDENTITY, me)?.affiliations[0];
  return {
    spoken,
    judge: {
      register,
      asRecipient,
      speakerKnowsRegister: 1,
      gap: Math.max(0, ctx.hearerRank - ctx.readRank),
      witnesses: witnessesOf(truth, me, speaker),
      hearerReverence: faith ? unit(0.5 * faith.belief + 0.5 * faith.practice) : DEFAULT_REVERENCE,
      speakerKnewTaboos: true,
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
): { changes: StateChange[]; schedule: ScheduleRequest[] } {
  if (!listener.startsWith("agent:") || listener === speaker) {
    return { changes: [], schedule: [] };
  }
  const key = replyKey(speaker, at);
  return {
    changes: [
      setComponent(PENDING, listener, { from: speaker, text: text ?? BARE_ADDRESS, clarity, key }),
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
  const goods = o.goods
    .filter((g) => g.form === "good")
    .map((g) => ({ id: g.id, names: [g.name, g.id] }));
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
 * Lo que el oyente pone para pesar una amenaza, un halago o un insulto (dialogue §9, §10): lo que
 * cree de la capacidad y la disposición de quien habla sale de la relación (miedo, respeto, trato) y
 * de lo vivido y sabido de él; la valentía, el orgullo y la vanidad, del temperamento; los testigos,
 * de la gente que está en el lugar. Sin ley todavía en la aldea: el recurso a la autoridad es chico.
 */
function regardOf(
  truth: ReadonlyWorldTruth,
  ctx: { me: AgentId; speaker: AgentId },
  feel: { fear: number; respect: number; trust: number; familiarity: number },
  recollection: { bias: number },
  reproach: boolean,
  z: Readonly<Record<string, number>>,
  gap: number,
): NonNullable<Parameters<typeof decideReply>[0]["regard"]> {
  const { me, speaker } = ctx;
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
      vanity: unit(0.45 + 0.2 * clampTemper(z["sociability"] ?? 0)),
      excess: 0,
      insight: unit(0.5 + 0.5 * clampTemper(z["perception"] ?? 0)),
      trust: unit(feel.trust),
      motiveKnown: false,
      recent: 0,
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
      stakes: unit(secret.stakes),
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

/**
 * Lo que la amenaza, el halago o el insulto dejan en lo que el oyente siente por quien habló
 * (dialogue §9, §10): deltas de la relación y, en el inspector, qué hizo y cuánta cara se jugó.
 */
function regardEffect(reply: ReturnType<typeof decideReply>): RegardEffect | undefined {
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
      OWN_DEEDS.name,
      AMENDS.name,
      RELATIONS.name,
      MIND.name,
      MEMORIES.name,
      INNATE.name,
      CREDIT.name,
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
    writes: [PENDING.name, OPEN_DEALS.name, HEARD.name, KNOWN_DEEDS.name, FACE.name],
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
      // Tratar de usted a quien tiene más rango es una costumbre de la aldea (culture, etiquette).
      const byRank = dominantVariant(villageCulture(truth), "etiquette.address") !== "uniform";
      // Lo que el oyente cree del rango de quien le habla (`STANDING_BELIEFS`), no la verdad:
      // sin lectura no hay deferencia, y el impostor bien vestido recibe el usted (social §3).
      const myRank = rankOf(truth.get(STATUS, me), o.statuses) ?? 0;
      const readRank = beliefAbout(truth.get(STANDING_BELIEFS, me), speaker)?.rank;
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
          })
        : undefined;
      const act = understand(
        pending.text,
        lexiconOf(truth, o, me, speaker),
        pending.clarity,
        formed?.spoken,
      );
      const feel = relationship(truth.get(RELATIONS, me), speaker, ctx.now, {
        dims: o.dims,
        bonds: o.bonds,
        schemaStrength: (s) => truth.get(MIND, me)?.schemas[s]?.strength ?? 0,
      }).dims;
      const recollection = recollect(truth.get(MEMORIES, me), speaker, ctx.now);
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
      // La propuesta que dejó planteada con este mismo interlocutor y sigue vigente.
      const stored = truth.get(OPEN_DEALS, me);
      const openWith =
        stored && stored.with === speaker && ctx.now - stored.at <= o.day ? stored : undefined;
      const reply = decideReply(
        {
          act,
          speaker,
          listener: me,
          feel,
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
                  { me, speaker },
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
            return g ? (ctx.ledger?.balance(holderAccount(larder), goodUnit(g)) ?? 0) : 0;
          },
          members,
          worth: (id) => goodById(id)?.priceCopperPerKg ?? null,
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
      const good = reply.give ? goodById(reply.give.good) : undefined;
      const regard = regardEffect(reply);
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
      if (judged && judged.faceLoss > 0) {
        changes.push(
          setComponent(FACE, me, adjustFace(truth.get(FACE, me), -judged.faceLoss, ctx.now)),
        );
      }
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
            // La acusación y su huella: sin respaldo quien acusa no conocía ningún hecho así.
            ...(reply.accusation
              ? {
                  accusation: {
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
            // Una promesa que tomó por hecha: `life.pledge` abre el compromiso con este dato.
            ...(reply.pledge ? { pledge: reply.pledge } : {}),
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
        if (term && g) swaps.push({ unit: goodUnit(g), from, to, amount: term.grams });
      }
      return {
        changes,
        events: [event],
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

// La conversación mínima (dialogue §4, §5, §18): cuando el personaje le dice algo a alguien, el
// oyente contesta al terminar de oír. El paso `speak` deja lo dicho en el oyente (`PENDING`) y
// agenda este proceso para cuando termina; acá el oyente lo entiende (léxico, `understand`), lo
// piensa con lo que sabe (`decideReply`) y contesta con un `action.speak` suyo, que el resto del
// juego percibe como cualquier otro. Si pidió algo y le dan, sale del ledger con ese evento.

import {
  type AgentId,
  type Duration,
  type EntityRef,
  type HolderRef,
  holderAccount,
  type PlaceRef,
  type Tick,
} from "../../core/index.ts";
import {
  type ActionCatalog,
  CREDIT,
  type Credit,
  callName,
  decideReply,
  deleteComponent,
  dominantVariant,
  draftEvent,
  ENTITY,
  type EventDraft,
  type GoodDef,
  goodUnit,
  HEARD,
  hear,
  KNOWN_DEEDS,
  type Lexicon,
  LOCATION,
  liveBetween,
  PERSON,
  PERSON_NAME,
  type ProcessContext,
  type ProcessDef,
  type ReadonlyWorldTruth,
  rankOf,
  type ScheduleRequest,
  type SpaceGraph,
  type SpeechLine,
  STATUS,
  type StateChange,
  type StatusDef,
  setComponent,
  table,
  understand,
  villageCulture,
  worstDeed,
} from "../../sim/index.ts";

export const CONVERSE_PROCESS = "life.converse";

/** Lo que le dijeron y todavía no contestó (se borra al contestar). */
export interface PendingSpeech {
  readonly from: AgentId;
  readonly text: string;
  readonly clarity: number;
  readonly key: string;
}

export const PENDING = table<PendingSpeech>("life.pending_speech");

export interface ConverseOptions {
  readonly spaces: SpaceGraph;
  readonly catalog: ActionCatalog;
  readonly goods: readonly GoodDef[];
  readonly statuses: readonly StatusDef[];
  readonly lines: readonly SpeechLine[];
  readonly placeOf: (truth: ReadonlyWorldTruth, who: AgentId) => PlaceRef;
  /** Ticks por día de mundo (los plazos del fiado se cuentan en días). */
  readonly day: Duration;
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
      HEARD.name,
      KNOWN_DEEDS.name,
      CREDIT.name,
      PERSON.name,
      PERSON_NAME.name,
      LOCATION.name,
      ENTITY.name,
    ],
    writes: [PENDING.name, HEARD.name],
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
      const above =
        byRank &&
        (rankOf(truth.get(STATUS, speaker), o.statuses) ?? 0) >
          (rankOf(truth.get(STATUS, me), o.statuses) ?? 0);
      const reply = decideReply(
        {
          act: understand(pending.text, lexiconOf(truth, o, me, speaker), pending.clarity),
          speaker,
          listener: me,
          kin: householdOf(truth, speaker) === home,
          formal: above,
          direct: (id) => {
            if (householdOf(truth, id) !== home && !sameSpot(truth, id, me)) return null;
            if (!alive(truth, id)) return { dead: true };
            const at = truth.get(LOCATION, id);
            return { where: o.spaces.spaces.find((s) => s.key === at?.space)?.kind ?? "open" };
          },
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
          lines: o.lines,
          rng: ctx.rng.fork("reply", pending.key),
        },
        ctx.now,
      );

      const changes: StateChange[] = [clear];
      if (reply.accepted) {
        changes.push(setComponent(HEARD, me, hear(truth.get(HEARD, me), reply.accepted)));
      }
      const good = reply.give ? goodById(reply.give.good) : undefined;
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
          },
          // Un pedido fiado: el proceso del crédito abre la deuda con este dato.
          ...(reply.give?.credit && good
            ? { credit: { unit: goodUnit(good), grams: reply.give.grams } }
            : {}),
        },
        emissions: { sight: speak?.emissions.sight ?? 0, sound: speak?.emissions.sound ?? 0 },
        causes: [reason],
      };
      return {
        changes,
        events: [event],
        postings:
          reply.give && good
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

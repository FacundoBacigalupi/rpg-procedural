// La intención económica se decide sin publicar el trato. act confirma recursos dentro del
// mismo dominio que las acciones económicas; las respuestas y sus efectos nacen del resultado.
import {
  type AgentId,
  type CauseRef,
  canonicalJson,
  type EventId,
  type HolderRef,
  type HouseholdId,
  holderAccount,
  type LedgerUnit,
  type PlaceRef,
  type Tick,
} from "../../core/index.ts";
import {
  deleteComponent,
  draftEvent,
  ENTITY,
  type EventDraft,
  HOUSEHOLD,
  LOCATION,
  PERSON,
  type ProcessContext,
  type ProcessDef,
  type ProcessResult,
  RESERVE_GRAMS_PER_MEMBER,
  type StateChange,
  setComponent,
  table,
  validateSettlement,
} from "../../sim/index.ts";
import { ECONOMIC_SERIAL_DOMAIN, ECONOMIC_SERIAL_GROUP } from "./economic-batch.ts";

export const CONVERSATION_INTENT = table<ConversationIntent>("life.conversation_intent");
export const CONVERSATION_SETTLE_PROCESS = "life.conversation_settle";
export const ECONOMIC_INTENDED_EVENT = "dialogue.economic_intended";

export interface ConversationIntent {
  readonly listener: AgentId;
  readonly speaker: AgentId;
  readonly household: HouseholdId;
  readonly key: string;
  readonly at: Tick;
  readonly originEventId: EventId;
  /** Los drafts de la respuesta futura quedan opacos al resolver drafts de la decisión. */
  readonly payload: string;
  readonly reserveUnits: readonly LedgerUnit[];
  readonly fallback: { readonly line: string; readonly text: string };
}

export function stageEconomicConversation(
  ctx: ProcessContext,
  listener: AgentId,
  speaker: AgentId,
  key: string,
  clear: StateChange,
  result: ProcessResult,
  fallback: ConversationIntent["fallback"],
): ProcessResult {
  const household = ctx.truth.get(PERSON, listener)?.household;
  const response = result.events?.[0];
  if (!household || !response) throw new Error("intención económica sin hogar o respuesta");
  const larder = holderAccount(household as unknown as HolderRef);
  const reserveUnits = [
    ...new Set(
      (result.postings ?? [])
        .flatMap((posting) => posting.transfers)
        .filter((transfer) => transfer.from === larder && !transfer.unit.startsWith("coin:"))
        .map((transfer) => transfer.unit),
    ),
  ].sort();
  return {
    changes: [
      clear,
      setComponent(CONVERSATION_INTENT, listener, {
        listener,
        speaker,
        household,
        key,
        at: ctx.now,
        originEventId: draftEvent(0),
        payload: canonicalJson({
          ...result,
          changes: (result.changes ?? []).filter((change) => change !== clear),
        }),
        reserveUnits,
        fallback,
      }),
    ],
    events: [
      {
        kind: ECONOMIC_INTENDED_EVENT,
        actors: [listener, speaker],
        place: response.place,
        data: {
          reply: (response.data as { effect?: { reply?: string } })?.effect?.reply ?? "economic",
        },
        emissions: {},
        causes: response.causes,
      },
    ],
    schedule: [
      {
        at: ctx.now,
        phase: "act",
        process: CONVERSATION_SETTLE_PROCESS,
        scope: listener,
        reason: { kind: "state", entity: listener, key },
      },
    ],
  };
}

export function conversationSettlementProcess(writes: readonly string[]): ProcessDef {
  return {
    id: CONVERSATION_SETTLE_PROCESS,
    system: "life",
    scope: "agent",
    phase: "act",
    cadence: { local: "onEvent", scene: "onEvent" },
    representation: "individual",
    reads: [CONVERSATION_INTENT.name, ENTITY.name, PERSON.name, HOUSEHOLD.name, LOCATION.name],
    writes: [...new Set([CONVERSATION_INTENT.name, ...writes])],
    serialDomain: ECONOMIC_SERIAL_DOMAIN,
    serialGroup: () => ECONOMIC_SERIAL_GROUP,
    run(ctx) {
      const listener = ctx.scope as AgentId;
      const intent = ctx.truth.get(CONVERSATION_INTENT, listener);
      if (!intent || ctx.item?.reason.kind !== "state" || ctx.item.reason.key !== intent.key)
        return {};
      const prepared = JSON.parse(intent.payload) as ProcessResult;
      const original = prepared.events?.[0];
      if (!original) throw new Error("intención económica sin respuesta guardada");
      const alive = (actor: AgentId) => {
        const entity = ctx.truth.get(ENTITY, actor);
        return entity !== undefined && entity.endedAt === undefined;
      };
      const listenerLocation = ctx.truth.get(LOCATION, listener);
      const speakerLocation = ctx.truth.get(LOCATION, intent.speaker);
      let reason: "dead" | "position" | "holder" | "stock" | "reserve" | undefined;
      if (!alive(listener) || !alive(intent.speaker)) reason = "dead";
      else if (
        !listenerLocation ||
        !speakerLocation ||
        listenerLocation.hex !== speakerLocation.hex
      )
        reason = "position";
      else if (
        ctx.truth.get(PERSON, listener)?.household !== intent.household ||
        !ctx.truth.get(HOUSEHOLD, intent.household)
      )
        reason = "holder";
      const transfers = (prepared.postings ?? []).flatMap((posting) => posting.transfers);
      if (reason === undefined) {
        const members = ctx.truth
          .ids(PERSON)
          .filter(
            (actor) =>
              ctx.truth.get(PERSON, actor)?.household === intent.household &&
              alive(actor as AgentId),
          ).length;
        const check =
          ctx.ledger && transfers.length > 0
            ? validateSettlement(
                ctx.ledger,
                transfers,
                intent.reserveUnits.map((unit) => ({
                  account: holderAccount(intent.household as unknown as HolderRef),
                  unit,
                  minimum: Math.max(1, members) * RESERVE_GRAMS_PER_MEMBER,
                })),
              )
            : undefined;
        if (!check) reason = "stock";
        else if (!check.allowed) reason = check.shortages[0]?.reason ?? "stock";
      }
      const cause: CauseRef = { kind: "event", event: intent.originEventId };
      const consumed = deleteComponent(CONVERSATION_INTENT, listener);
      if (reason === "dead" || reason === "position")
        return {
          changes: [consumed],
          events: [
            {
              kind: "dialogue.economic_cancelled",
              actors: [listener, intent.speaker],
              place: original.place,
              emissions: {},
              causes: [cause],
              data: { reason, decidedAt: intent.at },
            },
          ],
        };
      if (reason !== undefined) {
        const event: EventDraft = {
          kind: "action.speak",
          actors: [listener, intent.speaker],
          place: original.place as PlaceRef,
          outcome: "success",
          emissions: original.emissions,
          causes: [cause, ...original.causes],
          data: {
            verb: "speak",
            manner: [],
            margin: null,
            degree: 1,
            failure: null,
            seconds: 0,
            noticedBy: [],
            economicOutcome: { accepted: false, reason },
            effect: {
              kind: "speak",
              to: intent.speaker,
              delivered: true,
              clarity: 1,
              text: intent.fallback.text,
              reply: intent.fallback.line,
            },
          },
        };
        // No hay efectos de aceptar, crédito ni cierre de una propuesta que sigue sin cumplir.
        return { changes: [consumed], events: [event] };
      }
      return {
        ...prepared,
        changes: [consumed, ...(prepared.changes ?? [])],
        events: (prepared.events ?? []).map((event, index) =>
          index === 0
            ? {
                ...event,
                causes: [cause, ...event.causes],
                data: { ...(event.data as object), economicOutcome: { accepted: true } },
              }
            : event,
        ),
      };
    },
  };
}

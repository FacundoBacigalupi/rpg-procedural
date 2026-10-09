// Ofertas de los NPC al personaje (dialogue §8, contracts §3): una vez por día, el vecino que está
// en el mismo lugar que el personaje y tiene de sobra un bien le propone un trueque por iniciativa
// (le ofrece lo que le sobra a cambio de algo que él tiene a mano y a la casa le falta). Lo dicho
// es un `action.speak` del NPC; el trato queda abierto en `OPEN_DEALS` (del NPC, con el personaje
// como interlocutor) y el personaje lo acepta, lo rechaza o contrapropone como cualquier otro: el
// movimiento de bienes lo hace `life.converse` por el ledger, así que aquí no se mueve nada.

import {
  type AgentId,
  type Duration,
  type HolderRef,
  holderAccount,
  type PlaceRef,
} from "../../core/index.ts";
import {
  type ActionCatalog,
  BASE_MARGIN,
  ENTITY,
  GIFT_GRAMS,
  type GoodDef,
  goodUnit,
  KNOWN_DEEDS,
  LOCATION,
  PERSON,
  type ProcessDef,
  RESERVE_GRAMS_PER_MEMBER,
  type ReadonlyWorldTruth,
  type SpeechLine,
  sayLine,
  setComponent,
  worstDeed,
} from "../../sim/index.ts";
import { OPEN_DEALS } from "./converse.ts";

export const PITCH_PROCESS = "life.pitch";

/** Probabilidad por hora (con el personaje a la vista) de que un vecino con qué ofrecer se acerque con una propuesta (sin calibrar). */
export const PITCH_CHANCE = 0.02;
/** Gramos que ofrece de lo que le sobra. */
export const PITCH_GRAMS = 2 * GIFT_GRAMS;
/** Lo que pide de más sobre el valor de lo que da (sin calibrar). */
export const PITCH_MARGIN = BASE_MARGIN + 0.1;
/** Con menos que esto de sobra no ofrece nada. */
const MIN_SPARE = PITCH_GRAMS;

export interface PitchOptions {
  readonly catalog: ActionCatalog;
  readonly goods: readonly GoodDef[];
  readonly lines: readonly SpeechLine[];
  readonly player: AgentId;
  readonly day: Duration;
  readonly placeOf: (truth: ReadonlyWorldTruth, who: AgentId) => PlaceRef;
}

const alive = (truth: ReadonlyWorldTruth, id: AgentId) =>
  truth.get(ENTITY, id)?.endedAt === undefined;

export function pitchProcess(o: PitchOptions): ProcessDef {
  const speak = o.catalog.verb("speak");
  const tradable = o.goods
    .filter((g) => g.form === "good" && g.priceCopperPerKg !== undefined)
    .sort((a, b) => (a.id < b.id ? -1 : 1));
  return {
    id: PITCH_PROCESS,
    system: "life",
    scope: "agent",
    cadence: { local: "hour", scene: "hour" },
    representation: "individual",
    phase: "decide",
    reads: [OPEN_DEALS.name, PERSON.name, ENTITY.name, LOCATION.name, KNOWN_DEEDS.name],
    writes: [OPEN_DEALS.name],
    run(ctx) {
      const me = ctx.scope as AgentId;
      const you = o.player;
      const ledger = ctx.ledger;
      const truth = ctx.truth;
      if (!ledger || me === you || !alive(truth, me) || !alive(truth, you)) return {};
      const here = truth.get(LOCATION, me);
      const there = truth.get(LOCATION, you);
      if (!here || !there || here.hex !== there.hex || here.space !== there.space) return {};
      const home = truth.get(PERSON, me)?.household;
      if (home === undefined || truth.get(PERSON, you)?.household === home) return {};
      const open = truth.get(OPEN_DEALS, me);
      if (open && ctx.now - open.at <= o.day) return {};
      // A quien le consta que le hizo daño no le ofrece nada.
      if (worstDeed(truth.get(KNOWN_DEEDS, me), you) !== null) return {};
      if (!ctx.rng.chance(PITCH_CHANCE)) return {};

      const larder = home as unknown as HolderRef;
      const members = Math.max(
        1,
        truth.ids(PERSON).filter((id) => {
          return (
            truth.get(PERSON, id as AgentId)?.household === home && alive(truth, id as AgentId)
          );
        }).length,
      );
      const reserve = members * RESERVE_GRAMS_PER_MEMBER;
      const stock = (g: GoodDef) => ledger.balance(holderAccount(larder), goodUnit(g));
      const yours = (g: GoodDef) =>
        ledger.balance(holderAccount(you as unknown as HolderRef), goodUnit(g));

      // Lo que ofrece: lo que más le sobra. Lo que pide: algo que el personaje tiene a mano y a la
      // casa le queda por debajo de la reserva.
      const give = tradable
        .map((g) => ({ g, spare: stock(g) - reserve }))
        .filter((s) => s.spare >= MIN_SPARE)
        .sort(
          (a, b) => b.spare * (b.g.priceCopperPerKg ?? 0) - a.spare * (a.g.priceCopperPerKg ?? 0),
        )[0];
      if (!give) return {};
      const giveValue = (PITCH_GRAMS / 1000) * (give.g.priceCopperPerKg ?? 0);
      const want = tradable
        .filter((g) => g.id !== give.g.id && stock(g) < reserve)
        .map((g) => ({
          g,
          grams:
            Math.ceil(((giveValue * (1 + PITCH_MARGIN)) / (g.priceCopperPerKg ?? 1)) * 100) * 10,
        }))
        .filter((w) => w.grams > 0 && yours(w.g) >= w.grams)
        .sort((a, b) => (a.g.id < b.g.id ? -1 : 1))[0];
      if (!want) return {};

      const text = sayLine(
        o.lines,
        "offer.pitch",
        {
          give: give.g.name,
          kilos: String(Math.round(PITCH_GRAMS / 100) / 10),
          want: want.g.name,
          wantKilos: String(Math.round(want.grams / 100) / 10),
        },
        ctx.rng.fork("pitch"),
      );
      return {
        changes: [
          setComponent(OPEN_DEALS, me, {
            with: you,
            deal: {
              gets: { good: want.g.id, grams: want.grams },
              gives: { good: give.g.id, grams: PITCH_GRAMS },
            },
            at: ctx.now,
            rounds: 0,
          }),
        ],
        events: [
          {
            kind: "action.speak",
            actors: [me, you],
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
                to: you,
                delivered: true,
                clarity: 1,
                text,
                reply: "offer.pitch",
              },
            },
            emissions: { sight: speak?.emissions.sight ?? 0, sound: speak?.emissions.sound ?? 0 },
            causes: [{ kind: "state", entity: me, key: "larder" }],
          },
        ],
      };
    },
  };
}

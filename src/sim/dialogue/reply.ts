// Cómo contesta alguien (dialogue §4, §5): la respuesta sale de lo que el oyente sabe, no de lo
// que es cierto. Sabe de primera mano lo que tiene delante; de lo demás, lo que le contaron; y si
// no tiene nada, dice que no sabe. Un pedido se concede si hay de sobra después de la reserva de
// la casa y el oyente quiere a quien pide (lee las dimensiones de su relación, no un booleano de
// parentesco: `warmth`, `isFormal`). La función es pura: devuelve qué decir y qué pasa.

import type { AgentId, Rng } from "../../core/index.ts";
import { CREDIT_LIMIT_GRAMS } from "../contracts/index.ts";
import type { DeedKind } from "../law/index.ts";
import type { Vector } from "../relations/index.ts";
import type { SpeechAct } from "./acts.ts";
import type { HeardClaim } from "./knowledge.ts";
import { type Params, type SpeechLine, sayLine } from "./lines.ts";

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
  /** Cómo llama el oyente a `id` y a un bien. */
  readonly nameOf: (id: AgentId) => string;
  readonly goodName: (good: string) => string;
  /** Gramos de `good` que tiene la casa, y cuántos la componen. */
  readonly held: (good: string) => number;
  readonly members: number;
  readonly lines: readonly SpeechLine[];
  readonly rng: Rng;
}

/** Qué tanto quiere el oyente a quien habla: afecto, confianza, gratitud y dependencia. */
export function warmth(f: Vector): number {
  return 0.5 * f.affection + 0.3 * f.trust + 0.1 * f.gratitude + 0.1 * f.dependency;
}

/** Rencor o desconfianza que cierra los pedidos. */
export function holdsGrudge(f: Vector): boolean {
  return f.resentment >= GRUDGE_RESENTMENT || f.trust <= GRUDGE_DISTRUST;
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
}

export function decideReply(i: ReplyInput, at: number): Reply {
  const say = (line: string, params: Params = {}): Reply => ({
    line,
    text: sayLine(i.lines, line, params, i.rng.fork(line), isFormal(i.feel, i.rankAbove)),
  });
  const a = i.act;
  switch (a.kind) {
    case "greet":
      return say(i.reproach ? `greet.cold.${i.reproach}` : "greet");
    case "farewell":
      return say("farewell");
    case "ask": {
      if (a.about === null) return say("ask.unclear");
      const name = i.nameOf(a.about);
      const seen = i.direct(a.about);
      if (seen && "where" in seen) return say(`ask.at.${seen.where}`, { name });
      if (seen) return say("ask.dead", { name });
      const told = i.heard.find((c) => c.about === a.about);
      if (told?.claim === "dead") return say("ask.heard_dead", { name });
      return say("ask.unknown", { name });
    }
    case "tell": {
      const name = i.nameOf(a.about);
      const seen = i.direct(a.about);
      const contradicts = seen !== null && "dead" in seen !== (a.claim === "dead");
      if (contradicts) return say("tell.doubt", { name });
      return {
        ...say(a.claim === "dead" ? "tell.dead" : "tell.alive", { name }),
        accepted: { about: a.about, claim: a.claim, from: i.speaker, at },
      };
    }
    case "request": {
      if (a.good === null) return say("request.unclear");
      const what = i.goodName(a.good);
      if (i.reproach) return say(`request.refuse.${i.reproach}`, { what });
      if (holdsGrudge(i.feel)) return say("request.refuse.grudge", { what });
      const spare = i.held(a.good) - i.members * RESERVE_GRAMS_PER_MEMBER;
      if (warmth(i.feel) >= FREE_GIFT_WARMTH) {
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
    case "other":
      return say("other");
  }
}

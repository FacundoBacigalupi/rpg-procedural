// Cómo contesta alguien (dialogue §4, §5): la respuesta sale de lo que el oyente sabe, no de lo
// que es cierto. Sabe de primera mano lo que tiene delante; de lo demás, lo que le contaron; y si
// no tiene nada, dice que no sabe. Un pedido se concede si hay de sobra después de la reserva de
// la casa y quien pide es de la familia. La función es pura: devuelve qué decir y qué pasa.

import type { AgentId, Rng } from "../../core/index.ts";
import type { DeedKind } from "../law/index.ts";
import type { SpeechAct } from "./acts.ts";
import type { HeardClaim } from "./knowledge.ts";
import { type Params, type SpeechLine, sayLine } from "./lines.ts";

/** Gramos de un bien que se dan de una vez al que lo pide. */
export const GIFT_GRAMS = 500;
/** Gramos por miembro que la casa no regala (la reserva para comer). */
export const RESERVE_GRAMS_PER_MEMBER = 3000;

export interface ReplyInput {
  readonly act: SpeechAct;
  readonly speaker: AgentId;
  readonly listener: AgentId;
  /** De la familia del oyente: puede pedirle sin vergüenza. */
  readonly kin: boolean;
  /** Quien habla está por encima: se le contesta con más cuidado. */
  readonly formal: boolean;
  /** Lo que el oyente sabe de primera mano de `id`: dónde está (clave de lugar) o si murió. */
  readonly direct: (id: AgentId) => { readonly where: string } | { readonly dead: true } | null;
  readonly heard: readonly HeardClaim[];
  /** Lo peor que el oyente sabe que hizo quien habla (law §2): enfría el trato y cierra pedidos. */
  readonly reproach?: DeedKind | null;
  /** Cómo llama el oyente a `id` y a un bien. */
  readonly nameOf: (id: AgentId) => string;
  readonly goodName: (good: string) => string;
  /** Gramos de `good` que tiene la casa, y cuántos la componen. */
  readonly held: (good: string) => number;
  readonly members: number;
  readonly lines: readonly SpeechLine[];
  readonly rng: Rng;
}

export interface Reply {
  /** La clave de la línea que se usó (para tests y para el narrador). */
  readonly line: string;
  readonly text: string;
  /** Un pedido concedido: cuánto de qué sale de la casa del oyente. */
  readonly give?: { readonly good: string; readonly grams: number };
  /** Lo que el oyente toma como dicho (queda en `Heard`, con duda si choca con lo que sabe). */
  readonly accepted?: HeardClaim;
}

export function decideReply(i: ReplyInput, at: number): Reply {
  const say = (line: string, params: Params = {}): Reply => ({
    line,
    text: sayLine(i.lines, line, params, i.rng.fork(line), i.formal),
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
      const spare = i.held(a.good) - i.members * RESERVE_GRAMS_PER_MEMBER;
      if (!i.kin) return say("request.stranger", { what });
      if (spare < GIFT_GRAMS) return say("request.short", { what });
      return { ...say("request.give", { what }), give: { good: a.good, grams: GIFT_GRAMS } };
    }
    case "other":
      return say("other");
  }
}

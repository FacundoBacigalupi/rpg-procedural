// El loop de la CLI (player-loop §3, Fase 1): una línea por turno sobre la sesión compartida con la
// web (`../session.ts`), que es la que parsea, avanza la vida y narra.

import type { LifeStore } from "../../persistence/index.ts";
import { openSession, type SessionOptions } from "../session.ts";

export { HELP, JOURNAL_SHOWN, RECENT_INTENTS, VERSIONS } from "../session.ts";
export type CliOptions = SessionOptions;

export async function runCli(
  lines: AsyncIterable<string>,
  write: (text: string) => void,
  store: LifeStore,
  options: CliOptions,
): Promise<void> {
  const session = await openSession(store, options);
  // La misma pista de frases que la web, antes de cada pedido (play-hint-verbs).
  const prompt = () => {
    const line = session.hint().line;
    return line === "" ? "> " : `(${line})\n> `;
  };
  write(`${session.opening}\n${prompt()}`);
  for await (const line of lines) {
    if (line.trim() === "") {
      write("> ");
      continue;
    }
    const reply = await session.say(line);
    if (reply.end !== undefined) {
      write(`${reply.text}\n`);
      return;
    }
    write(`${reply.text}\n${prompt()}`);
  }
}

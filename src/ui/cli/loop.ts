// El loop de la CLI (player-loop §3, stub de la Fase 0): leer, parsear a mano, avanzar, imprimir.
// Cada turno se guarda entero (plan + estado, todo o nada) y deja antes un snapshot con el hash
// del estado, que es el checkpoint del replay (tooling §3). No hay cargar atrás: si el archivo
// tiene una vida, se sigue esa (player-loop §12).

import { canonicalJson, IdAllocator, type Seed } from "../../core/index.ts";
import { HELP, parseCommand, STUB_ENGINE, StubSession, type StubSetup } from "../../game/index.ts";
import { FORMAT_VERSION, type LifeStore, sha256 } from "../../persistence/index.ts";
import { renderStatus, renderTurn, renderView } from "./render.ts";

export const VERSIONS = { engine: STUB_ENGINE, content: "none", format: FORMAT_VERSION };

export interface CliOptions {
  /** Para una vida nueva; si el archivo ya tiene una, se ignoran. */
  readonly seed: Seed;
  readonly setup: StubSetup;
}

export async function runCli(
  lines: AsyncIterable<string>,
  write: (text: string) => void,
  store: LifeStore,
  options: CliOptions,
): Promise<void> {
  const session = open(store, options, write);
  write(`${renderView(session.view())}\n${renderStatus(session.now, session.view())}\n> `);

  for await (const line of lines) {
    const cmd = parseCommand(line);
    if (cmd.kind === "meta" && cmd.meta === "salir") {
      write("La vida queda guardada.\n");
      return;
    }
    if (cmd.kind === "meta") write(`${HELP}\n`);
    if (cmd.kind === "unknown") write("Eso todavía no se entiende. Escribí «ayuda».\n");
    if (cmd.kind === "plan") {
      const tick = session.now;
      const seq = store.nextPlanSeq();
      store.saveSnapshot(session.state());
      const report = session.turn(cmd.plan, seq);
      store.saveTurn(session.state(), { seq, tick, plan: cmd.plan, sourceTextHash: sha256(line) });
      write(`${renderTurn(report, cmd.plan.verb === "look")}\n`);
      if (report.over) {
        write("Tu vida terminó.\n");
        return;
      }
    }
    write("> ");
  }
}

function open(store: LifeStore, options: CliOptions, write: (text: string) => void): StubSession {
  if (store.hasSave) {
    const saved = store.getMeta("versions");
    if (canonicalJson(saved) !== canonicalJson(VERSIONS)) {
      throw new Error(`la vida guardada es de otra versión: ${canonicalJson(saved)}`);
    }
    const s = store.load();
    write("Seguís donde quedaste.\n");
    return StubSession.resume(store.getMeta("seed") as Seed, { ...s, ids: new IdAllocator(s.ids) });
  }
  const session = StubSession.create(options.seed, options.setup);
  store.setMeta("seed", options.seed);
  store.setMeta("versions", VERSIONS);
  store.setMeta("setup", options.setup);
  store.save(session.state());
  write("Empieza una vida.\n");
  return session;
}

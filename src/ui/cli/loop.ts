// El loop de la CLI (player-loop §3, Fase 1): leer, parsear, armar el plan, avanzar la vida real y
// narrar lo que el personaje percibió. Cada turno se guarda entero (plan + estado, todo o nada) y
// deja antes un snapshot con el hash del estado, que es el checkpoint del replay (tooling §3). No
// hay cargar atrás: si el archivo tiene una vida, se sigue esa (player-loop §12), con el modo con
// que empezó (game-modes §9).
//
// El LLM es opcional (`options.llm`): el parser prueba primero el modelo y cae a la gramática sin
// red, y el narrador cae a las plantillas (narration §11). Sin `llm` todo va por la cadena
// `templates`, así que el juego es el mismo con o sin red.

import {
  type Content,
  canonicalJson,
  IdAllocator,
  Rng,
  type Seed,
  type Tick,
} from "../../core/index.ts";
import {
  AMBIENCE,
  ambienceOf,
  characterPanel,
  inventoryPanel,
  knownEntities,
  LIFE_ENGINE,
  Life,
  type LifeSetup,
  NARRATION_TEMPLATES,
  optionsOf,
  playerView,
  type TurnReport,
} from "../../game/index.ts";
import {
  DEFAULT_NARRATION,
  LlmJobs,
  narrate,
  narrationRequest,
  offlineLlmConfig,
  parseCommand,
  parseIntentOrGrammar,
  parserSetup,
  styleOf,
  TemplateBook,
} from "../../llm/index.ts";
import { FORMAT_VERSION, type LifeStore, sha256 } from "../../persistence/index.ts";
import {
  type ActionPlan,
  type IntentDraft,
  PARSER_EXAMPLES,
  planFromDraft,
} from "../../sim/index.ts";
import {
  elapsed,
  renderCharacter,
  renderInterrupt,
  renderInventory,
  renderJournal,
  renderStatus,
} from "./render.ts";

export const VERSIONS = { engine: LIFE_ENGINE, content: "none", format: FORMAT_VERSION };

export interface CliOptions {
  /** Para una vida nueva; si el archivo ya tiene una, se ignoran. */
  readonly seed: Seed;
  readonly setup: LifeSetup;
  readonly content: Content;
  /** Los trabajos del LLM; sin esto, todo sale de la gramática y las plantillas. */
  readonly llm?: LlmJobs | undefined;
}

/** Cuántas intenciones anteriores ve el parser para entender «otra vez». */
export const RECENT_INTENTS = 3;

/** Cuántas entradas de la bitácora muestra el comando (las últimas). */
export const JOURNAL_SHOWN = 10;

export const HELP = [
  "Escribí lo que hace tu personaje, en tus palabras:",
  "  espero una hora · como · bebo · miro alrededor · voy al río · busco leña",
  "  hablo con mi madre · trabajo en el campo hasta que anochezca · descanso",
  "Fuera del personaje (no pasa el tiempo): personaje, inventario, bitácora, ayuda, salir.",
].join("\n");

export async function runCli(
  lines: AsyncIterable<string>,
  write: (text: string) => void,
  store: LifeStore,
  options: CliOptions,
): Promise<void> {
  const life = open(store, options, write);
  const book = new TemplateBook(options.content.all(NARRATION_TEMPLATES));
  const seed = store.getMeta("seed") as Seed;
  const jobs =
    options.llm ?? new LlmJobs({ config: offlineLlmConfig(), clientFor: () => undefined });
  const catalog = life.world.catalog;
  const parser = parserSetup(catalog, options.content.all(PARSER_EXAMPLES));
  const ambience = options.content.all(AMBIENCE);
  const recent: string[] = [];
  let scene = "";
  const tell = async (report: TurnReport | null, at: Tick): Promise<string> => {
    const view = playerView(life.world, report?.steps ?? [], { intro: report === null });
    const request = narrationRequest(
      view,
      styleOf(DEFAULT_NARRATION, "es"),
      ambienceOf(view.scene, ambience),
    );
    const told = await narrate(jobs, request, {
      templates: book,
      rng: Rng.root(seed).fork("narration", at),
    });
    scene = told.text;
    return told.text;
  };
  const intro = await tell(null, life.now);
  if (store.narrations(1).length === 0) store.appendNarration(life.now, intro);
  write(`${intro}
${renderStatus(life.now)}\n> `);

  for await (const line of lines) {
    if (line.trim() === "") {
      write("> ");
      continue;
    }
    // Los comandos fuera del personaje no pasan por el modelo.
    let draft: IntentDraft | null = parseCommand(line, catalog);
    if (draft?.kind !== "meta") {
      const parsed = await parseIntentOrGrammar(
        jobs,
        parser,
        { text: line, scene, recent },
        catalog,
      );
      draft = parsed.ok ? parsed.draft : null;
    }
    if (draft === null) {
      write("Eso todavía no se entiende. Escribí «ayuda».\n> ");
      continue;
    }
    if (draft.kind === "meta") {
      const text = draft.text ?? "";
      if (/^salir/i.test(text)) {
        write("La vida queda guardada.\n");
        return;
      }
      if (/^personaje/i.test(text)) {
        write(`${renderCharacter(characterPanel(life.world))}\n> `);
        continue;
      }
      if (/^inventario/i.test(text)) {
        write(`${renderInventory(inventoryPanel(life.world))}\n> `);
        continue;
      }
      if (/^bit[aá]cora/i.test(text)) {
        write(`${renderJournal(store.narrations(JOURNAL_SHOWN))}\n> `);
        continue;
      }
      write(`${HELP}\n> `);
      continue;
    }
    if (draft.kind !== "act" && draft.kind !== "plan") {
      write("Eso todavía no lo entiendo como algo que hace tu personaje.\n> ");
      continue;
    }
    const made = planFromDraft(draft, {
      actor: life.player,
      source: "player",
      catalog: life.world.catalog,
      known: knownEntities(life.world),
      clock: life.world.clock,
      causes: [{ kind: "state", entity: life.player, key: "intent" }],
    });
    if (made.kind === "clarify") {
      const labels = made.refs.flatMap((r) =>
        r.resolved.status === "ambiguous" ? r.resolved.clarify.map((o) => o.label) : [],
      );
      write(
        `No queda claro a quién o qué te referís${labels.length ? ` (${labels.join(", ")})` : ""}. Probá de nuevo.\n> `,
      );
      continue;
    }
    if (made.kind === "unknown") {
      write("No sabés de qué hablás: no conocés eso todavía.\n> ");
      continue;
    }
    if (made.kind === "invalid") {
      write(`No se puede armar ese plan (${made.problems.join("; ")}).\n> `);
      continue;
    }
    const plan: ActionPlan = made.plan;
    const tick = life.now;
    const seq = store.nextPlanSeq();
    store.saveSnapshot(life.state());
    const report = life.turn(plan, seq);
    store.saveTurn(life.state(), { seq, tick, plan, sourceTextHash: sha256(line) });
    recent.push(line.trim());
    if (recent.length > RECENT_INTENTS) recent.shift();
    const told = [
      await tell(report, report.to),
      ...(report.interrupt ? [renderInterrupt(report.interrupt)] : []),
    ].join("\n");
    store.appendNarration(report.to, told);
    write(`${told}\n${elapsed(report.to - report.from)}\n${renderStatus(report.to)}\n`);
    if (report.over) {
      write("Tu vida terminó.\n");
      return;
    }
    write("> ");
  }
}

function open(store: LifeStore, options: CliOptions, write: (text: string) => void): Life {
  if (store.hasSave) {
    const saved = store.getMeta("versions");
    if (canonicalJson(saved) !== canonicalJson(VERSIONS)) {
      throw new Error(`la vida guardada es de otra versión: ${canonicalJson(saved)}`);
    }
    const s = store.load();
    write("Seguís donde quedaste.\n");
    const mode = store.getMeta("mode");
    if (mode !== options.setup.game.mode) {
      write(`Esta vida es en modo ${modeName(mode)}: el modo no se cambia a mitad de una vida.\n`);
    }
    const setup = store.getMeta("setup") as LifeSetup;
    return Life.resume(
      store.getMeta("seed") as Seed,
      options.content,
      { ...s, ids: new IdAllocator(s.ids) },
      optionsOf(setup),
    );
  }
  const life = Life.create(options.seed, options.content, optionsOf(options.setup));
  store.setMeta("seed", options.seed);
  store.setMeta("versions", VERSIONS);
  store.setMeta("mode", options.setup.game.mode);
  store.setMeta("setup", options.setup);
  store.save(life.state());
  write(`Empieza una vida en modo ${modeName(options.setup.game.mode)}.\n`);
  return life;
}

function modeName(mode: unknown): string {
  return mode === "novel" ? "novela" : mode === "realistic" ? "realista" : String(mode);
}

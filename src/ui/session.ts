// La sesión de una vida (player-loop §3, Fase 1): leer, parsear, armar el plan, avanzar la vida real y
// narrar lo que el personaje percibió. La comparten la CLI y la web: cada una solo pone la entrada
// y la salida. Cada turno se guarda entero (plan + estado, todo o nada) y deja antes un snapshot con
// el hash del estado, que es el checkpoint del replay (tooling §3). No hay cargar atrás: si el
// archivo tiene una vida, se sigue esa (player-loop §12), con el modo con que empezó (game-modes §9).
//
// El LLM es opcional (`options.llm`): el parser prueba primero el modelo y cae a la gramática sin
// red, y el narrador cae a las plantillas (narration §11). Sin `llm` todo va por la cadena
// `templates`, así que el juego es el mismo con o sin red.

import {
  type AgentId,
  type Content,
  canonicalJson,
  IdAllocator,
  Rng,
  type Seed,
  type Tick,
} from "../core/index.ts";
import {
  AMBIENCE,
  ambienceOf,
  buildChronicle,
  characterPanel,
  inventoryPanel,
  knownEntities,
  LIFE_ENGINE,
  Life,
  type LifeSetup,
  NARRATION_TEMPLATES,
  optionsOf,
  PLAYER,
  playerView,
  type ResumeAnchor,
  renderChronicle,
  type TurnReport,
} from "../game/index.ts";
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
} from "../llm/index.ts";
import { FORMAT_VERSION, type LifeStore, sha256 } from "../persistence/index.ts";
import {
  type ActionPlan,
  callName,
  type IntentDraft,
  LOCATION,
  PARSER_EXAMPLES,
  PERSON_NAME,
  planFromDraft,
} from "../sim/index.ts";
import { INSPECTOR_HELP, inspect } from "../tools/index.ts";
import {
  elapsed,
  renderCharacter,
  renderInterrupt,
  renderInventory,
  renderJournal,
  renderStatus,
} from "./render.ts";

export const VERSIONS = { engine: LIFE_ENGINE, content: "none", format: FORMAT_VERSION };

export interface SessionOptions {
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
  "  guardo el grano en la despensa · compro 2 kilos de grano a mi vecino · vendo grano a mi tío",
  "Fuera del personaje (no pasa el tiempo): personaje, inventario, bitácora, ayuda, salir.",
].join("\n");

/** Lo que dice la sesión ante una línea. `end`: la sesión terminó (el jugador salió o murió). */
export interface Reply {
  readonly text: string;
  readonly end?: "quit" | "dead";
  /** Pasó tiempo en el mundo: los paneles de la web se vuelven a pedir. */
  readonly turn?: boolean;
}

export interface Session {
  readonly life: Life;
  readonly store: LifeStore;
  /** Lo que se muestra al abrir: los avisos y la escena. */
  readonly opening: string;
  say(line: string): Promise<Reply>;
}

export async function openSession(store: LifeStore, options: SessionOptions): Promise<Session> {
  const notices: string[] = [];
  const life = open(store, options, notices);
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
  const opening = `${notices.join("")}${intro}\n${renderStatus(life.now)}`;

  const say = async (line: string): Promise<Reply> => {
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
    if (draft === null) return { text: "Eso todavía no se entiende. Escribí «ayuda»." };
    if (draft.kind === "meta") {
      const text = draft.text ?? "";
      if (/^salir/i.test(text)) return { text: "La vida queda guardada.", end: "quit" };
      if (/^personaje/i.test(text)) return { text: renderCharacter(characterPanel(life.world)) };
      if (/^inventario/i.test(text)) return { text: renderInventory(inventoryPanel(life.world)) };
      if (/^bit[aá]cora/i.test(text)) {
        return { text: renderJournal(store.narrations(JOURNAL_SHOWN)) };
      }
      if (/^(?:abrir el )?(?:inspector|god)\b/i.test(text)) {
        // Mirar la verdad marca la vida (player-loop §11, tooling §5); el estado no cambia.
        store.setMeta("inspected", true);
        const rest = text.replace(/^(?:abrir el )?\S+\s*/i, "");
        return { text: rest === "" ? INSPECTOR_HELP : inspect(life, rest) };
      }
      return { text: HELP };
    }
    if (draft.kind !== "act" && draft.kind !== "plan") {
      return { text: "Eso todavía no lo entiendo como algo que hace tu personaje." };
    }
    const made = planFromDraft(draft, {
      actor: life.player,
      source: "player",
      catalog: life.world.catalog,
      known: knownEntities(life.world),
      clock: life.world.clock,
      causes: [{ kind: "state", entity: life.player, key: "intent" }],
      here: life.world.truth.get(LOCATION, life.player)?.hex,
    });
    if (made.kind === "clarify") {
      const labels = made.refs.flatMap((r) =>
        r.resolved.status === "ambiguous" ? r.resolved.clarify.map((o) => o.label) : [],
      );
      return {
        text: `No queda claro a quién o qué te referís${labels.length ? ` (${labels.join(", ")})` : ""}. Probá de nuevo.`,
      };
    }
    if (made.kind === "unknown") {
      return { text: "No sabés de qué hablás: no conocés eso todavía." };
    }
    if (made.kind === "invalid") {
      return { text: `No se puede armar ese plan (${made.problems.join("; ")}).` };
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
    const text = `${told}\n${elapsed(report.to - report.from)}\n${renderStatus(report.to)}`;
    if (report.over) {
      return {
        text: `${text}\nTu vida terminó.\n\n${endingOf(life, store)}`,
        end: "dead",
        turn: true,
      };
    }
    return { text, turn: true };
  };
  return { life, store, opening, say };
}

/** La crónica final desde la verdad (chronicle §3): lo único que se le muestra de ella al jugador. */
function endingOf(life: Life, store: LifeStore): string {
  const w = life.world;
  const chronicle = buildChronicle(w, w.truth.get(PLAYER, life.player)?.since ?? 0, {
    mode: String(store.getMeta("mode") ?? "realista"),
    inspected: store.getMeta("inspected") === true,
  });
  const nameOf = (id: string) => {
    const n = w.truth.get(PERSON_NAME, id as AgentId);
    return (n && callName(n)) ?? "alguien";
  };
  return renderChronicle(chronicle, w.clock, (id) => w.log.get(id), nameOf);
}

function open(store: LifeStore, options: SessionOptions, notices: string[]): Life {
  if (store.hasSave) {
    const saved = store.getMeta("versions");
    if (canonicalJson(saved) !== canonicalJson(VERSIONS)) {
      throw new Error(`la vida guardada es de otra versión: ${canonicalJson(saved)}`);
    }
    const s = store.load();
    notices.push("Seguís donde quedaste.\n");
    const mode = store.getMeta("mode");
    if (mode !== options.setup.game.mode) {
      notices.push(
        `Esta vida es en modo ${modeName(mode)}: el modo no se cambia a mitad de una vida.\n`,
      );
    }
    const setup = store.getMeta("setup") as LifeSetup;
    return Life.resume(
      store.getMeta("seed") as Seed,
      options.content,
      { ...s, ids: new IdAllocator(s.ids) },
      optionsOf(setup),
      (store.getMeta("anchor") as ResumeAnchor | undefined) ?? undefined,
    );
  }
  const life = Life.create(options.seed, options.content, optionsOf(options.setup));
  store.setMeta("seed", options.seed);
  store.setMeta("versions", VERSIONS);
  store.setMeta("mode", options.setup.game.mode);
  store.setMeta("setup", options.setup);
  store.setMeta("anchor", life.anchor);
  store.save(life.state());
  notices.push(`Empieza una vida en modo ${modeName(options.setup.game.mode)}.\n`);
  return life;
}

function modeName(mode: unknown): string {
  return mode === "novel" ? "novela" : mode === "realistic" ? "realista" : String(mode);
}

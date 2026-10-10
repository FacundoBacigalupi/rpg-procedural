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
  aboutPanel,
  aboutTopicText,
  ambienceOf,
  beliefViewOf,
  believedConcepts,
  bookPanel,
  buildChronicle,
  characterPanel,
  characterVoiceData,
  claimOfText,
  DEFAULT_SUGGESTIONS,
  type EnvironmentItem,
  type EnvironmentMemory,
  environmentPanel,
  hypothesesPanel,
  inventoryPanel,
  knownEntities,
  LIFE_ENGINE,
  Life,
  type LifeSetup,
  lexiconOf,
  NARRATION_TEMPLATES,
  optionsOf,
  PLAYER,
  peoplePanel,
  playerView,
  type ResumeAnchor,
  recapOf,
  renderChronicle,
  type Suggestion,
  suggestions,
  type ThoughtInput,
  type TurnReport,
  thinkOn,
  thoughtInputsOf,
  topicEntity,
  topicText,
  WORLD_LEXICON,
} from "../game/index.ts";
import {
  characterLexicon,
  continuityFor,
  DEFAULT_NARRATION,
  EMPTY_MEMORY,
  LlmJobs,
  type NarrationMemory,
  narrate,
  narrationRequest,
  offlineLlmConfig,
  parseCommand,
  parseIntentOrGrammar,
  parserSetup,
  recurringImages,
  remember,
  styleOf,
  TemplateBook,
  voiceOf,
} from "../llm/index.ts";
import { FORMAT_VERSION, type LifeStore, sha256 } from "../persistence/index.ts";
import {
  type ActionPlan,
  answerClarify,
  assessPlan,
  type ClarifyOption,
  callName,
  clarifyQuestion,
  draftHasVerb,
  INFERENCE_RULES,
  type IntentDraft,
  LOCATION,
  PARSER_EXAMPLES,
  PERSON_NAME,
  planFromDraft,
  renderWarnings,
  STATUSES,
  TRADE_RECIPES,
  unknownNote,
} from "../sim/index.ts";
import {
  INSPECTOR_HELP,
  inspect,
  narrationRejected,
  narratorRepro,
  type ReplayInput,
  replayInputFromStore,
  replayLifeAt,
} from "../tools/index.ts";
import {
  elapsed,
  renderAbout,
  renderBook,
  renderCharacter,
  renderHypotheses,
  renderInterrupt,
  renderInventory,
  renderJournal,
  renderPeople,
  renderRecap,
  renderStatus,
  renderSuggestion,
  renderThinking,
} from "./render.ts";

export const VERSIONS = { engine: LIFE_ENGINE, content: "none", format: FORMAT_VERSION };

export interface SessionOptions {
  /** Para una vida nueva; si el archivo ya tiene una, se ignoran. */
  readonly seed: Seed;
  readonly setup: LifeSetup;
  readonly content: Content;
  /** Los trabajos del LLM; sin esto, todo sale de la gramática y las plantillas. */
  readonly llm?: LlmJobs | undefined;
  /** Opt-in (`--nickname`): el apodo con lugar en el panel del personaje y en la narración; apagado por defecto. */
  readonly nickname?: boolean;
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
  "Fuera del personaje (no pasa el tiempo): personaje, inventario, deudas, gente, hipótesis, bitácora, pensar sobre X, qué sé de X, ayuda, salir.",
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
  /** Las opciones sugeridas de ahora (`all`: todas, para «ver más»). */
  suggested(all?: boolean): Suggestion[];
  /** Juega la opción sugerida con ese id, sin pasar por el parser. */
  choose(id: string): Promise<Reply>;
  /** Lo que se nota del lugar ahora, con la habituación al día. */
  environment(): EnvironmentItem[];
  /** Si el apodo con lugar está encendido (`--nickname`): paneles con fama y apodo, narración que lo cita. */
  readonly nickname: boolean;
}

/** La familia metafísica del mundo (hoy solo xianxia; la elige el seed cuando haya más). */
const WORLD_FAMILY = "xianxia";

/** La clave de `meta` donde se guarda la memoria de continuidad de la narración. */
const MEMORY_META = "narration_memory";

/** La clave de `meta` con la postura de contenerse (skills §9), fuera del hash y del replay. */
const HOLD_STANCE_META = "hold_stance";

/** Desde qué peso un aviso de factibilidad frena el primer intento (los menores se callan). */
const WARN_WEIGHT = 0.5;

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
  const lexicon = lexiconOf(options.content.all(WORLD_LEXICON), WORLD_FAMILY);
  const recent: string[] = [];
  // «Me contengo» suelto (skills §9): mientras esté puesto, los planes que golpean van en modo
  // `hold_back`. Se manda en el borrador (así el replay lo ve igual) y se guarda con la vida, fuera
  // del hash, para retomarla con la misma postura.
  let holdStance = store.getMeta(HOLD_STANCE_META) === true;
  // El plan que ya se avisó (actions §5): si el jugador insiste con lo mismo, se intenta.
  let warned = "";
  // La aclaración que espera respuesta (actions §4): el mismo borrador, los candidatos de la
  // pregunta y los ya descartados. La respuesta elige uno sin reescribir la línea.
  let pending: {
    draft: IntentDraft;
    line: string;
    options: readonly ClarifyOption[];
    dropped: readonly ClarifyOption[];
  } | null = null;
  const habituation: EnvironmentMemory = new Map();
  let attended = false;
  let scene = "";
  // La memoria de continuidad (narration §6) vive con la vida, fuera del estado de la sim: es solo
  // texto que el jugador ya leyó, así que no entra en el hash ni en el replay.
  const savedMemory = store.getMeta(MEMORY_META) as NarrationMemory | undefined;
  let memory: NarrationMemory = savedMemory ?? EMPTY_MEMORY;
  const tell = async (
    report: TurnReport | null,
    at: Tick,
    thinking?: readonly ThoughtInput[],
  ): Promise<string> => {
    const keys = new Map<string, string>();
    const view = playerView(life.world, report?.steps ?? [], {
      intro: report === null && thinking === undefined,
      ...(options.nickname ? { nickname: true } : {}),
      ...(thinking ? { thinking } : {}),
      ...(report ? { heardSince: report.from } : {}),
      heardTrades: options.content.all(TRADE_RECIPES),
      onLabel: (localId, entity) => keys.set(localId, entity),
    });
    const loc = life.world.truth.get(LOCATION, life.player);
    const placeKey =
      loc === undefined
        ? undefined
        : loc.space !== undefined
          ? `space:${loc.space}`
          : `hex:${loc.hex}`;
    // Un recuerdo deformado no se narra con el texto viejo de esa persona (narration §6).
    const hazy = new Set<string>(
      (view.thoughts ?? []).flatMap((t) => (t.hazy && t.about !== undefined ? [t.about] : [])),
    );
    const request = narrationRequest(
      view,
      styleOf(DEFAULT_NARRATION, "es"),
      ambienceOf(view.scene, ambience),
      {
        voice: voiceOf(
          characterVoiceData(
            life.world.truth,
            life.world.skills,
            life.player,
            options.content.all(STATUSES),
          ),
        ),
        vocabulary: characterLexicon(lexicon, believedConcepts(life.world.truth, life.player)),
      },
    );
    const told = await narrate(
      jobs,
      { ...request, continuity: continuityFor(memory, keys, placeKey, hazy) },
      { templates: book, rng: Rng.root(seed).fork("narration", at) },
    );
    // Si el validador rechazó al modelo, queda el paquete para reproducirlo (tooling §9).
    if (narrationRejected(told)) {
      store.setMeta(
        "repro.narrator",
        narratorRepro({
          versions: VERSIONS,
          seed,
          setup: store.getMeta("setup") as LifeSetup,
          plans: store.plans().map((p) => p.plan),
          tick: at,
          request,
          narration: told,
        }),
      );
    }
    // Al retomar, la escena de apertura ya está en la memoria: no se anota dos veces.
    if (thinking === undefined && (report !== null || savedMemory === undefined)) {
      const known = new Map([...keys].filter(([id]) => !hazy.has(id)));
      const motifs = [
        ...request.ambience.filter((line) => told.text.includes(line)),
        ...recurringImages(memory, told.text),
      ];
      memory = remember(memory, {
        marked: told.marked,
        text: told.text,
        keys: known,
        placeKey,
        motifs,
      });
      store.setMeta(MEMORY_META, memory);
    }
    if (thinking === undefined) scene = told.text;
    return told.text;
  };
  const intro = await tell(null, life.now);
  if (store.narrations(1).length === 0) store.appendNarration(life.now, intro);
  // Al retomar una vida, un recuento corto antes de la escena (player-loop §12).
  const back = notices[0]?.startsWith("Seguís") === true ? renderRecap(recapOf(life.world)) : "";
  const opening = `${notices.join("")}${back === "" ? "" : `${back}\n`}${intro}\n${renderStatus(life.now)}`;

  /** Valida el borrador contra lo que el personaje cree, lo juega y cuenta qué pasó. */
  const play = async (
    draft: IntentDraft,
    line: string,
    dropped: readonly ClarifyOption[] = [],
  ): Promise<Reply> => {
    pending = null;
    // Lo que el jugador descartó al aclarar no vuelve a ser candidato.
    const gone = new Set(dropped.map((o) => o.ref));
    const known = knownEntities(life.world).filter((k) => !gone.has(k.ref));
    const made = planFromDraft(draft, {
      actor: life.player,
      source: "player",
      catalog: life.world.catalog,
      known,
      clock: life.world.clock,
      causes: [{ kind: "state", entity: life.player, key: "intent" }],
      here: life.world.truth.get(LOCATION, life.player)?.hex,
    });
    if (made.kind === "clarify") {
      // La pregunta es del personaje: con lo que percibió de cada candidato (actions §4).
      const first = made.refs.find((r) => r.resolved.status === "ambiguous")?.resolved;
      if (first?.status !== "ambiguous") return { text: "¿A cuál te referís?" };
      pending = { draft, line, options: first.clarify, dropped };
      return { text: `${clarifyQuestion(first.clarify)} Contestá con un rasgo o «el primero».` };
    }
    if (made.kind === "unknown") {
      return { text: unknownNote(made.refs.map((r) => r.resolved.desc)) };
    }
    if (made.kind === "invalid") {
      return { text: `No se puede armar ese plan (${made.problems.join("; ")}).` };
    }
    const plan: ActionPlan = made.plan;
    // Factibilidad creída: avisa desde lo que el personaje cree y, si insiste, se intenta.
    const heads = assessPlan(plan, life.world.catalog, beliefViewOf(life.world, known)).filter(
      (w) => w.weight >= WARN_WEIGHT,
    );
    const key = JSON.stringify(plan.root);
    if (heads.length > 0 && warned !== key) {
      warned = key;
      return { text: `${renderWarnings(heads)}. Si igual querés intentarlo, repetilo.` };
    }
    warned = "";
    attended = draft.plan?.kind === "do" && draft.plan.verb === "look";
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

  const say = async (line: string): Promise<Reply> => {
    // Los comandos fuera del personaje no pasan por el modelo.
    let draft: IntentDraft | null = parseCommand(line, catalog);
    if (pending !== null && draft?.kind !== "meta") {
      // Respuesta a la aclaración: elige entre los candidatos y sigue con el mismo borrador.
      const chosen = answerClarify(line, pending.options);
      if (chosen !== undefined) {
        const { draft: again, line: first, options, dropped } = pending;
        return play(again, first, [...dropped, ...options.filter((o) => o.ref !== chosen.ref)]);
      }
      pending = null;
    }
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
      if (text === "contenerse") {
        holdStance = true;
        store.setMeta(HOLD_STANCE_META, true);
        return {
          text: "Vas a pelear conteniéndote, sin mostrar todo tu nivel, hasta que lo sueltes.",
        };
      }
      if (text === "no contenerse") {
        holdStance = false;
        store.setMeta(HOLD_STANCE_META, false);
        return { text: "Vas a pelear con todo lo que tenés." };
      }
      if (/^salir/i.test(text)) return { text: "La vida queda guardada.", end: "quit" };
      if (/^personaje/i.test(text)) {
        const panel = renderCharacter(
          characterPanel(life.world, {
            substances: true,
            ...(options.nickname ? { reputation: true } : {}),
          }),
        );
        return { text: holdStance ? `${panel}\nPeleás conteniéndote.` : panel };
      }
      if (/^inventario/i.test(text)) return { text: renderInventory(inventoryPanel(life.world)) };
      if (/^(?:deudas|libro)/iu.test(text)) return { text: renderBook(bookPanel(life.world)) };
      if (/^(?:gente|personas|creencias)/iu.test(text))
        return { text: renderPeople(peoplePanel(life.world)) };
      if (/^¿?qu[eé] s[eé] (?:yo )?(?:de|sobre|acerca de)/iu.test(text)) {
        // Mirar lo que sabe de alguien no gasta tiempo ni lee la verdad.
        const about = aboutTopicText(text);
        if (about === undefined)
          return { text: "¿De quién o de qué? Por ejemplo: qué sé de mi padre." };
        const ref = topicEntity(about, knownEntities(life.world));
        if (ref === undefined) return { text: "No sabés nada de eso." };
        return { text: renderAbout(aboutPanel(life.world, ref, about)) };
      }
      if (/^(?:recuento|resumen)/iu.test(text)) {
        const recap = renderRecap(recapOf(life.world));
        return { text: recap === "" ? "No hay mucho que recordar todavía." : recap };
      }
      if (/^hip[oó]tesis/i.test(text))
        return { text: renderHypotheses(hypothesesPanel(life.world)) };
      if (/^(?:pens[aá]r?|pienso|reflexion[oa]r?|¿?qu[eé] hago)/iu.test(text)) {
        // Pensar no gasta tiempo: razona sobre lo que cree, no sobre la verdad.
        const about = topicText(text);
        if (about === undefined)
          return { text: "¿Sobre qué querés pensar? Por ejemplo: pensar sobre mi padre." };
        const ref = topicEntity(about, knownEntities(life.world));
        if (ref === undefined) return { text: "No sabés lo bastante de eso como para pensarlo." };
        const name = (id: string) =>
          callName(
            life.world.truth.get(PERSON_NAME, id as AgentId) ?? { language: "", parts: [] },
          ) ?? "alguien";
        const result = thinkOn(life.world, options.content.all(INFERENCE_RULES), ref);
        const thoughts = thoughtInputsOf(result);
        if (thoughts.length === 0) return { text: renderThinking(result, about, name) };
        return { text: await tell(null, life.now, thoughts) };
      }
      if (/^bit[aá]cora/i.test(text)) {
        return { text: renderJournal(store.narrations(JOURNAL_SHOWN)) };
      }
      if (/^(?:abrir el )?(?:inspector|god)\b/i.test(text)) {
        // Mirar la verdad marca la vida (player-loop §11, tooling §5); el estado no cambia.
        store.setMeta("inspected", true);
        const rest = text.replace(/^(?:abrir el )?\S+\s*/i, "");
        const past = (t: number) =>
          replayLifeAt(
            options.content,
            replayInputFromStore(store).input as ReplayInput<LifeSetup, ActionPlan>,
            t,
          );
        return { text: rest === "" ? INSPECTOR_HELP : inspect(life, rest, past) };
      }
      return { text: HELP };
    }
    if (draft.kind !== "act" && draft.kind !== "plan") {
      return { text: "Eso todavía no lo entiendo como algo que hace tu personaje." };
    }
    const idea = ponderIdea(draft);
    if (idea !== undefined && claimOfText(idea) === null) {
      // Suponer gasta tiempo: si no se deja decir con lo que viste, no se empieza.
      return {
        text: "No sabés cómo ponerlo en términos de lo que viste. Probá con la estación, la luna o «no depende de nada».",
      };
    }
    return play(
      holdStance && draftHasVerb(draft.plan, "strike")
        ? { ...draft, manner: [...new Set([...(draft.manner ?? []), "hold_back"])] }
        : draft,
      line,
    );
  };

  const suggested = (all = false) => suggestions(life.world, all ? undefined : DEFAULT_SUGGESTIONS);
  const choose = async (id: string): Promise<Reply> => {
    // Se vuelve a armar la lista: si el cuerpo o la hora cambiaron, la opción puede ya no estar.
    const picked = suggestions(life.world).find((x) => x.id === id);
    pending = null;
    if (picked === undefined) return { text: "Esa opción ya no está." };
    return play(picked.draft, renderSuggestion(picked));
  };
  const environment = () => environmentPanel(life.world, habituation, { attended });
  return {
    life,
    store,
    opening,
    say,
    suggested,
    choose,
    environment,
    nickname: options.nickname === true,
  };
}

/** Lo que el jugador supone, si el borrador es solo eso (un `ponder` suelto). */
function ponderIdea(draft: IntentDraft): string | undefined {
  const plan = draft.plan;
  if (plan?.kind !== "do" || plan.verb !== "ponder") return undefined;
  const arg = plan.args.find((a) => a.role === "about");
  return arg && "text" in arg ? arg.text : undefined;
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

// La configuración de una vida nueva (game-modes §1, player-loop §1-§2): el modo, lo que se pide
// del mundo y, en modo novela, lo que se elige del personaje. Es parte de la entrada del replay
// (tooling §3), como el seed: mismo seed + mismo setup + mismos planes = mismo mundo.
//
// `NewGameSetup` de game-modes §1 también lleva `narration: NarrationPrefs` y `llm: LlmConfig`.
// Esos dos son de la capa `llm` (ARCHITECTURE §5), no cambian el mundo y no van al replay: la UI
// los junta con este setup. Acá vive solo lo que la simulación lee.
//
// Fase 0: el validador de `NovelSetup` está casi vacío. Del personaje se aceptan solo los campos
// simples; el resto (nacimiento, familia, talento, cuerpo, infancia, saberes, objetos, vida
// pasada) y los dedos de oro se rechazan hasta que llegue la fase que los resuelve (ROADMAP),
// para que una configuración vieja nunca diga algo que el mundo ignoró en silencio.

import { contentId, z } from "../../core/index.ts";

export const GameMode = z.enum(["realistic", "novel"]);
export type GameMode = z.infer<typeof GameMode>;

/** Edad en años de juego. */
const Age = z.number().int().min(0).max(10_000);

/** Cómo entra el personaje a su vida (player-loop §2). */
export const EntryMode = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("born"), vignettesFrom: Age }),
  z.strictObject({ kind: z.literal("age"), at: Age }),
]);
export type EntryMode = z.infer<typeof EntryMode>;

/**
 * Restricciones sobre el mundo, nunca sobre el personaje (game-modes §1): la familia de la
 * metafísica, la era y ejes sueltos de la ley en [0, 1]. Lo que no se fija sale del seed.
 */
export const WorldConstraints = z.strictObject({
  family: contentId.optional(),
  era: contentId.optional(),
  axes: z.record(contentId, z.number().min(0).max(1)).optional(),
});
export type WorldConstraints = z.infer<typeof WorldConstraints>;

/** El lugar de la familia en la aldea: el de arriba, el de la mayoría, el que depende (social-structure §1). */
export const FamilyPosition = z.enum(["holder", "common", "dependent"]);
export type FamilyPosition = z.infer<typeof FamilyPosition>;

/**
 * Lo que se puede elegir del personaje (game-modes §2.1): sexo, edad de entrada y posición de la
 * familia se buscan entre los nacimientos de la aldea (§2.2, paso 1). El nombre, la especie, el
 * lugar y el resto esperan a su fase (ROADMAP).
 */
export const CharacterSpec = z.strictObject({
  species: contentId.optional(),
  sex: z.enum(["female", "male"]).optional(),
  name: z.string().trim().min(1).max(60).optional(),
  entryAge: Age.optional(),
  family: z.strictObject({ position: FamilyPosition.optional() }).optional(),
});
export type CharacterSpec = z.infer<typeof CharacterSpec>;

/** Otros agentes con dedo de oro (game-modes §8). */
export const RivalSpec = z.strictObject({
  count: z.number().int().min(0).max(100),
  placement: z.enum(["anywhere", "near", "same_generation"]),
  power: z.enum(["weaker", "similar", "stronger"]),
  /** Nunca: los rivales se descubren como cualquier secreto. */
  knownToPlayer: z.literal(false),
});
export type RivalSpec = z.infer<typeof RivalSpec>;

/** Reglas de la vida (game-modes §9). */
export const LifeRules = z.strictObject({
  saves: z.enum(["one_life", "checkpoints", "free"]),
  deathOutcome: z.enum(["final", "spirit_if_possible"]).optional(),
});
export type LifeRules = z.infer<typeof LifeRules>;

/** Cómo se cuenta una vida en modo novela (game-modes §10). */
export const NovelNarration = z.strictObject({
  tone: z.enum(["realistic", "novel"]),
  systemMessages: z.enum(["bracketed", "voice", "none"]).optional(),
  chapterTitles: z.boolean().optional(),
  revealPanels: z.boolean().optional(),
});
export type NovelNarration = z.infer<typeof NovelNarration>;

export const NovelSetup = z.strictObject({
  character: CharacterSpec,
  /** Los dedos de oro llegan con su fase (game-modes §3-§7): por ahora, ninguno. */
  goldenFingers: z.array(z.unknown()).max(0, "los dedos de oro todavía no existen"),
  rivals: RivalSpec.optional(),
  life: LifeRules,
  narration: NovelNarration,
  preset: contentId.optional(),
});
export type NovelSetup = z.infer<typeof NovelSetup>;

const setupFields = {
  worldConstraints: WorldConstraints.optional(),
  mode: GameMode,
  novel: NovelSetup.optional(),
  entry: EntryMode,
};

/** `novel` va si y solo si el modo es novela. */
function coherent(s: { mode: GameMode; novel?: NovelSetup | undefined }, ctx: z.RefinementCtx) {
  if (s.mode === "novel" && s.novel === undefined) {
    ctx.addIssue({ code: "custom", path: ["novel"], message: "el modo novela necesita `novel`" });
  }
  if (s.mode === "realistic" && s.novel !== undefined) {
    ctx.addIssue({
      code: "custom",
      path: ["novel"],
      message: "el modo realista no lleva `novel`: no se elige nada del personaje",
    });
  }
}

/** Lo que entra al replay junto al seed (se guarda en `meta.setup`). */
export const GameSetup = z.strictObject(setupFields).superRefine(coherent);
export type GameSetup = z.infer<typeof GameSetup>;

/** La configuración entera de la simulación, con su seed. */
export const NewGameSetup = z
  .strictObject({ seed: z.number().int().min(0).max(0xffffffff), ...setupFields })
  .superRefine(coherent);
export type NewGameSetup = z.infer<typeof NewGameSetup>;

export class SetupError extends Error {
  override name = "SetupError";
  readonly problems: readonly string[];

  constructor(problems: readonly string[]) {
    super(`la configuración no es válida:\n- ${problems.join("\n- ")}`);
    this.problems = problems;
  }
}

function parseWith<T>(schema: z.ZodType<T>, raw: unknown): T {
  const parsed = schema.safeParse(raw);
  if (parsed.success) return parsed.data;
  throw new SetupError(
    parsed.error.issues.map((i) => {
      const path = i.path.map(String).join(".");
      return path ? `${path}: ${i.message}` : i.message;
    }),
  );
}

/** Valida un setup (de un archivo, de la CLI, de `meta`); tira `SetupError` con todo lo que falla. */
export function parseGameSetup(raw: unknown): GameSetup {
  return parseWith(GameSetup, raw);
}

export function parseNewGameSetup(raw: unknown): NewGameSetup {
  return parseWith(NewGameSetup, raw);
}

/** Una vida en modo novela sin nada elegido: el mundo decide todo, como en el realista. */
export const EMPTY_NOVEL: NovelSetup = {
  character: {},
  goldenFingers: [],
  life: { saves: "one_life" },
  narration: { tone: "novel" },
};

/** El setup por defecto de cada modo: entrar de adulto joven, sin restricciones sobre el mundo. */
export function defaultGameSetup(mode: GameMode = "realistic"): GameSetup {
  const entry: EntryMode = { kind: "age", at: 16 };
  return mode === "novel" ? { mode, novel: EMPTY_NOVEL, entry } : { mode, entry };
}

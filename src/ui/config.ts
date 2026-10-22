// Los argumentos de una vida, comunes a la CLI y a la web: seed, modo, personaje (modo novela),
// frecuencia, archivo de guardado y el modelo local opcional.

import { randomInt } from "node:crypto";
import {
  assertLifeDependencies,
  defaultGameSetup,
  FULL_PROFILE,
  type GameMode,
  type GameSetup,
  type LifeSetup,
  parseGameSetup,
} from "../game/index.ts";
import {
  LlmConfig,
  LlmJobs,
  type LlmProvider,
  LOCAL_BASE_URLS,
  offlineLlmConfig,
  openAiClientFactory,
} from "../llm/index.ts";

/** Las opciones de `parseArgs` que entiende `lifeConfig`. */
export const LIFE_ARG_OPTIONS = {
  seed: { type: "string" },
  mode: { type: "string", default: "realista" },
  frequency: { type: "string" },
  sex: { type: "string" },
  age: { type: "string" },
  familia: { type: "string" },
  save: { type: "string", default: "saves/vida.sqlite" },
  llm: { type: "string" },
  runtime: { type: "string", default: "ollama" },
  "llm-url": { type: "string" },
  think: { type: "boolean", default: false },
  famine: { type: "boolean", default: false },
  profile: { type: "string" },
  nickname: { type: "boolean", default: false },
  epilogue: { type: "boolean", default: false },
  tech: { type: "boolean", default: false },
} as const;

/** `full` (por defecto desde life-3) o `basic` (sin las opciones opt-in del perfil). */
const PROFILES: readonly string[] = ["full", "basic"];

export interface LifeArgs {
  seed?: string | undefined;
  mode: string;
  frequency?: string | undefined;
  sex?: string | undefined;
  age?: string | undefined;
  familia?: string | undefined;
  save: string;
  llm?: string | undefined;
  runtime: string;
  "llm-url"?: string | undefined;
  think: boolean;
  famine?: boolean | undefined;
  profile?: string | undefined;
  nickname?: boolean | undefined;
  epilogue?: boolean | undefined;
  tech?: boolean | undefined;
}

export interface LifeConfig {
  readonly seed: number;
  readonly setup: LifeSetup;
  readonly llm: LlmJobs | undefined;
  readonly save: string;
  /** `--nickname`: apodo con lugar en paneles y narración (solo vista). */
  readonly nickname: boolean;
  /** `--epilogue`: al morir, el mundo sigue un año sin el personaje y se cuenta qué fue de los suyos. */
  readonly epilogue: boolean;
}

export function lifeConfig(values: LifeArgs): LifeConfig {
  const seed = values.seed === undefined ? randomInt(0, 0xffffffff) : Number(values.seed);
  const frequency = values.frequency === undefined ? undefined : Number(values.frequency);
  if (!Number.isSafeInteger(seed) || seed < 0) throw new Error(`seed inválido: ${values.seed}`);
  const modes: Readonly<Record<string, GameMode>> = { realista: "realistic", novela: "novel" };
  const mode = modes[values.mode];
  if (!mode) throw new Error(`modo inválido: ${values.mode} (realista o novela)`);
  const runtime = values.runtime as keyof typeof LOCAL_BASE_URLS;
  if (!(runtime in LOCAL_BASE_URLS)) throw new Error(`runtime desconocido: ${values.runtime}`);
  if (values.profile !== undefined && !PROFILES.includes(values.profile)) {
    throw new Error(`perfil inválido: ${values.profile} (${PROFILES.join(", ")})`);
  }
  // Una vida nueva nace con el perfil completo (motor life-3, ROADMAP perfil4); `basic` es el mundo
  // mínimo anterior. Queda en el setup guardado: una vida ya empezada conserva el suyo, con o sin perfil.
  const full = values.profile !== "basic";
  if (full) assertLifeDependencies(FULL_PROFILE);
  return {
    seed,
    save: values.save,
    nickname: values.nickname === true,
    epilogue: values.epilogue === true,
    llm: values.llm === undefined ? undefined : llmJobs(values.llm, runtime, values),
    setup: {
      game: gameSetup(values, mode),
      ...(frequency === undefined ? {} : { frequency }),
      ...(values.famine ? { famine: true } : {}),
      ...(full || values.tech ? { life: lifeOptions(full, values.tech === true) } : {}),
    },
  };
}

/** El personaje que se pide en modo novela (game-modes §2.1); en el realista no se elige nada. */
function gameSetup(values: LifeArgs, mode: GameMode): GameSetup {
  const asked = values.sex ?? values.age ?? values.familia;
  if (asked === undefined) return defaultGameSetup(mode);
  if (mode !== "novel") throw new Error("elegir al personaje es del modo novela (--mode novela)");
  const sexes: Record<string, "female" | "male"> = { mujer: "female", hombre: "male" };
  const positions: Record<string, "holder" | "common" | "dependent"> = {
    terrateniente: "holder",
    campesina: "common",
    sirviente: "dependent",
  };
  const sex = values.sex === undefined ? undefined : sexes[values.sex];
  const position = values.familia === undefined ? undefined : positions[values.familia];
  if (values.sex !== undefined && !sex) throw new Error(`--sex: mujer u hombre (${values.sex})`);
  if (values.familia !== undefined && !position) {
    throw new Error(`--familia: terrateniente, campesina o sirviente (${values.familia})`);
  }
  const base = defaultGameSetup("novel");
  return parseGameSetup({
    ...base,
    novel: {
      ...base.novel,
      character: {
        ...(sex ? { sex } : {}),
        ...(values.age === undefined ? {} : { entryAge: Number(values.age) }),
        ...(position ? { family: { position } } : {}),
      },
    },
  });
}

/** Un modelo local residente para el parser y el narrador, con las plantillas detrás. */
function llmJobs(model: string, runtime: keyof typeof LOCAL_BASE_URLS, values: LifeArgs): LlmJobs {
  const local: LlmProvider = {
    kind: "local",
    runtime,
    model,
    grammar: true,
    ...(values.think ? { think: true } : {}),
    ...(values["llm-url"] ? { baseUrl: values["llm-url"] } : {}),
  };
  const chain = [local, { kind: "templates" } as const];
  const config = LlmConfig.parse({
    ...offlineLlmConfig(),
    jobs: { ...offlineLlmConfig().jobs, parser: chain, narrator: chain },
  });
  return new LlmJobs({ config, clientFor: openAiClientFactory({ timeoutMs: 60_000 }) });
}

/** Las opciones de vida de una vida nueva: el perfil completo si no es `basic`, más `--tech` (procesos mortales, technology §1-§2) que queda en `setup.life`. */
function lifeOptions(full: boolean, tech: boolean): LifeSetup["life"] {
  return { ...(full ? structuredClone(FULL_PROFILE) : {}), ...(tech ? { mortalTech: true } : {}) };
}

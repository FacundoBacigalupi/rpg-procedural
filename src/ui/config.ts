// Los argumentos de una vida, comunes a la CLI y a la web: seed, modo, personaje (modo novela),
// frecuencia, archivo de guardado y el modelo local opcional.

import { randomInt } from "node:crypto";
import {
  assertLifeDependencies,
  defaultGameSetup,
  type GameMode,
  type GameSetup,
  type LifeGroup,
  type LifeSetup,
  lifeGroupOptions,
  PROFILE_GROUPS,
  parseGameSetup,
  WORLD_FAMILIES,
} from "../game/index.ts";
import {
  LlmConfig,
  LlmJobs,
  type LlmProvider,
  LOCAL_BASE_URLS,
  offlineLlmConfig,
  openAiClientFactory,
} from "../llm/index.ts";
import { ScenarioLife } from "../sim/index.ts";

/** Las opciones de `parseArgs` que entiende `lifeConfig`. */
export const LIFE_ARG_OPTIONS = {
  seed: { type: "string" },
  mode: { type: "string", default: "realista" },
  world: { type: "string" },
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
  cultivation: { type: "boolean", default: false },
  con: { type: "string" },
  sin: { type: "string" },
} as const;

/** Los grupos de opciones por su nombre en castellano (`--con`, `--sin`, novel-flags-groups-cli). */
export const GROUP_NAMES: Readonly<Record<string, LifeGroup>> = {
  aldea: "village",
  gente: "people",
  vecinos: "npcs",
  economia: "economy",
  cuerpo: "body",
  ganado: "livestock",
  cultivo: "cultivation",
  tecnica: "tech",
};

/** `full` (por defecto desde life-3) o `basic` (sin las opciones opt-in del perfil). */
const PROFILES: readonly string[] = ["full", "basic"];

export interface LifeArgs {
  seed?: string | undefined;
  mode: string;
  world?: string | undefined;
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
  cultivation?: boolean | undefined;
  /** Grupos que se suman, separados por coma (`cultivo,tecnica`). */
  con?: string | undefined;
  /** Grupos que se sacan, separados por coma (`ganado,economia`). */
  sin?: string | undefined;
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
  const options = lifeGroupOptions(lifeGroups(values, full, mode)).options;
  assertLifeDependencies(options);
  // El mismo esquema con que se lee al retomar (`setup.life`).
  const life = ScenarioLife.parse(options);
  return {
    seed,
    save: values.save,
    nickname: values.nickname === true,
    epilogue: values.epilogue === true,
    llm: values.llm === undefined ? undefined : llmJobs(values.llm, runtime, values),
    setup: {
      game: withWorld(gameSetup(values, mode), values.world),
      ...(frequency === undefined ? {} : { frequency }),
      ...(values.famine ? { famine: true } : {}),
      ...(Object.keys(life).length > 0 ? { life } : {}),
    },
  };
}

/**
 * La familia del mundo, elegida al empezar (metaphysics §5): xianxia si no se pide otra. Va en
 * `worldConstraints.family` para que la vida la conserve al retomarla.
 */
function withWorld(game: GameSetup, asked: string | undefined): GameSetup {
  const family = asked ?? WORLD_FAMILIES[0] ?? "xianxia";
  if (!WORLD_FAMILIES.includes(family)) {
    throw new Error(`--world: ${WORLD_FAMILIES.join(", ")} (${asked})`);
  }
  return { ...game, worldConstraints: { ...game.worldConstraints, family } };
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

/** Los nombres de una lista `a,b` de grupos; error si alguno no existe. */
function groupList(flag: string, list: string | undefined): LifeGroup[] {
  if (list === undefined) return [];
  return list
    .split(",")
    .map((n) => n.trim().toLowerCase())
    .filter((n) => n !== "")
    .map((n) => {
      const g = GROUP_NAMES[n];
      if (!g) throw new Error(`--${flag}: ${Object.keys(GROUP_NAMES).join(", ")} (${n})`);
      return g;
    });
}

/**
 * Los grupos de una vida nueva (novel-flags-groups-cli): los del perfil si no es `basic`; el modo
 * novela trae el cultivo; `--tech` y `--cultivation` son atajos de `--con tecnica` y `--con cultivo`;
 * `--sin` saca al final. Si una dependencia vuelve a pedir un grupo sacado, es un error.
 */
export function lifeGroups(values: LifeArgs, full: boolean, mode: GameMode): LifeGroup[] {
  const groups = new Set<LifeGroup>(full ? PROFILE_GROUPS : []);
  if (mode === "novel" || values.cultivation === true) groups.add("cultivation");
  if (values.tech === true) groups.add("tech");
  for (const g of groupList("con", values.con)) groups.add(g);
  const without = groupList("sin", values.sin);
  for (const g of without) groups.delete(g);
  const resolved = lifeGroupOptions([...groups]).groups;
  const back = without.filter((g) => resolved.includes(g));
  if (back.length > 0) {
    const name = (g: LifeGroup) => Object.keys(GROUP_NAMES).find((n) => GROUP_NAMES[n] === g);
    throw new Error(`--sin ${back.map(name).join(",")}: lo piden otros grupos elegidos`);
  }
  return [...resolved];
}

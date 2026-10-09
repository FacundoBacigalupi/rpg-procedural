// Todos los tipos de `content/` que conoce el juego (content/README): quien carga la carpeta
// entera usa esta lista, así una carpeta nueva no rompe a los que no la registraron.

import type { ContentKind } from "../core/index.ts";
import { BIOMES } from "../worldgen/index.ts";
import { ACTIONS, PARSER_EXAMPLES, PLANS } from "./actions/index.ts";
import { BODY_PLANS, FOODS } from "./body/index.ts";
import { PRESSURE_CURVES } from "./causality/index.ts";
import { RECIPES } from "./crafts/index.ts";
import { CULTURE_TRAITS, CULTURES } from "./culture/index.ts";
import { SPEECH_LINES } from "./dialogue/index.ts";
import { DIVINATION_CONCERNS, DIVINATION_METHODS } from "./divination/index.ts";
import { GOODS } from "./economy/index.ts";
import { ELEMENT_SYSTEMS } from "./elements/index.ts";
import { DEMOGRAPHY, TRAITS } from "./family/index.ts";
import { INFERENCE_RULES } from "./knowledge/index.ts";
import {
  ADDRESSES,
  CONCEPTS,
  LANGUAGES,
  REGISTERS,
  TABOOS,
  TONE_CONTRASTS,
} from "./language/index.ts";
import { HABITS_CONTENT, LIFE_STAGES, SCHEMAS, TASTES, VALUES } from "./mind/index.ts";
import { TENURES } from "./property/index.ts";
import { RELATION_BONDS, RELATION_DIMS } from "./relations/index.ts";
import { DOCTRINES, RELIGIONS } from "./religion/index.ts";
import { BUILDING_TYPES, MATERIALS, WORK_TYPES } from "./settlements/index.ts";
import { SKILLS } from "./skills/index.ts";
import { ETIQUETTE, STATUSES } from "./social/index.ts";
import { SCENARIOS, TUNING_TARGETS } from "./tuning/index.ts";

export const CONTENT_KINDS: readonly ContentKind[] = [
  BIOMES,
  TRAITS,
  DEMOGRAPHY,
  SKILLS,
  BODY_PLANS,
  FOODS,
  GOODS,
  PRESSURE_CURVES,
  ACTIONS,
  PLANS,
  PARSER_EXAMPLES,
  MATERIALS,
  BUILDING_TYPES,
  WORK_TYPES,
  LANGUAGES,
  CONCEPTS,
  REGISTERS,
  ADDRESSES,
  TABOOS,
  TONE_CONTRASTS,
  RECIPES,
  STATUSES,
  ETIQUETTE,
  DIVINATION_METHODS,
  DIVINATION_CONCERNS,
  SPEECH_LINES,
  INFERENCE_RULES,
  TENURES,
  CULTURE_TRAITS,
  CULTURES,
  DOCTRINES,
  RELIGIONS,
  ELEMENT_SYSTEMS,
  SCHEMAS,
  VALUES,
  LIFE_STAGES,
  RELATION_DIMS,
  RELATION_BONDS,
  HABITS_CONTENT,
  TASTES,
  SCENARIOS,
  TUNING_TARGETS,
] as readonly ContentKind[];

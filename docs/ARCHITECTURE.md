# Arquitectura

## Las cinco capas

```
Jugador (texto)
   │
   ▼
[LLM: Intent Parser] ── texto → ActionPlan (JSON validado con Zod)
   │
   ▼
[Action Resolution] ── ActionPlan + estado → tiradas → Event[]
   │                         ▲
   ▼                         │ lee
[World Simulation] ◄── [NPC Simulation] (utilidad, memorias, relaciones)
   │
   ▼
[Memory / History] ── eventos persistidos, memorias de NPCs, crónica
   │
   ▼
[LLM: Narrator] ── Event[] + lo que el jugador percibe → prosa
```

El LLM está solo en los extremos. Todo lo del medio es TypeScript puro y determinista.

## Estructura de carpetas (objetivo)

```
src/
  core/          # RNG con seed y sub-streams, IDs, tiempo/calendario, tipos base. Sin dependencias.
  worldgen/      # pipeline de generación: cosmología → geografía → ... → NPCs. Puro.
  sim/           # simulación en curso. Puro.
    world/       # ubicaciones, biomas, recursos, clima, economía
    npc/         # psicología, memoria, relaciones, objetivos, IA de utilidad
    org/         # familias, clanes, sectas, naciones como entidades que actúan
    cultivation/ # reinos, técnicas, afinidades
    actions/     # catálogo de acciones + resolución (tiradas → Event[])
    scheduler/   # avance del tiempo multi-escala y LOD de NPCs (ver docs/systems/simulation.md)
    knowledge/   # qué sabe/cree cada agente (verdad vs creencia)
  llm/           # proveedores (plantillas, local, API), intent parser, narrador, prompts, mock para tests
  persistence/   # SQLite: guardar/cargar mundo, log de eventos
  ui/cli/        # loop de juego en terminal + comandos de debug
  tools/         # sim headless, inspector "god mode" (why, mapa de presiones, contrafácticos), reportes
content/         # datos: biomas, plantas, bestias, reinos, nombres, culturas (validados con Zod)
docs/systems/    # un doc de diseño por sistema
tests/           # además de *.test.ts junto al código
```

Se arranca como **un solo paquete** con estas carpetas. Si crece, se separa en workspaces (`packages/sim`, `apps/cli`, `apps/web`) sin cambiar las reglas de dependencia.

## Reglas de dependencia
- `core` ← `worldgen` ← `sim` ← `llm` / `persistence` ← `ui` / `tools`
- `sim` y `worldgen` nunca importan `llm`, `persistence`, `ui`, ni usan IO, `Math.random`, `Date`.
- Se puede forzar con una regla de ESLint (`no-restricted-imports`).

## Decisiones técnicas
| Tema | Decisión | Por qué |
|---|---|---|
| Lenguaje | TypeScript strict, Node 24 | Tipos fuertes para modelos de datos grandes; Zod para validar salidas del LLM; mismo lenguaje para la futura UI web; Node ya instalado. |
| Tests | Vitest | Rápido, TS nativo, snapshots para determinismo. |
| Persistencia | SQLite (`node:sqlite`) | Un archivo por partida, consultas sobre miles de NPCs, sin servidor. |
| RNG | Implementación propia (p.ej. sfc32/xoshiro) con sub-streams por nombre (`rng.fork("weather")`) | Determinismo y que agregar un sistema no cambie las tiradas de otro. |
| Modelo de datos | Records tipados + sistemas (estilo ECS liviano), entidades por ID | Serializable, fácil de guardar y de inspeccionar. |
| LLM | Proveedor intercambiable por trabajo: plantillas, modelo local (Ollama o similar) o API | Por defecto, modelos abiertos locales: parser de 7-8B con salida restringida a JSON, narrador de 12-14B. API opcional (Claude) por trabajo. Fine-tune propio al terminar el juego. Ver [systems/narration.md](systems/narration.md) §1. |
| LLM en tests | `MockLLM` | La sim se testea sin red ni costo. |
| UI | CLI primero → web (Vite + React) después | Iterar la simulación sin pelear con UI. |

## Contratos clave (borrador)
- `ActionPlan`: `{ goal, duration, steps: [{ verb, target?, manner? }], constraints, risksAccepted }` — `verb` sale de un catálogo cerrado de acciones del simulador (forma completa, como árbol de pasos con condiciones, en [actions.md](systems/actions.md) §3). Si el jugador pide algo fuera del catálogo, el parser lo mapea a lo más cercano o lo rechaza, no lo inventa.
- `Event`: `{ id, time, type, actors, location, outcome, data, emissions, causes }` — `emissions` es el perfil de lo que el evento emite por cada canal sensorial; quién lo percibe y cuánto se calcula como `Percept`s (ver [systems/perception.md](systems/perception.md)). `causes: CauseRef[]` forma el grafo causal (ver [systems/causality.md](systems/causality.md)).
- Toda entidad tiene `originEventId`. Bienes, dinero y qi pasan por un ledger de conservación.
- `Outcome`: `success | partial | failure | failure_unnoticed | failure_suspected | discovered | critical`.
- Narrador recibe solo los `Percept`s del jugador + contexto que el jugador conoce, nunca eventos crudos: todo pasa por `buildPlayerView` (ver [systems/narration.md](systems/narration.md)).

## Herramientas de debug (prioridad alta desde el día 1)
- **Inspector god-mode**: ver la verdad del mundo, un NPC completo, sus memorias y relaciones, por qué tomó una decisión.
- **Sim headless**: `--seed --years N` → reporte (población, muertes, guerras, quién se hizo poderoso). Base para balancear.
- **`why <eventId>`**: recorre el grafo causal hacia atrás.
- **Replay**: re-ejecutar una partida desde seed + log de acciones.

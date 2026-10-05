# rpg-procedural — Simulador de vida de fantasía procedural (xianxia como familia principal)

Juego personal (un solo jugador, para el autor). El jugador escribe en texto libre qué hace su personaje; un mundo simulado resuelve la acción; un LLM interpreta la intención y narra el resultado. Una sola vida: cuando tu alma cruza al ciclo (o se disipa), se termina la partida y queda una crónica. Morir puede dejarte como espíritu si las circunstancias lo permiten (ver spirits.md).

**Preferencia de diseño: cuanto más detalle, mejor**, en todos los sistemas. La escala se maneja con LOD (tiers, agregados), no recortando profundidad.

Documentos de referencia (leer el relevante antes de tocar un sistema):
- [docs/VISION.md](docs/VISION.md) — qué es el juego y sus principios de diseño.
- [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) — capas, carpetas, reglas de dependencia, modelo de datos.
- [docs/ROADMAP.md](docs/ROADMAP.md) — **qué sigue** (sección "Ahora"), fases y estado. Si el usuario pregunta con qué seguir, leer esto. Actualizar al cerrar algo.
- [docs/GIT_WORKFLOW.md](docs/GIT_WORKFLOW.md) — ramas (`main`, `develop`, `feat/*`…), commits, CI, secretos.
- [docs/systems/causality.md](docs/systems/causality.md) — **el modelo causal del mundo. Leerlo antes de tocar cualquier sistema de simulación o worldgen.**
- [docs/systems/heaven-karma.md](docs/systems/heaven-karma.md) — el Cielo como agente-ley, tribulaciones, karma.
- [docs/systems/deep-history.md](docs/systems/deep-history.md) — historia por relevancia (embudo + olvido entre épocas).
- [docs/systems/npc-psychology.md](docs/systems/npc-psychology.md) — temperamento, esquemas, memoria, relaciones, utilidad, demonios internos.
- [docs/systems/schemes.md](docs/systems/schemes.md) — intrigas: NPCs que traman contra otros (planes ocultos sobre creencias).
- [docs/systems/planet-gen.md](docs/systems/planet-gen.md) — generación del planeta: grilla hex, tectónica, clima, biomas, qi derivado de la geología.
- [docs/systems/metaphysics.md](docs/systems/metaphysics.md) — **las leyes de cada mundo varían mucho** (xianxia, magia occidental, pactos, dioses…). El código usa conceptos genéricos (`Essence`, `Practice`, `Law`, `Soul`).
- [docs/systems/living-world.md](docs/systems/living-world.md) — el mundo vivo: desastres, evolución de bestias, culturas, mitos, rutas, conocimiento.
- [docs/systems/spirits.md](docs/systems/spirits.md) — espíritus: almas ancladas, espíritus de lugar y de objetos.
- `docs/systems/<sistema>.md` — diseño de cada sistema (se crea antes de implementarlo).

## Reglas que no se rompen
1. **La IA no es el juego.** El LLM solo (a) traduce texto del jugador a intenciones estructuradas y (b) narra eventos ya resueltos. Nunca decide resultados, nunca crea entidades ni items, nunca modifica el estado.
2. **La simulación es determinista.** Mismo seed + mismas acciones = mismo mundo. Toda aleatoriedad pasa por el RNG con seed (`src/core/rng`), nunca `Math.random()` ni `Date.now()` dentro de la simulación.
3. **`src/sim/**` y `src/worldgen/**` no importan nada de `src/llm`, `src/persistence` ni `src/ui`.** Son TypeScript puro, sin IO.
4. **Verdad vs conocimiento.** El estado real del mundo (`WorldTruth`) está separado de lo que cada NPC/el jugador cree saber. Nunca pasarle al narrador información que el personaje no conoce.
5. **Causalidad.** Nada aparece "porque sí". Toda entidad tiene `originEventId`, todo evento registra `causes`, se conservan bienes/dinero/qi, y no hay tablas de eventos aleatorios: el azar solo elige entre posibilidades que el estado ya permite. La historia es la misma simulación corrida en modo agregado. Ver causality.md.
6. **El mundo no gira alrededor del jugador.** Los NPC y organizaciones actúan aunque el jugador no esté.

## Stack
TypeScript (strict) · Node 24 · npm · Vitest · SQLite (`node:sqlite`) · Zod · Claude API (`@anthropic-ai/sdk`) · CLI primero, UI web (Vite + React) más adelante.

## Comandos
(se completan al crear el scaffold en la Fase 0)
- `npm run typecheck` · `npm test` · `npm run dev` (CLI) · `npm run sim -- --seed 123 --years 50` (simulación headless + reporte)

## Flujo de trabajo por feature
1. Mirar ROADMAP → elegir la siguiente tarea.
2. Si el sistema no tiene `docs/systems/X.md`, escribirlo primero (plan mode).
3. Rama `feat/<nombre>` desde `develop`, tests (incluido uno de determinismo si toca la sim), implementar.
4. `npm run typecheck && npm run lint && npm test`, revisar, PR a `develop` (squash), actualizar ROADMAP.
5. `develop` → `main` solo al cerrar un hito, con tag. Nunca commitear directo a `main` ni `develop`.

## Convenciones
- Código e identificadores en inglés; docs y conversación en español.
- Commits: Conventional Commits (`feat(npc): ...`, `fix(sim): ...`).
- Datos de contenido (biomas, hierbas, reinos de cultivo, nombres) en `content/` como JSON/TS validado con Zod, no hardcodeado en la lógica.

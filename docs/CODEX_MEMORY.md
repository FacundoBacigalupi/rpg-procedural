# Memoria de proyecto y flujo para Codex

Preparada el 2026-10-10 desde el checkout `5408714` (#439).
El usuario pidió entender el repositorio y su documentación, conservar el contexto
para otra sesión y trabajar con un flujo equivalente a Claude Code.
Esta memoria está en el repositorio: no depende de recordar este chat. `AGENTS.md`
indica leerla al iniciar. El progreso vigente siempre se consulta en ROADMAP y
HANDOFF, y se contrasta con Git.

## Qué quiere construir el autor

Un simulador narrativo de vida de fantasía, personal y de un solo jugador,
principalmente xianxia, con familias de leyes procedurales diferentes. El usuario
escribe texto libre; el parser propone una intención estructurada; el mundo
resuelve; el narrador cuenta lo percibido. No hay misión principal ni un director
que invente encuentros para entretener. Profundidad y realismo pesan más que
ritmo o comodidad de juego; puede ser lento. El mundo vive sin el jugador.

Geografía, recursos, historia, cultura, familias, psicología y economía forman una
cadena causal. Ruinas, técnicas, rumores y tesoros tienen procedencia. Las personas
deciden con creencias imperfectas; mentiras, injusticias, errores médicos y malas
guerras emergen de esa separación. Más detalle es deseable: se administra con
tiers y agregados, sin borrar los hechos observados.

Modo realista por defecto: talento oculto, progreso continuo, conocimiento con
fuente y una sola vida. Morir puede dejar un espíritu si hay ancla y sustento;
cruzar/disiparse termina la vida y deja crónica. Ascender también termina la
partida. El modo novela permite personaje condicionado y dedos de oro como
entidades con origen, efectos y costos; mantiene las invariantes del motor.

## Arquitectura recordada

- TypeScript 6 estricto, Node 24 ejecutando `.ts` nativo; npm, Vitest, fast-check,
  Biome, dependency-cruiser, Zod 4, SQLite detrás de interfaz; React/Vite local.
  `package.json` exige `>=24.19.0 <25`; verificar al retomar.
- `core`: RNG, math determinista, ids, tiempo, eventos, ledger y serialización.
  `worldgen`: condiciones iniciales y planeta. `sim`: funciones y procesos puros.
  `game/life`: ensamblaje y cableado de los procesos de una vida. `llm` y
  `persistence`: adaptadores. `ui/session.ts`: sesión compartida CLI/web.
- Scheduler: `perceive → decide → act → physics → settle`. Procesos producen
  diffs, eventos, asientos y programación futura; el scheduler aplica en orden
  canónico y convierte ids provisionales en definitivos.
- ECS liviano: tablas por componente. `AgentId` único para personas, jugador
  incluido; `Item` con identidad frente a `Lot` fungible; tipos compartidos y
  dueños en ARCHITECTURE §4-§5. Metafísica genérica: Essence, Practice, Law, Soul.
- Ledger de doble entrada con cantidades enteras seguras y asientos por evento.
  RNG por contador/clave y math propia; no cambiar valores dorados para ocultar
  una divergencia. Guardado canónico, snapshots, versiones y replay sin LLM.
- Dos ejes LOD: tier del agente 0–4 y resolución de zona. Materialización y
  catch-up respetan hechos fijados. Historia = el mismo scheduler en agregado.
- LLM local residente, inicialmente Qwen3 14B por Ollama compatible con OpenAI;
  plantillas y gramática sin red como fallback. RTX 4070 Super de 12 GB según
  ARCHITECTURE. Este modelo del juego es independiente del modelo de Codex.

## Estado constatado y próximos pasos

Antes de esta preparación, el checkout estaba limpio en `develop`, `5408714`,
último commit #439. Fase 2 cerrada (`v0.2.0` según docs); Fase 3 en curso.
Worktrees g/h/i/j existentes en `C:\dev\rpg-procedural-wt`, todos en ese commit,
con ramas locales `feat/f3-g|h|i|j`. Las refs remotas locales mostraban solo
main/develop: no dar por existentes las ramas remotas que HANDOFF menciona.
`gh pr list` falló por restricción de red; no se verificaron PRs abiertos ni se
actualizaron refs con fetch. Comprobarlos en la próxima sesión con acceso.

HANDOFF informa 2182 tests en 308 archivos y último check completo verde en #433:
es un reporte histórico, no una validación ejecutada en esta sesión.
Muchos sistemas de Fase 3 tienen núcleo puro y cableado opcional; eso no significa
que estén activos, calibrados o terminados en la aldea por defecto.

La decisión pendiente es continuar ítems pequeños opt-in o cerrar Fase 3 después
de clasificar dependencias, verificar y mover pendientes con nombre. No cerrar
la fase automáticamente por ver una parte pura terminada. Ejemplos de límites:

- `combineAuthorities` es puro; cablearlo necesita consejo/puestos de aldea.
- `norms.interest` en la cultura base exige recalibrar hashes.
- `life.accent` y `life.born_taboos_settle` necesitan revisar `withRecent`; cambiar
  ese cableado altera el mundo por defecto.
- Puestos reales, lotes en el suelo, cultivos y tribunales completos no aparecen
  solo por disponer de callbacks opcionales.
- Fiebre puerperal tiene una ventana por madre que puede perderse con catch-up
  de más de dos días; partos vivos y embarazos siguen teniendo dependencias.

Fases siguientes: 4 cultivo y metafísica; 5 región/LOD; 6 organizaciones;
7 historia procedural y misterios; 8 mundo completo, guerra y cosmología;
9 pulido, archivo y fine-tune. Fases 0/1/2 están documentadas como cerradas.

## Cómo reproducir el trabajo de Claude Code

La parte transferible es el protocolo: coordinador, tareas pequeñas, worktrees
aislados, núcleo puro primero, flags opt-in, pruebas por módulo, integración
serial y handoff actualizado. Los settings/permisos de `.claude` no se trasladan
automáticamente a Codex.

El HANDOFF mezcla dos versiones: §2 habla de tres agentes y slots v/w/x; §8 y
«Dónde quedó» del ROADMAP describen cuatro agentes g/h/i/j y un PR por lote.
Usar la versión fechada más reciente para el método, ajustando el tamaño del
lote a la capacidad real. Esta sesión admite cuatro hilos en total: coordinador
más tres agentes. Cuatro tareas pueden hacerse en dos tandas; no prometer cuatro
agentes simultáneos además del líder. Si no hay subagentes, una sesión puede
cumplir ambos roles de forma secuencial.

1. Retomar Git + HANDOFF + Ahora; elegir ítems independientes y cerrables.
2. Preparar worktrees accesibles desde el sandbox, asignar alcance por agente.
   Conservar los existentes hasta verificar que no tienen trabajo pendiente.
3. Agente: doc antes de código, tests puros puntuales, un commit por ítem,
   pendiente como `[ ]`, sin push/merge ni editar los apartados del coordinador.
   Para reducir conflictos en ROADMAP, delimitar apartados o devolver cambios
   exactos al coordinador; nunca repartir modificaciones del mismo párrafo.
4. Coordinador: integrar commits en una rama, revisar dependencia/causalidad y
   actualizar Ahora/HANDOFF; typecheck y lint, una suite amplia por lote de código.
   Suite amplia: `npx.cmd vitest run src/game src/sim src/persistence src/llm src/ui src/tools src/core`.
   Check completo cada ~2 lotes y cierre de fase. Una corrida pesada a la vez.
5. PR a develop con squash según la autorización del trabajo; main solo cierre
   de fase, merge commit con CI y tag. No publicar esta preparación por haber
   pedido solo leer y guardar memoria. No copiar firmas Anthropic a trabajo Codex.

Los comandos de integración son llamadas separadas. El `node_modules` de un
worktree puede ser un junction compartido: no hacer borrados recursivos sin
verificarlo. En PowerShell, `codex.ps1` está bloqueado por execution policy;
`codex.cmd` funciona. Aplicar lo mismo a npm/npx sin cambiar la política global.

## Modelo recomendado para la próxima sesión

Preferencia del usuario al comenzar el trabajo: **GPT-6.1 Sol con razonamiento
Medium como coordinador**, para cuidar el consumo. Delegar tareas pequeñas y
delimitadas a GPT-6 Luna Medium/High (equivalente práctico al rol de Haiku), y
código de simulación complejo a GPT-6.1 Sol Medium (rol de Sonnet). Subir a High
solo si hay dificultades concretas de scheduler, determinismo, ledger o cruces
entre sistemas. Reservar Astra para un bloqueo arquitectónico excepcional.
Estas equivalencias son una estrategia de reparto, no una comparación medida
entre modelos. Evitar duplicar exploración, contexto completo y suites entre
agentes; un brief corto y un reporte de hasta 10 líneas por tarea.
Si no está 6.1 Sol, GPT-6 Sol es la alternativa disponible que conviene comprobar.

Fuentes oficiales consultadas el 2026-10-10:
- [Modelos](https://developers.openai.com/codex/models).
- [Guía GPT-6](https://developers.openai.com/api/docs/guides/latest-model).
- [AGENTS.md](https://developers.openai.com/codex/guides/agents-md): se descubre al iniciar.
- [Subagentes](https://developers.openai.com/codex/multi-agent): delegación,
  modelos y configuración dependen del cliente y de permisos reales.

Se agregó el MCP oficial `openaiDeveloperDocs` mediante `codex.cmd mcp add` para
futuras consultas. Reiniciar el cliente para cargarlo; no estuvo disponible como
herramienta en esta sesión y se consultó la web oficial como fallback.

Mensaje sugerido al abrir una nueva sesión en este repositorio:

> Leé AGENTS.md y retomá desde HANDOFF y Ahora. Trabajemos como con Claude Code:
> usá hasta tres agentes en worktrees para ítems independientes, coordiná la
> integración y corré una sola suite amplia por lote. Mantené pure-first y opt-in.
> Primero verificá qué queda realmente hacible en Fase 3; no cierres la fase ni
> actives cambios por defecto sin resolver sus dependencias y calibración.

## Mapa de los 46 documentos de sistema

Se revisaron la visión, arquitectura, workflow, handoff, las secciones de estado
del ROADMAP y el mapa de principios/secciones de todos los docs de sistema.
Esto no es una auditoría línea por línea de cada especificación ni del código.
Antes de implementar, leer completo el contrato relevante y su estado actual.

| Doc en `docs/systems/` | Contrato que conviene recordar |
|---|---|
| actions.md | Catálogo cerrado, planes abiertos, referencias/factibilidad creídas y ejecución real. |
| body-health.md | Anatomía, reservas, heridas, nutrición, contagio, sustancias; sin HP. |
| causality.md | Origen, conservación, azar condicionado, presiones y grafo causal. |
| chronicle.md | Historia escrita sesgada; crónica final desde verdad, legado y epílogo simulado. |
| combat.md | Pulsos, percepción, alcance, heridas, moral, huida y testigos. |
| contracts.md | Commitment común; términos reales, interpretaciones distintas y ejecutores finitos. |
| cosmology.md | Planos/enlaces, barreras, ascensión y ledger entre planos. |
| crafts.md | Pasos físicos; receta creída, habilidad real, productos desde insumos. |
| cultivation.md | Estado continuo frente a reinos culturales; técnicas y recursos con origen. |
| culture.md | Rasgos en personas, prevalencia, transmisión sesgada y cambio causal. |
| deep-history.md | Embudo de legados, estratos, conservación y arqueología como evidencia. |
| dialogue.md | Actos estructurados; persuasión cambia insumos de utilidad, LLM verbaliza. |
| discovery.md | Hipótesis y evidencia; saber que, saber cómo y comprender son distintos. |
| divination.md | Proyección de presiones, percepción con símbolos y efectos de profecías. |
| economy.md | Lotes y dinero físico; precios subjetivos, tenencias y crédito finitos. |
| elements.md | Una operación interact, cantidades y conservación, no tabla de ventajas. |
| family-lineage.md | Genoma, concepción/parto, hogares, parentesco creído y herencia cultural. |
| game-modes.md | Realista/novela; dedos de oro con origen y efectos aplicados por sim. |
| heaven-karma.md | Libro de verdad; atención finita, tribulaciones físicas y azar acotado. |
| information.md | Creencias con fuentes; rumores deformados y canales físicos. |
| language.md | Fonología/léxico, ramas, registros, nombres y escrituras con historia. |
| law.md | Normas culturales, investigación y juicio sobre creencias; castigar cuesta. |
| living-world.md | Ecología, redes tróficas, sucesión, vectores, migraciones y domesticación. |
| metaphysics.md | Ley generada vs escuelas; motor genérico, familias de poder distintas. |
| mysteries.md | Secuencias, pociones, características conservadas, control, anclas y dioses. |
| narration.md | PlayerView, referencias/whitelist, voz del personaje y fallback sin red. |
| npc-psychology.md | Temperamento, historia, emociones, memoria, relaciones, utilidad y etapas. |
| organizations.md | Personas/puestos/creencias, tesoro finito, facciones y sucesión. |
| perception.md | Única puerta de verdad a creencia; canales, atención y errores con forma. |
| planet-gen.md | Planeta geodésico, tectónica/clima/biomas/esencia y detalle condicionado. |
| player-loop.md | Turno, rutinas, interrupciones percibidas, paneles y una vida. |
| property.md | Posesión, creencia y registro; haz de derechos y ejecutores. |
| religion.md | Doctrina creída frente a ley; prácticas, clero, conversión y dioses según familia. |
| schemes.md | Planes sobre creencias, intrigas trazables y proyectos cooperativos. |
| secret-realms.md | Creador/causa, barrera con energía, contenido con historia y degradación. |
| settlements.md | Anclas, edificios/materiales, deterioro, fuego, mantenimiento y ruinas. |
| simulation.md | Un scheduler, tiers/zonas, materialización, catch-up y contrato agregado. |
| skills.md | Facetas/repertorio/familiaridad; tácito/ explícito, techos, vicios y oxidación. |
| social-structure.md | Posición multidimensional, normas/cara, coerción y movilidad sin menús. |
| spirits.md | Alma/ancla/sustento, ciclo final, ofrendas y cultos como física. |
| state.md | Organización con reclamo territorial, alcance, registros y cadena fiscal. |
| technology.md | Procesos sin árbol, conocimiento vs adopción, difusión y regresión. |
| tooling.md | SQLite, hash/replay, inspector sin escritura, headless y calibración. |
| travel.md | Journey y gasto diario; cruces de entidades existentes, rutas y orientación. |
| war.md | Decisión creída, personas/logística, moral y mando con niebla. |
| weather.md | Sistemas móviles, balance de agua, estaciones y pronóstico desde física. |

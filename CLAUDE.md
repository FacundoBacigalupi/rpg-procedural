# rpg-procedural — Simulador de vida de fantasía procedural (xianxia como familia principal)

Juego personal (un solo jugador, para el autor). El jugador escribe en texto libre qué hace su personaje; un mundo simulado resuelve la acción; un LLM interpreta la intención y narra el resultado. Una sola vida: cuando tu alma cruza al ciclo (o se disipa), se termina la partida y queda una crónica. Morir puede dejarte como espíritu si las circunstancias lo permiten (ver spirits.md).

**Preferencia de diseño: cuanto más detalle, mejor**, en todos los sistemas. La escala se maneja con LOD (tiers, agregados), no recortando profundidad.

Documentos de referencia (leer el relevante antes de tocar un sistema):
- [docs/VISION.md](docs/VISION.md) — qué es el juego y sus principios de diseño.
- [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) — capas, carpetas, reglas de dependencia, modelo de datos.
- [docs/ROADMAP.md](docs/ROADMAP.md) — **qué sigue** (sección "Ahora"), fases y estado. Si el usuario pregunta con qué seguir, leer esto. Actualizar al cerrar algo.
- [docs/GIT_WORKFLOW.md](docs/GIT_WORKFLOW.md) — ramas (`main`, `develop`, `feat/*`…), commits, CI, secretos.
- [docs/systems/causality.md](docs/systems/causality.md) — **el modelo causal del mundo. Leerlo antes de tocar cualquier sistema de simulación o worldgen.** Presiones como objeto (fuentes, umbrales, chispas, descargas), inspector con mapa de presiones, contrafácticos.
- [docs/systems/heaven-karma.md](docs/systems/heaven-karma.md) — el Cielo como agente-ley, tribulaciones, karma, cobro en las Fuentes; atención finita repartida por saliencia, zonas ciegas, tribulación como evento físico que se puede robar, retribución como inclinación acotada de tiradas, mérito (功德), fortuna colectiva (气运) derivada.
- [docs/systems/deep-history.md](docs/systems/deep-history.md) — historia por relevancia (embudo + olvido entre épocas).
- [docs/systems/npc-psychology.md](docs/systems/npc-psychology.md) — temperamento, esquemas, memoria, relaciones, utilidad, demonios internos; etapas de vida con períodos sensibles, salud mental con causa y etiqueta cultural (duelo, depresión, trauma, adicción), declive cognitivo, sentido y pertenencia, multitudes por umbrales, sueño que consolida y sueños, gustos personales generados.
- [docs/systems/schemes.md](docs/systems/schemes.md) — intrigas y proyectos: NPCs que traman contra otros (planes ocultos sobre creencias) o cooperan con versiones distintas del plan; intrigas entre organizaciones; intrigantes que explotan profecías.
- [docs/systems/planet-gen.md](docs/systems/planet-gen.md) — generación del planeta: grilla hex, tectónica, clima, biomas, qi derivado de la geología; después sigue cambiando: glaciaciones y nivel del mar con puentes de tierra, suelos que se agotan, volcanes e inviernos volcánicos, impactos.
- [docs/systems/metaphysics.md](docs/systems/metaphysics.md) — **las leyes de cada mundo varían mucho** (xianxia, magia occidental, pactos, dioses…). El código usa conceptos genéricos (`Essence`, `Practice`, `Law`, `Soul`).
- [docs/systems/living-world.md](docs/systems/living-world.md) — el mundo vivo: desastres, evolución de bestias, culturas, mitos, rutas, conocimiento; ecología con poblaciones y redes tróficas, sucesión y fuego, especies que llegan con un vector (puentes de tierra, rutas comerciales), migraciones con rutas aprendidas, domesticación como proceso, vínculos y contratos con bestias.
- [docs/systems/spirits.md](docs/systems/spirits.md) — espíritus: almas ancladas, espíritus de lugar y de objetos.
- [docs/systems/perception.md](docs/systems/perception.md) — percepción: la única puerta entre la verdad y las creencias (canales, atención, errores, huellas).
- [docs/systems/information.md](docs/systems/information.md) — creencias, rumores y su deformación, medios, mapas como creencia, reputación, secretos.
- [docs/systems/body-health.md](docs/systems/body-health.md) — cuerpo por partes, heridas, enfermedades y contagio, nutrición, sustancias, envejecimiento, medicina, meridianos.
- [docs/systems/cultivation.md](docs/systems/cultivation.md) — cultivo: ley (umbrales reales) vs escuelas (reinos culturales), talento, absorción, rupturas, técnicas como conocimiento, caminos, espíritus.
- [docs/systems/discovery.md](docs/systems/discovery.md) — descubrimiento: hipótesis sobre las leyes con evidencia, experimentos, errores con forma, dogmas y cismas, insights e iluminación (悟), arte con intención, inventar técnicas y recetas.
- [docs/systems/economy.md](docs/systems/economy.md) — economía: bienes como lotes con origen, dinero físico (metal, piedras espirituales, letras), precios que salen de creencias, regateo, comercio por rutas, crédito y usura, subastas, gremios, crisis con causa.
- [docs/systems/elements.md](docs/systems/elements.md) — interacciones elementales: sistema de elementos por mundo, generación/destrucción con inversión por cantidad, una sola operación `interact` con conservación, tensión de mezclas, derivados, campos, cuerpo, teorías culturales.
- [docs/systems/crafts.md](docs/systems/crafts.md) — oficios: sesiones por pasos que resuelve la ley, habilidad (control, sentidos, juicio), materiales con origen, fuegos, alquimia, forja y artefactos, formaciones como grafos sobre el campo, talismanes, oficios mortales, recetas con defectos.
- [docs/systems/organizations.md](docs/systems/organizations.md) — organizaciones: membresía y lealtad, puestos y legitimidad, cómo deciden (asuntos, deliberación, órdenes), facciones emergentes, tesoro finito, maestro y discípulo, relaciones, nacimiento, cismas, sucesión y muerte.
- [docs/systems/contracts.md](docs/systems/contracts.md) — contratos y juramentos: un solo `Commitment` para deudas, vínculos, tratados y pactos; bases (acuerdo, norma, imposición), garantías, ejecutores que leen creencias (y el Cielo y las ataduras que leen la verdad), incumplir y disputar, juramentos y sellos en el alma, herencia.
- [docs/systems/family-lineage.md](docs/systems/family-lineage.md) — familia y linaje: genoma y herencia de rasgos y talento, deseo, concepción y parto, fertilidad baja en cultivadores, parentesco como verdad y creencia (paternidad, ilegítimos, adopción), matrimonio, crianza, herencia, cultivo dual, clanes, genealogías y linajes de sangre.
- [docs/systems/social-structure.md](docs/systems/social-structure.md) — estratificación social: posición como haz de dimensiones, estatus como norma cultural reconocida, percibir y falsificar la posición, etiqueta y cara, qué puede hacer cada uno sin menús, abismo mortal/cultivador, servidumbre y esclavitud como compromisos, movilidad, élites, legitimidad y revueltas.
- [docs/systems/law.md](docs/systems/law.md) — ley y justicia: códigos por cultura, jurisdicciones superpuestas, denuncia y caso, investigación con huellas y testigos, procedimientos y prueba, corrupción emergente, castigos con costo, vendetta contra tribunal, por encima de la ley, contrabando y mercado negro, crimen organizado.
- [docs/systems/state.md](docs/systems/state.md) — estado y política: el estado como organización con un reclamo, alcance que se gasta con la distancia, registros y catastros vs verdad, impuestos con fugas por escalón, burocracia, exámenes, corte, legitimidad y presagios, dinastías y sucesión, trono y sectas, rebelión y colapso.
- [docs/systems/war.md](docs/systems/war.md) — guerra: la guerra como decisión sobre creencias, fuerzas armadas (levas, mercenarios, discípulos, bestias), logística con conservación, moral como psicología, mando con niebla, batallas con bajas como heridas, mortales vs cultivadores, formaciones defensivas y asedios, cautivos y botín, tratados, crímenes y karma, y lo que la guerra deja.
- [docs/systems/technology.md](docs/systems/technology.md) — tecnología mortal: procesos que la ley permite (sin árbol), saber vs adoptar, prerrequisitos físicos y geografía, dominios (agricultura, metalurgia, escritura, imprenta…), difusión, secretos y monopolios, cultivo que desplaza o reprime, pérdida y regresión, consecuencias sociales y ambientales.
- [docs/systems/secret-realms.md](docs/systems/secret-realms.md) — reinos secretos (秘境): bolsillos de espacio y lugares sellados con creador o causa, energía que se conserva, aperturas por física (mareas, ciclos, llaves, fuerza), contenido como libro (puesto, crecido, dejado, sacado), degradación y colapso, guardianes y pruebas, acceso entre sectas, adentro sin juez.
- [docs/systems/divination.md](docs/systems/divination.md) — adivinación y profecía: tres fuentes (conocimiento, lectura metafísica, ritual), el futuro como proyección de presiones sin destino escrito, lecturas en símbolos e interpretación con sesgo, profecías que viajan y se cumplen o frustran solas, reacción del Cielo y velos, presagios naturales, adivinos en la sociedad.
- [docs/systems/chronicle.md](docs/systems/chronicle.md) — crónica, epílogo e historiografía: crónicas adentro del mundo como objetos con autor, sesgo y copias que se reescriben con cada régimen; la crónica final desde la verdad (capítulos por huella causal, "lo que nunca supiste"), el legado medido como lo causado y lo recordado, epílogo como la misma simulación sin vos, archivo de vidas.
- `docs/systems/<sistema>.md` — diseño de cada sistema (se crea antes de implementarlo).

## Retomar en un chat nuevo
Si el usuario dice solo "continuá" (o similar): es el siguiente ítem del backlog de "▶ Ahora", siguiendo la **receta por ítem** que está ahí mismo.
1. Leer [docs/ROADMAP.md](docs/ROADMAP.md): "▶ Ahora" dice qué sigue (y cómo hacerlo) y "Estado del diseño" qué queda abierto.
2. `git status` y `gh pr list` para ver ramas o PRs a medio camino (`gh` ya está en el PATH de Bash vía `~/bin/gh`).
3. Leer el doc de sistema relevante antes de tocar código.
4. Al cerrar cualquier cosa: actualizar ROADMAP (y el doc del sistema) **en el mismo PR**, para que el próximo chat tenga el contexto sin depender de la conversación.

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

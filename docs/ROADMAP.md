# Roadmap

**Fuente única de "qué sigue".** Cuando preguntes "¿con qué seguimos?", la respuesta sale de la sección **Ahora** de este archivo. Al terminar algo: marcarlo, moverlo y elegir el siguiente.

Construcción por capas: cada fase deja algo **jugable o inspeccionable**.

Estado: `[ ]` pendiente · `[~]` en curso · `[x]` hecho

## ▶ Ahora (en orden)
**Backlog de diseño 2** (acordado el 2026-10-06). El primer backlog (#1-#26) está completo: los 28 docs de sistema están escritos. Antes de la Fase 0 se completa el diseño de lo que falta: la columna técnica que une los sistemas (bucle de simulación, acciones, narrador, persistencia) y los sistemas del mundo que todavía no tienen doc. La idea es que el diseño quede **lo más completo posible**; los detalles finos (números, formas exactas de las interfaces) se ajustan al implementar. Se hace **de a un ítem**, en orden: el siguiente es **el primer `[ ]` de la lista** (al 2026-10-06: **#39, clima diario y estaciones**). Después del backlog viene la **Fase 0: scaffold**.

**Receta por ítem** (lo que hay que hacer cuando el usuario dice "continuá"):
1. `git switch develop && git pull`, después rama `docs/<nombre>`.
2. Leer los docs que el ítem toca o de los que depende (la línea "Depende de" de los docs vecinos, y [ARCHITECTURE.md](ARCHITECTURE.md) para los ítems técnicos) y escribir `docs/systems/<nombre>.md` con el formato de siempre: nota de estado, Depende de / Lo usan, Principios, secciones numeradas con interfaces TS, el jugador y el narrador, Escala (LOD), Implementación por fase, Tests, Decisiones (revisables), Preguntas abiertas. Máximo detalle, siempre respetando las reglas de CLAUDE.md (causalidad, conservación, verdad vs creencia, determinismo).
3. En el mismo PR: anotar como "(aprobado <fecha>)" las respuestas del usuario a las preguntas del ítem anterior, marcar el ítem `[x]` acá con el enlace, sumarlo a la sección "Diseño", sumar tareas a las fases que corresponda, agregar el doc a la lista de CLAUDE.md, enlazarlo desde los docs que lo mencionaban como "futuro", y pasar las preguntas abiertas de calibración a "Estado del diseño".
4. Commit (`docs(<área>): ...`), push, `gh pr create --base develop --label design`, y mergear con `gh pr merge <n> --squash --delete-branch` **como comando suelto** (sin `&&` ni pipes). Sin CI en develop.
5. Contarle al usuario qué quedó y proponer el siguiente ítem. Si hay preguntas de diseño (no de calibración), explicarlas con una recomendación.

### D. La columna técnica: lo que une los sistemas
Los docs de sistema asumen piezas que nadie diseñó todavía: quién avanza el tiempo, cómo se pasa de un NPC agregado a uno con cuerpo, qué es exactamente una acción y qué ve el LLM. Van primero porque todo lo demás se apoya en ellas.

27. [x] **Bucle de simulación y LOD** → [simulation.md](systems/simulation.md): scheduler multi-escala (pasos por tier, eventos con hora, colas), orden determinista dentro de un paso, tiers 0-4 con qué se simula en cada uno, materialización y desmaterialización coherentes con las estadísticas (y con lo que el jugador ya vio), modo agregado vs individual y su calibración, presupuesto de cómputo por paso, saltos de tiempo largos, snapshots. Unifica las secciones "Escala (LOD)" de todos los docs.
28. [x] **Acciones e intenciones** → [actions.md](systems/actions.md): catálogo de acciones primitivas y compuestas (en `content/`), `ActionPlan` y su validación, precondiciones desde el estado y desde las creencias del actor, duración, interrupción y acciones largas, acciones que fallan con forma, acciones de NPCs con el mismo catálogo, qué hace el parser con lo ambiguo, lo imposible y lo que el personaje no sabe que es imposible.
29. [x] **Habilidades y aprendizaje** → [skills.md](systems/skills.md): el modelo común de saber hacer (combate, oficios, sociales, cuerpo, estudio): práctica percibida, maestros, libros, techo por talento y cuerpo, olvido por desuso, transferencia entre habilidades vecinas, conocimiento tácito vs explícito. Generaliza lo que ya está en crafts §2, cultivation y technology.
30. [x] **Combate individual** → [combat.md](systems/combat.md): duelos y peleas chicas como intercambios con tiempo, distancia y posición; cuerpo por partes y heridas reales; armas y armaduras como objetos; artes marciales y técnicas de cultivo con su costo; mortal contra cultivador; percepción en la pelea (leer al rival, fintas, sorpresa); huir, rendirse, perdonar; moral individual; huellas y testigos. War.md cubre las batallas; esto es la escala de una persona.
31. [x] **Conversación e influencia** → [dialogue.md](systems/dialogue.md): hablar como acción con estructura (temas, preguntas, pedidos, ofertas, amenazas, mentiras, halagos), persuasión que sale de creencias, relación, cara y utilidad del otro; detectar mentiras; regateo; secretos que se sueltan; lo que el NPC dice vs lo que cree; cómo el LLM pone en palabras una respuesta ya decidida por la sim.
32. [x] **Narrador y capa LLM** → [narration.md](systems/narration.md): qué recibe el narrador (percepts, creencias y voz del personaje, léxico generado), qué no puede hacer (inventar entidades, revelar la verdad), estilo y tono por situación, memoria de narración y continuidad, validación de la salida, parser de intención (modelo, esquema, aclaraciones), costos, caché y modo sin red.
33. [x] **Bucle del jugador** → [player-loop.md](systems/player-loop.md): cómo empieza una vida (nacimiento, infancia acelerada, punto de entrada), ritmo de juego (escenas, días, años), saltar tiempo con rutinas y con qué lo interrumpe el mundo, metas propias, diario y hipótesis del jugador, qué ve el jugador de su propio estado, muerte, espíritu y crónica final, comandos fuera del personaje.
34. [x] **Persistencia, inspector y herramientas** → [tooling.md](systems/tooling.md): guardado en SQLite (verdad, creencias, log de eventos), replay desde seed + acciones, versiones del formato, inspector god-mode completo (consultas, comandos de causality §10, mapas), sim headless con métricas y reportes para calibrar, perfiles de rendimiento.
35. [x] **Modos de juego: realista y novela** → [game-modes.md](systems/game-modes.md): el modo realista como default (todo lo diseñado hasta ahora) y un modo novela que se elige antes de empezar: decidir cosas del personaje (familia, lugar, talento, rasgos, edad de entrada) y **dedos de oro** (金手指) muy configurables (un sistema que muestra stats, alquimia que nunca falla, un abuelo en el anillo, aprendizaje acelerado, suerte de protagonista…). Cada dedo de oro es una entidad del mundo con origen, efectos que aplica la sim como modificadores acotados de la ley o de las tiradas, determinista y con su propia cuenta en el ledger si crea algo; qué pueden percibir los demás y el Cielo; opciones de vida (cargar partida o no); cómo lo narra el narrador; marca en el archivo de vidas. Las reglas que no se rompen siguen valiendo en los dos modos.

### E. Sistemas del mundo que faltan
36. [x] **Asentamientos y edificios** → [settlements.md](systems/settlements.md): dónde y por qué nace un asentamiento, cómo crece y se ordena (barrios, mercado, templo, murallas), edificios como objetos con materiales, dueño, uso y deterioro, infraestructura (pozos, canales, caminos, puentes), incendios y reconstrucción, abandono y ruina.
37. [x] **Propiedad y tenencia de la tierra** → [property.md](systems/property.md): propiedad como verdad, creencia y registro; tierras comunales, feudos, arrendamiento y aparcería, tierras de templo y de secta, herencia y partición, usurpación, catastros, cercamientos; la propiedad de objetos (marcas, robo, hallazgos, abandono).
38. [x] **Viaje, transporte y mar** → [travel.md](systems/travel.md): viajar como sucesión de días con costo, riesgo y encuentros que salen del estado (no tablas); caminos, posadas y postas; animales y carros; ríos y barcos; navegación, corrientes y vientos; puertos, piratas y naufragios; vuelo y espadas voladoras; mapas y perderse; transporte de carga con conservación.
39. [ ] **Clima diario y estaciones** → `weather.md`: tiempo del día derivado del clima de planet-gen (frentes, lluvias, tormentas, nieve, sequías), estaciones con efecto en cosechas, viajes, guerra y ánimo; pronóstico popular y por adivinación; tormentas de qi; cultivadores que alteran el tiempo y su costo.
40. [ ] **Culturas** → `culture.md`: la cultura como haz de normas, prácticas y saberes que se transmite y cambia; costumbres (comida, ropa, vivienda, ritos de paso, funerales, fiestas), estética y arte, valores y tabúes, etiqueta, humor; generación desde la geografía y la historia; contacto, préstamo, sincretismo y aculturación; identidad y etnicidad como creencia.
41. [ ] **Lenguas y escritura** → `language.md`: fonología, raíces y morfología; cambio fonético por siglos, lenguas hermanas, préstamos por contacto, pidgins y lenguas francas; nombres de personas y lugares con significado; escrituras que se inventan y se heredan; aprender una lengua, malentendidos e intérpretes; el léxico que usa el narrador. Incluye el worldgen mínimo de la Fase 5 (aprobado 2026-10-06).
42. [ ] **Religión y doctrinas** → `religion.md`: religiones como sistemas de creencias sobre el mundo, el Cielo, la muerte y la moral; doctrina, clero, textos sagrados, conversión, herejía y sincretismo; cómo se relacionan con los cultos y espíritus reales (spirits §9) y con la verdad metafísica; religión y estado; prácticas de devoción y ascetismo.
43. [ ] **Cosmología y ascensión** → `cosmology.md`: estructura del cosmos por familia de mundo (planos, inframundo, cielos superiores, otros mundos), qué hay después del último umbral, ascensión como evento físico con costo, visitantes de arriba y de abajo, lo que el jugador nunca va a ver pero el mundo tiene que tener coherente.

### F. Cierre del diseño
44. [ ] **Modelo de datos unificado y revisión de coherencia** → actualizar [ARCHITECTURE.md](ARCHITECTURE.md): glosario de tipos compartidos (`Entity`, `Event`, `Belief`, `Lot`, `Commitment`, `Pressure`…), qué módulo es dueño de cada uno, contradicciones entre docs resueltas, orden de implementación de las fases revisado con todo lo diseñado.

### Hecho: backlog de diseño 1 (2026-10-05 → 2026-10-06)
Los 26 ítems están escritos y mergeados en `develop` (PRs #9-#43):
- **A. Sistemas base:** percepción, información y rumores, cuerpo y salud, cultivo, descubrimiento e iluminación, economía, organizaciones.
- **B. Sistemas nuevos:** elementos, oficios, contratos y juramentos, familia y linaje, estratificación social, ley y justicia, estado y política, guerra, tecnología mortal, reinos secretos, adivinación y profecía, crónica e historiografía.
- **C. Ampliaciones:** heaven-karma §3-§8, npc-psychology §10-§17, causality §9-§11 + schemes §9-§13, planet-gen §8-§12, living-world §8-§16, spirits §6-§12, deep-history §1-§11 (arqueología).

## Estado del diseño (2026-10-06)
Los 28 docs de `docs/systems/` están escritos y mergeados en `develop`. Todos son **borradores revisables**: las preguntas de diseño se respondieron (quedan como "Decisiones" en cada doc), y lo que queda abierto en ellos es **calibración con la sim headless** (cada doc tiene sus objetivos de sensación). Lo que falta diseñar está en el backlog 2 de arriba (#27-#43):
- actions: número final de verbos y modos; checkpoints por verbo; umbral de saliencia para interrumpir; curvas de margen a `Outcome`; peso de los modos en duración y emisiones; frecuencia de confirmaciones.
- skills: tasas y curvas por dominio; tiempos por tramo; oxidación tácita y explícita; transferencia e interferencia; fijación de vicios; sesgos de autoimagen; dispersión por ocupación.
- combat: largo del pulso; tiempos por arma y movimiento; sangrado y shock en pelea; gasto de aire; peso de la sorpresa; umbrales de quiebre; brecha mortal–cultivador por umbral; duración típica; frecuencia de pausas.
- dialogue: duración de los turnos; pesos de relevancia, credibilidad, entrega y apertura en la persuasión; reacción por presionar; chance de soltar secretos por factor; tasa de detección de mentiras; costo de cara por cambiar de opinión en público; turnos de una charla resumida de tier 2.
- narration: largo por modo; ventana de texto reciente; cada cuánto resumir; presupuesto de tokens por turno; rigor de la detección de nombres; cantidad de ejemplos del parser.
- player-loop: largo de los saltos de las viñetas de infancia; qué cuenta como grave para la delegación; cuántos ítems tiene "qué pasó mientras"; tramos de una rutina larga.
- tooling: intervalo de snapshots; cada cuánto correr invariantes en debug; cuántas copias de respaldo; tamaño de lote de seeds para la suite de calibración; objetivos de rendimiento.
- game-modes: intensidades por defecto de los presets; techo de la reserva de suerte; cuántos guardados da `checkpoints`; saliencia de un dedo de oro `foreign`.
- settlements: tasas de deterioro por material y clima; riesgo de incendio por densidad, materiales y viento; gente que sostiene cada ancla; tiempos de construcción por tipo; umbrales de tipo de asentamiento.
- property: velocidad de concentración por crédito y malas cosechas; años de prescripción por cultura; frecuencia de disputas de límites; brecha de registro por calidad del estado.
- travel: velocidades por medio y terreno; consumo diario por persona y animal; tasas de cruce con bandidos y bestias; costo de qi del vuelo por reino; frecuencia de naufragios.
- simulation: tamaño de las zonas local y regional; histéresis; umbrales y pesos de importancia para tier 3; cupos de tier 2 y 3; cadencias por proceso y resolución; tolerancias agregado–individual; intervalo de snapshots; presupuestos por acción, día saltado y año de historia.
- deep-history: reglas agregadas vs individuales.
- npc-psychology: top-N memorias por NPC de tier 2 (arranca en 20).
- npc-psychology (ampliación): plasticidad por etapa, prevalencias base y resolución del duelo, distribución de umbrales en multitudes, fusiones por noche de consolidación.
- causality: intervalo de snapshots de presiones; curvas de hazard por tipo de descarga; efecto y duración de las chispas.
- schemes: tasa de intrigas entre organizaciones por par; proporción de free riders; frecuencia con que una profecía usada se vuelve contra el que la usó.
- planet-gen: período y amplitud de las oscilaciones oceánicas; largo y amplitud de los ciclos glaciales; tasas de formación y agotamiento de suelos; recarga y explosividad de volcanes; frecuencia de impactos.
- perception: curvas de atenuación y `k` de la sigmoide.
- body-health: curación, infección y mortalidad.
- cultivation: tasas de absorción, dificultad de rupturas y longevidad por umbral (forma de la pirámide de cultivadores).
- discovery: integración de `pending`, umbrales de iluminación y habituación; tasas de descubrimiento por cultura y caída de dogmas; ruido de observación y ventana de atribución (supersticiones comunes pero no universales).
- organizations: frecuencia de cismas, sucesiones disputadas y colapsos; vida media por tipo; tamaño a partir del cual aparecen facciones; pesos organización/facción/uno mismo (corrupción común pero no universal).
- elements: `λ`, `κ`, `ρ` y pérdida de generación (ventaja elemental que importa sin decidir sola); velocidad con que el uso sesga el campo de una celda; frecuencia de raíces mutadas y derivados.
- crafts: tasas de estallido y calidad por habilidad; velocidad de aprendizaje y techo por cultivo; duración de cargas y desgaste de artefactos; cuántos momentos de decisión tiene una sesión larga.
- contracts: umbral de peso para que una promesa llegue al libro del Cielo y peso de la traición; tasas de incumplimiento por tipo y cultura; fuerza de los sellos en el alma frente al portador; cuántas promesas chicas conserva un NPC de tier 2.
- family-lineage: heredabilidad por rasgo (sobre todo la aptitud de cultivo); curva de fertilidad por reino y diferencia de reino; tasas de ilegitimidad, adulterio descubierto y disputas de herencia; dilución y despertar de linajes de sangre; mortalidad materna e infantil.
- social-structure: tasas de movilidad por puerta; proporción de población no libre por cultura y era; umbrales de resentimiento para fugas, bandidaje y revueltas; peso del cultivo sobre las demás dimensiones (`powerOverrides`); velocidad de erosión de las ideologías de la jerarquía.
- law: tasas de delito por presión; fracción denunciada y resuelta por jurisdicción; tasa de condenas de inocentes; umbrales de soborno; duración y salida de las vendettas; prima de riesgo del contrabando.
- state: curva de alcance por distancia y terreno; fuga por escalón de recaudación; envejecimiento de registros y crecimiento de la tierra exenta; duración de dinastías y frecuencia de crisis de sucesión; peso de los presagios en la legitimidad.
- war: consumo diario por persona y animal y pérdida por distancia en el transporte; umbrales de quiebre de moral y contagio; bajas en choque vs persecución; equivalencia mortales–cultivador por umbral (con y sin armas preparadas y formaciones); duración de asedios y epidemias de campamento; peso kármico de las muertes en guerra según contexto.
- technology: tasas de invención según población, contacto, necesidad y cultura epistémica; velocidad de difusión y umbral de imitación; población mínima por complejidad de oficio; cuánto frena el cultivo a la tecnología mortal; variación de recetas por seed.
- secret-realms: costo de crear y mantener un bolsillo y vida típica según su reserva; frecuencia de aperturas y duración de ventanas; límites de umbral típicos; mortalidad y botín de expediciones agregadas; cantidad de reinos por región; radio y magnitud del colapso.
- divination: ruido de la lectura según diferencia de poder, distancia temporal y tamaño del sujeto; horizonte y corridas de la proyección por método y tier; magnitud de la reacción del Cielo; ambigüedad de los vocabularios simbólicos; fracción de profecías que se cumplen solas.
- chronicle: decaimiento de la huella causal por distancia y causas concurrentes; capítulos y puntos de giro según la duración de la vida; puntos de control del epílogo y umbral para seguir más allá del siglo; errores por copia y reescritura por cambio de régimen; tamaño y criterio de "lo que nunca supiste". Cobro en las Fuentes: peso de esencia, años y karma frente a la fuerza del alma (que un cultivador de los primeros umbrales renazca débil y uno alto con mucha deuda se disuelva).
- heaven-karma: capacidad de atención por fuerza del Cielo y rendimientos decrecientes; techo de la inclinación de tiradas; umbral de déficit de qi para calamidad; descuento por mérito; cierre de heridas del Cielo; fracción del rayo que se puede robar.
- living-world: velocidad de sucesión por bioma; hazard de incendio por combustible y sequía; establecimiento y latencia de introducciones; crecimiento y respuesta funcional por linaje; generaciones para una raza; pérdida y recuperación de rutas de migración; efecto de la domesticación sobre el núcleo de las bestias espirituales.
- spirits: qi que aporta un fiel sincero; fuga del `qiPool` según el estado del edificio; siglos para que un santuario despierte un espíritu; `upkeep` por tipo, lugar y hora.
- deep-history (arqueología): sedimentación y erosión por proceso; conservación por material y ambiente; frecuencia de perturbaciones; ritmo de cambio de estilos; supervivencia de topónimos; tasa de saqueo; granularidad de los `Assemblage`.
- economy: velocidad de ajuste de precios en el modo agregado (`k_bien`) contra el individual; tasas de interés y quiebras de hogares; formación y fuga de piedras espirituales y cambio plata–piedras; frecuencia de hambrunas y crisis monetarias.

## Ideas / pendientes sueltos
- ¿Qué hay después de la ascensión? (salir del planeta)
- Segunda familia de mundo: alta fantasía occidental (Fase 7+).

## Setup del repo
- [x] Ramas `main` + `develop` (sin `master`), flujo en [GIT_WORKFLOW.md](GIT_WORKFLOW.md)
- [x] CI: typecheck/lint/tests, gitleaks, npm audit · Dependabot · CodeQL · secret scanning + push protection
- [x] Rulesets en `main` y `develop`, opciones de merge, labels, milestones por fase
- [x] `gh` autenticado (con scope `workflow`) · PRs #2 y #3 de Dependabot mergeados

## Diseño
Docs escritos (todos borradores revisables; entre paréntesis, las ampliaciones del backlog 1).
- [x] Modelo causal del mundo ([systems/causality.md](systems/causality.md)) — §9-§11 (presiones, inspector, contrafácticos)
- [x] El Cielo y el karma ([systems/heaven-karma.md](systems/heaven-karma.md)) — §3-§8 (atención, zonas ciegas, tribulación física, inclinación, mérito, 气运)
- [x] Historia profunda por relevancia ([systems/deep-history.md](systems/deep-history.md)) — §1-§11 (arqueología: estratos, datación, topónimos, excavar, antigüedades, escuelas de historia)
- [x] Psicología de NPCs ([systems/npc-psychology.md](systems/npc-psychology.md)) — §10-§17 (etapas, salud mental, declive, sentido y pertenencia, multitudes, sueños, gustos)
- [x] Generación del planeta ([systems/planet-gen.md](systems/planet-gen.md)) — §8-§12 (glaciaciones, suelos, volcanes e inviernos volcánicos)
- [x] Metafísica: leyes por mundo ([systems/metaphysics.md](systems/metaphysics.md))
- [x] Mundo vivo ([systems/living-world.md](systems/living-world.md)) — §8-§16 (poblaciones, sucesión y fuego, invasoras, migraciones, domesticación, vínculos con bestias)
- [x] Espíritus ([systems/spirits.md](systems/spirits.md)) — §6-§12 (ofrendas, santuarios, ancestros, dioses locales, abandono, economía de las ofrendas)
- [x] Intrigas de NPCs ([systems/schemes.md](systems/schemes.md)) — §9-§13 (proyectos, intrigas entre organizaciones, profecías)
- [x] Percepción ([systems/perception.md](systems/perception.md))
- [x] Información, creencias y rumores ([systems/information.md](systems/information.md))
- [x] Cuerpo y salud ([systems/body-health.md](systems/body-health.md))
- [x] Cultivo ([systems/cultivation.md](systems/cultivation.md))
- [x] Descubrimiento e iluminación ([systems/discovery.md](systems/discovery.md))
- [x] Economía ([systems/economy.md](systems/economy.md))
- [x] Interacciones elementales ([systems/elements.md](systems/elements.md))
- [x] Oficios ([systems/crafts.md](systems/crafts.md))
- [x] Organizaciones ([systems/organizations.md](systems/organizations.md))
- [x] Contratos y juramentos ([systems/contracts.md](systems/contracts.md))
- [x] Familia y linaje ([systems/family-lineage.md](systems/family-lineage.md))
- [x] Estratificación social ([systems/social-structure.md](systems/social-structure.md))
- [x] Ley y justicia ([systems/law.md](systems/law.md))
- [x] Estado y política ([systems/state.md](systems/state.md))
- [x] Guerra ([systems/war.md](systems/war.md))
- [x] Tecnología mortal ([systems/technology.md](systems/technology.md))
- [x] Reinos secretos ([systems/secret-realms.md](systems/secret-realms.md))
- [x] Adivinación y profecía ([systems/divination.md](systems/divination.md))
- [x] Crónica, epílogo e historiografía ([systems/chronicle.md](systems/chronicle.md))
- [x] Bucle de simulación y LOD ([systems/simulation.md](systems/simulation.md)) — scheduler por fases, dos ejes de LOD (tier de agente y resolución de zona), materialización por ranuras, puesta al día, contrato del modo agregado, presupuesto determinista
- [x] Acciones e intenciones ([systems/actions.md](systems/actions.md)) — catálogo cerrado de verbos con modos, `ActionPlan` como árbol, referencias contra creencias, factibilidad en dos pasos, fracasos por el factor más débil, parser que descarta resultados
- [x] Habilidades y aprendizaje ([systems/skills.md](systems/skills.md)) — un modelo para todo saber hacer: facetas, repertorio y familiaridad; tácito vs explícito; aprender de lo percibido, con maestros y manuales; techo oculto; vicios; oxidación con pico; transferencia; autoimagen como creencia
- [x] Combate individual ([systems/combat.md](systems/combat.md)) — pulsos con preparación, compromiso y hueco; espacio continuo; intercambio con percepción y contienda; heridas reales sin puntos de vida; armas y armaduras como objetos; técnicas con `interact`; moral con chances creídas; cómo termina; rastros
- [x] Conversación e influencia ([systems/dialogue.md](systems/dialogue.md)) — actos de habla con contenido estructurado; entender con errores; persuasión como cambio de insumos de la utilidad del otro; preguntas, pedidos, amenazas, cara; secretos que se escapan; contenido del jugador con entrega del personaje; verbalización con lista blanca
- [x] Narrador y capa LLM ([systems/narration.md](systems/narration.md)) — el LLM solo en los bordes; `PlayerView` con marca de tipo como único muro; etiquetas como las nombra el personaje e ids locales; léxico y voz del personaje; salida con referencias marcadas y validador con lista blanca; plantillas y modo sin red; replay sin LLM
- [x] Bucle del jugador ([systems/player-loop.md](systems/player-loop.md)) — el personaje como un agente más que nace en la población; infancia en viñetas o entrada por edad; turno; ritmo por escala; rutinas con interrupciones solo desde percepts y delegación de lo chico; metas sin marcadores; paneles de creencias; comandos `meta`; morir, espíritu y cruzar
- [x] Persistencia, inspector y herramientas ([systems/tooling.md](systems/tooling.md)) — un SQLite por vida con la verdad completa; serialización canónica y hash por componente; replay desde seed + planes validados con detector de divergencias; versiones y límite de replay; catálogo del inspector de solo lectura con `at <tick>` y REPL; sim headless con escenarios, lotes y `sim:diff`; calibración con objetivos escritos como sensaciones; invariantes en debug; paquetes de reproducción; herramientas del LLM
- [x] Modos de juego ([systems/game-modes.md](systems/game-modes.md)) — realista por defecto; modo novela elegido antes de empezar; personaje elegido buscando, condicionando y recién después fijando con origen; dedos de oro como entidades con portador, origen, efectos acotados (revelar como percepción, oficios sin fallo con conservación, aprendizaje, fortuna sobre lo posible, mentor como agente, espacio, provisiones y misiones con reserva finita, memorias de vidas pasadas), reglas compuestas con disparador, condición y acción y un catálogo amplio de tropos para imitar distintas novelas (información, progreso, intercambio, tiempo y destino, compañeros, espacio, cuerpo, social, saber de otro mundo, con precio), firma ante el mundo y el Cielo; rivales; guardados opcionales como ramas; presets; marcas en el archivo
- [x] Asentamientos y edificios ([systems/settlements.md](systems/settlements.md)) — asentamientos con anclas con causa (agua, tierra, defensa, cruces, puertos, recursos, venas de qi, lugares sagrados, instituciones) y fundación como decisión sobre creencias; crecimiento por capacidad y migración por atractivo creído, decaimiento al perder anclas; barrios, trazados y normas de uso por cultura, geomancia como teoría con parte de verdad; edificios como objetos con componentes, materiales con origen, defectos ocultos, dueño, usos y grafo de espacios; construir como sesión de oficio; deterioro y mantenimiento; infraestructura con mantenedor (pozos, saneamiento, diques que sedimentan, caminos, puentes, murallas, graneros); fuego como frente sobre el grafo de edificios; reconstrucción; abandono, saqueo de materiales y ruinas con estratos; sitios de secta y campamentos móviles; stock agregado con materialización
- [x] Propiedad y tenencia de la tierra ([systems/property.md](systems/property.md)) — tres capas que divergen (posesión, creencia, registro); derechos como haz de incidentes con varios titulares sobre un mismo objeto; parcelas con límites que son memoria y mojones; formas de tenencia como contenido por cultura (plena, comunal, de linaje, de culto, de templo, dominio de secta, feudo, reparto del estado, arriendo, aparcería, dos dueños en un campo, venta con recompra, ocupación, pastoreo estacional); adquisición con formalidades y prescripción según la norma; comunales con reglas y cercamientos; partición por herencia; escrituras y catastros como objetos falsificables; disputas y usurpación del poderoso; concentración de la tierra como presión y reformas; muebles con marcas, robo, hallazgos y abandono; norma de la fuerza entre cultivadores; el Cielo no lee títulos
- [x] Viaje, transporte y mar ([systems/travel.md](systems/travel.md)) — el viaje como días de mundo con costo, desgaste y salud; red de rutas que nace del uso con tramos, cuellos de botella, peajes y estaciones; `Journey` común a jugador, NPCs, caravanas y ejércitos; encuentros como cruces de entidades que ya existen (bandidos que decidieron, bestias por territorio, viajeros del flujo agregado), nunca tablas; posadas, postas y campamentos; animales y vehículos con la regla del carro; carga como lotes con pérdidas con causa y anillos de almacenamiento; salvoconductos, controles y cierres; ríos con corriente, crecidas y esclusas; mar con vientos, monzones y corrientes, barcos como objetos, naufragios como proceso, pecios y piratas; vuelo visible con costo y zonas prohibidas, teletransporte raro y caro; orientarse y perderse con posición creída; viajar como rutina con montaje e interrupciones

## Fase 0 — Fundamentos
- [ ] Scaffold: TS strict, Vitest, ESLint (con reglas de dependencia), scripts npm, GitHub Actions (typecheck + tests)
- [ ] `core/rng` con seed y sub-streams + test de determinismo
- [ ] `core/time`: ticks absolutos en segundos, conversión a calendario simple ([simulation.md](systems/simulation.md) §1)
- [ ] Scheduler mínimo: `ProcessDef` puro con diffs, cola de ítems agendados, fases fijas, contiendas por conflicto de escritura, rng por clave ([simulation.md](systems/simulation.md) §2, §3, §14)
- [ ] Modelo de `Event` con `causes` + `originEventId` + tests de invariantes (sin huérfanos, conservación)
- [ ] Persistencia SQLite mínima (guardar/cargar mundo + log de eventos)
- [ ] Serialización canónica y hash del estado por componente; test de determinismo por hash; replay básico desde seed + planes; validación de `content/` con Zod ([tooling.md](systems/tooling.md) §1-§3, §11)
- [ ] Loop CLI: leer input → (stub) → imprimir
- [ ] Loop CLI con stub del turno: leer, parsear a mano, avanzar, imprimir ([player-loop.md](systems/player-loop.md) §3)
- [ ] `mode` en `NewGameSetup` y en `meta`; validador Zod de `NovelSetup` ([game-modes.md](systems/game-modes.md) §1)
- [ ] Cliente LLM con `MockLLM` e interfaz de trabajos (parser, narrador, verbalizador) ([narration.md](systems/narration.md) §1, §16)

## Fase 1 — Vertical slice: una aldea, 20 NPCs, acción libre
- [ ] Planet-gen mínima (grilla, tectónica, clima, biomas, qi, PNG) para ubicar la aldea
- [ ] Elementos: cinco fases en `content/`, vector elemental del qi de cada celda, `interact` puro con tests de conservación y sin móvil perpetuo ([elements.md](systems/elements.md))
- [ ] Aldea + bosque cercano hardcodeados/semigenerados
- [ ] Jugador con stats generados por seed, nacido de padres y hogar generados por la sim, genoma mínimo heredado ([family-lineage.md](systems/family-lineage.md))
- [ ] Catálogo de ~10 verbos en `content/actions/` (moverse, buscar/recolectar, hablar, trabajar, descansar, robar como plantilla, pelear, comerciar, observar, esperar); `ActionPlan` con `seq` y `until`; referencias con aclaración; requisitos de capacidad y medios; `Outcome` con autopercepción; fracasos por factor ([actions.md](systems/actions.md))
- [ ] Economía mínima: lotes con origen, tenencias finitas para todos (sin fondos ni reposición infinita), inventarios, moneda de cobre y trueque, comerciar con regateo simple, comida que se pudre ([economy.md](systems/economy.md))
- [ ] Resolución con resultados matizados
- [ ] Sesión de oficio mínima (cocina o herrería de aldea): pasos con ruido de control, física simple, producto con calidad y origen ([crafts.md](systems/crafts.md))
- [ ] Habilidades de los ~10 verbos con facetas `execution`/`reading`/`judgment`, aprendizaje por práctica desde la autopercepción con techo ([skills.md](systems/skills.md))
- [ ] Intent parser (modelo local con gramática JSON) → ActionPlan validado; banco de pruebas de modelos locales ([narration.md](systems/narration.md) §1)
- [ ] Percepción mínima (vista y oído, grafo de espacios de la aldea, luz) ([perception.md](systems/perception.md))
- [ ] Narrador (modelo local) solo con los percepts del jugador: `buildPlayerView` con marca de tipo, etiquetas, salida con referencias marcadas, validador con lista blanca, plantillas y parser sin red, caché del prefijo ([narration.md](systems/narration.md) §2-§5, §9-§12)
- [ ] Cuerpo mínimo: heridas con sangrado e infección, hambre, sed, fatiga, muerte con causa ([body-health.md](systems/body-health.md))
- [ ] Estatus mínimo de aldea (campesinos, terrateniente, sirvientes), marcas visibles y rango percibido, deferencia en la utilidad del diálogo ([social-structure.md](systems/social-structure.md))
- [ ] Pelea mortal: posiciones y alcances, pulsos con `windup`/`commit`/`recovery`, intercambio con percepción y contienda, heridas por parte, aire, huida y rendición, pausas del jugador ([combat.md](systems/combat.md))
- [ ] Conversación mínima: `greet`, `tell`, `ask`, `request`, `offer`, `accept`, `refuse`, `farewell`; NPC que contesta desde sus creencias o dice "no sé"; verbalización con lista blanca y plantillas de respaldo; `SpeechStyle` mínimo ([dialogue.md](systems/dialogue.md) §2, §5, §16)
- [ ] Huellas mínimas (sangre, objetos movidos), testigos, robo y pelea con reclamo de la víctima y reputación ([law.md](systems/law.md))
- [ ] Fiado de aldea como primer compromiso (deudas de palabra, la otra parte y la reputación como ejecutores) ([contracts.md](systems/contracts.md))
- [ ] Bucle del jugador mínimo: entrada por edad con escena inicial desde creencias, turno completo, interrupciones fijas, guardado automático sin cargar atrás, paneles de personaje, inventario creído y bitácora ([player-loop.md](systems/player-loop.md) §2-§4, §6, §9, §12)
- [ ] Muerte → pantalla de crónica mínima: epitafio, causa real de muerte y su cadena, capítulos por cortes de vida ([chronicle.md](systems/chronicle.md))
- [ ] Inspector god-mode básico: `entity`, `why`, `effects`, `mind`, `decision`, `believes`, `view`; sim headless con reporte JSON; invariantes en debug; guardado por turno en transacción ([tooling.md](systems/tooling.md) §1, §5, §6, §8)
- [ ] `Pressure` como objeto (fuentes, umbral, descargas) y comandos del inspector `why`, `effects`, `pressures`, `hazard` ([causality.md](systems/causality.md) §9, §10)
- [ ] Modo novela mínimo: elegir lugar, posición de la familia, sexo, nombre y edad de entrada, con búsqueda de nacimiento y biografía sintetizada; marca de modo en la crónica ([game-modes.md](systems/game-modes.md) §2)
- [ ] Aldea inicial con anclas, edificios con componentes, materiales con origen, dueños, contenido y grafo de espacios; un pozo y un camino ([settlements.md](systems/settlements.md) §1, §2, §5, §8)
- [ ] Parcelas de la aldea con dueño, forma de tenencia y escritura o testigos; posesión, creencia y registro separados; robo de muebles con reclamo ([property.md](systems/property.md) §1, §3, §12)
- [ ] Caminar por tramos con costo entre la aldea y lugares cercanos; acampar; cansancio y comida del camino ([travel.md](systems/travel.md) §1, §2, §4, §12)

## Fase 2 — Psicología y memoria
- [ ] Rasgos innatos + adquiridos
- [ ] Relaciones multidimensionales
- [ ] Memorias de eventos con intensidad, confianza, degradación
- [ ] Conocimiento vs verdad (creencias sobre el jugador)
- [ ] Creencias `law` como hipótesis con evidencia desde percepts; diario de hipótesis del jugador ([discovery.md](systems/discovery.md))
- [ ] Diálogo de NPCs condicionado por personalidad/memorias
- [ ] Creencias sobre la posición ajena con errores, etiqueta como norma, ofensas que cuestan cara ([social-structure.md](systems/social-structure.md))
- [ ] Testigos con memoria deformada y mentiras, acusaciones en el diálogo, culpa por el delito propio ([law.md](systems/law.md))
- [ ] Promesas en el diálogo, creencias sobre compromisos, culpa por incumplir, libro de deudas y promesas del jugador ([contracts.md](systems/contracts.md))
- [ ] Profecías como creencias con linaje que cambian utilidades, adivinos de calle (ritual, lectura en frío) ([divination.md](systems/divination.md))
- [ ] Crónica: "lo que nunca supiste" (intrigas y creencias equivocadas) y personas importantes por relación y memoria ([chronicle.md](systems/chronicle.md))
- [ ] Factibilidad creída con avisos desde lo que sabe el personaje, actos de habla como argumento de `speak`, referencias a entidades fantasma ([actions.md](systems/actions.md) §4, §5)
- [ ] Autoimagen y opinión ajena de la habilidad como creencias, saber explícito como creencias del dominio, aprender mirando ([skills.md](systems/skills.md) §2.4, §3.2, §9)
- [ ] Leer al rival, fintas, chances creídas y quiebre en la pelea; trauma y culpa después de matar ([combat.md](systems/combat.md) §5, §11)
- [ ] Paneles de creencias, hipótesis, personas y deudas; `qué sé de X`; recuento al volver ([player-loop.md](systems/player-loop.md) §9, §10, §12)
- [ ] Léxico y voz del personaje, memoria de narración y continuidad, modo introspección ([narration.md](systems/narration.md) §4, §6, §7)
- [ ] Mentiras y su detección, `TopicStack`, persuasión con argumentos y apelaciones, amenazas, halagos e insultos con cara, secretos que se escapan, sonsacar ([dialogue.md](systems/dialogue.md) §3-§11)
- [ ] Consolidación nocturna de memorias (fusiones, refuerzo de esquemas, calidad del sueño) y gustos básicos ([npc-psychology.md](systems/npc-psychology.md) §15, §16)
- [ ] Inspector: `memories`, `wrong`, `percepts`, `rumor`; métricas de exactitud de creencias en la sim headless ([tooling.md](systems/tooling.md) §5, §6)
- [ ] Temperamento y gustos elegidos; infancia elegida como intenciones del hogar ([game-modes.md](systems/game-modes.md) §2.3)

## Fase 3 — Vida offscreen, familias y economía
- [ ] IA de utilidad: objetivos en capas que compiten
- [ ] NPCs con el mismo catálogo de verbos, plantillas de plan en `content/plans/`, recursos del cuerpo y concurrencia, interrupciones y resultados parciales ([actions.md](systems/actions.md) §3, §6, §10)
- [ ] Rutinas diarias, NPCs actúan sin el jugador; tier 1 dormidos con puesta al día; primeros modelos agregados con test de calibración ([simulation.md](systems/simulation.md) §7-§9)
- [ ] Familias, herencia de rasgos, crianza → rasgos adquiridos: atracción y uniones, matrimonio con normas culturales, concepción y parto, hogares que se arman y se parten, herencia con disputas, paternidad como creencia, enfermedades hereditarias ([family-lineage.md](systems/family-lineage.md))
- [ ] Enfermedades con contagio, médicos, sustancias y adicciones, nutrición, frío/calor ([body-health.md](systems/body-health.md))
- [ ] Economía básica: hogares con presupuesto, producción agrícola y de oficios, mercado de la aldea con precios por creencias, salarios, crédito de cosecha y usura, calidad percibida y estafa, hambruna con causa ([economy.md](systems/economy.md))
- [ ] Medicina y remedios mortales, venenos y antídotos, habilidad que sale de la práctica percibida, aprendices ([crafts.md](systems/crafts.md))
- [ ] Armas y armaduras como objetos con desgaste, estilos y repertorio de combate, prácticas, peleas de hasta ~20, contienda resumida calibrada para NPCs lejanos ([combat.md](systems/combat.md) §6, §9, §14, §18)
- [ ] Maestros con métodos de enseñanza, manuales con tacitez, oxidación con pico, transferencia e interferencia, vicios, distribuciones de habilidad por ocupación; `CraftSkill` y `ProcessKnowledge` como vistas ([skills.md](systems/skills.md) §3-§8, §10, §13)
- [ ] Saber popular de hierbas y medicina como prior cultural, herbolario que experimenta, supersticiones con mecanismo, ventana de atribución ([discovery.md](systems/discovery.md))
- [ ] Rumores (propagación de información con distorsión, reputación por comunidad) ([information.md](systems/information.md))
- [ ] Intrigas F1-F2: asesinato/robo motivados, cebos con rumores falsos, cómplices ([schemes.md](systems/schemes.md))
- [ ] Compromisos: préstamos y garantías (colateral, fiadores, empeño), deudas por norma, herencia de deudas, matrimonio y aprendizaje como `status`, mediación, documentos y tallas como objetos ([contracts.md](systems/contracts.md))
- [ ] Estatus como normas en `content/` (derechos, deberes, protecciones, capacidad), servidumbre por deudas, movilidad por matrimonio, deuda y riqueza, resentimiento por comunidad ([social-structure.md](systems/social-structure.md))
- [ ] Consejo de ancianos como jurisdicción: `Case`, investigación simple, compensación y castigos; vendettas entre familias; rastreo de lotes robados en casas de empeño ([law.md](systems/law.md))
- [ ] Consejo de aldea como primera organización, bandas de bandidos que nacen del hambre, lealtad como relación con la organización ([organizations.md](systems/organizations.md))
- [ ] Catálogo inicial de procesos mortales en `content/` con requisitos físicos y efectos sobre producción, `ProcessKnowledge` por persona, aprendizaje con maestro ([technology.md](systems/technology.md))
- [ ] Epílogo corto (un año, diez años) con descendencia, herencia y quién ocupa tu lugar ([chronicle.md](systems/chronicle.md))
- [ ] `QiDebt` por sobreexplotación y retribución mínima como inclinación de las tiradas del deudor ([heaven-karma.md](systems/heaven-karma.md) §6)
- [ ] Etapas de vida y apego, `belonging`/`meaning`, condiciones mentales con etiqueta cultural, lado mental de la adicción, gustos en la demanda y los regalos, sueños con contenido ([npc-psychology.md](systems/npc-psychology.md) §10, §11, §13, §15, §16)
- [ ] Proyectos cooperativos de aldea y caravanas: participantes con `knownPlan`, pool con conservación, repartos con compromisos, free riders ([schemes.md](systems/schemes.md) §9)
- [ ] Oscilaciones oceánicas de pocos años (años buenos y malos) para la región ([planet-gen.md](systems/planet-gen.md) §3)
- [ ] Suelos por parcela con nutrientes que se mueven, agotamiento, barbecho y abono; rendimientos que alimentan la presión de hambre ([planet-gen.md](systems/planet-gen.md) §9)
- [ ] Poblaciones por celda con productividad y red trófica simple; caza, pesca, recolección y tala que agotan stocks; ganado como bien vivo con cuerpo, dueño y zoonosis; sucesión en campos abandonados; fuego con combustible ([living-world.md](systems/living-world.md) §8, §9, §12)
- [ ] Ofrendas como lotes con destino (quemado, enterrado, comido), gasto de funerales y endeudamiento, oficios de culto (incienso, papel, tablillas) ([spirits.md](systems/spirits.md) §6, §11)
- [ ] Conversaciones fuera de escena como actos, grupos y oyentes de costado, promesas que crean compromisos, interrogatorios ([dialogue.md](systems/dialogue.md) §7, §12, §15)
- [ ] Montaje para saltos de tiempo, textos dentro del mundo redactados una vez y guardados con el objeto, sueños narrados ([narration.md](systems/narration.md) §1, §12)
- [ ] Rutinas con delegación de lo chico, interrupciones configurables, montaje y "qué pasó mientras", metas del personaje, viñetas de infancia ([player-loop.md](systems/player-loop.md) §2, §5-§8)
- [ ] Escenarios, `sim:batch`, `sim:diff`, reporte HTML, primeros objetivos de calibración en `content/tuning/`, snapshots con diffs y `at <tick>`, paquetes de reproducción ([tooling.md](systems/tooling.md) §5-§7, §9)
- [ ] Hogares que construyen y reparan como sesión de oficio, deterioro por clima y uso, fuego con propagación y respuesta, agua y saneamiento con contagio ([settlements.md](systems/settlements.md) §6-§9)
- [ ] Venta, arriendo y aparcería como compromisos; prendas que se ejecutan; herencia con partición; comunales con reglas; mojones y disputas de límites ([property.md](systems/property.md) §4-§10)
- [ ] Viajes de varios días con montaje e interrupciones; posadas; animales de carga y regla del carro; carga como lotes con pérdidas ([travel.md](systems/travel.md) §2, §4-§6, §15)

## Fase 4 — Cultivo
- [ ] Raíces espirituales, afinidades, meridianos, alma
- [ ] Cobro en las Fuentes al cruzar (esencia, años, karma neto, mérito) y vías para seguir en otro cuerpo como poderes ganados ([heaven-karma.md](systems/heaven-karma.md), [cultivation.md](systems/cultivation.md) §14)
- [ ] Elementos en el cultivo: absorción por coincidencia, refinamiento por generación, tensión del `elementMix`, daño elemental por órgano, técnicas con vector, sentido de la esencia que lee elementos ([elements.md](systems/elements.md))
- [ ] Cuerpo y cultivo: daño de meridianos, desviación de qi, toxicidad de píldoras, refinamiento corporal ([body-health.md](systems/body-health.md))
- [ ] Ley del cultivo (umbrales reales) + escuelas con reinos culturales; absorción con conservación, rupturas, fundamento, técnicas y manuales ([cultivation.md](systems/cultivation.md))
- [ ] Percepción de nivel de cultivo ajeno (con incertidumbre)
- [ ] Combate con técnicas: esencia, choques con `interact`, escudos, cuerpo refinado, mortal contra cultivador, contragolpe, intención asesina ([combat.md](systems/combat.md) §8-§10)
- [ ] Piedras espirituales como moneda y combustible, cambio plata–piedras, mercado de píldoras y hierbas, casa de subastas ([economy.md](systems/economy.md))
- [ ] Secta mínima: prueba de ingreso con instrumentos con error, rangos sobre reinos culturales, maestro y discípulo, sueldos y puntos de contribución ([organizations.md](systems/organizations.md))
- [ ] Técnicas de cultivo como repertorio, techos que suben con el cultivo, insights que mueven facetas, `composure` con presión real ([skills.md](systems/skills.md) §3.3, §4.2)
- [ ] Verbos esotéricos (cultivar, técnicas, talismanes, juramentos) con requisitos de umbral; reflejos ([actions.md](systems/actions.md) §2, §6)
- [ ] Alquimia (hornos, fuegos de tierra y propio, tensión, toxicidad residual, señales visibles) y talismanes simples ([crafts.md](systems/crafts.md))
- [ ] Juramentos ante el Cielo y sobre el corazón del Dao (karma y demonios internos), juramentos de secreto, sellos simples en el alma, maestro–discípulo como compromiso ([contracts.md](systems/contracts.md))
- [ ] Herencia de la aptitud de cultivo, ambiente prenatal, fertilidad de cultivadores, compañeros del Dao y cultivo dual ([family-lineage.md](systems/family-lineage.md))
- [ ] Abismo mortal/cultivador: presión del cultivo como señal social, sirvientes de secta, familias elevadas por un hijo cultivador, tributo de aldeas a sectas ([social-structure.md](systems/social-structure.md))
- [ ] Salón de disciplina de secta, sello y abolición del cultivo como pena, búsqueda del alma, residuos de qi como prueba ([law.md](systems/law.md))
- [ ] Talentos ocultos (descubiertos por percepción interna e hipótesis sobre uno mismo)
- [ ] Hipótesis sobre umbrales, dogmas de escuela, insights con `pending` e iluminación, contemplación de obras con intención, variantes y técnicas nuevas evaluadas por la ley ([discovery.md](systems/discovery.md))
- [ ] Lugares sellados simples (cuevas de herencia, tumbas) con libro de contenido, detalle diferido con restricciones, llaves y trampas, remanentes de alma como guardianes ([secret-realms.md](systems/secret-realms.md))
- [ ] Lectura de qi residual como método de datación ([deep-history.md](systems/deep-history.md) §3)
- [ ] Lectura de karma como técnica (ruido, velos, reacción), símbolos e interpretación con vocabularios por cultura ([divination.md](systems/divination.md))
- [ ] Atención del Cielo finita repartida por saliencia; tribulaciones como eventos con olas, energía del campo, ayudantes e intercepción del rayo; mérito ([heaven-karma.md](systems/heaven-karma.md) §3, §5, §7)
- [ ] Declive cognitivo y legitimidad; condiciones como raíces de demonios; sueños inyectados ([npc-psychology.md](systems/npc-psychology.md) §11, §12, §15)
- [ ] Bestias espirituales con núcleo y consumo de qi; bestia compañera con contrato de alma; criar desde la cría con período sensible ([living-world.md](systems/living-world.md) §8, §13)
- [ ] `qiPool` de santuarios, devoción con sinceridad, `upkeep` de espíritus, ancestros que se quedan con el linaje como ancla ([spirits.md](systems/spirits.md) §6-§8)
- [ ] Encierros largos de cultivo con alarmas arregladas dentro del mundo; jugar como espíritu ([player-loop.md](systems/player-loop.md) §5, §13)
- [ ] Talento elegido con genoma condicionado; marco `GoldenFinger` con `reveal`, `craft`, `learning`, `talent`, `body` y reglas compuestas (disparador, condición, acción) con los primeros tropos; mentor como remanente; firma y saliencia ante el Cielo; presets Alquimista divino y Genio celestial ([game-modes.md](systems/game-modes.md) §3-§7, §11)

## Fase 5 — Región y LOD
- [ ] Múltiples asentamientos, viajes, biomas
- [ ] Campos elementales entre celdas (fronteras, estaciones, sesgo por uso), elementos derivados por condiciones, ecología con afinidad ([elements.md](systems/elements.md))
- [ ] Zonas con cinco resoluciones e histéresis; tiers de agente 0–4 con importancia y cupos; materialización por ranuras con biografía sintetizada y hechos fijados; puesta al día de dormidos; flujos de borde; `Deferred` general ([simulation.md](systems/simulation.md) §4-§11)
- [ ] Scheduler multi-escala con presupuesto y degradación determinista; contrato `AggregateModel` con tests de calibración ([simulation.md](systems/simulation.md) §9, §13)
- [ ] Contratos entre comerciantes por rutas, encargos lejanos, venta de créditos, falsificación de documentos ([contracts.md](systems/contracts.md))
- [ ] Varias jurisdicciones y fronteras de huida, contrabando por rutas, puestos de control, mercado negro regional ([law.md](systems/law.md))
- [ ] Alcance del estado por celda, magistrado de condado con registro de hogares y recaudación con fugas, edictos como noticias ([state.md](systems/state.md))
- [ ] Comerciantes que arbitrajean por rutas, caravanas, peajes, precios que viajan como noticias, modo agregado de mercados calibrado contra el individual ([economy.md](systems/economy.md))
- [ ] Bestias en pelea con armas naturales e instinto; persecuciones por terreno ([combat.md](systems/combat.md) §12, §15)
- [ ] Bandas y milicias, escaramuzas y emboscadas, consumo diario de una fuerza pequeña, cautivos y rescates simples ([war.md](systems/war.md))
- [ ] `PopulationTech` por asentamiento, adopción por hogares con utilidad sobre creencias, difusión por rutas ([technology.md](systems/technology.md))
- [ ] Control del ancla de reinos secretos por organizaciones, cupos y fichas como bienes, mercados de apertura, relatos y mapas del interior como creencias ([secret-realms.md](systems/secret-realms.md))
- [ ] Oráculos y salones de adivinación como instituciones, astrólogos de corte, lectura de karma como prueba ([divination.md](systems/divination.md))
- [ ] Zonas ciegas (reinos, formaciones de ocultamiento, lugares extremos), inclinación a favor de los enemigos del deudor, calamidades como descarga del déficit ([heaven-karma.md](systems/heaven-karma.md) §4, §6)
- [ ] Suelos agregados por celda, erosión, salinización y desertificación por uso; volcanes con presión, erupciones y ceniza fértil ([planet-gen.md](systems/planet-gen.md) §9, §10)
- [ ] Migraciones estacionales con rutas aprendidas, cuellos de botella y barreras; trashumancia; introducciones por rutas comerciales con latencia; plagas de cultivos; `BeastMind` para monturas y bestias de tier 2-3 ([living-world.md](systems/living-world.md) §10, §11, §13)
- [ ] Depósitos con estratos y perturbaciones en los sitios de la región, excavar como sesión de oficio, saqueo con contexto destruido ([deep-history.md](systems/deep-history.md) §1, §6-§7)
- [ ] Worldgen mínimo de pasado para la región inicial: protolengua y una o dos hijas con cambio fonético, topónimos con derivación, secuencia de estilos por cultura ([deep-history.md](systems/deep-history.md) §11, [living-world.md](systems/living-world.md) §3)
- [ ] Lenguas e intérpretes en la conversación, dialectos que revelan origen, discursos a multitudes ([dialogue.md](systems/dialogue.md) §12, §13)
- [ ] Mapas PNG del inspector con capas, perfiles de rendimiento y benchmarks, poda de diffs, tamaño del guardado medido ([tooling.md](systems/tooling.md) §1, §5, §12)
- [ ] Dedos de oro `space` (reino propio), `provision` con ledger y `fortune` con reserva ([game-modes.md](systems/game-modes.md) §5.4, §5.5)
- [ ] Varios asentamientos con crecimiento, migración por atractivo creído y decaimiento; barrios, caminos y puentes; stock agregado con materialización ([settlements.md](systems/settlements.md) §3, §4, §8, §18)
- [ ] Catastros con brecha, concentración de la tierra como presión con métricas en la sim headless, parcelas materializadas desde agregados ([property.md](systems/property.md) §9, §11, §16)
- [ ] Red regional con peajes, controles y salvoconductos; encuentros desde el estado con tasas de cruce; caravanas y escolta; perderse y guías; ríos y barcas; flujos agregados por ruta ([travel.md](systems/travel.md) §1, §3, §7, §8, §11, §13, §16)

## Fase 6 — Organizaciones
- [ ] Modelo completo de organizaciones: membresía y lealtad, puestos y órganos con legitimidad, decisión por asuntos → deliberación → órdenes con brecha de ejecución, facciones emergentes, tesoro finito con corrupción y huellas, normas y disciplina, sucesión y crisis ([organizations.md](systems/organizations.md))
- [ ] Estructura por organización: formal y real con ejes continuos, atención finita del líder, líderes que no sueltan, concentración y dispersión por eventos ([organizations.md](systems/organizations.md) §3b)
- [ ] Órdenes como `ActionPlan` con `source: "order"` y brecha de ejecución; registro de verbos faltantes ([actions.md](systems/actions.md) §9, §10)
- [ ] Estilos y escuelas con secretos, linajes de saber y certificaciones; robo de estilos ([skills.md](systems/skills.md) §6)
- [ ] Duelos pactados, desafíos con cara, escenarios de vida o muerte; la pelea del jugador dentro de una batalla ([combat.md](systems/combat.md) §13, §14)
- [ ] Plantillas (como costumbre, no molde): clan, secta, gremio, casa comercial, templo, sociedad secreta
- [ ] Clanes con genealogías como documentos, ramas, salón ancestral, matrimonios de alianza, linajes de sangre que despiertan ([family-lineage.md](systems/family-lineage.md))
- [ ] Rangos de secta y clan sobre el modelo de estatus, cierre de élites, sellos de esclavo ([social-structure.md](systems/social-structure.md))
- [ ] Jurisdicciones superpuestas (secta, gremio, clan), pedidos de entrega, bandas y gremios de ladrones con su propia justicia ([law.md](systems/law.md))
- [ ] Estado sobre el modelo de organizaciones: corte con facciones, arreglos trono–secta, dominios de secta ([state.md](systems/state.md))
- [ ] Sectas que nacen de eventos (descubridor de técnica → escuela → secta)
- [ ] Registro de anomalías, herejía y cismas doctrinales, cultura epistémica, archivos y mecenazgo ([discovery.md](systems/discovery.md))
- [ ] Relaciones entre organizaciones: diplomacia por personas, fuerza ajena como creencia, jerarquías regionales, escalera de conflicto, cismas y absorciones
- [ ] Forja y refinación de artefactos (inscripciones, vínculo con el dueño, desgaste), formaciones como grafos sobre el campo de qi, salones de oficio, encargos y marcas ([crafts.md](systems/crafts.md))
- [ ] Tratados, vasallaje y tributo, rehenes, repudio en sucesiones, garantes y árbitros, contratos con bestias y espíritus, talismanes de contrato ([contracts.md](systems/contracts.md))
- [ ] Gremios, monopolios y cárteles, casas de cambio y letras, sueldos de secta, tributo de protección, mercado negro ([economy.md](systems/economy.md))
- [ ] Fuerzas como organizaciones (mando, órdenes con brecha, deserción), logística con líneas de suministro y forrajeo, moral con drivers, guerras de sectas con formaciones ([war.md](systems/war.md))
- [ ] Textos como objetos en archivos de organizaciones (crónicas de secta, genealogías, memorias) con autor y sesgo; encargar, escribir y quemar ([chronicle.md](systems/chronicle.md))
- [ ] 气运 derivado de organizaciones (venas + karma y mérito de sus miembros), venas como territorio disputado ([heaven-karma.md](systems/heaven-karma.md) §8)
- [ ] Multitudes con umbrales y cascadas (motines, linchamientos, estampidas, desbandadas), agravio colectivo, conversiones y modas ([npc-psychology.md](systems/npc-psychology.md) §13, §14, §16)
- [ ] Intrigas entre organizaciones con órdenes compartimentadas y modelo del gobierno del blanco; intrigantes que explotan profecías; traición desde adentro de expediciones ([schemes.md](systems/schemes.md) §9-§11)
- [ ] Tratados entre comunidades y reinos de bestias, razas secretas de sectas, mercado de bestias y partes protegidas ([living-world.md](systems/living-world.md) §12, §13)
- [ ] Salones ancestrales con tablillas, tierras de culto como compromiso entre ramas, abandono con etapas (hambre, enojo, tomar) y desenlaces, fantasmas hambrientos ([spirits.md](systems/spirits.md) §7-§11)
- [ ] Deliberación de organizaciones y audiencias formales como conversaciones de registro alto ([dialogue.md](systems/dialogue.md) §10)
- [ ] Misiones desde presiones y tienda con reserva finita (preset Sistema); rivales con dedo de oro ([game-modes.md](systems/game-modes.md) §5.6, §8)
- [ ] Montañas de secta con formaciones, pueblos bajo protección, obras públicas con mantenedor (diques que sedimentan, canales, graneros, murallas) ([settlements.md](systems/settlements.md) §8, §14)
- [ ] Tierras de clan, culto, templo y dominio de secta; feudos; cercamientos; usurpación del poderoso; venas y cuevas disputadas ([property.md](systems/property.md) §4, §7, §10, §13)
- [ ] Vuelo con costo de qi y visibilidad; monturas espirituales; anillos de almacenamiento; fronteras de secta y zonas sin vuelo ([travel.md](systems/travel.md) §5, §6, §10)

## Fase 7 — Historia procedural
- [ ] Pipeline completo de worldgen (cosmología → … → NPCs)
- [ ] Resolución "history" con el embudo de épocas y transición continua de la historia al presente en el mismo scheduler ([simulation.md](systems/simulation.md) §16)
- [ ] Simulación histórica rápida (siglos) que deja ruinas, técnicas perdidas, rivalidades
- [ ] Descubrimiento como proceso de riesgo por población; pérdida y redescubrimiento ([discovery.md](systems/discovery.md))
- [ ] Ciclo de vida de organizaciones en modo agregado (procesos de riesgo de sucesión, cisma, colapso, nacimiento) con legados ([organizations.md](systems/organizations.md))
- [ ] Estructuras sociales que nacen en la historia: conquistas que crean castas, ideologías de la jerarquía ([social-structure.md](systems/social-structure.md))
- [ ] Estados que nacen y caen en la historia (conquistas, secesiones, dinastías) con legados; presagios leídos como juicio ([state.md](systems/state.md))
- [ ] Eras variables (temprana / dorada / decadente…)
- [ ] Generador de sistemas elementales por seed con validador; teorías elementales por cultura con dogmas sobre la matriz ([elements.md](systems/elements.md))
- [ ] Sistemas monetarios que nacen en la historia, acuñación y rebaja de ley, minas que se descubren y agotan, crisis monetarias ([economy.md](systems/economy.md))
- [ ] Guerras en la historia agregada con consecuencias demográficas, económicas y kármicas; conquistas y anexiones con legados ([war.md](systems/war.md))
- [ ] Invención y pérdida en la historia agregada, tecnología por cultura según geografía, ruinas con procesos perdidos, desplazamiento por cultivo ([technology.md](systems/technology.md))
- [ ] Reinos secretos creados por la historia profunda (creadores, propósitos, causas accidentales) con aperturas históricas, saqueos y degradación ([secret-realms.md](systems/secret-realms.md))
- [ ] Pronóstico por conocimiento (calendarios, ciclos), presagios naturales en la legitimidad, profecías como legados ([divination.md](systems/divination.md))
- [ ] Reescrituras por régimen, censura, estelas y canciones en la historia agregada; huella causal y legado recordado con el embudo; epílogo hasta que se apague el legado ([chronicle.md](systems/chronicle.md))
- [ ] Heridas del Cielo en la historia profunda, fuerza del Cielo por era, olas de tribulaciones postergadas al cerrarse una herida ([heaven-karma.md](systems/heaven-karma.md) §1, §4)
- [ ] Contrafácticos `whatif` en modo agregado y snapshots de presiones para el mapa histórico ([causality.md](systems/causality.md) §10, §11)
- [ ] Clima de largo plazo por época: glaciaciones, nivel del mar, puentes de tierra, costas y ruinas sumergidas; supervolcanes e impactos ([planet-gen.md](systems/planet-gen.md) §8, §10)
- [ ] Domesticaciones y razas como eventos de cultura, especiación por aislamiento, intercambios por puentes de tierra, extinciones, sucesión de largo plazo sobre ruinas ([living-world.md](systems/living-world.md) §8-§12)
- [ ] Cultos fundados por eventos, santuarios viejos que despiertan espíritus de lugar, ajuar enterrado para la arqueología ([spirits.md](systems/spirits.md) §7, §9, §11)
- [ ] Estratos de la historia agregada (montículos, horizontes de ceniza), `Assemblage` al compactar, secuencias de estilos por cultura, topónimos en capas con cambio fonético y etimologías populares, cicatrices de qi ([deep-history.md](systems/deep-history.md) §1-§5, §10)
- [ ] Nueva partida: generación con progreso por épocas sin spoilers, nacimiento del personaje elegido de la población ([player-loop.md](systems/player-loop.md) §1)
- [ ] Migraciones del formato con límite de replay; contenido huérfano ([tooling.md](systems/tooling.md) §4)
- [ ] `project` (simulador, premonición) y `rewind` (volver al morir) sobre copias y snapshots; resto del catálogo de tropos de dedos de oro ([game-modes.md](systems/game-modes.md) §5.9, §5.10)
- [ ] Fijar hechos con origen en la historia (linajes, artefactos de reinos caídos); memorias de vidas pasadas y regresión; armador paso a paso en la CLI; guardados `checkpoints` y `free` ([game-modes.md](systems/game-modes.md) §2.2, §5.8, §9, §11)
- [ ] Fundación, crecimiento, abandono y ruinas de asentamientos en la historia, con reuso de materiales y estratos ([settlements.md](systems/settlements.md) §2, §11, §12)
- [ ] Reformas, conquistas y repartos en la historia; restituciones que duran generaciones ([property.md](systems/property.md) §5, §11)
- [ ] Rutas que nacen y mueren en la historia; formaciones de teletransporte construidas por la historia ([travel.md](systems/travel.md) §1, §10)

## Fase 8 — Mundo completo
- [ ] Naciones, guerras, política (estado y ejército sobre el modelo de [organizations.md](systems/organizations.md))
- [ ] Economía de guerra (metal, levas, saqueo), billetes de estado, corridas ([economy.md](systems/economy.md))
- [ ] Nobleza y exámenes, esclavitud de guerra, revueltas que se vuelven ejércitos, edictos que cambian estatus ([social-structure.md](systems/social-structure.md))
- [ ] Códigos del estado, magistrados, cárceles, apelaciones, inspectores, edictos que viajan como noticia ([law.md](systems/law.md))
- [ ] Fiscalidad completa, burocracia con informes deformados, exámenes, sucesiones de trono, rebeliones, señores de la guerra, sistemas de tributo ([state.md](systems/state.md))
- [ ] Batallas por fases con terreno, asedios completos, epidemias de campamento, refugiados, treguas y tratados, costumbres de guerra, campos de batalla con espíritus ([war.md](systems/war.md))
- [ ] Imprenta y su efecto en información y exámenes, secretos de oficio y espionaje, represión de sectas, híbridos qi–técnica, consecuencias ambientales ([technology.md](systems/technology.md))
- [ ] Bolsillos de espacio con grilla interior, campo de qi y ecología cerrada, reglas internas, colapsos como desastres, crear un reino ([secret-realms.md](systems/secret-realms.md))
- [ ] Proyección del futuro con el modelo agregado y forks propios, profecías fabricadas, reacción del Cielo ([divination.md](systems/divination.md))
- [ ] Eventos mundiales que ocurren sin el jugador
- [ ] Rivales/genios en otras partes del mundo
- [ ] Inviernos volcánicos con aerosol por bandas y sus cadenas (hambre, presagios, legitimidad); estrellas caídas como materiales ([planet-gen.md](systems/planet-gen.md) §10)
- [ ] Intercambio biológico entre continentes al cruzar océanos (cultivos, ganado, malezas, enfermedades) ([living-world.md](systems/living-world.md) §10)
- [ ] Dioses locales que compiten por fieles, canonización y prohibición de cultos por el estado, dioses que se matan por su qi ([spirits.md](systems/spirits.md) §9)
- [ ] Mercado de antigüedades y falsificaciones, eruditos y tratados, escuelas de historia con dogmas y cismas, arqueología como arma de legitimidad, correlación de calendarios ([deep-history.md](systems/deep-history.md) §3, §7-§8)
- [ ] Ciudades grandes con LOD de barrios completo; nómadas y campamentos móviles ([settlements.md](systems/settlements.md) §15, §18)
- [ ] Dos culturas con normas de propiedad distintas sobre la misma tierra; nómadas y agricultores; territorios de bestias y espíritus ([property.md](systems/property.md) §4, §14)
- [ ] Mar con vientos, corrientes y monzones; barcos como objetos; naufragios y pecios; piratas; navegación de altura ([travel.md](systems/travel.md) §9)

## Fase 9 — Pulido
- [ ] UI web (Vite + React): chat + mapa + panel del personaje + crónica
- [ ] Archivo de crónicas de vidas pasadas, encadenado de vidas en un mismo mundo por renacimiento ([chronicle.md](systems/chronicle.md))
- [ ] Fine-tune LoRA propio de un modelo local con ejemplos reales del juego (no salidas de Claude) ([narration.md](systems/narration.md) §1)
- [ ] Armador web del modo novela; archivo de vidas con marcas y la verdad del dedo de oro ([game-modes.md](systems/game-modes.md) §11, §12)
- [ ] Inspector web con mapas interactivos; corpus de pares pedido → texto aprobado para el fine-tune ([tooling.md](systems/tooling.md) §5, §10)

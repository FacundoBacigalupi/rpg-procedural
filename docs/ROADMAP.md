# Roadmap

**Fuente única de "qué sigue".** Cuando preguntes "¿con qué seguimos?", la respuesta sale de la sección **Ahora** de este archivo. Al terminar algo: marcarlo, moverlo y elegir el siguiente.

Construcción por capas: cada fase deja algo **jugable o inspeccionable**.

Estado: `[ ]` pendiente · `[~]` en curso · `[x]` hecho

## ▶ Ahora (en orden)
**Backlog de diseño** (acordado el 2026-10-05). Se hace **de a un ítem**, en orden: el siguiente es **el primer `[ ]` de la lista** (al 2026-10-05: **#10, contratos y juramentos**). La **Fase 0 (scaffold)** se puede intercalar en cualquier momento si se quiere empezar a codear.

**Receta por ítem** (lo que hay que hacer cuando el usuario dice "continuá"):
1. `git switch develop && git pull`, después rama `docs/<nombre>`.
2. Leer los docs que el ítem toca o de los que depende (la línea "Depende de" de los docs vecinos) y escribir `docs/systems/<nombre>.md` (o ampliar el existente en la parte C) con el formato de siempre: nota de estado, Depende de / Lo usan, Principios, secciones numeradas con interfaces TS, el jugador y el narrador, Escala (LOD), Implementación por fase, Tests, Decisiones (revisables), Preguntas abiertas. Máximo detalle, siempre respetando las reglas de CLAUDE.md (causalidad, conservación, verdad vs creencia, determinismo).
3. En el mismo PR: marcar el ítem `[x]` acá con el enlace, sumarlo a la sección "Diseño" como borrador, sumar tareas a las fases que corresponda, agregar el doc a la lista de CLAUDE.md, enlazarlo desde los docs que lo mencionaban como "futuro", y pasar las preguntas abiertas de calibración a "Estado del diseño".
4. Commit (`docs(<área>): ...`), push, `gh pr create --base develop --label design`, y mergear con `gh pr merge <n> --squash --delete-branch` **como comando suelto** (sin `&&` ni pipes). Sin CI en develop.
5. Contarle al usuario qué quedó y proponer el siguiente ítem. Si hay preguntas de diseño (no de calibración), explicarlas con una recomendación.

### A. Sistemas base que otros docs ya dan por hechos
1. [x] **Percepción** → [perception.md](systems/perception.md): canales, emisión, propagación, atención, errores con forma, huellas, lectura de cultivo.
2. [x] **Información y rumores** → [information.md](systems/information.md): propagación con distorsión, canales (postas, palomas, talismanes de mensaje, espías), creencias en `sim/knowledge`, el mapa como creencia (mapas como objetos que envejecen y se falsifican), alfabetización y escrituras.
3. [x] **Cuerpo y salud** → [body-health.md](systems/body-health.md): cuerpo por partes, heridas que se infectan o dejan secuelas, enfermedades crónicas, nutrición, frío/calor, fatiga, adicciones, envejecimiento, medicina mortal vs alquimia, daño a meridianos.
4. [x] **Cultivo** → [cultivation.md](systems/cultivation.md) (familia xianxia, con las interfaces genéricas de [metaphysics.md](systems/metaphysics.md)): reinos procedurales, técnicas como conocimiento, rupturas, cultivo de espíritus, volver a ser humano.
5. [x] **Experimentación, descubrimiento e iluminación** → [discovery.md](systems/discovery.md): cómo un agente forma hipótesis sobre las leyes del mundo, prueba, se equivoca y acumula comprensión; dogmas erróneos de escuelas; iluminación (悟) como umbral de un estado acumulado; arte con intención (aprender contemplando una obra).
6. [x] **Economía** → [economy.md](systems/economy.md): mercados por asentamiento, precios por oferta y demanda, información asimétrica de precios, piedras espirituales como moneda (inflación por minas), crédito y usura, subastas, gremios y monopolios, metal escaso.
7. [x] **Organizaciones** → [organizations.md](systems/organizations.md): clanes, sectas, gremios; decisiones por facciones internas; nacimiento, cismas y muerte; recursos, aportes y puestos.

### B. Sistemas nuevos
8. [x] **Interacciones elementales** → [elements.md](systems/elements.md) (ampliación de [metaphysics.md](systems/metaphysics.md)): ciclos de generación y destrucción como física común para alquimia, formaciones y combate. Va antes de oficios porque estos la usan.
9. [x] **Oficios** → [crafts.md](systems/crafts.md): alquimia con propiedades y toxinas residuales, forja limitada por el metal escaso, formaciones que modifican el campo de qi real, talismanes.
10. [ ] **Contratos y juramentos** → `contracts.md`: un modelo único para deudas, matrimonios, maestro–discípulo, alianzas y pactos, con cumplimiento social, legal o kármico (unifica `debts`, `bonds` y `KarmicBond`).
11. [ ] **Familia y linaje** → `family-lineage.md`: matrimonio y alianzas, sexualidad, hijos ilegítimos, herencias y disputas, cultivo dual, fertilidad baja en cultivadores, genealogías de clan.
12. [ ] **Estratificación social** → `social-structure.md`: castas, servidumbre, esclavitud, movilidad social, abismo mortal/cultivador; qué acciones tiene cada uno a su alcance.
13. [ ] **Ley y justicia** → `law.md`: códigos por cultura, crímenes, investigación (huellas), jueces corruptos, castigos, sectas por encima de la ley, vendetta vs tribunal, reglas internas de secta, contrabando y mercado negro.
14. [ ] **Estado y política** → `state.md`: legitimidad, impuestos, burocracia, exámenes imperiales, crisis de sucesión, relación trono–secta.
15. [ ] **Guerra** → `war.md`: logística y suministro, moral, asedios, formaciones defensivas, ejércitos mortales vs cultivadores.
16. [ ] **Tecnología mortal** → `technology.md`: agricultura, metalurgia, escritura, imprenta; difusión de innovaciones con el modelo de información.
17. [ ] **Reinos secretos (秘境)** → `secret-realms.md`: bolsillos dimensionales con creador, que se abren con las mareas de qi, saqueados antes y degradándose por dentro.
18. [ ] **Adivinación y profecía** → `divination.md`: lectura ruidosa del grafo causal y de las presiones; profecías que se cumplen solas o provocan lo que querían evitar; lectura de karma.
19. [ ] **Crónica, epílogo e historiografía** → `chronicle.md`: epílogo simulado N años después de morir; crónicas in-world sesgadas; el legado como lo que se recuerda de vos.

### C. Ampliaciones de lo que ya hay
20. [ ] [heaven-karma.md](systems/heaven-karma.md): atención del Cielo como recurso finito, zonas ciegas, robar el rayo de una tribulación ajena, el Cielo inclina tiradas a favor de los enemigos de quien sobreexplota, fortuna colectiva (气运) de organizaciones y naciones.
21. [ ] [npc-psychology.md](systems/npc-psychology.md): desarrollo por etapas, salud mental (depresión, estrés postraumático, adicción), declive cognitivo, necesidad de sentido y pertenencia, psicología de multitudes, sueños que consolidan memorias, gustos personales generados.
22. [ ] [causality.md](systems/causality.md) + [schemes.md](systems/schemes.md): mapa de presiones en el inspector; generalizar `Scheme` a proyectos (planes cooperativos); intrigas entre organizaciones; intrigantes que explotan profecías.
23. [ ] [planet-gen.md](systems/planet-gen.md): glaciaciones y nivel del mar ligados a las mareas de qi (puentes de tierra), suelos que se agotan, inviernos volcánicos.
24. [ ] [living-world.md](systems/living-world.md): sucesión ecológica, especies invasoras por rutas comerciales, migraciones estacionales, domesticación y contratos con bestias.
25. [ ] [spirits.md](systems/spirits.md): economía de ofrendas a ancestros; qué pasa cuando un linaje deja de ofrendar.
26. [ ] [deep-history.md](systems/deep-history.md): arqueología como juego (estratos, datación de objetos, nombres de lugares deformados como pistas).

### Después del backlog
- [ ] **Fase 0: scaffold** (TS strict, Vitest, ESLint con reglas de dependencia, scripts npm), que activa los checks de CI. Ver la sección Fase 0 más abajo.

## Estado del diseño (2026-10-05)
Todo el diseño base está escrito en `docs/systems/` y mergeado en `develop`. Las preguntas de diseño se respondieron el 2026-10-05; lo que queda es **calibración con la sim headless** (cada doc tiene sus objetivos de sensación):
- deep-history: reglas agregadas vs individuales.
- npc-psychology: top-N memorias por NPC de tier 2 (arranca en 20).
- perception: curvas de atenuación y `k` de la sigmoide.
- body-health: curación, infección y mortalidad.
- cultivation: tasas de absorción, dificultad de rupturas y longevidad por umbral (forma de la pirámide de cultivadores).
- discovery: integración de `pending`, umbrales de iluminación y habituación; tasas de descubrimiento por cultura y caída de dogmas; ruido de observación y ventana de atribución (supersticiones comunes pero no universales).
- organizations: frecuencia de cismas, sucesiones disputadas y colapsos; vida media por tipo; tamaño a partir del cual aparecen facciones; pesos organización/facción/uno mismo (corrupción común pero no universal).
- elements: `λ`, `κ`, `ρ` y pérdida de generación (ventaja elemental que importa sin decidir sola); velocidad con que el uso sesga el campo de una celda; frecuencia de raíces mutadas y derivados.
- crafts: tasas de estallido y calidad por habilidad; velocidad de aprendizaje y techo por cultivo; duración de cargas y desgaste de artefactos; cuántos momentos de decisión tiene una sesión larga.
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
- [x] Modelo causal del mundo ([systems/causality.md](systems/causality.md))
- [x] El Cielo y el karma ([systems/heaven-karma.md](systems/heaven-karma.md))
- [~] Historia profunda por relevancia ([systems/deep-history.md](systems/deep-history.md)) — borrador
- [~] Psicología de NPCs ([systems/npc-psychology.md](systems/npc-psychology.md)) — borrador
- [x] Generación del planeta ([systems/planet-gen.md](systems/planet-gen.md))
- [~] Metafísica: leyes por mundo ([systems/metaphysics.md](systems/metaphysics.md)) — borrador
- [x] Mundo vivo ([systems/living-world.md](systems/living-world.md))
- [~] Espíritus ([systems/spirits.md](systems/spirits.md)) — borrador
- [~] Intrigas de NPCs ([systems/schemes.md](systems/schemes.md)) — borrador
- [~] Percepción ([systems/perception.md](systems/perception.md)) — borrador
- [~] Información, creencias y rumores ([systems/information.md](systems/information.md)) — borrador
- [~] Cuerpo y salud ([systems/body-health.md](systems/body-health.md)) — borrador
- [~] Cultivo ([systems/cultivation.md](systems/cultivation.md)) — borrador
- [~] Descubrimiento e iluminación ([systems/discovery.md](systems/discovery.md)) — borrador
- [~] Economía ([systems/economy.md](systems/economy.md)) — borrador
- [~] Interacciones elementales ([systems/elements.md](systems/elements.md)) — borrador
- [~] Oficios ([systems/crafts.md](systems/crafts.md)) — borrador
- [~] Organizaciones ([systems/organizations.md](systems/organizations.md)) — borrador

## Fase 0 — Fundamentos
- [ ] Scaffold: TS strict, Vitest, ESLint (con reglas de dependencia), scripts npm, GitHub Actions (typecheck + tests)
- [ ] `core/rng` con seed y sub-streams + test de determinismo
- [ ] `core/time`: calendario, avance multi-escala
- [ ] Modelo de `Event` con `causes` + `originEventId` + tests de invariantes (sin huérfanos, conservación)
- [ ] Persistencia SQLite mínima (guardar/cargar mundo + log de eventos)
- [ ] Loop CLI: leer input → (stub) → imprimir

## Fase 1 — Vertical slice: una aldea, 20 NPCs, acción libre
- [ ] Planet-gen mínima (grilla, tectónica, clima, biomas, qi, PNG) para ubicar la aldea
- [ ] Elementos: cinco fases en `content/`, vector elemental del qi de cada celda, `interact` puro con tests de conservación y sin móvil perpetuo ([elements.md](systems/elements.md))
- [ ] Aldea + bosque cercano hardcodeados/semigenerados
- [ ] Jugador con stats generados por seed
- [ ] Catálogo de ~10 acciones (moverse, buscar/recolectar, hablar, trabajar, descansar, robar, pelear, comerciar, observar, esperar)
- [ ] Economía mínima: lotes con origen, tenencias finitas para todos (sin fondos ni reposición infinita), inventarios, moneda de cobre y trueque, comerciar con regateo simple, comida que se pudre ([economy.md](systems/economy.md))
- [ ] Resolución con resultados matizados
- [ ] Sesión de oficio mínima (cocina o herrería de aldea): pasos con ruido de control, física simple, producto con calidad y origen ([crafts.md](systems/crafts.md))
- [ ] Intent parser (Claude) → ActionPlan validado
- [ ] Percepción mínima (vista y oído, grafo de espacios de la aldea, luz) ([perception.md](systems/perception.md))
- [ ] Narrador (Claude) solo con los percepts del jugador
- [ ] Cuerpo mínimo: heridas con sangrado e infección, hambre, sed, fatiga, muerte con causa ([body-health.md](systems/body-health.md))
- [ ] Muerte → pantalla de crónica
- [ ] Inspector god-mode básico

## Fase 2 — Psicología y memoria
- [ ] Rasgos innatos + adquiridos
- [ ] Relaciones multidimensionales
- [ ] Memorias de eventos con intensidad, confianza, degradación
- [ ] Conocimiento vs verdad (creencias sobre el jugador)
- [ ] Creencias `law` como hipótesis con evidencia desde percepts; diario de hipótesis del jugador ([discovery.md](systems/discovery.md))
- [ ] Diálogo de NPCs condicionado por personalidad/memorias

## Fase 3 — Vida offscreen, familias y economía
- [ ] IA de utilidad: objetivos en capas que compiten
- [ ] Rutinas diarias, NPCs actúan sin el jugador
- [ ] Familias, herencia de rasgos, crianza → rasgos adquiridos
- [ ] Enfermedades con contagio, médicos, sustancias y adicciones, nutrición, frío/calor ([body-health.md](systems/body-health.md))
- [ ] Economía básica: hogares con presupuesto, producción agrícola y de oficios, mercado de la aldea con precios por creencias, salarios, crédito de cosecha y usura, calidad percibida y estafa, hambruna con causa ([economy.md](systems/economy.md))
- [ ] Medicina y remedios mortales, venenos y antídotos, habilidad que sale de la práctica percibida, aprendices ([crafts.md](systems/crafts.md))
- [ ] Saber popular de hierbas y medicina como prior cultural, herbolario que experimenta, supersticiones con mecanismo, ventana de atribución ([discovery.md](systems/discovery.md))
- [ ] Rumores (propagación de información con distorsión, reputación por comunidad) ([information.md](systems/information.md))
- [ ] Intrigas F1-F2: asesinato/robo motivados, cebos con rumores falsos, cómplices ([schemes.md](systems/schemes.md))
- [ ] Consejo de aldea como primera organización, bandas de bandidos que nacen del hambre, lealtad como relación con la organización ([organizations.md](systems/organizations.md))

## Fase 4 — Cultivo
- [ ] Raíces espirituales, afinidades, meridianos, alma
- [ ] Elementos en el cultivo: absorción por coincidencia, refinamiento por generación, tensión del `elementMix`, daño elemental por órgano, técnicas con vector, sentido de la esencia que lee elementos ([elements.md](systems/elements.md))
- [ ] Cuerpo y cultivo: daño de meridianos, desviación de qi, toxicidad de píldoras, refinamiento corporal ([body-health.md](systems/body-health.md))
- [ ] Ley del cultivo (umbrales reales) + escuelas con reinos culturales; absorción con conservación, rupturas, fundamento, técnicas y manuales ([cultivation.md](systems/cultivation.md))
- [ ] Percepción de nivel de cultivo ajeno (con incertidumbre)
- [ ] Piedras espirituales como moneda y combustible, cambio plata–piedras, mercado de píldoras y hierbas, casa de subastas ([economy.md](systems/economy.md))
- [ ] Secta mínima: prueba de ingreso con instrumentos con error, rangos sobre reinos culturales, maestro y discípulo, sueldos y puntos de contribución ([organizations.md](systems/organizations.md))
- [ ] Alquimia (hornos, fuegos de tierra y propio, tensión, toxicidad residual, señales visibles) y talismanes simples ([crafts.md](systems/crafts.md))
- [ ] Talentos ocultos (descubiertos por percepción interna e hipótesis sobre uno mismo)
- [ ] Hipótesis sobre umbrales, dogmas de escuela, insights con `pending` e iluminación, contemplación de obras con intención, variantes y técnicas nuevas evaluadas por la ley ([discovery.md](systems/discovery.md))

## Fase 5 — Región y LOD
- [ ] Múltiples asentamientos, viajes, biomas
- [ ] Campos elementales entre celdas (fronteras, estaciones, sesgo por uso), elementos derivados por condiciones, ecología con afinidad ([elements.md](systems/elements.md))
- [ ] Tiers de NPC 0–4, materialización coherente con estadísticas
- [ ] Scheduler multi-escala eficiente
- [ ] Comerciantes que arbitrajean por rutas, caravanas, peajes, precios que viajan como noticias, modo agregado de mercados calibrado contra el individual ([economy.md](systems/economy.md))

## Fase 6 — Organizaciones
- [ ] Modelo completo de organizaciones: membresía y lealtad, puestos y órganos con legitimidad, decisión por asuntos → deliberación → órdenes con brecha de ejecución, facciones emergentes, tesoro finito con corrupción y huellas, normas y disciplina, sucesión y crisis ([organizations.md](systems/organizations.md))
- [ ] Estructura por organización: formal y real con ejes continuos, atención finita del líder, líderes que no sueltan, concentración y dispersión por eventos ([organizations.md](systems/organizations.md) §3b)
- [ ] Plantillas (como costumbre, no molde): clan, secta, gremio, casa comercial, templo, sociedad secreta
- [ ] Sectas que nacen de eventos (descubridor de técnica → escuela → secta)
- [ ] Registro de anomalías, herejía y cismas doctrinales, cultura epistémica, archivos y mecenazgo ([discovery.md](systems/discovery.md))
- [ ] Relaciones entre organizaciones: diplomacia por personas, fuerza ajena como creencia, jerarquías regionales, escalera de conflicto, cismas y absorciones
- [ ] Forja y refinación de artefactos (inscripciones, vínculo con el dueño, desgaste), formaciones como grafos sobre el campo de qi, salones de oficio, encargos y marcas ([crafts.md](systems/crafts.md))
- [ ] Gremios, monopolios y cárteles, casas de cambio y letras, sueldos de secta, tributo de protección, mercado negro ([economy.md](systems/economy.md))

## Fase 7 — Historia procedural
- [ ] Pipeline completo de worldgen (cosmología → … → NPCs)
- [ ] Simulación histórica rápida (siglos) que deja ruinas, técnicas perdidas, rivalidades
- [ ] Descubrimiento como proceso de riesgo por población; pérdida y redescubrimiento ([discovery.md](systems/discovery.md))
- [ ] Ciclo de vida de organizaciones en modo agregado (procesos de riesgo de sucesión, cisma, colapso, nacimiento) con legados ([organizations.md](systems/organizations.md))
- [ ] Eras variables (temprana / dorada / decadente…)
- [ ] Generador de sistemas elementales por seed con validador; teorías elementales por cultura con dogmas sobre la matriz ([elements.md](systems/elements.md))
- [ ] Sistemas monetarios que nacen en la historia, acuñación y rebaja de ley, minas que se descubren y agotan, crisis monetarias ([economy.md](systems/economy.md))

## Fase 8 — Mundo completo
- [ ] Naciones, guerras, política (estado y ejército sobre el modelo de [organizations.md](systems/organizations.md))
- [ ] Economía de guerra (metal, levas, saqueo), billetes de estado, corridas ([economy.md](systems/economy.md))
- [ ] Eventos mundiales que ocurren sin el jugador
- [ ] Rivales/genios en otras partes del mundo

## Fase 9 — Pulido
- [ ] UI web (Vite + React): chat + mapa + panel del personaje + crónica
- [ ] Archivo de crónicas de vidas pasadas

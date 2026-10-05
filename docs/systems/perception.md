# Percepción

> Estado: **borrador de diseño**. Es la **única puerta** entre la verdad del mundo (`WorldTruth`) y lo que cualquier agente cree. Nadie (NPC, jugador, espíritu, bestia) se entera de algo si no lo percibió, lo infirió de algo percibido o se lo contaron. El sistema de información ([information.md](information.md), pendiente) arranca donde termina este.

Depende de: [causality.md](causality.md) (Ley 4: se actúa según lo que se cree), [planet-gen.md](planet-gen.md) (terreno, clima, luz, qi ambiental), [metaphysics.md](metaphysics.md) (qué sentidos extra existen en cada mundo). Lo usan: [npc-psychology.md](npc-psychology.md) (interpretación, memorias `witnessed`), [schemes.md](schemes.md) (huellas, "nadie me vio"), [spirits.md](spirits.md) (ver espíritus), el narrador.

## Principios
1. **Nada se sabe gratis.** Toda memoria `witnessed` apunta a un `Percept`, y todo `Percept` apunta a un evento o entidad real. El narrador del jugador recibe percepts, nunca eventos.
2. **Percibir no es binario.** Entre "no vio nada" y "vio todo" hay grados: algo se movió, una persona, un hombre armado, Zhao con un cuchillo. Cada dato se percibe (o no) por separado.
3. **Los errores tienen forma.** Cuando alguien percibe mal, completa el hueco con lo que **espera** ver (sus creencias, esquemas y miedos), no con ruido. El miedoso ve un bandido donde había un leñador.
4. **Física, no permisos.** No hay un flag `visibility: public`. Lo que llega depende de cuánto emite el estímulo, cómo se propaga en ese entorno y qué tan bueno es el receptor.
5. **Determinista.** Cada tirada usa `rng.fork("perception", eventId, observerId)`. El mismo seed y las mismas acciones dan los mismos testigos y los mismos errores.

## 1. Canales
Cada estímulo viaja por uno o más canales. Los dos últimos son genéricos (`Essence`, `Soul`) y su forma concreta depende de las leyes del mundo:

| Canal | Qué lleva | Propagación | Qué lo tapa |
|---|---|---|---|
| **Vista** | Forma, movimiento, color, cara, gestos, objetos | Línea de visión, cae con la distancia; necesita luz | Paredes, vegetación, relieve, oscuridad, niebla, lluvia, humo |
| **Oído** | Voces (y palabras), pasos, golpes, gritos, metal | Rodea obstáculos, cae con la distancia; el viento lo lleva | Ruido de fondo (río, lluvia, mercado, viento), paredes gruesas |
| **Olfato** | Sangre, humo, comida, cuerpos, individuos (para bestias) | Difusión lenta **a favor del viento**; persiste en el lugar | Viento en contra, lluvia, olores fuertes que lo enmascaran |
| **Tacto / térmico** | Temblores, calor, frío, vibración en el suelo | Contacto o muy corta distancia; el suelo propaga pisadas pesadas | Distancia |
| **Gusto** | Venenos, ingredientes, calidad | Solo al ingerir | — (es la última defensa contra un veneno) |
| **Esencia** (sentido del qi) | Auras: presencia, intensidad, elemento, técnica que se usa, intención asesina (杀气) | Radio del receptor, cae con la distancia | Qi ambiental denso (como ruido), formaciones, supresión de aura |
| **Alma** (sentido espiritual, 神识) | Presencia de almas y espíritus, emociones fuertes, la "firma" de un alma | Radio que escala con la fuerza del alma; atraviesa paredes | Sellos, técnicas de ocultamiento del alma, yin denso |

- **Karma** no es un canal sensorial. Solo lo leen técnicas específicas de adivinación ([heaven-karma.md](heaven-karma.md)) y va en el doc de adivinación.
- En un mundo sin esencia ambiental (ver metaphysics), el canal Esencia no existe o cambia de forma (sentir el mana de un hechizo, oler la sangre de un pacto). Si no hay alma, no hay canal Alma.

## 2. Emisión: qué produce cada cosa
Todo evento y toda entidad tiene un **perfil de emisión** por canal: un número de intensidad más los **atributos** que se pueden leer por ese canal.

```ts
interface Emission {
  channel: Channel;
  intensity: number;            // base, antes de propagar
  attributes: AttrEmission[];   // qué datos lleva y qué tan legibles son
}

interface AttrEmission {
  key: PerceptKey;              // "actor.identity", "actor.weapon", "action.kind", "speech.words", "aura.realm"…
  value: unknown;               // el valor real (verdad)
  legibility: number;           // cuánta señal hace falta para leerlo (la cara pide más que "hay una persona")
}
```

- Las **acciones** del catálogo traen su perfil: caminar emite poco, correr más, pelear mucho, gritar muchísimo por oído. La **manera** del `ActionPlan` lo modifica: "en silencio", "a escondidas", "a plena vista", "imponiendo el aura".
- El **cuerpo** emite según su tamaño, su ropa (colores, metal que suena), su olor y sus heridas (sangre).
- **El aura** emite según el cultivo: intensidad, elemento dominante y "profundidad" (el reino). Usar una técnica emite un pico con la firma de la técnica, que alguien que la conoce puede reconocer.
- **Las emociones se filtran.** La ira, el miedo o la intención de matar emiten en Vista (cara, tensión) y, en cultivadores, en Esencia (杀气). Ocultarlas cuesta `control` (ver máscaras en npc-psychology).

## 3. Propagación: el entorno
Lo que llega al receptor es `intensidad × atenuación(distancia, canal) × oclusión × condiciones`. El ruido de fondo se resta después.

### Espacio: dónde está cada uno
El hex local de planet-gen (1-3 km) es demasiado grueso para saber si alguien te ve desde la otra punta de la calle. Por eso los **sitios** (aldeas, casas, cuevas, ruinas, campamentos) se modelan por dentro como un **grafo de espacios**:
- Cada espacio (una habitación, una calle, un patio, un claro, una galería de la cueva) es un nodo con tamaño, luz propia y ruido de fondo.
- Las aristas dicen cómo pasa cada canal entre dos espacios: una puerta abierta deja pasar vista y oído, una cerrada solo un poco de oído, una pared de papel deja pasar oído y sombras, una pared de piedra casi nada.
- Afuera de los sitios se usa el hex local con su relieve (una loma tapa la vista), su vegetación (el bosque denso corta la vista a pocos metros) y la distancia.
- Para la sim histórica y los tiers bajos no hace falta nada de esto (ver §9).

### Condiciones
- **Luz:** sale de la hora (sol), la fase y la posición de la luna (calculables por planet-gen), el clima (nubes, tormenta) y las fuentes artificiales (fuegos, faroles, perlas luminosas). Una noche sin luna en el bosque es casi ciega para un humano y no para un lobo.
- **Clima:** la lluvia tapa el oído y el olfato, la niebla la vista, el viento lleva sonido y olor en su dirección y lo corta en contra.
- **Ruido de fondo:** cada espacio tiene el suyo (mercado, cascada, batalla). Es el mejor aliado del que no quiere ser oído.
- **Qi ambiental:** un lugar de qi muy denso es "ruidoso" para el sentido de esencia. Esconder un aura en una vena espiritual es fácil, y en una tierra muerta, imposible.
- **Formaciones y sellos:** bloquean canales concretos (una barrera de sonido, un array que oculta el qi). Son objetos con origen, se pueden detectar y romper.

## 4. El receptor
```ts
interface SensorProfile {
  acuity: Record<Channel, number>;   // especie + edad + salud + cultivo
  range: Record<Channel, number>;    // sobre todo Esencia y Alma
  nightVision: number;
  attention: AttentionState;
}
```

- **Especie** (desde `content/`): las bestias tienen olfato fino, visión nocturna o sentido de temblores; los peces sienten vibraciones; una especie inteligente no humana tiene su propio perfil.
- **Cuerpo:** la edad baja la vista y el oído; las heridas y secuelas los cambian (un ojo perdido reduce el campo y la profundidad, un oído roto). Sale del doc de cuerpo y salud.
- **Aptitud `perception`** del NPC (npc-psychology) multiplica todo.
- **Cultivo:** abrir meridianos agudiza los sentidos físicos y habilita el sentido de esencia; fortalecer el alma amplía el radio del sentido espiritual. Un cultivador alto escucha una conversación a cien metros y siente un aura a kilómetros.
- **Habilidades aprendidas:** un rastreador lee huellas que otro no ve, un médico ve la enfermedad en la cara, un alquimista distingue hierbas por el olor. Son hábitos con procedencia, no stats.

### Atención
Nadie percibe todo lo que le llega. La atención es un **presupuesto** que se reparte:
- **Estado:** dormido (solo pasan estímulos muy intensos o muy relevantes, como tu nombre o el llanto de tu hijo), relajado, alerta, concentrado en una tarea (ve mucho de eso y poco del resto), en combate (visión de túnel).
- **Saliencia:** el movimiento, lo inesperado, lo amenazante y lo relevante para sus objetivos y miedos acaparan la atención. Un esquema `world_is_dangerous` alto pone más atención en las amenazas.
- **Emociones:** el miedo sube la vigilancia general pero estrecha el foco; la ira lo estrecha sobre el objeto del enojo; la alegría la relaja.
- **Acciones de atención:** vigilar, montar guardia, observar a alguien, escuchar detrás de una puerta y buscar son acciones del catálogo que concentran el presupuesto en un objetivo.
- **El cansancio** (doc de cuerpo) la degrada: la tercera noche de guardia es la peor.

## 5. Detección: del estímulo al percept
Por cada observador candidato y cada canal:

```
señal  = emisión × atenuación × oclusión × condiciones
ruido  = ruido_ambiente + ruido_interno(cansancio, dolor, emociones)
snr    = señal × agudeza × atención / ruido
```

Después, **por cada atributo** que emite el estímulo:
```
P(leer atributo) = sigmoid(k × (snr − legibilidad(atributo)))
```

- Así se dan solos los grados: con poca señal solo se leen los atributos fáciles ("algo se movió", "un grito"); con más, "un hombre armado"; con mucha, la cara y las palabras.
- Combinar canales suma evidencia: oír la voz de Zhao y ver su silueta alcanza para identificarlo aunque ninguno de los dos sea suficiente solo.
- Cada atributo leído tiene una **confianza** que sale de su margen sobre la legibilidad.

### Errores con forma
Si la señal de un atributo queda en la zona gris (ni claramente leída ni claramente perdida), el observador puede **completarlo**:
- Los candidatos salen de sus **creencias**: quién suele andar por ahí, quién cree que es su enemigo, qué espera que pase.
- Los esquemas y emociones sesgan la elección: con miedo y `world_is_dangerous`, la sombra es un bandido; con esperanza, es el hijo que vuelve.
- El valor erróneo queda en el percept con su confianza (a veces alta: la gente está segura de lo que vio mal). El inspector muestra "creyó ver a X, era Y".

Este mecanismo alimenta directamente la distorsión de memoria de npc-psychology: la memoria arranca ya sesgada desde la percepción.

```ts
interface Percept {
  id: PerceptId;
  observer: AgentId;
  sourceEventId?: EventId;        // lo que pasó de verdad
  sourceEntityId?: EntityId;      // o la entidad observada (persona, objeto, huella)
  time: Time;
  channels: Channel[];
  fields: Partial<Record<PerceptKey, { value: unknown; confidence: number; mistaken: boolean }>>;
  // `mistaken` es verdad del mundo: solo lo ven el inspector y la crónica, nunca el observador ni el narrador
}
```

## 6. Percepción social
Leer a una persona es un caso particular, con las mismas reglas:
- **Emociones ajenas:** la cara, la voz y la postura emiten la emoción real. La máscara (npc-psychology §9c) baja esa emisión según `control`, y se agrieta con estrés, alcohol o emociones fuertes. Leerla depende de `perception`, de la familiaridad con esa persona (a tu madre no le mentís) y de la teoría de la mente del observador.
- **Mentiras:** una mentira es un acto de habla decidido por la sim. Detectarla es una comparación entre el `control` y la práctica del mentiroso y la percepción, la familiaridad y lo que **ya sabe** el que escucha (una contradicción con un hecho conocido se detecta aunque el mentiroso sea perfecto). No es un "detector": el que escucha puede sospechar de alguien que dice la verdad.
- **Intención asesina:** un cultivador la siente en otro antes del ataque, salvo que el atacante la controle. Los asesinos entrenados la suprimen.

## 7. Identificar personas y cosas
Reconocer a alguien es comparar lo percibido con lo que el observador recuerda de esa persona. Hay varias **firmas** independientes:

| Firma | Canal | Se disfraza con |
|---|---|---|
| Cara, cuerpo, forma de caminar | Vista | Maquillaje, máscaras, técnicas de cambio de rostro, crecer o envejecer |
| Voz | Oído | Imitar voces, técnicas |
| Olor | Olfato (bestias, rastreadores) | Hierbas, baños |
| Firma del aura (elemento, textura del qi) | Esencia | Supresión o cambio de técnica de cultivo |
| Firma de técnica | Esencia | No usar la técnica |
| Firma del alma | Alma | Muy difícil: sellos de alma de alto nivel |
| Objetos (sello, espada, anillo) | Vista | No mostrarlos |

- Un disfraz tapa algunas firmas y no otras. Un cambio de rostro engaña a la vista pero no al sentido de esencia, y suprimir el aura no cambia la cara.
- **La firma del alma sobrevive a la reencarnación.** Un enemigo con un sentido espiritual muy fuerte y una memoria intensa de tu alma puede reconocerte en tu vida nueva (ver [spirits.md](spirits.md) §3e). Es raro y depende de los dos lados.
- **Reconocer objetos:** el anillo del anciano Wu es reconocible para quien lo vio o conoce su sello. Así se encadena "usar el anillo en público" con "alguien del Filo de Hierro lo reconoce" de causality.md.

## 8. Percibir el cultivo ajeno
Es lo que da el "creen que sos Qi Gathering 9 con 60% de confianza" de VISION:
- El aura emite la profundidad del cultivo. Leerla depende de la diferencia de reinos: hacia abajo se lee con claridad, en el mismo reino con un margen, y hacia arriba solo se percibe "insondable" o "más fuerte que yo", sin poder estimar cuánto.
- La **supresión de aura** (técnica u objeto) baja la emisión. Bien hecha, un cultivador pasa por mortal: es el origen del "no lo provoques, parecía débil". Mantenerla cuesta atención y se rompe al pelear en serio o con una emoción fuerte.
- El resultado es una **creencia con distribución** (un rango de reinos con probabilidades), que va a `sim/knowledge`. Otras pistas la ajustan: cómo se mueve, qué técnica usó, quién lo trata con respeto, rumores.
- Fingir más fuerza de la que se tiene (inflar el aura) es posible con técnicas u objetos, con el riesgo de que alguien superior lo note.

## 9. Huellas: percibir el pasado
Muchos eventos dejan **huellas** persistentes en el lugar, que son entidades con origen y que se pueden percibir después:

| Huella | Dura | Lo borra |
|---|---|---|
| Pisadas, ramas rotas, pasto aplastado | Días | Lluvia, tránsito, nieve |
| Sangre, cuerpos, restos de fogata | Días a semanas | Lluvia, animales carroñeros, limpieza |
| Olor (persona, bestia, sangre) | Horas a días | Viento, lluvia |
| Residuo de qi de una técnica | Horas a meses según la potencia | El flujo del qi ambiental |
| Objetos movidos, cerraduras forzadas, polvo alterado | Hasta que alguien los toque | Que alguien acomode |
| Daño al terreno (cráter, árbol partido, quemadura) | Años o siglos | La erosión, el crecimiento |

- Leer una huella es percepción (verla) más **inferencia** (saber qué significa). Un rastreador ve más y entiende más que un campesino. El residuo de qi de una técnica revela la escuela, si el observador la conoce.
- Las huellas son la base para descubrir intrigas, crímenes y batallas viejas (schemes §5, el futuro doc de ley y justicia).
- **Borrar huellas** es una acción (limpiar, quemar, dispersar el qi) que deja sus propias huellas si no se hace bien.

## 10. Percepción interna
Percibirse a uno mismo usa el mismo modelo, con el cuerpo como fuente:
- Una herida interna, un veneno lento o una desviación de qi incipiente pueden **pasar desapercibidos** si la señal es baja. Un mortal no siente sus meridianos; un cultivador sí, más con más cultivo.
- Es la vía por la que se **descubren** los talentos ocultos (VISION: los talentos se descubren, no se crean): entrenar o cultivar da señales internas que alguien atento puede notar.
- El jugador recibe lo que su personaje siente de su cuerpo, no sus stats reales. El panel del personaje muestra creencias sobre uno mismo, con incertidumbre donde corresponda.

## 11. El jugador y el narrador
- El narrador recibe solo los percepts del personaje, con sus campos y confianzas. Tiene que narrar lo vago como vago ("una figura entre los árboles") y nunca completar un hueco con la verdad.
- Los errores del personaje se narran como si fueran ciertos, porque para él lo son. El jugador puede sospechar si algo no cierra, pero el narrador no le avisa.
- Las acciones de atención ("observo al mercader", "me quedo escuchando", "reviso el piso") son acciones del catálogo y cuestan tiempo, como cualquier otra.

## 12. Escala (LOD)
- **Testigos candidatos:** al crear un evento se buscan observadores en el radio máximo de cada canal con un índice espacial (por sitio y hex local). Nada fuera de ese radio se evalúa.
- **Tier 3-4:** modelo completo (todos los canales, atributos, errores con forma).
- **Tier 2:** una tirada por canal y un nivel de detalle global (nada / vago / identificado), sin errores de completado salvo en identidades.
- **Tier 0-1 y simulación histórica:** en agregado: "lo vio el 30% de la aldea", con un percept resumido compartido. Si después se materializa un NPC de esa aldea, se decide (con su rng) si estaba entre los testigos, respetando la fracción.
- Las huellas viejas sin observadores cercanos no se recalculan cada tick: guardan su momento de origen y se evalúan cuando alguien llega (detalle diferido de causality §5.3).

## Implementación
- **Fase 1:** Vista y Oído, grafo de espacios mínimo para la aldea, luz por hora del día, ruido de fondo, niveles nada/vago/identificado. El narrador ya recibe percepts.
- **Fase 2:** atributos separados con legibilidad, errores con forma, percepción social (emociones, mentiras), atención y saliencia, huellas simples.
- **Fase 3:** olfato y viento, huellas completas, rastreo, borrar huellas.
- **Fase 4 (cultivo):** sentidos de Esencia y Alma, lectura de cultivo con incertidumbre, supresión e inflado de aura, firma de técnica, percepción interna de meridianos.
- **Fase 5 (LOD):** testigos en agregado, índice espacial, tiers.

## Tests
- Determinismo: mismo seed y mismos eventos dan los mismos percepts.
- Ninguna memoria `witnessed` sin `Percept`, y ningún `Percept` sin evento o entidad real.
- El narrador nunca recibe campos que no estén en los percepts del jugador.
- Monotonía: más distancia, menos luz o más ruido nunca aumentan la probabilidad de leer un atributo.
- Los errores de completado solo eligen valores que estaban en las creencias del observador.
- Una pared de piedra entre dos espacios bloquea la vista en un escenario controlado.
- Agregado: la fracción de testigos de un evento en tier 0 coincide (en promedio) con la que sale de simular individuos.

## Decisiones tomadas en este borrador (revisables)
- Siete canales (cinco físicos + Esencia + Alma), con los dos últimos genéricos según la metafísica del mundo.
- Detección por atributo con legibilidad, no un nivel único de "visto / no visto".
- Los errores se completan desde las creencias del observador, no al azar.
- Interior de los sitios como grafo de espacios con aristas por canal, no coordenadas continuas.
- El campo `visibility` de `Event` (ARCHITECTURE) se reemplaza por perfiles de emisión; los percepts se calculan.

## Preguntas abiertas
- Cuántos nodos tiene el grafo de espacios de una ciudad grande: ¿una calle por nodo o barrios agregados que se abren al entrar?
- Calibración de las curvas de atenuación y del `k` de la sigmoide con la sim headless.

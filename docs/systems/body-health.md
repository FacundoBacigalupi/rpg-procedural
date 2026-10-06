# Cuerpo y salud

> Estado: **borrador de diseño**. Define el cuerpo como un sistema físico simulado: partes con funciones, reservas que se gastan y se reponen, heridas que evolucionan, enfermedades que se contagian por causas concretas, sustancias, envejecimiento, medicina y el puente con el cultivo (meridianos, dantian, refinamiento corporal). No hay "puntos de vida": hay sangre, órganos, huesos, fiebre y hambre.

Depende de: [causality.md](causality.md) (nada aparece sin causa, conservación), [metaphysics.md](metaphysics.md) (qué es `Essence`, qué cuerpos existen, cómo se cultiva), [planet-gen.md](planet-gen.md) (clima, temperatura, agua, biomas), [perception.md](perception.md) (síntomas visibles, percepción interna). Lo usan: [npc-psychology.md](npc-psychology.md) (dolor, desfiguración, miedo a morir), [heaven-karma.md](heaven-karma.md) (límite de vida), [spirits.md](spirits.md) (cómo y dónde se muere), [living-world.md](living-world.md) (epidemias, evolución de patógenos), [information.md](information.md) (diagnóstico como creencia), [economy.md](economy.md) (comida, medicina y sustancias con precio), y los futuros oficios y guerra.

## Principios
1. **Sin barra de vida.** Un cuerpo muere por una causa fisiológica concreta: se desangró, se le paró el corazón, se le infectó la herida, se congeló, se murió de hambre, el qi le rompió los meridianos, se le acabó la vida. La crónica siempre puede decir **de qué** murió alguien.
2. **El cuerpo es una cadena causal.** Un corte en el muslo sangra; la pérdida de sangre baja la presión; la debilidad hace caer; la herida sucia se infecta tres días después; la fiebre impide trabajar; no trabajar trae hambre. Cada paso es un evento con `causes`.
3. **Las enfermedades se contagian, no se tiran.** Nadie se enferma "porque salió un 5%". Se enferma porque tomó agua de un pozo contaminado por una letrina, porque cuidó a un enfermo, porque lo mordió un animal portador. El azar elige si el contagio prende, no si hubo exposición (causality, Ley 2).
4. **Lo que se pierde no vuelve gratis.** La sangre se repone comiendo y descansando; un miembro amputado no vuelve salvo con medios que el mundo permita y que cuestan (píldoras, técnicas, materiales). Una píldora curativa consume ingredientes y qi que existían (conservación).
5. **Nadie ve su propio estado real.** El jugador y los NPCs sienten síntomas, no números. Lo que un médico sabe es una creencia inferida de lo que percibió ([information.md](information.md)).
6. **Las secuelas son historia.** Una cojera, una cicatriz en la cara, una tos crónica o meridianos dañados cambian lo que alguien puede hacer, cómo lo miran y quién es. El cuerpo acumula biografía.
7. **Determinista.** Cada tirada usa `rng.fork("body", entityId, eventId)`.

## 1. Plan corporal: anatomía por especie
Cada especie (generada, ver [metaphysics.md](metaphysics.md) §especies) tiene un `BodyPlan`: un árbol de partes con tejidos y funciones. Los humanos usan un plan base; otras especies, bestias y espíritus materializados tienen el suyo (seis patas, alas, caparazón, sin sangre, núcleo de bestia).

```ts
interface BodyPlan {
  species: SpeciesId;
  parts: BodyPartDef[];                 // árbol: torso → brazo → mano → dedos
  bloodVolume: number;                  // litros en un adulto (0 si no tiene sangre)
  thermo: { ideal: number; tolerance: [number, number]; endotherm: boolean };
  diet: DietProfile;                    // omnívoro, carnívoro, se alimenta de qi...
  lifespan: { natural: number; maturity: number; senescenceStart: number };
  essenceAnatomy?: EssenceAnatomyDef;   // meridianos, dantian, núcleo; depende del mundo
}

interface BodyPartDef {
  id: PartId;                           // "left_hand", "liver", "heart"
  parent?: PartId;
  size: number;                         // probabilidad relativa de ser golpeada
  exposure: "external" | "internal";    // los órganos internos se alcanzan atravesando
  tissues: Tissue[];                    // piel, músculo, hueso, órgano, nervio, vaso
  functions: BodyFunction[];            // qué capacidades aporta y cuánto
  vital?: "instant" | "fast" | "slow";  // destruirla mata: corazón (instant), hígado (slow)
}

type BodyFunction =
  | { kind: "manipulation"; weight: number }
  | { kind: "locomotion"; weight: number }
  | { kind: "sight" | "hearing" | "smell"; weight: number }
  | { kind: "breathing" | "circulation" | "digestion" | "filtration"; weight: number }
  | { kind: "consciousness"; weight: number }
  | { kind: "speech"; weight: number }
  | { kind: "reproduction"; weight: number };
```

El estado real de cada individuo guarda solo lo que se aparta del plan:

```ts
interface Body {
  entity: EntityId;
  plan: SpeciesId;
  genome: GenomeRef;                    // rasgos heredados: constitución, talla, predisposiciones
  age: Duration;
  parts: Record<PartId, PartState>;     // solo las partes con algo distinto de "sana"
  physio: PhysioState;
  conditions: Condition[];              // heridas, enfermedades, intoxicaciones, dependencias
  scars: Scar[];                        // marcas permanentes (identidad, perception §7)
  essence?: EssenceBodyState;           // ver §12
}

interface PartState {
  integrity: number;                    // 0 = destruida o ausente, 1 = sana
  function: number;                     // puede ser < integrity (nervio cortado con el músculo sano)
  pain: number;
  missing?: { since: Time; cause: EventId };
  prosthesis?: ItemId;                  // pata de palo, mano de hierro, ojo de jade
}
```

## 2. Fisiología: reservas y homeostasis
El cuerpo mantiene un puñado de variables. Cada acción y cada hora las mueven; cuando salen de rango aparecen síntomas, y cuando salen mucho, la muerte.

```ts
interface PhysioState {
  blood: number;                // fracción del volumen normal
  hydration: number;
  energy: number;               // reservas de corto plazo (glucógeno): se vacía con esfuerzo
  fat: number;                  // reserva de largo plazo: cuánto aguanta sin comer
  nutrition: Record<Nutrient, number>;  // déficits crónicos (§5)
  coreTemp: number;
  fatigue: number;              // muscular, se recupera con descanso
  sleepDebt: number;            // solo se paga durmiendo
  immune: number;               // capacidad actual; baja con hambre, frío, agotamiento, pena
  toxins: Record<SubstanceId, number>;
  stress: number;               // fisiológico; lo alimenta npc-psychology y lo devuelve
  consciousness: "alert" | "dazed" | "unconscious" | "comatose";
}
```

- **Umbrales con síntomas graduales.** Perder 15% de sangre: nada visible; 30%: palidez, sed, pulso rápido; 40%: confusión, caída; más de 50%: muerte sin intervención. Lo mismo para temperatura, deshidratación y hambre.
- **Las variables se afectan entre sí.** Hambre baja `immune` y la recuperación de `fatigue`; fiebre sube el consumo de agua; perder sangre baja la tolerancia al frío; la falta de sueño baja todas las capacidades y la percepción.
- **Paso de tiempo.** En escena (tier 4) el cuerpo se actualiza por acción o por minuto; fuera de escena, por hora o día con fórmulas cerradas (§16).

## 3. Capacidades derivadas
La resolución de acciones, el combate y la percepción no leen el cuerpo parte por parte: leen **capacidades** calculadas.

```ts
interface Capabilities {
  strength: number; endurance: number; agility: number; dexterity: number;
  locomotion: number;        // 0 = no puede caminar
  manipulation: Record<"left" | "right", number>;
  acuity: Record<Channel, number>;     // se lo pasa a SensorProfile (perception §4)
  cognition: number;         // dolor, fiebre, sueño, sustancias
  speech: number;
  painTolerance: number;
}
```

- Se derivan de las partes (funciones ponderadas), de la fisiología (fatiga, sangre, fiebre), del genoma (talla, constitución), del entrenamiento (músculo que crece con uso y se atrofia sin él) y del cultivo (§12).
- **Mano dominante, ambidiestro, zurdo:** son del genoma. Perder la mano dominante baja `dexterity` hasta que la otra se entrena (aprendizaje, no magia).
- **El entrenamiento es fisiología.** Fuerza y resistencia suben por estrés de entrenamiento + comida + descanso, con rendimientos decrecientes y techo genético. Entrenar con hambre o sin dormir lesiona en vez de fortalecer (VISION, principio 10: sin disparadores secretos).

## 4. Heridas
Una herida es una `Condition` sobre una parte, causada por un evento.

```ts
interface Injury {
  kind: "cut" | "puncture" | "blunt" | "fracture" | "burn" | "frostbite" | "crush"
      | "bite" | "tear" | "essence";  // daño por qi o energías del mundo
  part: PartId;
  depth: number;               // qué tejidos alcanzó: piel → músculo → hueso/órgano
  severity: number;
  bleeding: number;            // litros por hora; cae con presión, vendaje, coagulación
  contamination: number;       // suciedad que entró: arma, suelo, mordida, ropa
  treated: Treatment[];        // limpieza, sutura, entablillado, cauterio, ungüento, píldora
  stage: "fresh" | "inflamed" | "healing" | "infected" | "necrotic" | "healed";
  causeEventId: EventId;
}
```

- **Dónde pega.** El atacante apunta (si tiene la habilidad) y el defensor se cubre; la parte final sale de tamaño + intención + habilidad + armadura. Un golpe en la cabeza puede aturdir aunque la herida sea leve.
- **Daño por tejido.** Cada tipo de arma daña distinto: el corte sangra mucho y cierra rápido si se sutura; la punción llega a órganos con poca herida externa; el contundente rompe huesos bajo piel sana; la quemadura destruye piel y deja la herida abierta a infección.
- **Armadura.** Cuero, metal, sedas de bestia y túnicas con formaciones cambian el tipo de daño (un corte se vuelve contundente contra la cota de malla), no solo lo restan.
- **Sangrado.** Se suma de todas las heridas. Vendar, presionar, cauterizar o técnicas de sellar puntos de acupuntura lo bajan. Las arterias (un `vessel` en el tejido) sangran rápido y matan en minutos.
- **Dolor y shock.** El dolor baja `cognition` y la capacidad de actuar; mucho dolor + mucha pérdida de sangre lleva a shock e inconsciencia. La tolerancia al dolor es genética, entrenada y psicológica (un fanático aguanta más).

### Curación por etapas
1. **Fresca** → la herida sangra y duele.
2. **Inflamada** (horas a días): normal; calor, hinchazón.
3. **Cicatrizando:** la velocidad depende de profundidad, edad, nutrición (proteína), descanso, `immune` y tratamiento.
4. **Infectada:** si `contamination × (1 - limpieza)` supera lo que el sistema inmune controla. Fiebre, pus, olor (perception: olfato). Puede volver a cicatrizar o seguir.
5. **Necrótica / sepsis:** sin tratamiento, la infección se extiende o pasa a la sangre. Ahí la amputación salva la vida, si alguien sabe hacerla.
6. **Curada:** deja una `Scar` y, según profundidad y tratamiento, una **secuela**.

La infección no es una tirada aparte: el nivel de contaminación sale de qué la causó (mordida de perro > cuchillo de cocina limpio; flecha que pasó por el barro; herida tratada con manos sucias) y del ambiente (calor húmedo favorece la infección). El azar solo decide el desenlace en la zona gris.

### Secuelas
- **Funcionales:** cojera (fractura mal entablillada), mano rígida (tendón), visión doble (golpe en la cabeza), dolor crónico, pulmón débil (quemadura por humo), sordera.
- **Visibles:** cicatrices, desfiguración, miembros ausentes. Son rasgos de identidad (perception §7) y pesan en lo social (npc-psychology: la cara, la belleza, el estigma; un rostro marcado puede ser respeto en un ejército y repulsión en una corte).
- **Psicológicas:** el evento queda como memoria intensa; un miedo, un trauma o un orgullo (npc-psychology, esquemas).

## 5. Nutrición, agua y hambre
- **Comida concreta.** Comer consume ítems reales (conservación, causality §5): arroz de esta cosecha, carne de esta bestia. El hambre de una aldea es la suma de estómagos vacíos, no un modificador.
- **Calorías → `energy` → `fat`.** Sin comer, primero se vacía `energy` (horas), después `fat` (semanas, según reserva). El trabajo pesado consume el doble. Al agotarse la grasa, el cuerpo consume músculo: baja `strength` antes de morir.
- **Nutrientes crónicos** (pocos y con efecto claro):
  - `protein`: curación lenta, músculo que no crece, crecimiento atrofiado en niños.
  - `vitaminC`-equivalente (fruta y verdura fresca): escorbuto en marineros, asedios e inviernos largos. Encías sangrantes, heridas viejas que se reabren.
  - `iodine`-equivalente: bocio y cretinismo en regiones de montaña lejos del mar (sale de planet-gen).
  - `iron`: anemia; empeora con sangrados y partos.
  Cuáles existen y cómo se llaman depende del conocimiento médico de cada cultura: la sim los modela igual; la gente los entiende distinto ("el mal de los marineros").
- **Agua.** Deshidratación en días; peor con calor, fiebre, diarrea y esfuerzo. El agua tiene una **calidad** (ver §6, patógenos y contaminación).
- **Infancia.** El hambre en los primeros años deja secuela permanente (talla, `cognition` y `immune` base algo más bajos): las hambrunas marcan generaciones.
- **Comida espiritual.** En mundos con qi, carne de bestia, frutos espirituales y arroz de campos con qi alimentan además la `Essence`, y pueden sobrecargar a un mortal (§9).

## 6. Enfermedades
### Patógenos como entidades
Cada enfermedad infecciosa es un `Pathogen` con `originEventId`, no una entrada de tabla. Nace de algo: un reservorio animal (zoonosis desde una población de bestias de living-world), una mutación de otro patógeno, una maldición o un qi corrupto que el mundo permita (metaphysics), un cadáver de algo poderoso.

```ts
interface Pathogen {
  id: PathogenId;
  originEventId: EventId;
  ancestor?: PathogenId;             // los patógenos evolucionan (living-world)
  routes: ("contact" | "air" | "water" | "food" | "vector" | "blood" | "sexual" | "essence")[];
  reservoirs: PopulationRef[];       // ratas, mosquitos, un tipo de bestia, el agua de un pantano
  incubation: Duration;
  transmissibility: number;
  course: SymptomStage[];            // fiebre → manchas → delirio...
  lethality: number;                 // depende también del estado del huésped
  targets: (PartId | "essence" | "soul")[];
  immunity: "lifelong" | "waning" | "none";
  climate: { temp: [number, number]; humidity: [number, number] };
}
```

- **Exposición concreta.** El contagio sucede en eventos donde hay contacto real: compartir cuarto, agua, comida, sangre, un mosquito del pantano. La probabilidad sale de transmisibilidad × dosis × `immune` del expuesto.
- **Contaminación de lugares.** Pozos, ríos, mercados, cuarteles y fosas tienen una carga de patógenos que suben con densidad, cadáveres, letrinas y animales, y bajan con higiene, frío y tiempo. Una ciudad sitiada se enferma por razones calculables.
- **Epidemias emergentes.** Densidad + rutas comerciales + hambre (inmunidad baja) + higiene + clima hacen que un patógeno viaje por las rutas (living-world) y se vuelva epidemia. Una peste es la consecuencia de una caravana concreta que llegó de un lugar concreto, y la gente le busca culpables (information: rumores; schemes: chivos expiatorios).
- **Inmunidad adquirida.** Quien sobrevive queda inmune (o no, según el patógeno). Una población que ya pasó la enfermedad la resiste; una aislada muere en masa cuando llega (choque de poblaciones al abrirse rutas).
- **Evolución.** Los patógenos mutan en poblaciones grandes: más contagiosos, menos letales, nuevas rutas. Se registra en `ancestor`.

### No infecciosas
- **Crónicas:** tisis, artritis, piedras, corazón débil, "mal del azúcar", tumores. Salen del genoma (predisposición), la edad, la dieta, el oficio (pulmón de minero, espalda de cargador, ojos de bordadora) y las sustancias. Avanzan lentamente y pueden controlarse con tratamiento.
- **Congénitas y hereditarias:** en el genoma; se transmiten por el linaje ([family-lineage.md](family-lineage.md) §1). La consanguinidad de clanes cerrados las concentra.
- **Mentales con base física:** demencia senil, delirio por fiebre, daño por golpes. Se cruzan con npc-psychology (la psicología usa `cognition` como límite).
- **Embarazo y parto:** estado del cuerpo con riesgo real (hemorragia, fiebre puerperal, mala posición) que depende de nutrición, edad, partera y medicina disponible. Es una de las grandes causas de muerte en mundos mortales y un motor de familias y herencias.

## 7. Frío, calor y ambiente
- **Balance térmico:** temperatura del aire (planet-gen, hora, estación), viento, humedad, mojado, ropa (aislamiento como propiedad del ítem), refugio, fuego, esfuerzo y comida. `coreTemp` se mueve hacia el equilibrio.
- **Frío:** escalofríos → torpeza (`dexterity` baja) → confusión → hipotermia → muerte. Las extremidades expuestas sufren **congelación**: lesión de parte que puede terminar en amputación de dedos.
- **Calor:** sudor (pierde agua) → agotamiento → golpe de calor. El esfuerzo con armadura en un desierto mata soldados.
- **Altitud:** falta de aire en montañas altas (planet-gen): menos `endurance`, mal de altura. Los nacidos allá están adaptados (genoma + aclimatación).
- **Ambientes del mundo:** qi de fuego, frío yin, miasmas de pantano, aire de un reino secreto. Son entradas del mismo balance (calor, toxinas, `Essence` dañina), no reglas aparte. Su efecto lo calcula la física elemental ([elements.md](elements.md) §7).

## 8. Fatiga y sueño
- **Fatiga muscular** sube con esfuerzo y baja con descanso; acumulada sin descanso produce lesiones (desgarros, fracturas por estrés).
- **Deuda de sueño** solo se paga durmiendo. Más de un día sin dormir baja `cognition`, percepción y juicio (npc-psychology: más impulsividad, más errores con forma en perception §5).
- **Calidad del sueño:** frío, hambre, dolor, miedo, ruido y pesadillas (traumas) lo empeoran. Dormir en la intemperie no descansa igual que en una cama.
- **Meditación** reemplaza parte del sueño solo si el mundo y la práctica lo permiten, y en cultivadores avanzados la necesidad baja (pero no desaparece salvo en reinos que el mundo defina).

## 9. Sustancias, venenos y adicciones
```ts
interface Substance {
  id: SubstanceId;
  originEventId: EventId;              // una planta, un animal, una receta, una píldora
  routes: ("ingest" | "inhale" | "blood" | "skin" | "essence")[];
  effects: Effect[];                    // por dosis: euforia, analgesia, sueño, parálisis, alucinación...
  toxicity: DoseCurve;                  // dosis → daño (por órgano)
  halfLife: Duration;
  dependence?: { potential: number; tolerancePerUse: number; withdrawal: SymptomStage[] };
  detectability: number;                // sabor, olor, color (perception: Gusto)
}
```

- **Venenos:** sustancias con curva de dosis. Lentos (se acumulan en `toxins`, ideales para intrigas, schemes) o rápidos. Cada uno daña órganos concretos y deja síntomas que un médico puede reconocer o confundir con una enfermedad. Los antídotos existen solo si alguien los conoce ([discovery.md](discovery.md)).
- **Alcohol, opio, hierbas recreativas:** efectos agudos (cognición, dolor, coraje) y crónicos (hígado, pulmones).
- **Adicción = tolerancia + dependencia + abstinencia.** El uso repetido sube la tolerancia (más dosis para el mismo efecto) y la dependencia; sin la sustancia aparece abstinencia (dolor, temblores, ansiedad). Se cruza con npc-psychology: una necesidad nueva compite en la utilidad, y alguien puede vender, robar o traicionar por su dosis. Quien controla el suministro tiene poder (schemes, economía).
- **Toxicidad de píldoras (丹毒).** Las píldoras de cultivo dejan residuos según su pureza ([crafts.md](crafts.md) §4: la toxicidad es la tensión residual). Se acumulan en el cuerpo, bajan la eficiencia del cultivo y pueden causar desviaciones. Purgarlas cuesta tiempo o recursos. De acá sale el clásico "fundamento inestable por abusar de píldoras".
- **Sobrecarga de `Essence`:** un mortal que come algo demasiado potente (fruto espiritual, sangre de bestia) puede romperse: fiebre, meridianos quemados, muerte. A veces despierta algo; el resultado depende de su cuerpo, no de la suerte pura.

## 10. Envejecimiento y límite de vida
- **Curva por especie:** crecimiento → madurez → meseta → senescencia. Las capacidades siguen la curva: fuerza y velocidad pico en la juventud adulta, habilidad y juicio más tarde.
- **Senescencia por sistemas:** vista y oído (perception §4), articulaciones, huesos frágiles (las caídas se vuelven fracturas), inmunidad, memoria. Cada sistema envejece a su ritmo según genoma, desgaste del oficio, heridas viejas y hábitos.
- **Dos relojes.**
  - **Desgaste biológico:** el cuerpo acumula daño; vivir mal envejece antes, y la medicina y el cultivo lo retrasan.
  - **Límite de vida** ([heaven-karma.md](heaven-karma.md)): el plazo que el Cielo asigna según reino, constitución, técnicas y karma. Cuando se cumple, se muere aunque el cuerpo esté entero (agotamiento de la vida, 寿元). Prolongarlo cuesta tesoros, técnicas prohibidas o romper al siguiente reino.
  - Normalmente el cuerpo se gasta antes que el límite; en cultivadores es al revés, y el cuerpo joven con la vida acabándose es una tragedia típica.
- **Muerte de vejez:** es una falla concreta (corazón, pulmones, una infección que ya no se pudo pelear), o el agotamiento del límite de vida, que el narrador cuenta distinto.

## 11. Medicina
### Medicina mortal
- **El conocimiento es de la cultura y la época** ([discovery.md](discovery.md): priors culturales, errores que funcionan, supersticiones): herbolaria, cirugía, acupuntura, cauterio, sangrías (que pueden empeorar las cosas si es lo que la cultura cree), teorías de humores o de los cinco elementos. Una cultura puede saber limpiar heridas con alcohol y otra no.
- **Tratamientos concretos** sobre condiciones concretas: limpiar, suturar, entablillar, reducir fracturas, amputar, sangrar, dar hierbas con efectos reales (cada hierba es una `Substance` con efectos y toxicidad).
- **Diagnóstico como percepción e inferencia.** El médico percibe síntomas (pulso, color, olor, fiebre, relato del paciente) y forma una creencia sobre la enfermedad ([information.md](information.md)): puede equivocarse con forma, según su formación ("es un desequilibrio de fuego" cuando es un veneno). Un buen envenenador cuenta con eso.
- **El sanador como oficio:** practicantes, curanderos, médicos de corte, monjes, parteras. Tienen habilidad, reputación, precio y límites; el más cercano a la aldea es probablemente el único.
- **Charlatanes:** venden curas que no funcionan o que dañan. Son reales en la sim (sustancias con efectos reales distintos de los anunciados) y la gente les cree por rumor.

### Medicina con `Essence` (alquimia y curación espiritual)
- **Píldoras:** consumen ingredientes reales y qi; su efecto escala con calidad, reino del alquimista y compatibilidad con el cuerpo. Curan rápido lo que la medicina mortal no puede (regenerar órganos, reparar meridianos, reponer sangre al instante), pero tienen toxicidad residual (§9) y precio.
- **Curación con qi:** un practicante puede acelerar la cicatrización, expulsar venenos o sellar sangrados gastando su propia `Essence`. Requiere conocer el cuerpo: canalizar qi a ciegas puede empeorar una herida interna.
- **Regeneración de miembros:** solo en mundos y reinos que lo permitan, siempre cara. Es un objetivo clásico para un NPC mutilado.
- **Límites:** nada cura la vejez ni devuelve años de vida sin pagar el precio que fija el Cielo (heaven-karma).

## 12. El cuerpo y el cultivo
Los términos son genéricos (`Essence`, `Practice`); la forma concreta sale de [metaphysics.md](metaphysics.md). Para la familia xianxia:

```ts
interface EssenceBodyState {
  meridians: Record<MeridianId, { open: number; damage: number; blocked?: CauseRef }>;
  reservoir?: { capacity: number; current: number; purity: number };   // dantian, núcleo, etc.
  constitution?: ConstitutionId;          // cuerpo raro: puro yang, de hielo, sin raíz, venenoso...
  bodyRefinement: number;                 // templado del cuerpo: piel, huesos, médula, sangre
  residues: Record<SubstanceId, number>;  // toxicidad de píldoras
  deviation?: DeviationState;             // desviación de qi en curso
}
```

- **Meridianos como anatomía.** Existen en el plan corporal de especies con `essenceAnatomy`. Pueden estar cerrados, abiertos, dañados o bloqueados por algo concreto (una herida de técnica, un sello que alguien puso, residuos).
- **Daño a meridianos y fundamento.** Usar más `Essence` de la que el cuerpo soporta, recibir una técnica que ataca meridianos, cultivar con una técnica incompatible o romper un reino a la fuerza **daña** el sistema. Daño leve se cura con tiempo; grave baja el techo de cultivo (fundamento dañado); total deja un lisiado (废人) que puede seguir viviendo como mortal. Repararlo es una búsqueda (píldoras raras, técnicas, tesoros).
- **Desviación de qi (走火入魔).** Un estado que nace de causas concretas: cultivar con la mente turbada (npc-psychology: demonios internos), una técnica incompatible, interrupciones en un momento crítico, residuos acumulados. Avanza por etapas (calor interno, alucinaciones, pérdida de control, meridianos quemados) y puede detenerse si se actúa a tiempo.
- **Constituciones especiales.** Del genoma (o de eventos: una bendición, una exposición extrema). Dan afinidades y debilidades reales, y pueden ser invisibles hasta que algo las active o alguien con buena percepción las lea (perception §8). Son el "talento oculto" de VISION, principio 9.
- **Refinamiento corporal.** Los caminos de cultivo del cuerpo templan tejidos: más `integrity` máxima, menos sangrado, curación más rápida, más tolerancia a calor y frío, sentidos más agudos. Se modela como modificadores al plan corporal del individuo, no como un número de poder aparte.
- **El cultivo cambia la fisiología.** Menos necesidad de comida y sueño, inmunidad a enfermedades mortales a partir de cierto reino, envejecimiento más lento, recuperación rápida. Cada cosa con su umbral según las leyes del mundo; nada es automático "por subir de nivel".
- **El cuerpo limita el cultivo.** Un cuerpo enfermo, desnutrido, viejo o mutilado cultiva peor. Algunos caminos exigen cuerpo entero; otros florecen en lo roto (un mundo puede tener técnicas que reemplazan miembros con `Essence`).

## 13. Muerte
- **Causa inmediata y causas de fondo.** El evento `death` registra la falla fisiológica (`cause: "exsanguination"`) y la cadena (`causes: [herida, ataque, motivo del atacante]`). La crónica y el Cielo la leen.
- **Muerte no es instantánea salvo destrucción vital.** Hay un período de moribundo donde el cuerpo puede ser salvado, la persona puede hablar (últimas palabras, venganzas encargadas, secretos revelados) y el alma se prepara para salir ([spirits.md](spirits.md): las circunstancias de la muerte deciden si queda un espíritu).
- **El cadáver es una entidad:** se descompone (emite olor, perception), contamina agua y suelo (§6), puede ser robado (ingredientes, nigromancia si el mundo la permite), enterrado según la cultura (living-world) o reanimado. Los restos de un cultivador poderoso conservan `Essence` y atraen buscadores.
- **Muerte aparente:** comas, catalepsia, técnicas de fingir la muerte. Un observador puede creer que alguien murió (information: creencia falsa) y equivocarse.

## 14. Cuerpo y mente
- **Dolor crónico y enfermedad larga** bajan el ánimo, la paciencia y suben el riesgo de adicción (npc-psychology).
- **Desfiguración y mutilación** afectan la autoimagen y los esquemas ("soy un monstruo", "ya no sirvo"), y cómo reacciona la gente según su cultura.
- **Miedo a la muerte**: la consciencia de la propia vejez o de una enfermedad terminal mueve objetivos (buscar longevidad, dejar herencia, reconciliarse, vengarse antes de morir).
- **Hormonas y edad** modelados de forma gruesa: la adolescencia sube impulsividad; la vejez baja energía y sube la prudencia (o el resentimiento).
- **Lo psicológico vuelve al cuerpo:** estrés crónico baja `immune` y el sueño; la pena puede matar a un anciano debilitado.

## 15. El jugador y el narrador
- **Sin números a la vista.** El jugador recibe percepts internos (perception §10): "te late la pierna", "la venda está empapada otra vez", "tenés la frente caliente", "hace dos días que no comés bien". Un cultivador percibe su `Essence` y sus meridianos con detalle según su reino.
- **La percepción interna puede fallar.** Un veneno lento o una herida interna pueden no notarse hasta tarde; la adrenalina tapa el dolor en combate (y el narrador lo cuenta como lo vive el personaje).
- **El inspector god-mode** sí muestra el `Body` real (para depurar y para la crónica).
- El parser del jugador mapea acciones de cuidado ("me vendo la pierna", "busco un curandero", "duermo junto al fuego") a acciones de la sim con efectos concretos; el LLM no decide si curan.

## 16. Escala (LOD)
- **Tier 4 (en escena):** modelo completo por parte y por minuto.
- **Tier 3:** partes agregadas en zonas (cabeza, torso, brazos, piernas), fisiología por hora, heridas y enfermedades individuales.
- **Tier 2:** `health` resumido por sistemas (heridas activas, enfermedades, nutrición, edad) con fórmulas diarias; se expande a tier 3 al materializarse, eligiendo detalles coherentes con el resumen (una "pierna mala" se vuelve una fractura vieja mal soldada en la pierna izquierda).
- **Tier 0-1 y simulación histórica:** demografía de salud: tasas de mortalidad por causa, prevalencia de enfermedades, nutrición promedio, epidemias como olas por asentamiento. Las tasas salen del estado (hambre, densidad, clima, medicina disponible), nunca de constantes sueltas.
- **Patógenos** se simulan por población en agregado y por individuo solo en NPCs materializados. La materialización respeta la prevalencia (si el 20% de la aldea tiene la fiebre, el NPC nuevo la tiene con esa probabilidad, con su rng).

## Implementación
- **Fase 1:** plan corporal humano por zonas, sangre, hambre y sed simples, fatiga y sueño, heridas (corte, contundente, punción) con sangrado y curación, infección simple, muerte con causa. Capacidades derivadas para la resolución de acciones.
- **Fase 2:** dolor y su efecto en la psicología, cicatrices y secuelas como rasgos, envejecimiento por capacidades.
- **Fase 3:** nutrientes crónicos, frío y calor con ropa y refugio, sustancias y adicciones, enfermedades infecciosas con contagio por eventos, médicos y diagnóstico como creencia, embarazo y parto, epidemias en agregado.
- **Fase 4 (cultivo):** `EssenceBodyState`: meridianos, reservorio, constituciones, daño de fundamento, desviación de qi, toxicidad de píldoras, refinamiento corporal, curación con qi.
- **Fase 5 (LOD):** tiers de salud, demografía en agregado, materialización coherente.
- **Fase 7 (historia):** evolución de patógenos, pestes históricas que dejan marca (mitos, tabúes, poblaciones inmunes).

## Tests
- Determinismo: mismo seed y mismos eventos dan las mismas heridas, contagios y muertes.
- Toda muerte tiene una causa fisiológica y una cadena de `causes` hasta un evento.
- Toda infección apunta a una exposición (evento) y a un `Pathogen` con `originEventId`.
- Conservación: la comida consumida desaparece del inventario; una píldora consume sus ingredientes.
- Monotonía: más sangrado sin tratamiento nunca mejora el pronóstico; limpiar una herida nunca sube la probabilidad de infección.
- Un cuerpo sin comida pierde `energy`, después `fat`, después músculo, en ese orden.
- El jugador nunca recibe valores de `PhysioState`, solo percepts.
- Agregado: la mortalidad por causa de una aldea en tier 0 coincide en promedio con la de simular sus individuos.

## Decisiones tomadas en este borrador (revisables)
- Sin puntos de vida: muerte por fallas fisiológicas concretas.
- Plan corporal por especie como árbol de partes con tejidos y funciones; el individuo guarda solo los desvíos.
- Las capacidades se derivan del cuerpo y son lo que leen las demás capas.
- Patógenos como entidades con origen y evolución; contagio solo por exposición en eventos.
- Pocos nutrientes, cada uno con una enfermedad reconocible.
- Dos relojes de muerte por vejez: desgaste del cuerpo y límite de vida del Cielo.
- El daño a meridianos y la desviación de qi son estados del cuerpo con causas, no penalizaciones de reglas.

## Decisiones (2026-10-05)
- **Plan humano detallado en tier 4 (~60 partes):** dedos, ojos, orejas, dientes y órganos por separado. Tier 3 usa zonas (§16).
- **Objetivos de calibración (sensación buscada):** una herida grave sin tratar mata más o menos a 1 de cada 3 (sobre todo por infección); una herida leve limpia casi nunca mata; un mortal promedio que sobrevive a la infancia llega a los 50-60 años; la mortalidad infantil es alta en mundos con medicina pobre.

## Preguntas abiertas
- Calibración fina de curación, infección y mortalidad con la sim headless, contra los objetivos de arriba.

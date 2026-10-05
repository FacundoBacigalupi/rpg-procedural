# Intrigas (planes de NPCs contra otros)

> Un NPC astuto quiere algo que otro tiene o le impide tener. No lo ataca de frente: habla con otros, siembra rumores, prepara una trampa y espera a que la víctima tome las decisiones que él previó. La víctima (el jugador u otro NPC) puede no darse cuenta hasta el final, o nunca.

Depende de: [npc-psychology.md](npc-psychology.md) (objetivos, utilidad, creencias sobre otros), [causality.md](causality.md) (todo paso es un evento con causas), [heaven-karma.md](heaven-karma.md) (las intrigas generan karma). Se apoya en el futuro sistema de información y rumores.

## Principios
1. **Nada de guiones.** Una intriga es un plan que un agente ejecuta con las mismas acciones que cualquier otro (hablar, mentir, pagar, esconder, atacar). No hay "evento trampa" escrito a mano; lo que hay es un NPC que decidió mentir sobre un tesoro.
2. **El jugador no es especial.** Los NPCs traman entre ellos todo el tiempo. El jugador es una víctima más, y solo lo eligen si tiene algo que quieren o les estorba.
3. **El plan vive en las creencias del intrigante.** Modela a su víctima con lo que **cree** saber de ella. Si se equivoca sobre tu personalidad, el plan falla. Si lo conocés mejor de lo que él cree, podés usarlo en su contra.
4. **Oculto pero trazable.** El plan es parte de `WorldTruth`, nunca se le pasa al narrador. Se descubre por percepción, rumores, contradicciones e inferencia. Después de muerto (o en el inspector), `why <eventId>` muestra la cadena entera.
5. **La complejidad sale del intelecto, no del autor.** Un intrigante torpe manda matones de noche. Uno brillante arma cinco capas que te hacen elegir lo que él quería creyendo que fue idea tuya.

## 1. Motivos
Una intriga nace cuando un objetivo del NPC (siempre con `originEventId`) tiene a otra persona como **obstáculo o medio**:

| Motivo | Ejemplo |
|---|---|
| Codicia | Tenés una técnica, un tesoro, una herencia. |
| Rival afectivo | A la persona que él quiere le gustás vos. |
| Posición social | Tenés el favor del maestro, el puesto, el matrimonio que él quería. |
| Obstáculo | Investigás algo que lo compromete, o protegés a alguien que quiere eliminar. |
| Venganza | Resentimiento acumulado, aunque lo que recuerda esté distorsionado. |
| Encargo | Otro le paga o lo obliga: es el brazo de una intriga ajena. |
| Prevención | Cree que vos vas a atacarlo (paranoia, esquema "el mundo es hostil"). |

Que el motivo dé lugar a una intriga y no a otra cosa (pedir, competir, rendirse) depende de la utilidad: `boldness`, `control`, `warmth` baja, valores (¿lo frena la honra o el miedo al karma?) y relación con la víctima.

## 2. Métodos (catálogo, en `content/`)
Cada método es una **plantilla de sub-plan** con precondiciones y efectos esperados, armada con acciones normales:

- **Violencia directa:** asesinato nocturno, emboscada, contratar asesinos, envenenar.
- **Cebo:** plantar un rumor (tesoro, herencia, oportunidad) que lleva a la víctima a un lugar o acción preparados.
- **Falsas creencias:** calumniar, falsificar pruebas, hacer que un tercero crea que la víctima le hizo daño. Usar a otro como arma.
- **Reclutar o coaccionar:** sobornar, chantajear con secretos reales, aprovechar deudas o resentimientos ajenos.
- **Dilema fabricado:** forzar una elección donde todas las salidas sirven al plan (por ejemplo, salvar a un amigo o llegar a la prueba de la secta).
- **Tentación:** ofrecer justo lo que la víctima desea (sus objetivos y demonios son conocidos) a cambio de algo que la compromete.
- **Aislar:** separar a la víctima de sus protectores, dañar su reputación antes del golpe final.
- **Encubrir:** coartadas, eliminar testigos, culpar a otro.

Las técnicas que un NPC conoce se **aprenden**: por experiencia propia (memorias de intrigas que funcionaron), por haberlas sufrido o por enseñanza (escuelas, sectas de asesinos, cortes). Un NPC no usa un método que nunca vio ni pensó.

## 3. El planificador
Planificación jerárquica (estilo HTN) **sobre las creencias del intrigante**, no sobre la verdad.

```ts
interface Scheme {
  id: SchemeId;
  owner: AgentId;
  target: AgentId;
  goal: GoalId;                 // el objetivo que la motiva (con originEventId)
  plan: PlanNode;               // árbol: pasos, ramas condicionales, contingencias
  targetModel: BeliefRef;       // cómo cree el intrigante que piensa la víctima
  accomplices: AgentId[];       // quiénes participan (y cuánto saben)
  status: "preparing" | "active" | "adapting" | "succeeded" | "failed" | "abandoned" | "exposed";
  originEventId: EventId;       // el momento en que decidió tramar
  log: EventId[];               // eventos que produjo
}

interface PlanNode {
  step: ActionTemplate | MethodRef;
  expects?: PredictedReaction;  // qué cree que hará la víctima
  branches?: Array<{ if: Condition; then: PlanNode }>; // si la víctima hace otra cosa
  next?: PlanNode;
}
```

- **Modelo de la víctima:** para predecir tus decisiones, el intrigante corre **la misma función de utilidad de la víctima, pero con los rasgos y objetivos que él cree que tiene**. Si cree que sos codicioso porque te vio regatear, el cebo será un tesoro. Si en realidad sos cauto, no vas, y el plan pasa a una rama o falla.
- **Presupuesto por intelecto:** `intellect` limita la profundidad del árbol y cuántas ramas considera. `control` (paciencia, planificación) limita el horizonte temporal: semanas o décadas. `perception` y `memory` limitan la calidad del modelo de la víctima.
  - Intelecto bajo: 1-2 pasos, sin ramas ("que la maten esta noche").
  - Medio: 3-5 pasos, una contingencia.
  - Alto: árbol profundo, varias capas de engaño, cómplices que no saben que lo son, y un chivo expiatorio preparado.
- **Ejecución:** cada paso se convierte en una acción normal en la cola del intrigante y compite en su utilidad con su vida diaria (no deja de comer ni de cultivar para tramar). Todo lo que hace es un evento con `causes` que apunta al paso anterior y al `originEventId` del plan.
- **Adaptación:** el intrigante solo se entera de lo que percibe o le cuentan. Si la víctima se desvía, re-planifica desde su creencia actual, o abandona si el costo esperado ya no compensa.

## 4. Ejemplo: el tesoro del bosque
Zhao (intelecto alto, `warmth` baja) quiere el puesto de discípulo interno que el maestro piensa darte.

1. Zhao cree que sos ambicioso y que confiás en Wen, el herbolario (lo vio conversar con vos).
2. Le cuenta a Wen, como de pasada, que unos cazadores vieron una hierba espiritual en la cueva del barranco. Wen no miente al pasarlo: cree el rumor.
3. Wen te lo cuenta. Tu fuente es alguien en quien confiás, así que la confianza en el rumor es alta.
4. Zhao le paga a dos bandidos (el dinero sale de sus ahorros: conservación) para esperar en el barranco.
5. Rama: si no vas en tres días, Zhao hace que otro discípulo comente frente a vos que él piensa ir a buscarla.
6. Vas, te emboscan. Si morís, Zhao se lleva el puesto. Si sobrevivís, hay rastros: los bandidos saben quién les pagó, Wen recuerda de dónde sacó el rumor y el dinero de Zhao bajó.

Nada de esto es un evento especial: son conversaciones, un pago, una espera y un ataque. La "trampa" es emergente.

## 5. Descubrir una intriga
Cada paso deja **huellas** reales en el mundo (testigos, dinero que se movió, rumores con fuente rastreable, contradicciones):

- **Percepción:** notar que te siguen, que el rumor llegó demasiado justo, que alguien sabe algo que no debería.
- **Rastrear rumores:** preguntar "¿quién te lo dijo?" sigue la cadena real de `toldBy` en las memorias (con distorsión y olvido).
- **Cómplices:** pueden traicionar, confesar bajo presión o dejar pruebas. Su lealtad es una relación más.
- **Inferencia:** el jugador razona por su cuenta. El narrador solo le muestra lo que su personaje percibió, nunca la conclusión.
- **Contra-intriga:** una víctima que detecta el plan puede fingir que cae, usar la trampa contra el intrigante o exponerlo ante otros.

El ritmo "a lo Lord of the Mysteries" sale de acá: los eventos de fondo ocurren con causas reales, el jugador ve fragmentos sueltos y solo al final (o al leer la crónica) se arma el cuadro.

## 6. Consecuencias
- **Karma:** cada intriga crea `KarmicBond`s entre intrigante, víctima y cómplices, con peso según el daño. Matar por intriga pesa como matar.
- **Psicología:** el éxito refuerza el esquema "la gente es manipulable" y el hábito de tramar. El fracaso o la exposición genera miedo, vergüenza y quizás un demonio. A la víctima que sobrevive le quedan memorias intensas, resentimiento y quizás el esquema "no confíes".
- **Reputación:** una intriga expuesta se vuelve un rumor que se propaga.
- **Cadenas:** la venganza de la víctima o de su familia puede abrir otra intriga. Así nacen enemistades de generaciones.

## 7. Escala por tier
- **Tier 3-4:** planificador completo, intrigas multi-capa.
- **Tier 2:** métodos simples (1-3 pasos), sin modelo fino de la víctima.
- **Tier 0-1 y simulación histórica:** en agregado. Por ejemplo, "en esta corte hay N intrigas por década con tal tasa de éxito", que deja asesinatos, desgracias y enemistades con procedencia resumida.

## 8. Implementación (Fase 3+, después de rumores e información)
- **F1:** asesinato y robo directos motivados por objetivos (sin modelo de la víctima).
- **F2:** cebos y rumores falsos (requiere el sistema de información) y cómplices pagados.
- **F3:** modelo de la víctima (utilidad sobre creencias), ramas y re-planificación.
- **F4:** chantaje, calumnias, dilemas fabricados, contra-intriga y escuelas que enseñan métodos.

**Tests:**
- Determinismo: mismo seed y mismas acciones dan la misma intriga.
- Ningún paso sin `causes` hacia el plan.
- El planificador nunca lee `WorldTruth` (solo creencias).
- Un intrigante con un modelo errado de la víctima falla en un escenario controlado.
- Conservación: el dinero de los sobornos sale de algún lado.
- El narrador nunca recibe el `Scheme`.

## Preguntas abiertas
- ¿Cuántas intrigas activas como máximo por NPC (costo de CPU)?
- ¿Cómo se ve en la crónica final? Propuesta: una sección "Lo que nunca supiste", que revela las intrigas que te afectaron.

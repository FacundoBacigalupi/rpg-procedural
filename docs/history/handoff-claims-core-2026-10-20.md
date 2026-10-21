# Estado anterior: claims core y ramas pendientes

**2026-10-20: #652 y #653 integrados por squash a develop, `ec05d59`.**
Git fetch, push, consulta y merge funcionan con permisos ampliados en esta sesión.
PR #651 de dependencias sigue fuera de alcance. Worktrees temáticos conservados;
sus cambios sociales ya entraron en #652, no volver a integrarlos por hash.

Lote anterior: entierro y crédito opt-in, sucesión de bandas, percepción NPC de
asaltos y deliberación del consejo, reservas de ofrendas, núcleo de productos de
culto, métricas de oscilación y método compartido Claude/Codex. Defaults y motor
sin cambios. [Evidencia y límites](../history/handoff-social-continuity-2026-10-20.md):
check de producción `487abdd` con 3239 tests aprobados y dos fallos del fixture;
fixture reparado en `d4e5395`, 15 tests afectados aprobados, typecheck/lint exit 0.
No se repitió la suite amplia tras ese cambio exclusivo de pruebas.

Diseño de objetos con identidad integrado en #653 (`ec05d59`), sin código,
revisado independientemente y con diff/LF/enlaces comprobados. ROADMAP divide
contrato, núcleo puro, take con contienda, give y replay/perfil. Diseño en
property §12 y dueños en ARCHITECTURE §4.5.

Lote actual, base `ec05d59`, coordinador `feat/f3-item-claims-core`: agente en
`.worktrees/itemclaims`, rama `feat/f3-itemclaims-agent`, implementa solo núcleo
puro de posesión/donación y tests en sim/property; sin componentes activos ni
consumidores, defaults, motor o contenido. node_modules es junction, conservar.
Núcleo integrado localmente en `01c4f26`; corrección de titulares Party y dos
casos colectivos en `61091e3`. 40 tests de property aprobados, typecheck y lint
exit 0; logs `sim-reports/item-claims-core-{tests,typecheck,lint}.log` y tests.exit.
Sin suite amplia adicional: núcleo nuevo sin consumidores ni efectos al cargar.
El agente agotó su cuota después de dejar la corrección sin commit en su
worktree; coordinador incorporó y verificó ambos archivos. No reintegrarlos.

Inventario de ramas auditado por pedido del usuario (2026-10-20):
- Bandas y culto: commits/archivos incorporados a #652; worktrees limpios.
  Cult tiene patch-ids distintos en dos commits, pero archivos de núcleo/tests
  idénticos a la rama coordinadora integrada. No necesitan otro merge.
- Funerales: commits incorporados a #652, pero **cuatro archivos sin commit**
  permanecen en `.worktrees/funeral`: funerals.ts/test, loans.ts y world/space.ts.
  Son avance de tumba física/cadáver local, no integrado; ROADMAP `funeral-tomb-wip`.
  Respaldo sin alterar el worktree: `sim-reports/funeral-tomb-wip-before-integration.patch`.
- Remoto real (`git ls-remote --heads origin`): main, develop y dependabot #651.
  Las referencias origin/feat de #652/#653 están obsoletas, no son PR pendientes.
- Claims: rama coordinadora y worktree del agente activos. No borrar junctions,
  worktrees ni cambios sin commit como parte de limpiar nombres de ramas.

Siguiente: integrar el núcleo; retomar `funeral-tomb-wip` antes de abrir take.

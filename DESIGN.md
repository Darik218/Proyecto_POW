# PULSO — Athletic Performance Command Center

Dirección solicitada en UI-REDESIGN-FINAL: aplicación deportiva premium oscura para operar, registrar y comprender. Superficies azules profundas, menta para acción y lima como acento; datos legibles y controles reales. El concepto visual de referencia está en /home/darik/.codex/generated_images/01a1655d-7a4e-7b43-ab44-21510a71d2ae/exec-919725d6-8ca2-448a-a36c-e86a107fd61e.png. Es referencia de composición; sus datos ilustrativos no son contenido del producto.

## Sistema implementado

- Tokens: `frontend/src/assets/tokens.css`, con primitivas semánticas y aliases compatibles con módulos existentes.
- Tipografía: Manrope en títulos y DM Sans en controles/cuerpo. Cifras tabulares en datos; monospace reservado para IDs.
- Motivo: pulso SVG original y pista atlética abstracta. Sin fotos, texturas raster ni gráficos ficticios.
- Contenedores: sidebar242px; contenido máximo1320px; paneles16px; controles9px; espaciado4/8px. Bordes finos, sombras limitadas.
- Layout único autenticado: sidebar, contexto, contenido del router. Drawer móvil con Escape/foco/inert; sin duplicar las vistas.
- Breakpoints: escritorio>1100px; tablet901–1100px; drawer≤900px; columnas móviles≤600px. Los formularios específicos reducen columnas según su contenido.
- Controles: labels persistentes, targets44px, focus visible, error/success con texto y color; estados sin datos y skeletons nunca contienen datos sintéticos.
- Movimiento: entrada de página260ms, microinteracciones140ms, expansión nativa y pista introductoria. Se respeta prefers-reduced-motion.
- Datos: totales del dashboard proceden de los campos total del servidor; gráficos solo cuentan las sesiones visibles y declaran su cobertura. Las mediciones sin unidad histórica no se convierten ni se grafican como si compartieran una unidad.
- Seguridad visual: pendiente, aceptado inactivo, grant activo, revocado y aplicado son estados separados. Ningún nuevo efecto implica éxito antes del COMMIT confirmado.

La ruta `/app` conserva Mi rutina. `/app/overview` incorpora el dashboard al router/guard existentes. La navegación y la marca ofrecen Inicio sin alterar el destino de autenticación original.

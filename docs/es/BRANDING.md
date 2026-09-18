# Branding aprobado e instalación de Lila Modeler

**Decisión del usuario: 14 de septiembre de 2026.**

Lila Modeler toma su nombre de la chihuahua del usuario. La identidad elegida es la
ilustración **detallada**, de color blanco/crema sobre morado: cabeza ladeada, orejas
dobladas asimétricas, ojos expresivos con brillos, nariz y pelo con detalle.

Las pruebas de silueta minimalista, relieve con facetas y rostro simplificado se
descartaron porque perdían expresión. No deben sustituir al dibujo aprobado ni
servir como base para futuras exportaciones, salvo que el usuario pida rediseñarlo.

El icono se utiliza en la aplicación, el editor y el favicon. El logo horizontal
“Lila Modeler” se muestra sobre blanco en la presentación del producto y al iniciar
el editor, tanto en navegador como en escritorio, acompañado de la versión real.
La carga termina cuando el lienzo está listo, sin espera mínima artificial, y ofrece
recuperación si falla. La página del producto no tiene pantalla de carga.

Los originales son raster, no vectores. La variante monocromática es alternativa.
Consulta la [decisión completa](../design/branding/DECISION.md) y la
[guía de archivos y exportación](../design/branding/README.md).

## Variante transparente — 18 de septiembre de 2026

La variante aprobada `sources/lila-transparent.png` (1254 × 1254 px) contiene solo
Lila con transparencia real. Se obtuvo del original con el editor de imágenes;
es un derivado raster independiente, no una máscara idéntica píxel a píxel ni un
vector. La barra del editor, la bienvenida y la cabecera del sitio utilizan
`web/lila-transparent.png` (256 × 256 px), sobre la superficie de cada tema.

Conserva las proporciones, el color y el canal alfa; no recortes las orejas ni
apliques filtros, sombras o contenedores redondeados. Comprueba el contorno sobre
fondos claros y oscuros. Para composiciones grandes usa el archivo fuente y para
nuevos tamaños usa `tools/generate-branding.mjs`, sin regenerar el personaje.
El favicon y los iconos de plataforma mantienen el fondo morado; el logo
horizontal continúa sobre blanco en la presentación principal y el arranque.

## Instalación registrada

El 14 de septiembre de 2026 se instaló en `/Applications/Lila Modeler.app` la versión
`1.0.0-alpha.1`, compilación `357`, para Apple Silicon, basada en el commit `b165374`.
La copia instalada pasó las comprobaciones de arranque y se dejó abierta para
validación manual. Los cambios se subieron mediante la
[PR #350](https://github.com/AlambritoDito/lila-modeler/pull/350).

Es un registro histórico, no una garantía de la versión instalada actualmente ni
del estado actual de la PR. El [registro de instalación](../design/branding/INSTALLATION-2026-09-14.md)
incluye la revisión completa, pruebas y comandos para consultar la procedencia.
La instalación local no implica que se haya publicado una release o desplegado la web.

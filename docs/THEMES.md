# Formato de tema

Un tema de Lila Modeler es un único archivo JSON con un objeto plano:

```json
{ "name": "Eva-01", "tokens": { "bg.base": "#12101A", "font.size.base": "13px" } }
```

`name` es la etiqueta que ve el usuario en la lista de temas. `tokens` es un mapa
de nombre de token a valor. Las claves válidas son **solo** las de
`apps/web/src/theme/tokens.ts` (`TOKEN_NAMES`), que son las del brief
`prompts/claude-design-ui.md`; los dos temas integrados traen las 40. Los valores de
color son hex (`#rgb`, `#rrggbb` o `#rrggbbaa`, este último para `shadow`); los
de `font.ui`, `font.mono` y `font.diagram` son listas de familias CSS;
`font.size.base` es una longitud CSS y `density` es `compacta`, `normal` o
`comoda`. Es un objeto plano y no un árbol anidado a propósito: así el JSON que
se exporta se lee de un vistazo, el diff es legible y no hay dos maneras de
escribir el mismo tema.

`applyTheme(theme, root)` (en `apps/web/src/theme/applyTheme.ts`) escribe cada
token como variable CSS en `root`, convirtiendo el nombre con `tokenToCssVar`:
los puntos pasan a guiones y nada más, sin tocar mayúsculas
(`bg.base` → `--bg-base`, `diagram.marker.error` → `--diagram-marker-error`,
`fg.onAccent` → `--fg-onAccent`). La conversión es reversible, que es lo que
permite a la pantalla Apariencia (LILA-114) exportar de vuelta al mismo JSON.
Los valores por defecto (Eva-01) viven además en `apps/web/src/theme/tokens.css`
como `:root`, de modo que la app pinta bien antes de cargar tema alguno. De ahí
salen los tres comportamientos de `applyTheme` ante un tema imperfecto:

- **Token ausente**: no es error. Se queda con el valor por defecto de
  `tokens.css`, así que un tema parcial (`{ "accent.primary": "#00FFAA" }`) es
  legal y solo cambia lo que trae.
- **Clave desconocida**: `Error`. Escribirla dejaría una variable basura
  (`--foo-bar`) que ningún componente lee y que nadie llegaría a ver.
- **Valor que no es texto** (número, `null`, objeto): `Error`. Escribirlo dejaría
  CSS inválido y el elemento se pintaría mal sin aviso.

Quien llame a `applyTheme` con un tema de fuera (un JSON de disco, un import de
LILA-114) tiene que capturar ese error y enseñárselo al usuario; la página de
humo de `main.tsx` lo hace en `--status-error`. Los
temas integrados se sirven como archivos estáticos y se piden por `fetch`, así
que cambiar un valor del JSON y recargar cambia la UI sin recompilar. LILA-113
(persistencia y `ThemeProvider`) y LILA-114 (editor, validación de un JSON
inválido, importar/exportar) amplían este documento.

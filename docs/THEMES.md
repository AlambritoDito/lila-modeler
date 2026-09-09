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
que cambiar un valor del JSON y recargar cambia la UI sin recompilar.

## Elegir tema (LILA-113, versión mínima)

`App.tsx` conoce los temas integrados por id (`eva-01`, `papel`), pide `./<id>.json` y lo pasa a
`applyTheme`. La densidad (`compacta` / `normal` / `comoda`) se escribe encima del token `density`
del tema y sale como `data-densidad` en `.app` para el CSS. No hay `ThemeProvider`: con dos temas y
un `useState` sobra un contexto.

**Dónde se guarda la elección.** En el navegador, en `localStorage['lila.tema']` y
`localStorage['lila.densidad']`. En escritorio, en `<userData>/estado.json`, bajo `ajustes`, por el
puente (`readSettings()` / `writeSettings(ajustes)`, `apps/desktop/src/bridge.ts`), donde ya viven
la ventana y los recientes. Son excluyentes: si `window.lila` existe, el `localStorage` ni se lee ni
se escribe. Hasta ahora era `localStorage` en las dos modalidades, con el argumento —cierto— de que
`lila://` es un esquema con origen propio y por tanto tiene su propio almacén; lo que falla no es el
aislamiento sino el sitio: ese almacén está dentro del perfil de Chromium de la app, no se ve desde
fuera, no se copia a otra máquina y se va con los datos del sitio. `writeSettings` **fusiona**
(mandar solo `{ tema }` no borra la densidad) y `main.ts` pasa lo que llega por `parseAjustes`, que
descarta cualquier clave o valor que no sea uno de los dos textos esperados. Leer es asíncrono —en
escritorio es IPC—, así que `temaId` y `densidad` arrancan de fábrica y el primer efecto los pisa:
es el mismo instante en el que `tema` deja de ser `undefined`, y el lienzo no se monta hasta
entonces.

**Cambiar de tema en caliente.** `cambiarTema` aplica el JSON y llama a `Modelador.repintar()`. El
lienzo **no** se remonta —antes cambiaba la `key` de `<Lienzo>`, y eso se llevaba por delante la
pila de deshacer y la selección—. `repintar()` reconstruye el `bpmnRenderer` porque bpmn-js copia
`defaultFillColor`/`defaultStrokeColor`/`defaultLabelColor` a variables locales de su constructor y
no ofrece ni setter ni evento para cambiarlas: se vuelve a ejecutar ese constructor sobre la misma
instancia (con un `eventBus` mudo, para no apilar oyentes de `render.shape`) y después se dispara
`elements.changed`, que es la vía normal de diagram-js para redibujar. No pasa por el
`commandStack`, así que ni ensucia el documento ni añade un paso al deshacer, y los colores que un
elemento traiga en su DI siguen mandando sobre los del tema.

Esa última regla tiene una consecuencia en «Validar rutas»: los colores neutros del modo
(`ColoresNeutrosDelTema`, `TokenSim.tsx`) se escriben en el DI al activarlo, o sea que ganan a lo
que repinte `repintar()`. El módulo relee los tokens en cada activación y no en cada repintado, así
que `App.tsx` monta `<TokenSim key={temaId}>`: cambiar de tema con el modo encendido lo apaga y lo
vuelve a encender, y así el diagrama sale con el tema de ahora. Sin esa `key` el diagrama se
quedaba con el relleno del tema anterior y la etiqueta con el color del nuevo.

**`font.size.base`** se cablea en `body` (`app.css`) y de ahí lo hereda todo lo que no fija su
propio tamaño. A propósito no está en `html`: las medidas en `rem` del CSS se resolverían contra el
token y los diálogos encogerían al bajar la letra.

LILA-114 (editor de tokens, validación de un JSON importado, exportar) amplía este documento.

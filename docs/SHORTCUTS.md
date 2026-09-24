# Keyboard shortcuts

Lila Modeler has one shortcut map (`apps/web/src/atajos.ts`): the keyboard, the tooltips, the
native menu of the desktop app and this page all come from it, and a test fails if this page
misses one of its keys. On Windows and Linux, `Ctrl` takes the place of `⌘`.

Shortcuts without `⌘`/`Ctrl` (F2, F6, Esc) do nothing while you type in a field or edit a label,
and no shortcut reaches the app while a dialog (Settings, a confirmation) is open.

## File

| Action | macOS | Windows / Linux |
| --- | --- | --- |
| New project ¹ | `⌘N` | `Ctrl+N` |
| Open project | `⌘O` | `Ctrl+O` |
| Save project | `⌘S` | `Ctrl+S` |
| Save as | `⇧⌘S` | `Ctrl+Shift+S` |
| Settings ¹ | `⌘,` | `Ctrl+,` |

## Search

| Action | macOS | Windows / Linux |
| --- | --- | --- |
| Command palette | `⌘K` | `Ctrl+K` |

## Modes

| Action | macOS | Windows / Linux |
| --- | --- | --- |
| Model ¹ | `⌘1` | `Ctrl+1` |
| Simulate ¹ | `⌘2` | `Ctrl+2` |
| Results ¹ | `⌘3` | `Ctrl+3` |
| Compare ¹ | `⌘4` | `Ctrl+4` |
| Animate ¹ | `⌘5` | `Ctrl+5` |
| Validate paths ¹ | `⌘6` | `Ctrl+6` |

The number keys are read by position, so they work on any keyboard layout.

## Simulation

| Action | macOS | Windows / Linux |
| --- | --- | --- |
| Run simulation | `⌘↩` | `Ctrl+Enter` |
| Cancel the run (only while it runs) | `Esc` | `Esc` |

## Canvas

With the canvas focused (click on it first):

| Action | macOS | Windows / Linux |
| --- | --- | --- |
| Zoom in | `⌘+` | `Ctrl++` |
| Zoom out | `⌘−` | `Ctrl+-` |
| Fit the diagram | `⌘0` | `Ctrl+0` |
| Rename the selected element | `F2` | `F2` |
| Undo | `⌘Z` | `Ctrl+Z` |
| Redo | `⇧⌘Z` | `Ctrl+Y` |
| Delete the selection | `⌫` | `Del` |
| Select all | `⌘A` | `Ctrl+A` |
| Copy | `⌘C` | `Ctrl+C` |
| Paste | `⌘V` | `Ctrl+V` |
| Lasso tool | `L` | `L` |
| Hand tool | `H` | `H` |
| Connect tool | `C` | `C` |
| Edit the label | `E` | `E` |
| Replace the element | `R` | `R` |

Zoom and fit work from anywhere in the window, not only from the canvas. The shape palette on the
left filters as you type and inserts the highlighted shape with `Enter`.

## Panels

| Action | macOS | Windows / Linux |
| --- | --- | --- |
| Show or hide the left column | `⇧⌘L` | `Ctrl+Shift+L` |
| Show or hide the right panel | `⇧⌘P` | `Ctrl+Shift+P` |
| Show or hide the diagram tabs | `⇧⌘D` | `Ctrl+Shift+D` |
| Show or hide the status bar | `⇧⌘B` | `Ctrl+Shift+B` |
| Move the focus to the modes | `F6` | `F6` |
| Move the focus to the right panel | `⇧F6` | `Shift+F6` |

`Tab` always moves the focus, the canvas included.

## Keys the browser keeps

¹ Only in the desktop app. In a browser, `⌘N`/`Ctrl+N` (new window), `⌘,` (browser settings) and
`⌘1`…`⌘6`/`Ctrl+1`…`Ctrl+6` (switch tabs) are taken by the browser before the page sees them: use
the bar's buttons and mode tabs instead. In the desktop app the File, View and Simulation menus
list these shortcuts next to each item.

The detached scenario window forwards `⌘S`, `⇧⌘S` and `⌘K` to the main window.

[Versión en español](es/ATAJOS.md)

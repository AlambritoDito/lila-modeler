# Keyboard shortcuts

Lila Modeler has one shortcut map (`apps/web/src/atajos.ts`): the keyboard, the tooltips, the
native menu of the desktop app and this page all come from it, and a test fails if this page
misses one of its keys. On Windows and Linux, `Ctrl` takes the place of `⌘`.

Shortcuts without `⌘`/`Ctrl` (F2, F6, Esc, the align keys) do nothing while you type in a field or edit a label,
and, apart from the desktop app's File menu, no shortcut reaches the app while a dialog
(Settings, a confirmation) is open.

## File

| Action | macOS | Windows / Linux |
| --- | --- | --- |
| New project ¹ | `⌘N` | `Ctrl+N` |
| Open project | `⌘O` | `Ctrl+O` |
| Save project | `⌘S` | `Ctrl+S` |
| Save as | `⇧⌘S` | `Ctrl+Shift+S` |
| Print the diagram ² | `⌘P` | `Ctrl+P` |
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

The number keys are read by position, so they work on any keyboard layout. Switching modes
from the keyboard is a desktop-app feature: in a browser these keys switch the browser's tabs, so
the web app leaves them alone — click a mode tab or use the command palette (`⌘K`) instead.

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
| Align left | `⌥⇧L` | `Alt+Shift+L` |
| Align center | `⌥⇧C` | `Alt+Shift+C` |
| Align right | `⌥⇧R` | `Alt+Shift+R` |
| Align top | `⌥⇧T` | `Alt+Shift+T` |
| Align middle | `⌥⇧M` | `Alt+Shift+M` |
| Align bottom | `⌥⇧B` | `Alt+Shift+B` |
| Distribute horizontally | `⌥⇧H` | `Alt+Shift+H` |
| Distribute vertically | `⌥⇧V` | `Alt+Shift+V` |

Zoom and fit work from anywhere in the window, not only from the canvas. The align keys act on the
selected shapes (two or more; three or more to distribute), like the align buttons of the Model
bar and the command palette. The shape palette on the
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

¹ Only in the desktop app. In a browser, `⌘N`/`Ctrl+N` (new window) and `⌘,` (browser settings)
are taken by the browser before the page sees them, and the web app does not listen to
`⌘1`…`⌘6`/`Ctrl+1`…`Ctrl+6` so they keep switching the browser's tabs: use the bar's buttons, the
mode tabs or `⌘K` instead. In the desktop app the File, View and Simulation menus
list these shortcuts next to each item.

² Prints the diagram alone, black on white, on one sheet. In a browser, that print dialog is also
how you get a PDF (choose «Save as PDF»); the desktop app has «File → Export diagram as PDF…» as
well. SVG and PNG exports are in the File menu and the command palette, with no key of their own.

In the desktop app `⌘W`/`Ctrl+W` closes the focused window (About or the detached scenario on
their own; the main window asks first when there are unsaved changes and, like its red button,
quits the app) and `⌘Q`/`Ctrl+Q` quits (on Windows use the window's close button or `Alt+F4`).
Both come from the native menu's own roles, so they are not in the map above and a browser keeps
them for itself.

The detached scenario window forwards `⌘S`, `⇧⌘S` and `⌘P` to the main window; `⌘K` too, but only in the desktop app, where the main window is raised first (a browser cannot bring another window to the front, so there the key does nothing in the detached window).

[Versión en español](es/ATAJOS.md)

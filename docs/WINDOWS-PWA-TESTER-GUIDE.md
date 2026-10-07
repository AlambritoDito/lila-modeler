# Windows web app tester guide

> Read this in: [Español](es/GUIA-PROBADOR-WINDOWS-PWA.md)

Thank you for trying Lila Modeler on Windows. On Windows, Lila Modeler is meant to be used as a
**web app installed from Microsoft Edge or Google Chrome** ([ADR-031](DECISIONS.md)): it gets its own
window and Start menu entry, opens `.lila` files on double click and saves back to the same file.
**Nobody on the project has done this on a real Windows machine yet**, so you are the first: things
may not work, and a clear report of what did and did not work is exactly what we need. You do not
have to be a developer. Set aside about 20 minutes.

Two things to know before you start:

- There is nothing to download and no installer: no SmartScreen warning and no administrator
  rights. The browser installs the app from the project's website.
- Lila Modeler runs entirely in your browser: no account and nothing is uploaded. Your files stay
  where you save them.

(The unsigned `.exe` installer is a separate, secondary option with its own
[guide](WINDOWS-TESTER-GUIDE.md). You do not need it for this one.)

## What you need

- Windows 10 or Windows 11.
- Microsoft Edge (it comes with Windows). If you also have Google Chrome, step 12 repeats the main
  steps there.
- An internet connection for the first visit; step 10 checks that the app then works without one.

## Steps

Menu and button names below are the app's English ones. If the app shows up in Spanish, click
**Ajustes** (the gear at the top right) and set **Idioma** to **English**, or read the
[Spanish guide](es/GUIA-PROBADOR-WINDOWS-PWA.md), which uses the Spanish names. Browser menus change
a little between versions: if a name does not match exactly, pick the closest one and note it in
your report.

1. **Open the app in Edge.** Go to <https://alambritodito.github.io/lila-modeler/app/>. A white
   screen with the Lila Modeler logo and a version number (for example `v1.0.0-beta.22`) appears
   for a moment, then the editor with an example diagram (a restaurant order). Write down the
   version you saw.
2. **Install it.** In the address bar, click the **App available** icon (a small square with a plus
   sign or a down arrow), or open the **⋯** menu ▸ **Apps** ▸ **Install this site as an app**. The
   dialog should say **Lila Modeler** with the purple dog icon; click **Install**. Edge may offer to
   pin it to the taskbar or Start; accept whatever you like. The app reopens in its own window,
   without the address bar.
3. **Open it from Start.** Close that window. Open the **Start** menu, type `Lila` and open **Lila
   Modeler**. It should open in its own window with the purple dog icon in the taskbar.
4. **Run a simulation.** Click **Simulate** in the top bar, then **Run simulation**. The dock under
   the canvas shows the quick results when it finishes.
5. **Save as a `.lila` file.** Click **File ▸ Save as**. The usual Windows **Save As** dialog opens
   (not a download). Pick a folder you know (for example **Documents**), keep or change the name,
   and click **Save**. In File Explorer, check that the folder now has a file ending in `.lila`, and
   that nothing new appeared in **Downloads**.
6. **Save again to the same file.** Back in the app, click a task in the diagram, change its name
   (double-click it and type), and press `Ctrl+S` (or **File ▸ Save**). This time **no dialog
   should appear**. If the browser asks whether Lila Modeler may save changes to the file, choose
   **Allow** (or **Save changes**). In File Explorer, check that the **Date modified** of the same
   `.lila` changed and that there is no second copy.
7. **Open it by double click.** Close the app window. In File Explorer, **double-click the `.lila`
   file**. Lila Modeler should open in its own window with your renamed task. The first time,
   Windows may ask which app to use (choose **Lila Modeler**) and the browser may ask whether Lila
   Modeler may open `.lila` files (choose **Allow**; you may tick **Remember my choice**). If the
   double-click opens something else or nothing, open the app from Start and use **File ▸ Open**
   instead, and say in your report that the double-click failed.
8. **Double-click with unsaved changes.** With the project open, change something again (for
   example rename another task) and do **not** save. Double-click the same `.lila` in File Explorer
   again. The app should ask about **Unsaved changes** with **Save and continue**, **Discard** and
   **Cancel**. Click **Discard**: the file reopens as it was on disk, without your last change.
9. **Open from inside the app.** Click **File ▸ Open**. The Windows **Open** dialog appears; pick
   your `.lila` and click **Open**. Then change something and press `Ctrl+S`: it should save to that
   file without asking where.
10. **Use it offline.** Close the app. Turn on airplane mode (or unplug the network cable). Open
    **Lila Modeler** from Start: it should still open with the editor, and step 4 should still
    work. Turn the connection back on.
11. **Uninstall.** In the app window, open the **⋯** menu at the top right ▸ **Uninstall Lila
    Modeler** (or **App settings** ▸ **Uninstall**; or **Settings ▸ Apps ▸ Installed apps** in
    Windows). Confirm. Check that **Lila Modeler** disappears from Start. Your `.lila` file stays
    where you saved it.
12. **Optional: repeat with Chrome.** If you have Google Chrome, open the same address in it and
    install it from the install icon in the address bar (a monitor with a down arrow) or **⋮ ▸
    Cast, save and share ▸ Install page as app…**. Then repeat steps 3 to 7 and 11 and note any
    difference.

## Report what happened

Please report even if everything worked (“all 12 steps fine” is useful). Use one of these:

- Open an issue at [github.com/AlambritoDito/lila-modeler/issues/new](https://github.com/AlambritoDito/lila-modeler/issues/new/choose)
  and paste the template below. Please do not put anything private in it; screenshots can be
  cropped to the app window.
- Or send the same text, with the screenshots, by message to the person who gave you this guide.

To find your Windows version, press `Win+R`, type `winver` and press Enter. To find the browser
version, open `edge://version` (or `chrome://version`) in a normal browser tab.

```text
Lila Modeler version (step 1):
Windows version and build (from winver):
Browser and version (Edge / Chrome, from edge://version or chrome://version):
Windows language and app language (English / Spanish):
Computer: (for example laptop, 8 GB RAM; managed by an employer or school: yes / no)

Step by step (OK / failed / skipped, and a note):
1  Open the app in Edge:
2  Install it:
3  Open it from Start:
4  Run a simulation:
5  Save as a .lila (Windows Save As dialog, no download):
6  Save again to the same file (no dialog, same file updated):
7  Open by double click:
8  Double-click with unsaved changes (Unsaved changes dialog):
9  File ▸ Open and save in place:
10 Offline:
11 Uninstall:
12 Chrome (optional):

For every step that failed: what you did, what you expected, what happened.
Exact message of any browser or Windows prompt (copy the text, or attach a screenshot):
Screenshots attached: yes / no
Anything else that felt slow, confusing or odd:
```

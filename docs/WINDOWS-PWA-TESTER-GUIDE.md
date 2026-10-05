# Windows web app tester guide

> Read this in: [Español](es/GUIA-PROBADOR-WINDOWS-PWA.md)

Thank you for trying Lila Modeler on Windows. On Windows the recommended way to use it is the web
app **installed from Chrome or Microsoft Edge**: it gets its own window and Start menu entry, opens
`.lila` files with a double click and saves back to the same file, with no installer and no security
warning. **Nobody on the project has tried this on a real Windows machine yet**, so you are the
first: things may not work, and a clear report of what did and did not work is exactly what we need.
You do not have to be a developer. Set aside about 20 minutes.

Lila Modeler runs entirely on your computer: no account, and your models are not uploaded anywhere.
Your files stay where you save them. It does need an internet connection to start.

## What you need

- Windows 10 or Windows 11.
- **Google Chrome** or **Microsoft Edge** (Edge comes with Windows), up to date. If you have both,
  doing the guide once in each is twice as useful, but one is enough.
- Firefox does not install web apps, so it is not covered here.

## Steps

Menu and button names below are the app's English ones. If the app shows up in Spanish, open
**Ajustes** (`Ctrl+,`), go to **General** and set **Idioma** to **English**, or
read the [Spanish guide](es/GUIA-PROBADOR-WINDOWS-PWA.md), which uses the Spanish names. Browser
menus change between versions; if a name below does not match exactly, look for the closest one and
say so in your report.

1. **Open the app.** In Chrome or Edge, go to
   <https://alambritodito.github.io/lila-modeler/app/>. A short loading screen with the Lila
   Modeler logo appears, then the editor with a diagram.
2. **Install it.**
   - **Chrome:** click the install icon at the right end of the address bar (a small screen with a
     downward arrow) and then **Install**. If there is no icon, open the **⋮** menu ▸ **Cast, save
     and share** ▸ **Install page as app…** and click **Install**.
   - **Edge:** click the **App available** icon in the address bar and then **Install**, or open the
     **…** menu ▸ **Apps** ▸ **Install this site as an app** and click **Install**.

   The app opens in its own window, without the address bar. Edge may ask whether to pin it to the
   taskbar or the Start menu; either answer is fine. Check that **Lila Modeler** now appears in the
   Start menu with the purple Lila icon.
3. **Open the example.** In the app window, the **Restaurant order** example should be on the
   canvas (a diagram with tasks such as **Take order**). If the canvas is empty, tell us in the report.
4. **Run a simulation.** Click **Simulate** in the top bar, then **Run simulation**. The dock under
   the canvas shows the quick results. Click **Open in Results** to see the full tables.
5. **Save as a `.lila` file.** Open **File ▸ Save**. The first time, a Windows **Save As** window
   asks where: pick a folder you know (for example **Documents**), keep or change the name, and click
   **Save**. The file ends in `.lila`.
6. **Save again to the same file.** Go back to **Model**, move one shape a little, and open **File ▸
   Save** again. This time **no window should appear and nothing should be downloaded**: the same
   file is rewritten. Check your **Downloads** folder: no new `.lila` should be there. If the browser
   asks whether the site may save changes to the file, click **Save changes** (or **Allow**).
7. **Close the app.** Close its window with the **X**. If it warns about unsaved changes, choose to
   leave anyway only if you just saved.
8. **Open the file with a double click.** In File Explorer, go to the folder from step 5 and
   **double-click the `.lila` file**. The first time, Windows may ask **How do you want to open this
   file?**: choose **Lila Modeler** (tick “Always use this app” if offered). The browser may then
   ask for permission to open the file (for example “Open file?” or “Allow Lila Modeler to open
   `.lila` files?”): allow it. Lila Modeler should open in its own window with your saved project,
   including the simulation results under **Results**. If the double click does nothing or opens
   something else, open the app from the Start menu, use **File ▸ Open**, and say in your report
   that the double click failed.
9. **Save after the double click.** Move a shape again and choose **File ▸ Save**. As in step 6, the
   same file should be rewritten with no download (the browser may ask once for permission to save
   changes).
10. **Uninstall.**
    - **Chrome:** in the app window, open the **⋮** menu in its title bar ▸ **Uninstall Lila
      Modeler…** ▸ **Remove**. (Also possible: go to `chrome://apps` in Chrome, right-click Lila
      Modeler ▸ **Remove from Chrome…**.)
    - **Edge:** in the app window, open the **…** menu ▸ **App settings** (or go to `edge://apps`) and
      choose **Uninstall** for Lila Modeler.
    - **Either browser:** **Settings ▸ Apps ▸ Installed apps** in Windows (Windows 10: **Apps &
      features**) also lists **Lila Modeler**; **Uninstall** there removes it too.

    Check that it disappears from the Start menu. Your `.lila` files stay where you saved them.

## Report what happened

Please report even if everything worked (“all 10 steps fine in Edge” is useful). Use one of these:

- Open an issue at [github.com/AlambritoDito/lila-modeler/issues/new](https://github.com/AlambritoDito/lila-modeler/issues/new/choose)
  and paste the template below. Please do not put anything private in it; screenshots can be
  cropped to the app window.
- Or send the same text, with the screenshots, by message to the person who gave you this guide.

To find your Windows version, press `Win+R`, type `winver` and press Enter. The browser version is
under **⋮ ▸ Help ▸ About Google Chrome** or **… ▸ Help and feedback ▸ About Microsoft Edge**.

```text
Lila Modeler version: (File ▸ About Lila Modeler)
Windows version and build (from winver):
Browser and version (Chrome / Edge):
Windows language and app language (English / Spanish):

Step by step (OK / failed / skipped, and a note):
1  Open the app:
2  Install it:
3  Restaurant order example on the canvas:
4  Run a simulation:
5  First save asks where:
6  Second save, same file, no download:
7  Close the app:
8  Open by double-click:
9  Save after the double-click:
10 Uninstall (how):

For every step that failed: what you did, what you expected, what happened.
Exact error message (copy the text, or attach a screenshot):
Screenshots attached: yes / no
Anything else that felt slow, confusing or odd:
```

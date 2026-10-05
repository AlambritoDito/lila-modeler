# Windows tester guide

> Read this in: [Español](es/GUIA-PROBADOR-WINDOWS.md)

Thank you for trying Lila Modeler on Windows. **Nobody on the project has run the Windows installer
on a real Windows machine yet**, so you are the first: things may not work, and a clear report of
what did and did not work is exactly what we need. You do not have to be a developer. Set aside about
30 minutes.

Two things to know before you start:

- The installer is **not signed**, so Windows will warn you before it lets you run it (step 3). The
  project asked SignPath Foundation for a signature and was declined until it has users; there is no
  signed Windows build. The warning is expected, and the steps below show how to continue.
- Lila Modeler runs entirely on your computer: no account and nothing is uploaded. Your files stay
  where you save them.

## What you need

- Windows 10 or Windows 11, 64-bit (x64).
- Microsoft Excel or another spreadsheet program (steps 7 and 9), and Microsoft Word or another
  program that opens `.docx` files (step 8).

## Steps

Menu and button names below are the app's English ones. If your app is in Spanish, open **Archivo ▸
Preferencias…** (`Ctrl+,`), go to **General** and set **Idioma** to **English**, or read the
[Spanish guide](es/GUIA-PROBADOR-WINDOWS.md), which uses the Spanish names.

1. **Download the installer.** Open the
   [`v1.0.0-beta.16` release](https://github.com/AlambritoDito/lila-modeler/releases/tag/v1.0.0-beta.16)
   (it is a prerelease, so it does not appear under “Latest”) and download
   `Lila-Modeler-1.0.0-beta.16-win-x64.exe` from the **Assets** list. Your browser may ask you to
   confirm that you want to keep the file; confirm it.
2. **Optional: check the download.** Open the folder where you saved the file (usually
   **Downloads**) in File Explorer, right-click an empty spot and choose **Open in Terminal** (or
   type `powershell` in the address bar and press Enter). Run
   `Get-FileHash .\Lila-Modeler-1.0.0-beta.16-win-x64.exe -Algorithm SHA256` and compare the result
   with the line for that file in the release's `SHA256SUMS` (download it too). Upper and lower
   case do not matter. If they differ, do not run the file and tell us.
3. **Get past the SmartScreen warning.** Double-click the `.exe`. Windows shows **“Windows protected
   your PC”**. Click **More info**, then **Run anyway**. If Windows asks for permission to make
   changes, choose **Yes**. If anything different appears (a different message, an antivirus block,
   no button), take a screenshot: that is a result too.
4. **Install.** The installer is expected to work in one click, with no questions, and open Lila
   Modeler when it finishes. If it shows a wizard instead, follow it and note that in your report.
5. **First launch.** You should see the **Welcome** screen with the version (`v1.0.0-beta.16`),
   **Get started**, an **Examples** list and **Recent**. If Windows Defender Firewall asks about
   network access, you can choose **Cancel**; the app does not need it.
6. **Open an example.** Under **Examples**, click **Restaurant order**. A diagram opens with two
   scenarios ready to run.
7. **Run a simulation.** Click **Simulate** in the top bar, then **Run simulation**. You stay in
   Simulate and the dock under the canvas shows the quick results. Click **Open in Results** to
   see the full tables, then export them: click **Export XLSX**, choose where to
   save, and open the file in Excel. Check that it opens and has several sheets with numbers.
8. **Export the process document.** Choose **File ▸ Export process document (Word)…**, save the
   file, and open it in Word. Check that it has a cover, the diagram and one section per element.
9. **Import scenario parameters from Excel.** Go back to **Simulate**. In the scenario panel on the
   right, click **Download template** and save the `.xlsx`. Open it in Excel, change one number (in the
   **Elements** sheet, the **Take order** row, the **min** column: make it smaller), save, and close Excel. Back in Lila Modeler click **Import
   Excel/CSV…** and pick that file. A report lists the changes to make: check that your change is
   in it, then click **Apply**. You can click **Undo import** afterwards. More on this in
   [Scenario parameters from Excel or CSV](SCENARIO_SHEETS.md).
10. **Add a second process.** Below the diagram, in the row of process tabs, click the **+** button
    next to the tab (tooltip **New process**; not the zoom + at the canvas's right edge).
    Leave the suggested name in **Process name** and click **Create**. A second tab appears; click
    between the two tabs to check that each keeps its own diagram.
11. **Save as a `.lila` file.** Choose **File ▸ Save as…**, pick a folder you know (for example
    Documents) and a name, and save. The file ends in `.lila` and holds both processes.
12. **Close and reopen it.** Close the app (the window's **X**, or `Alt+F4`). If it asks about unsaved
    changes, choose **Save**. Then, in File Explorer, **double-click the `.lila` file**. Lila
    Modeler should open with both processes. If Windows asks which app to use, choose **Lila
    Modeler**. If double-clicking does nothing, open the app and use **File ▸ Open project file
    (.lila)…** instead, and say in your report that the double-click failed. If you have a `.bpmn`
    or `.xml` exported from another tool (Bizagi, Camunda, Signavio…), also try **File ▸ Import
    BPMN…** with it and say whether its diagram appeared.
13. **Uninstall.** Open **Settings ▸ Apps ▸ Installed apps** (Windows 10: **Apps & features**), find
    **Lila Modeler**, and choose **Uninstall**. Check that it disappears from the list. Your `.lila`
    and exported files stay where you saved them.

## Report what happened

Please report even if everything worked (“all 13 steps fine” is useful). Use one of these:

- Open an issue at [github.com/AlambritoDito/lila-modeler/issues/new](https://github.com/AlambritoDito/lila-modeler/issues/new/choose)
  and paste the template below. Please do not put anything private in it; screenshots can be
  cropped to the app window.
- Or send the same text, with the screenshots, by message to the person who gave you this guide.

To find your Windows version, press `Win+R`, type `winver` and press Enter.

```text
Lila Modeler version: 1.0.0-beta.16 (File ▸ About Lila Modeler)
Windows version and build (from winver):
Windows language and app language (English / Spanish):
Computer: (for example laptop, 8 GB RAM; antivirus if you know it)

Step by step (OK / failed / skipped, and a note):
1  Download:
2  Checksum (optional):
3  SmartScreen warning:
4  Install:
5  First launch (Welcome screen):
6  Open the Restaurant order example:
7  Run a simulation and export XLSX:
8  Export the process document (Word):
9  Import parameters from Excel:
10 Second process with the + tab:
11 Save as .lila:
12 Close and reopen by double-click:
13 Uninstall:

For every step that failed: what you did, what you expected, what happened.
Exact error message (copy the text, or attach a screenshot):
Screenshots attached: yes / no
Anything else that felt slow, confusing or odd:
```

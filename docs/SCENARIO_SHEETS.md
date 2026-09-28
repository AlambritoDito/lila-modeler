# Scenario parameters from Excel or CSV

> Read this in: [Español](es/SCENARIO_SHEETS.md)

The scenario panel can fill a scenario from a spreadsheet: processing times, arrivals, resource
pools, which pool each task uses and the weekly calendars. It is meant for the parameters you
already have in Excel, so you do not have to copy them field by field.

1. In the scenario panel, press **Download template**. You get an `.xlsx` with one sheet per table,
   already filled with the scenario you are editing and with one row per element of the diagram.
2. Edit it in Excel, LibreOffice, Numbers or Google Sheets. Change what you need and leave the rest.
3. Press **Import Excel/CSV…** and pick the file. Nothing changes yet: the panel shows what would
   change (with the sheet and row of each change), the rows that matched nothing and the invalid
   values, each one with its sheet, row and column, and the errors the scenario would have after
   applying.
4. **Apply** writes the changes into the scenario you are editing, and **Undo import** reverts them
   while you have not edited anything else. **Cancel** (or Escape) leaves the scenario as it was.
   Apply stays disabled while a row of the file would give the scenario a new error, and when the
   scenario or the diagram changed after reading the file: import it again then. Errors the
   scenario already had do not block, even if the file reorders a list.

The result is an ordinary scenario edit, so the validation list of the panel lints it as usual.
If the scenario inherits from another one (`extends`), the changes go into this scenario's own file,
as when you edit a field by hand ([SCENARIO_FORMAT.md](SCENARIO_FORMAT.md) § 6).

## Rules

- **An empty cell changes nothing.** The import fills in the scenario, it does not replace it. A
  sheet with only the `mean` column filled changes the means and nothing else. A sheet or a row
  the file does not have leaves those values as they are.
- **Rows are matched by BPMN id, otherwise by BPMN name.** The name comparison ignores upper and
  lower case and extra spaces. When two elements share a name the row is reported as ambiguous and
  not applied: write the id to choose one.
- **A row is applied whole or not at all.** If a row has an invalid value, nothing in that row is
  applied. For the assignments of a task and the intervals of a calendar, which take several rows,
  one invalid row leaves that task or calendar unchanged.
- **Values are checked with the same rules as the scenario** ([SCENARIO_FORMAT.md](SCENARIO_FORMAT.md)
  § 3 and § 5), so the reasons are the ones the panel and the CLI give.
- Column and sheet names are in English, as in the template. Upper and lower case, spaces and a
  unit between parentheses do not matter: `Fixed cost (MXN)` is `fixedCost`. The sheets can also
  be called `Elementos`, `Llegadas`, `Recursos`, `Asignaciones` and `Calendarios`. Unknown columns
  are ignored with a note.
- **Assignments and calendar intervals replace a whole list.** The rows of a task in Assignments
  are all its pools, and the rows of a calendar are all its intervals: deleting one of a task's two
  rows removes that pool. A task or calendar the sheet does not mention keeps what it has.
- **Numbers follow the file.** A CSV separated by `;` (what a Spanish Excel writes) uses `,` for
  decimals and `.` for thousands: `7,5`, `1.500` (fifteen hundred), `1.234.567,5`. A CSV separated
  by `,` uses `.` for decimals and `,` for thousands, which then has to be quoted: `7.5`,
  `"1,500"`. A separator that is not the decimal one must group digits by three, otherwise the
  value is an error that says the convention (`1.5` in a `;` file). In a workbook, numeric cells
  are numbers and need none of this; a number typed as text follows the language of the app, and
  one that could be read both ways (`1.500`) gets a note. A percentage works (`78%` is `0.78`);
  values that are not finite (`1e999`) are errors. A tab-separated file (Excel's «Unicode Text»)
  follows the language of the app, like text in a workbook. The `points` column is the exception:
  it has no thousands, so its decimal can be `.` or `,` in any file.
- **Hidden sheets are not read**, with a note: the import never applies data you cannot see in the
  file. A formula without a saved result (a file written by a script, or Excel in manual
  calculation) is read as empty, with a note: open the file in Excel and save it again.
- A workbook larger than 50 MB of sheets once uncompressed, or with cells beyond Excel's last row
  or column, is refused. Images and charts in it are never read.

## Sheets

### Elements

One row per task, timer, end event and outgoing flow of a gateway.

| Column | Meaning |
|---|---|
| `id`, `name` | BPMN id and name of the element. One of them is enough. |
| `kind` | `task`, `timer`, `end`, `flow`… Informative only: the import ignores it. |
| `distribution` | Processing time distribution (`processingTime`): `constant`, `uniform`, `triangular`, `exponential`, `normal`, `truncatedNormal`, `lognormal`, `gamma`, `erlang`, `weibull`, `beta`, `poisson`, `binomial` or `user`. Spanish names also work: `constante`, `uniforme`, `exponencial`, `normal truncada`, `usuario`. |
| `unit` | Unit of the times in this row: `s`, `min`, `h` or `day`. Empty means `run.baseTimeUnit`, the unit the panel shows. |
| `value` … `p` | One column per distribution parameter: `value`, `min`, `mode`, `max`, `mean`, `sd`, `shape`, `scale`, `k`, `alpha`, `beta`, `n`, `p`. Fill in the ones of the chosen distribution and leave the rest empty. `value`, `min`, `mode`, `max`, `mean` and `sd` are times in `unit`. |
| `points` | Only for `user`: `value:probability` pairs separated by `;`, for example `5:0.2; 10:0.8` (or `5:0,2; 10:0,8`). The values are in `unit`. |
| `fixedCost` | Fixed cost per execution. |
| `calendar` | Calendar key; it must exist in the scenario or in the `Calendars` sheet. |
| `probability` | For a flow that leaves a gateway: between 0 and 1, or a percentage. |
| `selection` | `and` or `or`, when the task uses several pools. |

A distribution always needs its type: parameters without `distribution` are an error, and so is a
parameter the distribution does not have.

### Arrivals

One row per start event: `id`, `name`, the same distribution columns (`interTriggerTimer`, the
time between arrivals), `triggerCount` (how many cases arrive, whole number ≥ 1), `fixedCost` and
`calendar`.

### Resources

One row per pool: `id`, `name`, `type` (`role` or `equipment`), `capacity`, `costPerHour`,
`fixedCost` and `calendar`.

- `capacity` is a whole number, or capacity by shift as `calendar:units` pairs separated by `;`
  (`day:3; night:1`).
- A row with an `id` the scenario does not have creates that pool. Without `id` the row is matched
  by `name`, and a name that matches no pool is reported.
- `name` renames a pool only when the row also has its `id`.

### Assignments

Which pools each task uses: `elementId`, `elementName`, `resourceId`, `resourceName` and `quantity`
(empty means 1). One row per task and pool. The rows of a task replace its whole list, so a task
not in the sheet keeps its pools. A row with the task and no pool leaves the task without pools.

### Calendars

One row per weekly interval: `id`, `days`, `from` and `to`. The rows of a calendar replace its
intervals, and an `id` the scenario does not have creates the calendar.

- `days`: `MON,TUE,WED`, a range such as `MON-FRI` (also `MON - FRI` or with a dash), full names (`Monday`), or the Spanish
  abbreviations and names `LUN`, `MAR`, `MIE`, `JUE`, `VIE`, `SAB`, `DOM`, `lunes`… Whole words
  only: `Monkey` is not Monday.
- `from` and `to`: `HH:MM`, with `24:00` allowed as the end of the day. A time Excel stores as a time
  of day also works. Calendars keep hours and minutes, so seconds are dropped with a note.
- A calendar with monthly or yearly dates (`monthDays`, `monthWeekdays`, `dates`) or with
  `holidays` is not edited in this sheet. The template leaves it out and the import keeps it
  untouched, whole, with a note in the report. Edit it in the panel.

## CSV

A CSV file holds one table. The sheet is taken from the file name (`recursos.csv`,
`Assignments.csv`…) or, if the name does not say, from its columns. The separator is detected: `,`,
`;` (what a Spanish Excel writes, with the decimal comma) or tab, and Excel's `sep=;` first line is
understood. The separator also decides how numbers are written (see Rules). The file can be
UTF-8, the Windows encoding Excel uses for «CSV (delimited)», or UTF-16 («Unicode Text»).

## Limits

- The import does not change `run` (duration, replications, seed), the gateway conditions
  (`conditions`) or the reserved fields. Edit those in the panel.
- Apart from the pools of a task, it cannot remove a value, only set one: an empty cell never
  deletes. Remove values in the panel.
- The web page imports; the `lila` CLI does not have an import command yet. Its functions are
  public in `@lila-modeler/engine/scenario-sheets` (`scenarioTemplate`, `readScenarioFile`,
  `planScenarioImport`, `applyImportChanges`).

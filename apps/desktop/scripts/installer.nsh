; Additions to electron-builder's NSIS installer for Windows (#566), wired in electron-builder.yml
; (`nsis.include`). The ProgIds below are the `name` of each `fileAssociations` entry there, and the
; command is the one electron-builder registers; `src/installer.test.ts` holds both to that file.

; electron-builder registers the open command as `$appExe "%1"`, with the program's path unquoted
; although the install folder and the .exe name both have spaces. Windows still opens the file, by
; trying each space-cut prefix of the line as a program first; quoting the path ends that guess.
; Runs right after electron-builder's own registerFileAssociations.
!macro customInstall
  WriteRegStr SHELL_CONTEXT "Software\Classes\Lila Modeler Project\shell\open\command" "" '"$appExe" "%1"'
  WriteRegStr SHELL_CONTEXT "Software\Classes\BPMN Diagram\shell\open\command" "" '"$appExe" "%1"'
!macroend

; electron-builder's uninstaller deletes the two ProgIds but leaves `.lila` and `.bpmn` naming them.
; The extension's default goes only while it still names ours: another app may have claimed it since.
!macro lilaForgetExtension EXT PROGID
  Push $0
  ReadRegStr $0 SHELL_CONTEXT "Software\Classes\.${EXT}" ""
  ${if} $0 == "${PROGID}"
    DeleteRegValue SHELL_CONTEXT "Software\Classes\.${EXT}" ""
  ${endIf}
  DeleteRegValue SHELL_CONTEXT "Software\Classes\.${EXT}\OpenWithProgids" "${PROGID}"
  Pop $0
!macroend

; Not on an update: the new version's installer registers both again right after.
!macro customUnInstall
  ${ifNot} ${isUpdated}
    !insertmacro lilaForgetExtension "lila" "Lila Modeler Project"
    !insertmacro lilaForgetExtension "bpmn" "BPMN Diagram"
    ; `.lila` is this app's own extension: once nothing names a program for it, its keys go too.
    ; `.bpmn` is shared with other modelers, so its key stays.
    DeleteRegKey /ifempty SHELL_CONTEXT "Software\Classes\.lila\OpenWithProgids"
    Push $0
    ReadRegStr $0 SHELL_CONTEXT "Software\Classes\.lila" ""
    ${if} $0 == ""
      DeleteRegKey /ifempty SHELL_CONTEXT "Software\Classes\.lila"
    ${endIf}
    Pop $0
  ${endIf}
!macroend

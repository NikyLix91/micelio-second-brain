; Passi aggiuntivi dell'installer di Micelio (NSIS, incluso da electron-builder).
; Vedi scripts/package-win.js.
;
; - Installazione: aggiunge resources\bin al PATH dell'utente, così `micelio` funziona da
;   qualunque terminale aperto dopo l'installazione.
; - Disinstallazione (anche prima di un aggiornamento): ferma il daemon, che altrimenti terrebbe
;   bloccati node.exe e i moduli nativi, e toglie la cartella dal PATH.
; I dati in %USERPROFILE%\.micelio non si toccano mai.
;
; Le operazioni sul PATH usano PowerShell ([Environment]::...Variable, ambito utente): niente
; plugin NSIS aggiuntivi. Le stringhe sono fra apici inversi (`) così dentro si possono usare sia
; " sia '. In NSIS $$ = $ letterale (per le variabili di PowerShell).
;
; EN: Extra steps of the Micelio installer (NSIS, included by electron-builder).
;     See scripts/package-win.js.
;
;     - Install: adds resources\bin to the user's PATH, so `micelio` works from any terminal
;       opened after the installation.
;     - Uninstall (also before an update): stops the daemon, which would otherwise keep
;       node.exe and the native modules locked, and removes the folder from the PATH.
;     The data in %USERPROFILE%\.micelio is never touched.
;
;     PATH operations use PowerShell ([Environment]::...Variable, user scope): no extra NSIS
;     plugins. Strings are in backticks (`) so both " and ' can be used inside. In NSIS
;     $$ = literal $ (for PowerShell variables).

!macro customInstall
  nsExec::ExecToLog `powershell -NoProfile -ExecutionPolicy Bypass -Command "$$d='$INSTDIR\resources\bin'; $$p=[Environment]::GetEnvironmentVariable('Path','User'); if ($$p -eq $$null) { $$p='' }; if (-not (($$p -split ';') -contains $$d)) { [Environment]::SetEnvironmentVariable('Path', (($$p.TrimEnd(';') + ';' + $$d).TrimStart(';')), 'User') }"`
!macroend

!macro customUnInit
  ; All'avvio del disinstallatore, PRIMA che si cancelli qualunque file: chiusura ordinata del
  ; daemon, poi (se serve) chiusura forzata del SOLO Node di questa installazione.
  ; EN: When the uninstaller starts, BEFORE any file is deleted: orderly shutdown of the
  ;     daemon, then (if needed) forced kill of ONLY this installation's Node.
  IfFileExists "$INSTDIR\resources\bin\micelio.cmd" 0 +4
    nsExec::ExecToLog `"$INSTDIR\resources\bin\micelio.cmd" stop`
    Sleep 3000
    nsExec::ExecToLog `powershell -NoProfile -ExecutionPolicy Bypass -Command "Get-Process node -ErrorAction SilentlyContinue | Where-Object { $$_.Path -eq '$INSTDIR\resources\node\node.exe' } | Stop-Process -Force"`
!macroend

!macro customUnInstall
  ; Toglie resources\bin dal PATH dell'utente
  ; EN: Removes resources\bin from the user's PATH
  nsExec::ExecToLog `powershell -NoProfile -ExecutionPolicy Bypass -Command "$$d='$INSTDIR\resources\bin'; $$p=[Environment]::GetEnvironmentVariable('Path','User'); if ($$p) { [Environment]::SetEnvironmentVariable('Path', (($$p -split ';' | Where-Object { $$_ -and $$_ -ne $$d }) -join ';'), 'User') }"`
!macroend

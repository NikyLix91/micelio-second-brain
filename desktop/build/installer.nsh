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

; Segnale «installazione in corso» per hook e shim (vedi installing() in src/cli/main.ts).
; $R9 = cartella dei dati: MICELIO_HOME se impostata, altrimenti %USERPROFILE%\.micelio.
; EN: "Installation in progress" marker for hooks and shim (see installing() in src/cli/main.ts).
;     $R9 = data folder: MICELIO_HOME if set, otherwise %USERPROFILE%\.micelio.
!macro micelioDataDir
  ReadEnvStr $R9 MICELIO_HOME
  ${If} $R9 == ""
    StrCpy $R9 "$PROFILE\.micelio"
  ${EndIf}
!macroend

; Sostituisce il controllo «app in esecuzione» di electron-builder (installazione, aggiornamento e
; disinstallazione). Quello predefinito cerca i processi che partono dalla cartella di installazione,
; li chiude e, se li ritrova, mostra «Micelio is running»: ma gli hook e lo shim MCP di Claude Code
; riavviavano il daemon dalla stessa cartella, quindi li ritrovava sempre (bug della 0.6.1, il
; messaggio non chiudeva niente). Qui:
; 1. il segnale «installazione in corso» ferma i riavvii automatici;
; 2. chiusura ordinata del daemon (`micelio stop`);
; 3. fino a 10 giri: chiusura forzata di ogni processo della cartella (Micelio.exe, node.exe dello
;    shim, degli hook e del daemon), tranne il disinstallatore stesso; si esce appena non ne resta
;    nessuno;
; 4. solo se qualcosa resiste ancora: il messaggio per chiudere a mano, con «Riprova».
; Le etichette sono della LogicLib (${Do}/${Loop}): la macro è inserita più volte nello stesso
; script e etichette fisse sarebbero duplicate.
; EN: Replaces electron-builder's "app running" check (install, update and uninstall). The default
;     one looks for processes started from the installation folder, closes them and, if it finds
;     them again, shows "Micelio is running": but Claude Code's hooks and MCP shim restarted the
;     daemon from the same folder, so it always found them again (0.6.1 bug, the message closed
;     nothing). Here:
;     1. the "installation in progress" marker stops automatic restarts;
;     2. orderly shutdown of the daemon (`micelio stop`);
;     3. up to 10 rounds: forced close of every process of the folder (Micelio.exe, node.exe of the
;        shim, the hooks and the daemon), except the uninstaller itself; it exits as soon as none
;        is left;
;     4. only if something still resists: the message to close it by hand, with "Retry".
;     Labels come from LogicLib (${Do}/${Loop}): the macro is inserted several times in the same
;     script and fixed labels would be duplicated.
!macro customCheckAppRunning
  !insertmacro micelioDataDir
  CreateDirectory "$R9"
  FileOpen $R8 "$R9\installing" w
  FileWrite $R8 "Micelio installer"
  FileClose $R8

  ${If} ${FileExists} "$INSTDIR\resources\bin\micelio.cmd"
    nsExec::Exec `"$INSTDIR\resources\bin\micelio.cmd" stop`
    Pop $R0
  ${EndIf}

  StrCpy $R1 0
  ${Do}
    nsExec::Exec `"$PowerShellPath" -NoProfile -ExecutionPolicy Bypass -Command "$$d='$INSTDIR'; $$mine = { param($$p) $$p.ExecutablePath -and $$p.ExecutablePath.StartsWith($$d, 'CurrentCultureIgnoreCase') -and $$p.Name -notlike 'Uninstall*' }; Get-CimInstance Win32_Process | Where-Object { & $$mine $$_ } | ForEach-Object { Stop-Process -Id $$_.ProcessId -Force -ErrorAction SilentlyContinue }; Start-Sleep -Milliseconds 800; if (Get-CimInstance Win32_Process | Where-Object { & $$mine $$_ }) { exit 1 } else { exit 0 }"`
    Pop $R0
    ${If} $R0 == 0
      ${Break}
    ${EndIf}
    IntOp $R1 $R1 + 1
    ${If} $R1 >= 10
      MessageBox MB_RETRYCANCEL|MB_ICONEXCLAMATION "$(appCannotBeClosed)" /SD IDCANCEL IDRETRY +2
      Quit
      StrCpy $R1 0
    ${EndIf}
  ${Loop}
!macroend

!macro customInstall
  ; Fine installazione: hook e shim possono di nuovo avviare il daemon
  ; EN: End of installation: hooks and shim can start the daemon again
  !insertmacro micelioDataDir
  Delete "$R9\installing"
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
  ; Disinstallazione vera (non un aggiornamento): via il segnale «installazione in corso».
  ; Durante un aggiornamento lo toglie l'installer nuovo alla fine (customInstall).
  ; EN: Real uninstall (not an update): remove the "installation in progress" marker.
  ;     During an update the new installer removes it at the end (customInstall).
  ${IfNot} ${isUpdated}
    !insertmacro micelioDataDir
    Delete "$R9\installing"
  ${EndIf}
  ; Toglie resources\bin dal PATH dell'utente
  ; EN: Removes resources\bin from the user's PATH
  nsExec::ExecToLog `powershell -NoProfile -ExecutionPolicy Bypass -Command "$$d='$INSTDIR\resources\bin'; $$p=[Environment]::GetEnvironmentVariable('Path','User'); if ($$p) { [Environment]::SetEnvironmentVariable('Path', (($$p -split ';' | Where-Object { $$_ -and $$_ -ne $$d }) -join ';'), 'User') }"`
!macroend

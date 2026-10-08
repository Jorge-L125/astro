; Pasos extra del instalador de Astro (electron-builder los incluye con "nsis.include").
; Pone "<instalación>\bin", que solo contiene astro.cmd, en el PATH del usuario para poder abrir
; Astro escribiendo `astro` en una terminal. No se añade la carpeta de instalación entera: tiene DLLs
; de Chromium (ffmpeg.dll, d3dcompiler_47.dll…) que otros programas podrían cargar por error.

!macro customInstall
  nsExec::ExecToLog 'powershell.exe -NoProfile -NonInteractive -ExecutionPolicy Bypass -File "$INSTDIR\resources\path-env.ps1" -Action add -Dir "$INSTDIR\bin"'
!macroend

!macro customUnInstall
  nsExec::ExecToLog 'powershell.exe -NoProfile -NonInteractive -ExecutionPolicy Bypass -File "$INSTDIR\resources\path-env.ps1" -Action remove -Dir "$INSTDIR\bin"'
!macroend

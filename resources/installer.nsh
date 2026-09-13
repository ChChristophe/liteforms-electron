; Liteforms NSIS include — inbound firewall rules for the provisioning server
; (tcp 8080) and device API (tcp 43178). electron-builder NSIS include runs
; the installer elevated, unlike the app at boot (no UAC from the appliance).
!macro customInstall
  nsExec::ExecToLog 'netsh advfirewall firewall add rule name="Liteforms Provisioning Server" dir=in action=allow protocol=TCP localport=8080'
  nsExec::ExecToLog 'netsh advfirewall firewall add rule name="Liteforms Device API" dir=in action=allow protocol=TCP localport=43178'
!macroend

!macro customUnInstall
  nsExec::ExecToLog 'netsh advfirewall firewall delete rule name="Liteforms Provisioning Server"'
  nsExec::ExecToLog 'netsh advfirewall firewall delete rule name="Liteforms Device API"'
!macroend

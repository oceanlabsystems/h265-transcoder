; H265 Transcoder Custom NSIS Installer Script
; Installs both GUI application and CLI service tools

!include "MUI2.nsh"
!include "nsDialogs.nsh"
!include "LogicLib.nsh"

; Custom variables
Var InstallService
Var ConfigPath

; Custom finish page
!define MUI_FINISHPAGE_RUN
!define MUI_FINISHPAGE_RUN_TEXT "Launch H265 Transcoder"
!define MUI_FINISHPAGE_RUN_FUNCTION "LaunchApp"

; Custom page for service configuration
Page custom ServiceConfigPage ServiceConfigPageLeave

Function ServiceConfigPage
  nsDialogs::Create 1018
  Pop $0
  
  ${If} $0 == error
    Abort
  ${EndIf}
  
  ${NSD_CreateLabel} 0 0 100% 36u "H265 Transcoder includes both a GUI application and a CLI service for automated processing. The CLI can run as a Windows service that monitors directories for new video files."
  Pop $0
  
  ${NSD_CreateCheckbox} 0 45u 100% 12u "Install CLI as Windows Service (auto-start on boot)"
  Pop $InstallService
  
  ${NSD_CreateLabel} 0 70u 100% 12u "Service configuration file:"
  Pop $0
  
  StrCpy $ConfigPath "${PROGRAMDATA}\H265 Transcoder\config.yaml"
  ${NSD_CreateText} 0 85u 100% 12u $ConfigPath
  Pop $0
  ${NSD_Edit_SetReadOnly} $0 1
  
  ${NSD_CreateLabel} 0 110u 100% 48u "If you enable the service, edit the config file after installation to set your input/output directories. You can manage the service from Services (services.msc) or use the shortcuts in the Start Menu."
  Pop $0
  
  nsDialogs::Show
FunctionEnd

Function ServiceConfigPageLeave
  ${NSD_GetState} $InstallService $InstallService
FunctionEnd

; Main installation section
Section "H265 Transcoder" SecMain
  SectionIn RO ; Required
  
  ; Install CLI service tools
  SetOutPath "$INSTDIR\service"
  File "${BUILD_RESOURCES_DIR}\service\install-service.ps1"
  File "${BUILD_RESOURCES_DIR}\service\uninstall-service.ps1"
  File "${BUILD_RESOURCES_DIR}\service\config.example.yaml"
  
  ; Create Start Menu shortcuts
  CreateDirectory "$SMPROGRAMS\H265 Transcoder"
  CreateShortCut "$SMPROGRAMS\H265 Transcoder\H265 Transcoder.lnk" "$INSTDIR\H265 Transcoder.exe" "" "$INSTDIR\H265 Transcoder.exe" 0
  CreateShortCut "$SMPROGRAMS\H265 Transcoder\Install Service.lnk" "powershell.exe" '-ExecutionPolicy Bypass -File "$INSTDIR\service\install-service.ps1"' "" "" SW_SHOWNORMAL "" "Install H265 Transcoder as a Windows service"
  CreateShortCut "$SMPROGRAMS\H265 Transcoder\Uninstall Service.lnk" "powershell.exe" '-ExecutionPolicy Bypass -File "$INSTDIR\service\uninstall-service.ps1"' "" "" SW_SHOWNORMAL "" "Remove H265 Transcoder Windows service"
  CreateShortCut "$SMPROGRAMS\H265 Transcoder\Edit Service Config.lnk" "notepad.exe" "${PROGRAMDATA}\H265 Transcoder\config.yaml" "" "" SW_SHOWNORMAL "" "Edit service configuration"
  
  ; Create config directory
  CreateDirectory "${PROGRAMDATA}\H265 Transcoder"
  
  ; Copy default config if not exists
  IfFileExists "${PROGRAMDATA}\H265 Transcoder\config.yaml" +2 0
    CopyFiles "$INSTDIR\service\config.example.yaml" "${PROGRAMDATA}\H265 Transcoder\config.yaml"
SectionEnd

; Post-install: optionally install service
Section "-PostInstall"
  ${If} $InstallService == 1
    ; Run service installation script
    DetailPrint "Installing Windows service..."
    nsExec::ExecToLog 'powershell.exe -ExecutionPolicy Bypass -File "$INSTDIR\service\install-service.ps1" -InstallDir "$INSTDIR"'
  ${EndIf}
SectionEnd

; Uninstaller additions
Section "un.H265 Transcoder"
  ; Stop and remove service if installed
  nsExec::ExecToLog 'powershell.exe -ExecutionPolicy Bypass -File "$INSTDIR\service\uninstall-service.ps1"'
  
  ; Remove service files
  RMDir /r "$INSTDIR\service"
  
  ; Remove Start Menu shortcuts
  Delete "$SMPROGRAMS\H265 Transcoder\H265 Transcoder.lnk"
  Delete "$SMPROGRAMS\H265 Transcoder\Install Service.lnk"
  Delete "$SMPROGRAMS\H265 Transcoder\Uninstall Service.lnk"
  Delete "$SMPROGRAMS\H265 Transcoder\Edit Service Config.lnk"
  RMDir "$SMPROGRAMS\H265 Transcoder"
  
  ; Note: Config files are preserved at ${PROGRAMDATA}\H265 Transcoder
  ; User can manually delete if desired
SectionEnd

Function LaunchApp
  Exec '"$INSTDIR\H265 Transcoder.exe"'
FunctionEnd

; Initialize variables
Function .onInit
  StrCpy $InstallService 0
FunctionEnd

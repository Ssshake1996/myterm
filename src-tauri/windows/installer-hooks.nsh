!macro NSIS_HOOK_PREINSTALL
  Push $0
  Push $1
  StrCpy $1 0

  ; The product registry entry proves this is myterm's known install directory,
  ; not an arbitrary user-selected folder containing a file named uninstall.exe.
  ReadRegStr $0 SHCTX "${MANUPRODUCTKEY}" ""
  ${If} $0 == "$INSTDIR"
    StrCpy $1 1
    ${If} ${FileExists} "$INSTDIR\uninstall.exe"
      DetailPrint "Removing the previous myterm installation..."
      ExecWait '"$INSTDIR\uninstall.exe" /S /UPDATE _?=$INSTDIR' $0
      ${If} $0 != 0
        Pop $1
        Pop $0
        Abort "The previous myterm installation could not be removed."
      ${EndIf}
    ${EndIf}
  ${EndIf}

  ${If} $1 == 1
    RMDir /r "$INSTDIR"
    CreateDirectory "$INSTDIR"
    SetOutPath "$INSTDIR"
  ${EndIf}

  Pop $1
  Pop $0
!macroend

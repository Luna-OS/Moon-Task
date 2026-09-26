; MoonTask's night-sky theme for the Windows installer.
;
; Tauri includes this file (bundle > windows > nsis > installerHooks) near the
; top of installer.nsi, before any page is declared. installer.nsi is Tauri's
; own template with a handful of lines added (all marked "MoonTask theme")
; that insert the macros below at each page.
;
; NSIS draws with plain Win32 controls, so the theme works per control:
; SetCtlColors for backgrounds and text, the "DarkMode_Explorer" visual style
; for push buttons and scroll bars, and no visual style at all for check
; boxes, radio buttons, group boxes and the progress bar — with a visual
; style Windows ignores their text and bar colors.

!include LogicLib.nsh
!include WinMessages.nsh

; The palette of src/styles/tokens.css.
!define MT_NIGHT_950 "0B0920"
!define MT_NIGHT_900 "141030"
!define MT_NIGHT_800 "1D1742"
!define MT_MOON_100 "F4F1FF"
!define MT_LAVENDER_300 "D6CFFD"
!define MT_LAVENDER_400 "B9AEFB"
!define MT_FAINT "8C84B8"
!define MT_LINE "2E2660"
; The same colors as COLORREF (0x00BBGGRR) for the Win32 calls below.
!define MT_NIGHT_950_REF 0x0020090B
!define MT_NIGHT_900_REF 0x00301014
!define MT_LAVENDER_400_REF 0x00FBAEB9
!define MT_VIOLET_700_REF 0x006B2E3B

; The header strip and the welcome and finish pages.
!define MUI_BGCOLOR "${MT_NIGHT_800}"
!define MUI_TEXTCOLOR "${MT_MOON_100}"
; The log on the installation page.
!define MUI_INSTFILESPAGE_COLORS "${MT_LAVENDER_300} ${MT_NIGHT_950}"
!define MUI_INSTFILESPAGE_PROGRESSBAR "smooth colored"
!define MUI_CUSTOMFUNCTION_GUIINIT MoonTaskThemeWindow
!define MUI_CUSTOMFUNCTION_UNGUIINIT un.MoonTaskThemeWindow

!define /ifndef GWL_STYLE -16
!define /ifndef GWL_EXSTYLE -20
; SWP_NOSIZE | SWP_NOMOVE | SWP_NOZORDER | SWP_NOACTIVATE | SWP_FRAMECHANGED
!define SWP_REFRAME 0x37
!define /ifndef BS_TYPEMASK 0x0F
!define /ifndef BS_GROUPBOX 0x07
!define /ifndef BS_DEFPUSHBUTTON 0x01
!define /ifndef BS_FLAT 0x8000
!define /ifndef SS_TYPEMASK 0x1F
!define /ifndef SS_ICON 0x03
!define /ifndef SS_BITMAP 0x0E
!define /ifndef SS_ETCHEDHORZ 0x10
!define /ifndef SS_ETCHEDFRAME 0x12
!define /ifndef PBM_SETBARCOLOR 0x0409
!define /ifndef PBM_SETBKCOLOR 0x2001
!define /ifndef STM_SETIMAGE 0x0172
!define /ifndef IMAGE_BITMAP 0
!define /ifndef LR_LOADFROMFILE 0x0010

; Sharp images on high-DPI screens. MUI stretches the 100 % bitmaps from
; tauri.conf.json to the size of their controls, which blurs them at 125 %
; and above; these are the same images rendered at larger scales, and the
; closest one replaces MUI's.
!macro MOONTASK_EXTRACT_IMAGES NAME
  File "/oname=$PLUGINSDIR\moontask-${NAME}-125.bmp" "${__FILEDIR__}\hidpi\${NAME}-125.bmp"
  File "/oname=$PLUGINSDIR\moontask-${NAME}-150.bmp" "${__FILEDIR__}\hidpi\${NAME}-150.bmp"
  File "/oname=$PLUGINSDIR\moontask-${NAME}-200.bmp" "${__FILEDIR__}\hidpi\${NAME}-200.bmp"
  File "/oname=$PLUGINSDIR\moontask-${NAME}-250.bmp" "${__FILEDIR__}\hidpi\${NAME}-250.bmp"
!macroend

!macro _MOONTASK_PICK_SCALE WIDTH SCALE
  ${If} $R5 == ""
  ${AndIf} $R3 <= ${WIDTH}
    StrCpy $R5 ${SCALE}
  ${EndIf}
!macroend

; Stack: the image control, then "header" or "sidebar" on top.
!macro MOONTASK_SHARP_IMAGE_FUNCTION UN
  Function ${UN}MoonTaskSharpImage
    Exch $R0
    Exch
    Exch $R1
    Push $R2
    Push $R3
    Push $R4
    Push $R5
    System::Call "*(i, i, i, i) p .R2"
    System::Call "user32::GetClientRect(p R1, p R2)"
    System::Call "*$R2(i, i, i .R3, i .R4)"
    System::Free $R2
    StrCpy $R5 ""
    ${If} $R0 == "header"
      ${If} $R3 > 150
        !insertmacro _MOONTASK_PICK_SCALE 188 125
        !insertmacro _MOONTASK_PICK_SCALE 225 150
        !insertmacro _MOONTASK_PICK_SCALE 300 200
        ${IfThen} $R5 == "" ${|} StrCpy $R5 250 ${|}
      ${EndIf}
    ${ElseIf} $R3 > 164
      !insertmacro _MOONTASK_PICK_SCALE 205 125
      !insertmacro _MOONTASK_PICK_SCALE 246 150
      !insertmacro _MOONTASK_PICK_SCALE 328 200
      ${IfThen} $R5 == "" ${|} StrCpy $R5 250 ${|}
    ${EndIf}
    ${If} $R5 != ""
      System::Call "user32::LoadImageW(p 0, w '$PLUGINSDIR\moontask-$R0-$R5.bmp', i ${IMAGE_BITMAP}, i R3, i R4, i ${LR_LOADFROMFILE}) p .R2"
      ; MUI frees the image it set when the page closes; this one lives
      ; until Setup exits.
      ${If} $R2 P<> 0
        SendMessage $R1 ${STM_SETIMAGE} ${IMAGE_BITMAP} $R2
      ${EndIf}
    ${EndIf}
    Pop $R5
    Pop $R4
    Pop $R3
    Pop $R2
    Pop $R1
    Pop $R0
  FunctionEnd
!macroend

; An inner page: its dialog and every control on it, on the background BG.
; (SetCtlColors takes its colors at compile time, hence one function per
; background.)
!macro MOONTASK_THEME_PAGE_FUNCTION UN NAME BG
  Function ${UN}${NAME}
    Push $0
    Push $1
    Push $2
    Push $3
    Push $4
    FindWindow $0 "#32770" "" $HWNDPARENT
    ${If} $0 <> 0
      SetCtlColors $0 "" "${BG}"
      StrCpy $1 0
      ${Do}
        FindWindow $1 "" "" $0 $1
        ${If} $1 = 0
          ${Break}
        ${EndIf}
        System::Call "user32::GetClassNameW(p r1, w .r2, i 64)"
        System::Call "user32::GetWindowLongW(p r1, i ${GWL_STYLE}) i .r3"
        ${If} $2 == "Static"
          IntOp $4 $3 & ${SS_TYPEMASK}
          ${If} $4 = ${SS_BITMAP}
            Push $1
            Push "sidebar"
            Call ${UN}MoonTaskSharpImage
          ${ElseIf} $4 <> ${SS_ICON}
          ${AndIf} $4 < ${SS_ETCHEDHORZ}
            SetCtlColors $1 "${MT_MOON_100}" "${BG}"
          ${EndIf}
        ${ElseIf} $2 == "Button"
          IntOp $4 $3 & ${BS_TYPEMASK}
          ${If} $4 <= ${BS_DEFPUSHBUTTON}
            System::Call "uxtheme::SetWindowTheme(p r1, w 'DarkMode_Explorer', p 0)"
          ${Else}
            ; Check boxes, radio buttons and group boxes: unstyled, so that
            ; Windows draws their text in our color.
            System::Call "uxtheme::SetWindowTheme(p r1, w '', w '')"
            ${If} $4 = ${BS_GROUPBOX}
              SetCtlColors $1 "${MT_LAVENDER_300}" "${BG}"
            ${Else}
              IntOp $3 $3 | ${BS_FLAT}
              System::Call "user32::SetWindowLongW(p r1, i ${GWL_STYLE}, i r3)"
              SetCtlColors $1 "${MT_MOON_100}" "${BG}"
            ${EndIf}
          ${EndIf}
        ${ElseIf} $2 == "Edit"
          SetCtlColors $1 "${MT_MOON_100}" "${MT_NIGHT_950}"
        ${ElseIf} $2 == "msctls_progress32"
          System::Call "uxtheme::SetWindowTheme(p r1, w '', w '')"
          SendMessage $1 ${PBM_SETBARCOLOR} 0 ${MT_LAVENDER_400_REF}
          SendMessage $1 ${PBM_SETBKCOLOR} 0 ${MT_NIGHT_950_REF}
        ${ElseIf} $2 == "SysListView32"
          System::Call "uxtheme::SetWindowTheme(p r1, w 'DarkMode_Explorer', p 0)"
        ${EndIf}
      ${Loop}
    ${EndIf}
    Pop $4
    Pop $3
    Pop $2
    Pop $1
    Pop $0
  FunctionEnd
!macroend

; The outer window: title bar, frame, header and the Back / Next / Cancel row.
!macro MOONTASK_THEME_WINDOW_FUNCTION UN
  Function ${UN}MoonTaskThemeWindow
    Push $0
    Push $1
    Push $2
    ; A dark title bar (Windows 10 20H1+), tinted night on Windows 11.
    ; Older Windows ignores the unknown attributes.
    System::Call "dwmapi::DwmSetWindowAttribute(p $HWNDPARENT, i 20, *i 1, i 4)"
    System::Call "dwmapi::DwmSetWindowAttribute(p $HWNDPARENT, i 35, *i ${MT_NIGHT_900_REF}, i 4)"
    System::Call "dwmapi::DwmSetWindowAttribute(p $HWNDPARENT, i 34, *i ${MT_VIOLET_700_REF}, i 4)"

    SetCtlColors $HWNDPARENT "" "${MT_NIGHT_900}"
    InitPluginsDir
    !insertmacro MOONTASK_EXTRACT_IMAGES header
    !if "${UN}" == ""
      !insertmacro MOONTASK_EXTRACT_IMAGES sidebar
    !endif
    GetDlgItem $0 $HWNDPARENT 1046
    Push $0
    Push "header"
    Call ${UN}MoonTaskSharpImage
    ; The header's subtitle, a little softer than its title.
    GetDlgItem $0 $HWNDPARENT 1038
    SetCtlColors $0 "${MT_LAVENDER_300}" "${MUI_BGCOLOR}"
    ; The branding line above the buttons.
    GetDlgItem $0 $HWNDPARENT 1028
    SetCtlColors $0 "${MT_FAINT}" "${MT_NIGHT_900}"
    GetDlgItem $0 $HWNDPARENT 1256
    SetCtlColors $0 "${MT_FAINT}" "${MT_NIGHT_900}"
    ${ForEach} $1 1 3 + 1
      GetDlgItem $0 $HWNDPARENT $1
      System::Call "uxtheme::SetWindowTheme(p r0, w 'DarkMode_Explorer', p 0)"
    ${Next}
    ; The etched lines under the header and above the buttons are drawn in
    ; system colors, bright white on night. Turn them into plain statics,
    ; which fill themselves with a quiet line color instead.
    StrCpy $0 0
    ${Do}
      FindWindow $0 "Static" "" $HWNDPARENT $0
      ${If} $0 = 0
        ${Break}
      ${EndIf}
      System::Call "user32::GetWindowLongW(p r0, i ${GWL_STYLE}) i .r1"
      IntOp $2 $1 & ${SS_TYPEMASK}
      ${If} $2 >= ${SS_ETCHEDHORZ}
      ${AndIf} $2 <= ${SS_ETCHEDFRAME}
        IntOp $1 $1 & -32 ; clears SS_TYPEMASK
        System::Call "user32::SetWindowLongW(p r0, i ${GWL_STYLE}, i r1)"
        System::Call "user32::GetWindowLongW(p r0, i ${GWL_EXSTYLE}) i .r1"
        IntOp $1 $1 & -131073 ; clears WS_EX_STATICEDGE
        System::Call "user32::SetWindowLongW(p r0, i ${GWL_EXSTYLE}, i r1)"
        System::Call "user32::SetWindowPos(p r0, p 0, i 0, i 0, i 0, i 0, i ${SWP_REFRAME})"
        SetCtlColors $0 "" "${MT_LINE}"
      ${EndIf}
    ${Loop}
    Pop $2
    Pop $1
    Pop $0
  FunctionEnd
!macroend

!insertmacro MOONTASK_SHARP_IMAGE_FUNCTION ""
!insertmacro MOONTASK_SHARP_IMAGE_FUNCTION "un."
!insertmacro MOONTASK_THEME_WINDOW_FUNCTION ""
!insertmacro MOONTASK_THEME_WINDOW_FUNCTION "un."
; Pages inside the header strip.
!insertmacro MOONTASK_THEME_PAGE_FUNCTION "" MoonTaskThemeInnerPage "${MT_NIGHT_900}"
!insertmacro MOONTASK_THEME_PAGE_FUNCTION "un." MoonTaskThemeInnerPage "${MT_NIGHT_900}"
; The welcome and finish pages, which cover the header.
!insertmacro MOONTASK_THEME_PAGE_FUNCTION "" MoonTaskThemeFullPage "${MUI_BGCOLOR}"

; Inserted right before the page macros in installer.nsi.
!macro MOONTASK_PAGE
  !define MUI_PAGE_CUSTOMFUNCTION_SHOW MoonTaskThemeInnerPage
!macroend

!macro MOONTASK_UNPAGE
  !define MUI_PAGE_CUSTOMFUNCTION_SHOW un.MoonTaskThemeInnerPage
!macroend

!macro MOONTASK_PAGE_WELCOME
  !define MUI_PAGE_CUSTOMFUNCTION_SHOW MoonTaskThemeFullPage
  !define MUI_WELCOMEPAGE_TEXT "$(moonTaskWelcomeText)"
!macroend

!macro MOONTASK_PAGE_FINISH
  !define MUI_PAGE_CUSTOMFUNCTION_SHOW MoonTaskThemeFullPage
  !define MUI_FINISHPAGE_TEXT_LARGE
  !define MUI_FINISHPAGE_TITLE "$(moonTaskFinishTitle)"
  !define MUI_FINISHPAGE_TEXT "$(moonTaskFinishText)"
!macroend

; Inserted after the languages are loaded.
!macro MOONTASK_LANGSTRINGS
  !ifdef LANG_ENGLISH
    LangString moonTaskWelcomeText ${LANG_ENGLISH} "Every process, calmly under the moon.$\r$\n$\r$\nMoonTask shows what your computer is doing — processes, CPU, GPU, memory, disks and network — and lets you act on it safely.$\r$\n$\r$\nIt is installed for your user account only and needs no administrator rights.$\r$\n$\r$\nClick Next to continue."
    LangString moonTaskFinishTitle ${LANG_ENGLISH} "MoonTask is ready"
    LangString moonTaskFinishText ${LANG_ENGLISH} "MoonTask has been installed and is waiting in the Start menu.$\r$\n$\r$\nTip: started as administrator, it can manage every process, not only your own."
  !endif
  !ifdef LANG_GERMAN
    LangString moonTaskWelcomeText ${LANG_GERMAN} "Jeder Prozess, ruhig unter dem Mond.$\r$\n$\r$\nMoonTask zeigt, was Ihr Computer gerade tut — Prozesse, CPU, GPU, Arbeitsspeicher, Datenträger und Netzwerk — und lässt Sie sicher eingreifen.$\r$\n$\r$\nEs wird nur für Ihr Benutzerkonto installiert und braucht keine Administratorrechte.$\r$\n$\r$\nKlicken Sie auf Weiter, um fortzufahren."
    LangString moonTaskFinishTitle ${LANG_GERMAN} "MoonTask ist bereit"
    LangString moonTaskFinishText ${LANG_GERMAN} "MoonTask wurde installiert und wartet im Startmenü.$\r$\n$\r$\nTipp: Als Administrator gestartet, verwaltet es alle Prozesse, nicht nur Ihre eigenen."
  !endif
!macroend

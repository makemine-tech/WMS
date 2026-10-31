' MAKEWON secretary Chrome guard - hidden launcher (2026-10-31)
' Task Scheduler calls this with wscript.exe so no console window flashes on screen.
' Runs guard.ps1 in the same folder, window style 0 = hidden, waits until it finishes.
Option Explicit
Dim sh, fso, dir, code
Set sh  = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")
dir = fso.GetParentFolderName(WScript.ScriptFullName)
code = sh.Run("powershell.exe -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File """ & dir & "\guard.ps1""", 0, True)
WScript.Quit code

; Inno Setup script — SillyQuiz "Download & Play (Zero Config)"
; Compila el instalador tras empaquetar con PyInstaller.
;
; Requisitos: Inno Setup 6+ (https://jrsoftware.org/isdl.php)
; Uso: iscc build/installer.iss
; El .exe resultante (SillyQuiz-Setup.exe) instala dist\SillyQuiz\* en {autopf}\SillyQuiz.

#define MyAppName "SillyQuiz"
#define MyAppVersion "6.0"
#define MyAppPublisher "SillyQuiz"
#define MyAppExeName "SillyQuiz.exe"
#define MyOutputBase "SillyQuiz-Setup"

[Setup]
AppId={{8F3C2A1B-6E4D-4C9A-8B21-5D7E0F3A9C12}
AppName={#MyAppName}
AppVersion={#MyAppVersion}
AppPublisher={#MyAppPublisher}
DefaultDirName={autopf}\SillyQuiz
DefaultGroupName=SillyQuiz
AllowNoIcons=yes
LicenseFile=
OutputDir=dist_installer
OutputBaseFilename={#MyOutputBase}
SetupIconFile=sillyquiz.ico
Compression=lzma2
SolidCompression=yes
WizardStyle=modern
PrivilegesRequired=admin
ArchitecturesInstallIn64BitMode=x64

[Languages]
Name: "spanish"; MessagesFile: "compiler:Languages\Spanish.isl"

[Files]
; Salida de PyInstaller (pyinstaller build/pyinstaller.spec -> dist\SillyQuiz)
Source: "dist\SillyQuiz\*"; DestDir: "{app}"; Flags: ignoreversion recursesubdirs createallsubdirs

[Icons]
Name: "{group}\{#MyAppName}"; Filename: "{app}\{#MyAppExeName}"
Name: "{autodesktop}\{#MyAppName}"; Filename: "{app}\{#MyAppExeName}"; Tasks: desktopicon

[Tasks]
Name: "desktopicon"; Description: "Crear acceso directo en el escritorio"; GroupDescription: "Opciones adicionales:"; Flags: unchecked

[Run]
Filename: "{app}\{#MyAppExeName}"; Description: "Ejecutar {#MyAppName}"; Flags: nowait postinstall skipifsilent

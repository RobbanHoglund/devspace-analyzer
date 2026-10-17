# Product branding

`robbanhoglund.png` is the unmodified author/publisher portrait from
`RobbanHoglund/JvmScope`, `extensions/vscode/icon.png`, revision
`94c50d84f9e28fe1b0b82038f56ab7e97dba2e57` (2026-10-17).
Robert requested the same branding for both products. It identifies the author
in the extension catalogue, desktop executable/installer and application header.

`devspace-mark.svg` uses the same 48px rounded tile, blue palette and line style
as JvmScope's analyzer marks. Its storage layout identifies DevSpace specifically.
The Activity Bar and editor-tab mark follows JvmScope's 24px magnifier convention,
with storage inside it. VS Code theme colors remain authoritative for the UI.

`npm run icons` copies the original portrait into the VSIX resources, creates
light/dark editor-tab SVGs and uses the Tauri icon builder for native icon sizes.
No remote image loading, image generation or downloaded fonts are used at runtime.

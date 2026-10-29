# Report font

`NotoSansSC-Regular.ttf` is a static weight-400 instance of the official Noto
Sans SC variable TrueType font. It is embedded as a subset in exported PDFs,
so Chinese glyphs and Latin spacing do not depend on the viewer's fonts.

- Upstream: https://github.com/notofonts/noto-cjk
- Source: https://raw.githubusercontent.com/notofonts/noto-cjk/main/Sans/Variable/TTF/Subset/NotoSansSC-VF.ttf
- Downloaded: 2026-10-29
- Source SHA-256: `d68bafcb48a2707749396aa12bbbd833cb70401f3a9a689fd2902c7e0d295964`
- Conversion: `fontTools.varLib.instancer.instantiateVariableFont(font, {"wght": 400})`
- License: SIL Open Font License 1.1; see `OFL.txt`.

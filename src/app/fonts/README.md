# Local UI fonts

Unmodified Latin-subset variable WOFF2 files, downloaded on 2026-11-07.
`src/app/layout.tsx` loads these with `next/font/local`; builds and browsers do not fetch Google Fonts.
The system stacks supply glyphs outside the subsets. JetBrains Mono is not preloaded.

| File | Weight range | SHA-256 |
|---|---|---|
| `inter-latin-variable.woff2` | 100–900 | `3100e775e8616cd2611beecfa23a4263d7037586789b43f035236a2e6fbd4c62` |
| `jetbrains-mono-latin-variable.woff2` | 100–800 | `18be452724bfdc236c074ca94a249a7f41a86752c7d04ab258ce9ed5651f6a7e` |

Sources:

- Stylesheet: https://fonts.googleapis.com/css2?family=Inter:wght@100..900&family=JetBrains+Mono:wght@100..800&display=swap
- Inter: https://fonts.gstatic.com/s/inter/v20/UcC73FwrK3iLTeHuS_nVMrMxCp50SjIa1ZL7.woff2
- JetBrains Mono: https://fonts.gstatic.com/s/jetbrainsmono/v24/tDbV2o-flEEny0FZhsfKu5WU4xD7OwE.woff2
- Licenses: `OFL-Inter.txt` and `OFL-JetBrainsMono.txt` (SIL Open Font License 1.1).
- License originals: https://raw.githubusercontent.com/google/fonts/main/ofl/inter/OFL.txt and https://raw.githubusercontent.com/google/fonts/main/ofl/jetbrainsmono/OFL.txt

# Modaya type system

Three tiers:

| Tier        | Font            | Used for                              | Loaded from              |
|-------------|-----------------|---------------------------------------|--------------------------|
| **Display** | **Satoshi Bold**| Logo + major headlines                | Fontshare CDN (free)     |
| **UI/body** | **Inter**       | All UI text + body copy (default)     | Google Fonts (free)      |
| **Mono**    | **JetBrains Mono** | Timestamps / technical / processing | Google Fonts (free)      |

All three are **free for commercial use**, so no licensed files are required —
they load from CDN (`api.fontshare.com` for Satoshi, `fonts.googleapis.com` for
Inter + JetBrains Mono). Nothing needs to be placed in this folder.

## Optional: self-host Satoshi

If you prefer not to depend on the Fontshare CDN for the display face, download
Satoshi (free) from <https://www.fontshare.com/fonts/satoshi> and drop these
WOFF2 files here:

    Satoshi-Bold.woff2    (weight 700)
    Satoshi-Black.woff2   (weight 900)

The `@font-face` rules in `src/app/globals.css` reference these exact paths and
will pick up the local files automatically (they take precedence over the CDN
copy thanks to `font-display: swap`). Remove the Fontshare `<link>` from
`src/app/layout.tsx` if you fully self-host.

Inter and JetBrains Mono can likewise be self-hosted via Fontsource
(`@fontsource/inter`, `@fontsource/jetbrains-mono`) if desired.

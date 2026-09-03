# Brand font: Uni Neue

Uni Neue is a commercial typeface by Fontfabric. It is NOT bundled here.

To activate it, drop these licensed WOFF2 files into this folder
(`public/fonts/`):

  UniNeue-Regular.woff2   (weight 400)
  UniNeue-Bold.woff2      (weight 700)
  UniNeue-Heavy.woff2     (weight 800)

The `@font-face` rules in `src/app/globals.css` reference these exact
paths. Until the files are present, the UI automatically falls back to
**Manrope** (loaded from Google Fonts), a free geometric sans-serif with
a very similar look and feel.

Licenses: https://fontfabric.com/uni-neue/

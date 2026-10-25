# Visual assets

All illustration assets were generated with **Higgsfield** (model: GPT Image 2.5, high
quality, transparent backgrounds where applicable) from prompts describing IFDY's visual
language: graphite and smoked glass, molten ember (`#FF6A3D → #FFB547`) for the brand,
electric blue (`#4F8CFF`) for inspection, violet (`#A78BFA`) for AI, mint (`#3DD68C`) for
passing checks. They are stored as optimized WebP/PNG.

| File | Use |
|---|---|
| `src/assets/brand/ifdy-app-icon.webp`, `public/favicon.png`, `public/apple-touch-icon.png` | App icon (stacked molten interface panels in a graphite squircle) |
| `src/assets/brand/ifdy-crucible.webp` | Secondary mark (crucible pouring a window), demo button |
| `src/assets/brand/welcome-hero.webp` | Welcome screen hero (molten light through glass panels) |
| `src/assets/icons3d/{design,inspect,simulate,test,ai,ship}.webp` | Welcome feature tiles, empty states |
| `src/assets/icons3d/device-{phone,foldable,tablet,desktop}.webp` | Device categories (picker, Device Manager, device navigator) |
| `src/assets/icons3d/{select,record,hierarchy-3d,device-wall,code,git,tokens,assets,components}.webp` | Empty states and onboarding |
| `demo/assets/harbor-home*.webp` | Harborline demo login hero photograph (synthetic) |
| `demo/assets/harborline-mark*.png` | Harborline (fictional lender) logo |

UI glyphs (toolbar, tabs, menus) are vector icons from `lucide-react` so they stay crisp
at 12–18px on every display density; generated raster art is reserved for sizes where it
renders well (≥ 20px), per `docs/MODULE_GUIDE.md`.

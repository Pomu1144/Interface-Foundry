# Visual assets

Brand mark and product icons were generated with **Higgsfield** (model: GPT Image 2.5,
high quality, transparent background) as flat, monochrome line art: uniform ~2px strokes,
rounded caps, no gradients, shading or 3D. The icon sheets were sliced into individual
192px alpha masks so the UI can tint them with the current text color.

| File | Use |
|---|---|
| `src/assets/brand/ifdy-mark.png`, `public/favicon.png`, `public/apple-touch-icon.png` | App mark: a selection frame with corner handles and a fold line, ember on a graphite tile |
| `src/assets/icons/{design,inspect,simulate,test,ai,ship}.png` | Welcome capability strip, empty states |
| `src/assets/icons/{phone,foldable,tablet,desktop}.png` | Device categories (toolbar scheme, picker, Device Manager, devices panel) |
| `src/assets/icons/{select,record,hierarchy,wall,code,git,tokens,assets,components,shield,chart,tools,folderPlus,globe}.png` | Empty states, start actions, import dialog |
| `src/assets/brand/product-shot.webp` | Real screenshot of the workspace (Harborline demo, Surface Duo expanded) on the welcome screen |
| `demo/assets/harbor-home*.webp` | Harborline demo login hero photograph (synthetic) |
| `demo/assets/harborline-mark*.png` | Harborline (fictional lender) logo |

Render the line icons with `<ArtIcon src={art.x} />` (or `EmptyState art={art.x}`), never
as `<img>`: `ArtIcon` uses the PNG as a CSS mask filled with `currentColor`, so icons follow
the dark and light themes and any tone. Only the app mark and the product shot are
full-color images.

Small UI glyphs (toolbar, tabs, menus) are vector icons from `lucide-react` so they stay
crisp at 12–18px on every display density.

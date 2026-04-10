# Claude Code — Clean UI Specification

> Pass this document when requesting any UI build from Claude Code.

---

## Philosophy

| Principle     | Rule                                                                                                                                         |
| ------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| **Aesthetic** | Flat, minimal, utilitarian. No gradients, no drop shadows, no decorative effects. Surfaces feel like they belong in a professional dev tool. |
| **Motion**    | Functional only. Transitions for state changes: `150ms ease`. No entrance animations, no bounce, no parallax.                                |
| **Density**   | Compact. Use space to separate, not to decorate. Whitespace is structural, not atmospheric.                                                  |

---

## Typography

| Property            | Value                                                                                 |
| ------------------- | ------------------------------------------------------------------------------------- |
| **UI font**         | `system-ui, -apple-system, sans-serif`                                                |
| **Code font**       | `'JetBrains Mono', monospace`                                                         |
| **Page title**      | `20px / weight 500`                                                                   |
| **Section heading** | `13px / weight 500 / uppercase / 0.08em letter-spacing`                               |
| **Body**            | `14px / weight 400`                                                                   |
| **Caption / meta**  | `12px / weight 400`                                                                   |
| **Code**            | `13px`                                                                                |
| **Weights**         | 400 regular and 500 medium only. Never 600, 700, or bold — too heavy.                 |
| **Case**            | Sentence case always. Uppercase only for section labels (≤4 words). Never title case. |

---

## Color

| Role               | Light mode                    | Notes                                      |
| ------------------ | ----------------------------- | ------------------------------------------ |
| **Page bg**        | `#ffffff`                     |                                            |
| **Surface bg**     | `#f5f5f4`                     | Cards, panels                              |
| **Raised bg**      | `#ebebea`                     | Hover states, tags                         |
| **Text primary**   | `#1a1a18`                     |                                            |
| **Text secondary** | `#6b6b67`                     |                                            |
| **Text muted**     | `#9b9b96`                     | Placeholders, captions                     |
| **Border default** | `rgba(0,0,0,0.12)` at `0.5px` |                                            |
| **Border hover**   | `rgba(0,0,0,0.22)` at `0.5px` |                                            |
| **Accent**         | One per app                   | Active states, primary CTA, selection only |

**Dark mode:** Use CSS custom properties with `prefers-color-scheme` media query. All color values defined as variables on `:root`, overridden in dark.

---

## Layout & Spacing

- **Base unit:** 8px
- **Allowed spacing values:** `4 8 12 16 24 32 48px` — no arbitrary values
- **Max content width:** `960px`
- **Sidebar widths:** `220px` nav · `280px` side panel
- **Main content:** fills remaining width

### Border radius

| Context                | Value    |
| ---------------------- | -------- |
| Inputs, buttons, chips | `4px`    |
| Cards, panels          | `6px`    |
| Modals, drawers        | `8px`    |
| Pills, tags, badges    | `9999px` |

---

## Components

### Buttons

- Height: `32px` · Padding: `0 12px` · Border: `0.5px`
- **Primary:** filled accent background
- **Secondary:** transparent + border
- **Ghost:** no border, hover bg only
- No rounded-pill buttons unless it's a tag or badge

### Inputs

- Height: `32px` · Padding: `0 10px`
- Border: `0.5px solid` default
- Focus ring: `box-shadow: 0 0 0 2px accent/25%`
- Placeholder: muted color
- No floating labels

### Tables

- Row height: `36px`
- Header: `12px / uppercase / 0.07em tracking / muted color`
- Dividers: row borders only (`0.5px`) — no outer table border
- Hover: subtle bg tint

### Cards

- Background: raised surface
- Border: `0.5px`
- Radius: `6px`
- Padding: `16px`
- No `box-shadow` — hover increases border opacity only

### Badges / Tags

- Height: `20px` · Font: `11px / weight 500` · Padding: `0 7px`
- Muted bg with text from the same color family
- Pill radius (`9999px`)

### Code blocks

- Font: monospace `13px`
- Background: surface bg
- Border: `0.5px`
- Radius: `6px`
- Padding: `12px 16px`
- Syntax highlight: minimal — 3–4 colors max

### Icons

- UI context: `16px`
- Standalone / decorative: `20px`
- Keep sizes consistent — never inherit container font size

---

## Do / Don't

### ✅ Do

- Use borders to define structure
- Use weight and size for visual hierarchy
- Use muted text for secondary information
- Keep icon sizes consistent (16px UI, 20px standalone)
- Define all tokens as CSS custom properties

### ❌ Don't

- No gradients
- No `box-shadow` (except 2px focus rings)
- No decorative dividers or ornamental lines
- No overuse of icon + text combinations
- No more than 2 type sizes per component
- No color used for purely decorative (non-semantic) purposes

---

## Output Instructions for Claude Code

| Rule               | Requirement                                                                                                                              |
| ------------------ | ---------------------------------------------------------------------------------------------------------------------------------------- |
| **Stack**          | Clean HTML + CSS, or React with Tailwind if specified. No inline style clutter.                                                          |
| **CSS variables**  | Define all colors, spacing, and radii as custom properties on `:root`. Components reference variables — never hard-coded hex.            |
| **File structure** | Variables → reset → layout → components → utilities. Single-line comment label per section.                                              |
| **Accessibility**  | All inputs have `<label>`. Interactive elements keyboard-accessible. Focus states always visible. Contrast ratio ≥ 4.5:1 for body text.  |
| **No extras**      | No animation libraries. No CSS frameworks unless specified. No lorem ipsum in delivered code. No placeholder logic — wire up real state. |

---

## CSS Variables Template

```css
:root {
  /* Backgrounds */
  --color-bg-page: #ffffff;
  --color-bg-surface: #f5f5f4;
  --color-bg-raised: #ebebea;

  /* Text */
  --color-text-primary: #1a1a18;
  --color-text-secondary: #6b6b67;
  --color-text-muted: #9b9b96;

  /* Borders */
  --color-border: rgba(0, 0, 0, 0.12);
  --color-border-hover: rgba(0, 0, 0, 0.22);

  /* Accent — replace with your chosen color */
  --color-accent: #2563eb;

  /* Spacing */
  --space-1: 4px;
  --space-2: 8px;
  --space-3: 12px;
  --space-4: 16px;
  --space-6: 24px;
  --space-8: 32px;
  --space-12: 48px;

  /* Radius */
  --radius-sm: 4px;
  --radius-md: 6px;
  --radius-lg: 8px;
  --radius-pill: 9999px;

  /* Typography */
  --font-ui: system-ui, -apple-system, sans-serif;
  --font-code: 'JetBrains Mono', monospace;
}

@media (prefers-color-scheme: dark) {
  :root {
    --color-bg-page: #1a1a18;
    --color-bg-surface: #242422;
    --color-bg-raised: #2e2e2b;
    --color-text-primary: #f0efeb;
    --color-text-secondary: #a3a39e;
    --color-text-muted: #6b6b67;
    --color-border: rgba(255, 255, 255, 0.1);
    --color-border-hover: rgba(255, 255, 255, 0.2);
  }
}
```

---

_End of spec. Attach this file to any Claude Code session to enforce consistent, clean UI output._

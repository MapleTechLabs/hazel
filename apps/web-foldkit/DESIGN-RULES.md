# Design rules

The web app is built from one kit (`src/ui`) and one set of tokens (`src/core/styles/styles.css`).
These rules keep it that way. Each is a lint rule in `scripts/oxlint-plugins/hazel-ui.mjs`, so a page
that bypasses the kit or a token fails `bun run lint` (and CI) instead of review.

## Build from the kit

Pages compose `src/ui`. They don't rebuild a control from raw elements or from a kit component's
style export.

| Rule                     | Instead of                                 | Use                                                                            |
| ------------------------ | ------------------------------------------ | ------------------------------------------------------------------------------ |
| `no-raw-control`         | `h.button`                                 | `button` (ui/button), `link` (ui/link), `ariaButton` for a self-drawn target   |
|                          | `h.input`                                  | `textField`, `input`, `searchField`, `checkbox`, `switchControl`, `radioGroup` |
|                          | `h.textarea` / `h.select` / `h.label`      | `textarea`, the `Select` component, `label` (ui/field)                         |
|                          | `h.dialog`                                 | the `Modal` component with `dialog` (ui/modal, ui/dialog)                      |
| `no-raw-heading`         | `h.h1` … `h.h6`                            | `heading` (ui/heading), `cardTitle`, `dialogTitle`, `sectionHeaderHeading`     |
|                          | `h.kbd`                                    | `kbd` / `shortcut` (ui/kbd) for key caps, `menuKeyboard` in a menu item        |
| `no-kit-styles-in-pages` | `import … from "~/components/ui/*.styles"` | the kit wrapper in `src/ui`                                                    |

If the kit lacks what you need, add the variant or option to the kit component and use it. That is
the whole point: the next page gets it for free, and a design change lands in one place.

The whole kit is drawn, live, on `/lab/kit` (`src/lab/kit/`): add a specimen there with the variant,
and look at it in both themes before using it on a page.

### Headings

`heading(h, { variant }, children)` has five variants. `level` sets the element for the document
outline independently of the look; `className` is for layout only (margins, truncation).

| Variant      | Look                         | Default level | For                                  |
| ------------ | ---------------------------- | ------------- | ------------------------------------ |
| `display`    | 24px semibold, tight         | `h1`          | a page's title                       |
| `title`      | 18px semibold                | `h2`          | a panel's or modal page's title      |
| `section`    | 16px semibold                | `h2`          | a section in a page, a card          |
| `subsection` | 14px semibold                | `h3`          | a group in a section, a list header  |
| `label`      | 12px medium uppercase, muted | `h3`          | a quiet eyebrow over a group of rows |

## Values come from tokens

| Rule                     | Flags                                   | Use                                                                        |
| ------------------------ | --------------------------------------- | -------------------------------------------------------------------------- |
| `no-unknown-color`       | a colour class the theme doesn't define | an existing token; Tailwind silently generates nothing for an unknown one  |
| `no-palette-color`       | `text-red-500`, `bg-zinc-900`           | semantic tokens: `fg`/`fg-2`/`muted-fg`, `primary`, `danger`, `success`, … |
| `no-raw-color`           | `bg-[#fff]`, `text-[oklch(…)]`          | a colour token; a vendor's brand colour gets a token too                   |
| `no-arbitrary-text-size` | `text-[13px]`                           | the type scale, `text-3xs` (10px) and `text-2xs` (11px) through `text-xl`  |
| `no-arbitrary-radius`    | `rounded-[6px]`                         | `rounded-xs` … `rounded-4xl`, which follow the user's radius preset        |
| `no-raw-shadow`          | `shadow-[0_1px_…]`                      | `shadow-xs` … `shadow-xl`, `shadow-control` (tuned per theme)              |
| `no-transition-all`      | `transition-all`                        | name what moves: `transition-colors`, `transition-[opacity,translate]`     |

A semantic token adapts to dark mode, the user's gray palette and brand colour; a palette step or a
raw value doesn't.

## Elevation and motion

- **Elevation** (`--elevation-*`): `xs` seats a resting surface (cards, outline buttons); `sm`, a
  focused one (the composer); `md`, a small float (tooltips, hover cards); `lg`, a popover, menu or
  toast; `xl`, a modal or the command menu. Dark mode deepens each and adds a top highlight.
- **Motion**: `ease-out` is a strong ease-out (`cubic-bezier(0.23, 1, 0.32, 1)`); overlays enter
  in 150–200ms. Pressable controls scale to `0.98` on press. `prefers-reduced-motion` collapses
  everything (`styles.css`).

## The burndown

Code that predates a rule is listed per file in `scripts/oxlint-plugins/ui-kit-baseline.json`. A file
may keep the count it had, never more; new files get zero. When you fix violations, run
`bun run lint:ui-baseline` to lower the counts. Lint reports a file whose count dropped until you do,
so the baseline only shrinks. The script refuses to grow an entry (`--allow-increase` exists for a
new rule landing, never for new code).

Exempt: the kit itself (`src/ui`, `src/core/components`) may render raw elements; tests and
`*.gallery.ts` files build fixtures and skip all of these rules.

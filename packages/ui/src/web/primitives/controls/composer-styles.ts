/**
 * The composer's suggestions panel and context bar (lane A2, W12a): today's `composer/autocomplete-view.ts`,
 * `trigger-views.ts` and `draft-view.ts` indicators. Renderer-owned like the chat leaves' (`chat/styles.ts`):
 * every value is a token variable; no primitive export, so the registry glob skips this file.
 */
// HAZEL-GAP(composer-recipe-parts): these parts belong in the composer recipe; filling it needs a
// regenerated `tokens.css` (integrator), so they live here until then.

const color = (name: string) => `var(--hz-color-${name})`
const space = (step: string) => `var(--hz-space-${step.replace(".", "_")})`
const radius = (name: string) => `var(--hz-radius-${name})`
const type = (step: string) =>
	`font-size: var(--hz-text-${step}-size); line-height: var(--hz-text-${step}-leading);`

const C = '[data-hz="composer"]'
const p = (name: string) => `[data-hz-part="${name}"]`
const panel = `${C} > ${p("suggestions")}`
const option = `${panel} ${p("suggestion")}`
const bar = `${C} > ${p("context")}`

const rules: ReadonlyArray<readonly [string, string]> = [
	[C, "position: relative;"],
	// The context bar takes the card's first row; the card's top corners are the bar's (`rounded-t-lg`).
	[
		`${C}[data-context]`,
		`grid-template-areas: "context context" "above above" "input input" "actions send";
		border-top-left-radius: ${radius("lg")}; border-top-right-radius: ${radius("lg")};`,
	],
	// `flex items-center justify-between gap-2 border bg-secondary px-3 py-2` above the card's top border;
	// it bleeds over the card's padding (`space-2`), and the card's border is its bottom line.
	[
		bar,
		`grid-area: context; display: flex; align-items: center; justify-content: space-between;
		column-gap: ${space("2")}; margin: calc(-1 * ${space("2")}) calc(-1 * ${space("2")}) ${space("1")};
		padding: ${space("2")} ${space("3")}; background-color: ${color("secondary")};
		border-bottom: 1px solid ${color("border")};
		border-top-left-radius: calc(${radius("lg")} - 1px); border-top-right-radius: calc(${radius("lg")} - 1px);`,
	],
	[bar + "[hidden]", "display: none;"],
	[
		`${bar} > ${p("contextLabel")}`,
		`display: flex; align-items: center; column-gap: ${space("2")}; min-width: 0; ${type("label")}`,
	],
	[`${bar} ${p("contextPrefix")}`, `flex-shrink: 0; color: ${color("muted-fg")};`],
	[
		`${bar} ${p("contextAuthor")}`,
		`min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
		color: ${color("fg")}; font-weight: var(--hz-weight-semibold);`,
	],
	// `max-w-xs truncate text-muted-fg`.
	[
		`${bar} ${p("contextText")}`,
		`min-width: 0; max-width: calc(${space("20")} * 4); overflow: hidden; text-overflow: ellipsis;
		white-space: nowrap; color: ${color("muted-fg")};`,
	],
	[
		`${bar} ${p("contextIcon")}`,
		`display: flex; flex-shrink: 0; width: ${space("3.5")}; height: ${space("3.5")}; color: ${color("primary")};`,
	],
	[`${bar} ${p("contextIcon")} > svg`, "width: 100%; height: 100%;"],
	[`${bar} ${p("contextTitle")}`, `color: ${color("primary")}; font-weight: var(--hz-weight-semibold);`],
	// The close button is today's `sq-xs` with a 14px icon at every size (`!p-1`, `size-3.5`).
	[`${bar} > [data-hz="button"]`, "flex-shrink: 0;"],
	[`${bar} > [data-hz="button"] > ${p("icon")}`, `width: ${space("3.5")}; height: ${space("3.5")};`],

	// The panel: `absolute inset-x-0 bottom-full mb-2 z-50 overflow-y-auto rounded-xl border border-fg/10
	// bg-overlay shadow-lg`, anchored over the field's top (the renderer sets `top`).
	[
		panel,
		`position: absolute; left: 0; right: 0; z-index: 50; translate: 0 calc(-100% - ${space("2")});
		overflow-x: hidden; overflow-y: auto; overscroll-behavior: contain; padding: ${space("2")};
		border: 1px solid ${color("overlay-border")}; border-radius: ${radius("xl")};
		background-color: ${color("overlay")}; color: ${color("fg")}; box-shadow: var(--hz-shadow-lg);
		text-align: left;`,
	],
	[panel + "[hidden]", "display: none;"],
	// A group heading (no today counterpart: today's lists are ungrouped).
	[
		`${panel} ${p("suggestionGroup")}`,
		`padding: ${space("2")} ${space("3")} ${space("1")}; color: ${color("muted-fg")}; ${type("caption")}
		font-weight: var(--hz-weight-strong);`,
	],
	[`${panel} ${p("suggestionGroup")}:first-child`, `padding-top: ${space("1")};`],
	// A row: `flex items-center gap-2 rounded-lg px-3 py-2 text-sm`; active `bg-primary/10 text-primary`.
	[
		option,
		`display: flex; align-items: center; column-gap: ${space("2")}; padding: ${space("2")} ${space("3")};
		border-radius: ${radius("lg")}; cursor: pointer; ${type("label")}
		transition: color var(--hz-duration-fast) var(--hz-ease-standard),
			background-color var(--hz-duration-fast) var(--hz-ease-standard);`,
	],
	[`${option}:not([aria-selected="true"]):hover`, `background-color: ${color("muted")};`],
	[
		`${option}[aria-selected="true"]`,
		`background-color: ${color("primary-tint")}; color: ${color("primary")};`,
	],
	[`${option} > ${p("suggestionText")}`, "min-width: 0; flex: 1 1 0%;"],
	[
		`${option} ${p("suggestionLabel")}`,
		`overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-weight: var(--hz-weight-strong);`,
	],
	[
		`${option} ${p("suggestionDescription")}`,
		`overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: ${color("muted-fg")};
		${type("caption")}`,
	],
	// The face: today's `avatar` `xs` (24px, `rounded-xl` squircle over `bg-muted`), its badge in the corner.
	[
		`${option} ${p("suggestionFace")}`,
		`position: relative; display: flex; flex-shrink: 0; align-items: center; justify-content: center;
		width: ${space("6")}; height: ${space("6")}; border-radius: ${radius("xl")}; corner-shape: squircle;
		background-color: ${color("muted")}; color: ${color("muted-fg")}; ${type("micro")}
		font-weight: var(--hz-weight-strong);`,
	],
	[
		`${option} ${p("suggestionFace")} > img`,
		`width: 100%; height: 100%; object-fit: cover; border-radius: inherit; corner-shape: squircle;`,
	],
	[`${option} ${p("suggestionFace")}[data-seeded]`, "container-type: size;"],
	[
		`${option} ${p("suggestionFace")}[data-seeded] > ${p("initials")}`,
		`position: relative; color: white; font-weight: var(--hz-weight-semibold); font-size: 46cqw;
		line-height: 1; text-box: trim-both cap alphabetic;`,
	],
	[`${option} ${p("suggestionFace")} > ${p("dither")}`, "corner-shape: squircle;"],
	// `presenceDot` `xs`: 10px, a quarter outside, cut out by `ring-2 ring-bg`; offline is a hollow ring.
	[
		`${option} ${p("suggestionPresence")}`,
		`position: absolute; right: 0; bottom: 0; width: ${space("2.5")}; height: ${space("2.5")};
		border-radius: ${radius("full")}; transform: translate(25%, 25%); box-shadow: 0 0 0 2px ${color("bg")};`,
	],
	...(["online", "away", "busy"] as const).map(
		(status) =>
			[
				`${option} ${p("suggestionPresence")}[data-presence="${status}"]`,
				`background-color: ${color(`presence-${status}`)};`,
			] as const,
	),
	[
		`${option} ${p("suggestionPresence")}[data-presence="offline"]`,
		`background-color: ${color("bg")};
		box-shadow: 0 0 0 2px ${color("bg")}, inset 0 0 0 2px ${color("presence-offline")};`,
	],
	// The provider mark: `size-3 rounded-full ring-2 ring-bg`, Discord on its blurple with a white glyph.
	[
		`${option} ${p("suggestionMark")}`,
		`position: absolute; right: 0; bottom: 0; display: flex; align-items: center; justify-content: center;
		width: ${space("3")}; height: ${space("3")}; border-radius: ${radius("full")};
		transform: translate(25%, 25%); box-shadow: 0 0 0 2px ${color("bg")}; background-color: ${color("bg")};`,
	],
	[
		`${option} ${p("suggestionMark")}[data-mark="discord"]`,
		`background-color: ${color("discord")}; color: white;`,
	],
	[
		`${option} ${p("suggestionMark")} > svg`,
		`display: block; width: ${space("2")}; height: ${space("2")};`,
	],
	// An icon lead: today's `@` tile, `size-6 rounded-md bg-primary text-primary-fg`.
	[
		`${option} ${p("suggestionIcon")}`,
		`display: flex; flex-shrink: 0; align-items: center; justify-content: center; width: ${space("6")};
		height: ${space("6")}; border-radius: ${radius("md")}; background-color: ${color("primary")};
		color: ${color("primary-fg")};`,
	],
	[
		`${option} ${p("suggestionIcon")} > svg`,
		`display: block; width: ${space("3.5")}; height: ${space("3.5")};`,
	],
	// An emoji row: the glyph at `text-xl` (20/28) or a custom emoji's `size-5 object-contain`, then the muted name.
	[
		`${option} ${p("suggestionEmoji")}`,
		`flex-shrink: 0; font-size: ${space("5")}; line-height: ${space("7")};`,
	],
	[
		`${option} img${p("suggestionEmoji")}`,
		`width: ${space("5")}; height: ${space("5")}; object-fit: contain;`,
	],
	[
		`${option}[data-emoji] ${p("suggestionLabel")}`,
		`color: ${color("muted-fg")}; font-weight: var(--hz-weight-regular);`,
	],
	// A bot command (the `/` trigger): `items-start gap-2.5`, a 20px avatar `mt-0.5`, the description `mt-0.5`.
	[
		`${panel}[data-trigger="/"] ${p("suggestion")}`,
		`align-items: flex-start; column-gap: ${space("2.5")};`,
	],
	[
		`${panel}[data-trigger="/"] ${p("suggestionFace")}`,
		`width: ${space("5")}; height: ${space("5")}; margin-top: ${space("0.5")};`,
	],
	[`${panel}[data-trigger="/"] ${p("suggestionDescription")}`, `margin-top: ${space("0.5")};`],
	[`@media (prefers-reduced-motion: reduce)`, `${option} { transition: none; }`],
]

const css = rules.map(([selector, body]) => `${selector} { ${body} }`).join("\n")

const installed = new WeakSet<Document>()

/** Adds the composer's suggestions and context stylesheet to `document` once. */
export const ensureComposerStyles = (document: Document) => {
	if (installed.has(document)) return
	installed.add(document)
	const style = document.createElement("style")
	style.dataset.hzRenderer = "composer"
	style.textContent = css
	document.head.append(style)
}

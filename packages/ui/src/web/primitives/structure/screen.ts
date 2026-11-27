// Owned by lane A4 (`docs/hazel-ui.md`, "Phase 2: lanes"). `hz:screen`: a title bar over its content,
// with a back button (`back`) and a `toolbar` slot drawn at the bar's end. Phase 4: breadcrumbs
// (`crumb {index}`), a subtitle, `meta` badges after the title, and `centered` with its `aside`.
import { svg } from "../../icons.ts"
import { definePrimitive, flag, option, part, type Plain, type Primitive } from "../define.ts"
import { ensureSheet, fire, isPlainClick, listens, textOf } from "../list/runtime.ts"

interface Crumb {
	readonly label: string
	readonly href?: string
}

// SAFETY: the host only passes `crumbs` that decoded as `Content.Crumb` arrays (`spec.ts`).
const crumbsOf = (value: Plain): ReadonlyArray<Crumb> => (Array.isArray(value) ? (value as never) : [])

const ROOT = '[data-hz="screen"]'
const CONTENT = `${ROOT} > [data-hz-part="content"]`

// `floatingAction` (`floating-action`): today's DMs compose, a 56px round button that sticks to the
// end corner of the scrolling content, after the last row; only the button takes the pointer.
const FLOATING = `${CONTENT} > [data-hz-slot="floatingAction"]`
const floatingCss = `
${FLOATING} {
	order: 1; position: sticky; bottom: var(--hz-space-4); margin-top: auto; display: flex;
	justify-content: flex-end; padding: var(--hz-space-4) var(--hz-space-4) 0; pointer-events: none;
}
${FLOATING} > * { pointer-events: auto; }
${FLOATING} > [data-hz="button"] {
	width: var(--hz-space-14); height: var(--hz-space-14); border-radius: var(--hz-radius-full);
	box-shadow: var(--hz-shadow-lg);
}
${FLOATING} > [data-hz="button"] > [data-hz-part="icon"] { width: var(--hz-space-6); height: var(--hz-space-6); }
`

// The header is a grid (`ui/page-header.ts`): the crumbs over the title line (12px apart), the
// subtitle under it (2px), and the back button beside all three. The title shrinks first; empty
// rows take no space. `header[...]` outranks the recipe's flex row.
const HEADER = `${ROOT} > header[data-hz-part="header"]`
const headingCss = `
${HEADER} {
	display: grid; align-items: center; align-content: center;
	grid-template-columns: auto minmax(0, max-content) auto minmax(0, 1fr);
	grid-template-areas: "back crumbs crumbs crumbs" "back title meta ." "back subtitle subtitle subtitle";
}
${ROOT}:not([data-back]) > header[data-hz-part="header"] {
	grid-template-columns: minmax(0, max-content) auto minmax(0, 1fr);
	grid-template-areas: "crumbs crumbs crumbs" "title meta ." "subtitle subtitle subtitle";
}
${HEADER} > [data-hz-part="back"] { grid-area: back; }
${HEADER} > [data-hz-part="title"] { grid-area: title; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
${HEADER} > [data-hz-part="metaRoom"] { grid-area: meta; }
${HEADER} > [data-hz-part="crumbs"] { grid-area: crumbs; margin-bottom: var(--hz-space-3); }
${HEADER} > [data-hz-part="subtitle"] { grid-area: subtitle; margin-top: var(--hz-space-0_5); }
${HEADER} > [data-hz-part="crumbs"][hidden], ${HEADER} > [data-hz-part="subtitle"]:empty, ${HEADER} > [data-hz-part="metaRoom"][hidden] { display: none; }
${HEADER} > [data-hz-part="crumbs"] > [data-hz-part="crumb"] { color: inherit; text-decoration: none; min-width: 0; }
${HEADER} > [data-hz-part="crumbs"] > a[data-hz-part="crumb"]:hover { color: var(--hz-color-fg); }
${HEADER} > [data-hz-part="crumbs"] > a[data-hz-part="crumb"]:focus-visible { outline: 2px solid var(--hz-color-ring); outline-offset: 1px; }
${HEADER} > [data-hz-part="crumbs"] > [aria-current="page"] { color: var(--hz-color-fg); font-weight: var(--hz-weight-strong); }
${HEADER} > [data-hz-part="crumbs"] > [data-hz-part="crumbSeparator"] > svg { display: block; width: 100%; height: 100%; }
${CONTENT} > [data-hz-slot="meta"] { position: absolute; z-index: 11; }
${ROOT}[data-toolbar] > [data-hz-part="header"] {
	padding-inline-end: calc(var(--hz-screen-toolbar) + var(--hz-space-4) + var(--hz-space-2));
}
`

// `centered` (`auth/layout.ts` `authShell`): one column at the compact size; from the regular size
// the `aside` panel fills the start half and the card (`max-w-sm`, 384px) centres in the end half.
const CENTERED = `${ROOT}[data-surface="centered"]`
const centeredCss = `
${CENTERED} { display: grid; grid-template-columns: minmax(0, 1fr); align-content: center; justify-items: center; min-height: 100%; }
${CENTERED} > [data-hz-part="header"], ${CENTERED} > [data-hz-part="content"] > [data-hz]:not([data-hz-slot="aside"]) {
	grid-column: -2; width: min(100%, calc(var(--hz-space-24) * 4));
}
${ROOT} > [data-hz-part="content"] > [data-hz-slot="aside"] { display: none; }
${CENTERED} > [data-hz-part="content"] > [data-hz-slot="leading"] { order: -1; }
${CENTERED} > header[data-hz-part="header"] > [data-hz-part="title"] { white-space: normal; }
${CENTERED} > header[data-hz-part="header"] > [data-hz-part="subtitle"] { margin-top: var(--hz-space-2); }
@media (width >= 40rem) {
	${CENTERED} { grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); }
	${CENTERED} > [data-hz-part="content"] > [data-hz-slot="aside"] {
		display: flex; flex-direction: column; position: absolute; inset-block: 0; inset-inline-start: 0; width: 50%;
	}
}
`

// The toolbar slot stays in the content parent (slots never move) and is placed over the bar's end.
// A recipe's interaction states are the root's, so the back button's own hover is here.
const css = `
${ROOT} { position: relative; }
${CONTENT} > [data-hz-slot="toolbar"] {
	position: absolute; top: 0; inset-inline-end: var(--hz-space-4); height: var(--hz-space-14);
	display: flex; align-items: center; gap: var(--hz-space-1); z-index: 11;
}
${CONTENT} > [data-hz-slot="toolbar"] > [data-hz="icon"] {
	width: var(--hz-space-5); height: var(--hz-space-5); color: var(--hz-color-fg-3);
}
${ROOT} > [data-hz-part="header"] > [data-hz-part="back"] > svg { display: block; width: 100%; height: 100%; transform: scaleX(-1); }
${ROOT} > [data-hz-part="header"] > [data-hz-part="back"]:is(:hover, :active) {
	background: var(--hz-color-wash); color: var(--hz-color-fg);
}
${ROOT} > [data-hz-part="header"] > [data-hz-part="back"]:focus-visible {
	outline: 2px solid var(--hz-color-ring); outline-offset: -2px;
}
/* A phone tab's page (\`surface\` \`page\`): at least its container's height, so the floating action
   reaches the bottom, under a bar that sticks (\`sticky top-0 z-10\`). */
${ROOT}[data-surface="page"] { min-height: 100%; flex: 1 0 auto; }
${ROOT}[data-surface="page"] > [data-hz-part="header"] { position: sticky; top: 0; z-index: 10; background: inherit; }
/* A page opened from another (\`detail\`): the column's full height, its back an unflipped arrow. */
${ROOT}[data-surface="detail"] { height: 100%; min-height: 0; }
/* Its back spans the empty crumb and subtitle rows; the title's row takes the back's extra height. */
${ROOT}[data-surface="detail"] > header[data-hz-part="header"] { flex-shrink: 0; grid-template-rows: auto 1fr auto; }
${ROOT}[data-surface="detail"] > [data-hz-part="header"] > [data-hz-part="back"] > svg { transform: none; }
${ROOT}[data-surface="detail"] > [data-hz-part="content"] { min-height: 0; }
${headingCss}
${centeredCss}
${floatingCss}
`

export const primitive = definePrimitive("screen", ({ document, tag, outer }) => {
	ensureSheet(document, "screen", css)
	const node = outer("main")
	const header = part(document, "header", "header")
	const back = part(document, "button", "back")
	back.setAttribute("type", "button")
	back.setAttribute("aria-label", "Back")
	back.innerHTML = svg("chevron-right")
	back.hidden = true
	const crumbs = part(document, "nav", "crumbs")
	crumbs.setAttribute("aria-label", "Breadcrumb")
	crumbs.hidden = true
	const title = part(document, "h1", "title")
	const metaRoom = part(document, "span", "metaRoom")
	metaRoom.setAttribute("aria-hidden", "true")
	metaRoom.hidden = true
	const subtitle = part(document, "p", "subtitle")
	const content = part(document, "div", "content")
	header.append(back, crumbs, title, metaRoom, subtitle)
	node.append(header, content)
	back.addEventListener("click", () => fire(primitive, "back"))

	// `meta` and `toolbar` stay in the content parent: `meta` is laid over a room of its size kept
	// after the title, and the header keeps the toolbar's width clear at its end.
	const slotOf = (name: string) => content.querySelector<HTMLElement>(`:scope > [data-hz-slot="${name}"]`)
	let meta: HTMLElement | null = null
	let toolbar: HTMLElement | null = null
	const place = () => {
		const tools = toolbar !== null && toolbar.childElementCount > 0 ? toolbar : null
		flag(node, "toolbar", tools !== null)
		if (tools !== null)
			node.style.setProperty("--hz-screen-toolbar", `${tools.getBoundingClientRect().width}px`)
		const has = meta !== null && meta.childElementCount > 0
		metaRoom.hidden = !has
		if (!has || meta === null) return
		const size = meta.getBoundingClientRect()
		metaRoom.style.width = `${size.width}px`
		metaRoom.style.height = `${size.height}px`
		const origin = node.getBoundingClientRect()
		const room = metaRoom.getBoundingClientRect()
		meta.style.left = `${room.left - origin.left}px`
		meta.style.top = `${room.top - origin.top}px`
	}
	const win = document.defaultView
	const sizes = win?.ResizeObserver === undefined ? undefined : new win.ResizeObserver(() => place())
	sizes?.observe(node)
	sizes?.observe(title)
	const follow = (current: HTMLElement | null, next: HTMLElement | null) => {
		if (current === next) return next
		if (current !== null) sizes?.unobserve(current)
		if (next !== null) sizes?.observe(next)
		return next
	}
	// Only the content's own children: a list's rows changing never reads layout here.
	if (win?.MutationObserver !== undefined)
		new win.MutationObserver(() => {
			meta = follow(meta, slotOf("meta"))
			toolbar = follow(toolbar, slotOf("toolbar"))
			place()
		}).observe(content, { childList: true })

	const drawCrumbs = (list: ReadonlyArray<Crumb>) => {
		crumbs.hidden = list.length === 0
		crumbs.replaceChildren(
			...list.flatMap((crumb, index) => {
				const separator = part(document, "span", "crumbSeparator")
				separator.setAttribute("aria-hidden", "true")
				separator.innerHTML = svg("chevron-right")
				const link = part(document, crumb.href === undefined ? "span" : "a", "crumb")
				link.textContent = crumb.label
				if (crumb.href === undefined) link.setAttribute("aria-current", "page")
				else {
					link.setAttribute("href", crumb.href)
					// A plain click is the view's when it listens (a form asks first); else the link's.
					link.addEventListener("click", (event) => {
						if (!isPlainClick(event) || !listens(primitive, "crumb")) return
						event.preventDefault()
						fire(primitive, "crumb", { index })
					})
				}
				return index === 0 ? [link] : [separator, link]
			}),
		)
		place()
	}

	const primitive: Primitive = {
		tag,
		outer: node,
		content,
		set: (name, value) => {
			if (name === "title") title.textContent = textOf(value)
			else if (name === "subtitle") subtitle.textContent = textOf(value)
			else if (name === "crumbs") drawCrumbs(crumbsOf(value))
			else if (name === "surface") {
				option(node, "surface", value)
				back.innerHTML = svg(value === "detail" ? "arrow-left" : "chevron-right")
			} else if (name === "back") {
				back.hidden = value !== true
				flag(node, "back", value)
			} else return
			place()
		},
		events: undefined,
	}
	return primitive
})

/**
 * The `GifPicker` extension on the web (`emoji-gif-picker`, lane A3, G3): drawn into the `hz:ext`
 * placeholder, a non-modal panel like today's (`gif-picker/view.ts`): the search field, category
 * chips while nothing is typed, two columns of stills that animate under the pointer or focus, a
 * pager at the end and the KLIPY attribution. The screen owns the search: typing raises `query`
 * (after 300ms), a chip `category`, scrolling near the end `reachEnd`, "Try again" `retry`. A press
 * picks (`select` with the GIF's URL); Escape or a press outside raises `dismiss`.
 * Registered on import: `primitives.ts` loads every file in this folder.
 */
import type { GifItem } from "../../../extensions/GifPicker.ts"
import { GifPicker } from "../../../extensions/GifPicker.ts"
import { registerWebExtension } from "../../extensions.ts"
import { focusElement } from "../../focus/focusable.ts"
import { trackPlacement } from "../../focus/position.ts"
import { makePopoverPanel } from "../../focus/surface.ts"
import { glyph } from "../../icons.ts"
import { flag, part } from "../define.ts"
import { gridStep, openerRect } from "./emojiPicker.ts"
import { controlledOverlay } from "./overlay.ts"
import { spinner } from "./spinner.ts"

const COLUMNS = 2
const DEBOUNCE_MS = 300
/** Today's 12 chips at most. */
const CHIPS = 12

// Today's classes (`gif-picker/view.ts`), tokens only: the panel `h-[420px] w-[400px] rounded-lg
// border-fg/15 bg-overlay shadow-lg`, chips as `toggleChip` `h-7 text-xs`, `columns-2 gap-2` tiles
// `rounded-md bg-muted/60`, the footer `border-t px-3 py-1.5` with `text-3xs` attribution.
const css = `
[data-hz-part=gifPanel] {
	display: flex; flex-direction: column; overflow: hidden; box-sizing: border-box;
	width: min(calc(100vw - var(--hz-space-4)), calc(var(--hz-space-20) * 5)); height: min(var(--hz-space-105), 60dvh);
	border: 1px solid var(--hz-color-overlay-border); border-radius: var(--hz-radius-lg);
	background: var(--hz-color-overlay); color: var(--hz-color-overlay-fg); box-shadow: var(--hz-shadow-lg);
	font-family: var(--hz-font-sans);
}
@media (width >= 48rem) { [data-hz-part=gifPanel] { width: calc(var(--hz-space-20) * 5); height: var(--hz-space-105); } }
[data-hz-part=gifPanel] [data-hz-part=gifHeader] { flex: none; padding: var(--hz-space-3) var(--hz-space-3) var(--hz-space-2); }
[data-hz-part=gifPanel] [data-hz-part=gifSearchBox] {
	display: flex; align-items: center; gap: var(--hz-space-2); min-height: var(--hz-space-9);
	padding-inline: var(--hz-space-2_5); border-radius: var(--hz-radius-lg); background: var(--hz-color-field); color: var(--hz-color-muted-fg);
}
[data-hz-part=gifPanel] [data-hz-part=gifSearchBox]:is(:hover, :focus-within) { background: var(--hz-color-field-hover); }
[data-hz-part=gifPanel] [data-hz-part=gifSearchBox] > [data-hz-part=gifSearchIcon] { width: var(--hz-space-4); height: var(--hz-space-4); flex: none; }
[data-hz-part=gifPanel] [data-hz-part=search] {
	flex: 1; min-width: 0; border: 0; background: transparent; color: var(--hz-color-fg); outline: none;
	font-size: var(--hz-text-body-size); line-height: var(--hz-text-body-leading);
}
[data-hz-part=gifPanel] [data-hz-part=search]:is(:focus, :focus-visible) { outline: none; }
[data-hz-part=gifPanel] [data-hz-part=search]::placeholder { color: var(--hz-color-muted-fg); opacity: 1; }
[data-hz-part=gifPanel] [data-hz-part=search]::-webkit-search-cancel-button { display: none; }
[data-hz-part=gifPanel] [data-hz-part=gifChips] { display: flex; flex: none; gap: var(--hz-space-1_5); overflow-x: auto; padding: 0 var(--hz-space-3) var(--hz-space-2); scrollbar-width: none; }
[data-hz-part=gifPanel] [data-hz-part=gifChip] {
	flex: none; height: var(--hz-space-7); padding-inline: var(--hz-space-2_5); border: 1px solid var(--hz-color-border);
	border-radius: var(--hz-radius-md); background: transparent; color: var(--hz-color-muted-fg); cursor: pointer;
	font: inherit; font-weight: var(--hz-weight-strong); font-size: var(--hz-text-caption-size); line-height: var(--hz-text-caption-leading); white-space: nowrap;
}
[data-hz-part=gifPanel] [data-hz-part=gifChip]:hover { background: var(--hz-color-secondary); color: var(--hz-color-fg); }
[data-hz-part=gifPanel] [data-hz-part=gifChip][data-selected] { background: var(--hz-color-chip-selected); border-color: var(--hz-color-chip-selected-border); color: var(--hz-color-fg); }
[data-hz-part=gifPanel] [data-hz-part=gifNote] { display: flex; flex: none; align-items: center; gap: var(--hz-space-2); padding: 0 var(--hz-space-3) var(--hz-space-2); color: var(--hz-color-muted-fg); font-size: var(--hz-text-caption-size); }
[data-hz-part=gifPanel] [data-hz-part=gifResults] { position: relative; flex: 1; overflow-x: hidden; overflow-y: auto; padding-inline: var(--hz-space-3); overscroll-behavior: contain; }
[data-hz-part=gifPanel] [data-hz-part=gifs] { columns: 2; column-gap: var(--hz-space-2); margin: 0; padding: 0; list-style: none; }
[data-hz-part=gifPanel] [data-hz-part=gif] {
	display: block; width: 100%; margin-bottom: var(--hz-space-2); padding: 0; border: 0; overflow: hidden; break-inside: avoid;
	border-radius: var(--hz-radius-md); background: color-mix(in oklab, var(--hz-color-muted) 60%, transparent); cursor: pointer; outline: none;
}
[data-hz-part=gifPanel] [data-hz-part=gif]:hover { opacity: 0.9; }
[data-hz-part=gifPanel] [data-hz-part=gif]:focus-visible { box-shadow: 0 0 0 2px var(--hz-color-primary); }
[data-hz-part=gifPanel] [data-hz-part=gif] > img { display: block; width: 100%; height: 100%; object-fit: cover; }
[data-hz-part=gifPanel] [data-hz-part=gifState] {
	position: absolute; inset: 0; display: flex; flex-direction: column; align-items: center; justify-content: center;
	gap: var(--hz-space-3); padding-inline: var(--hz-space-6); text-align: center; color: var(--hz-color-muted-fg);
	font-size: var(--hz-text-label-size); line-height: var(--hz-text-label-leading);
}
[data-hz-part=gifPanel] [data-hz-part=gifStateTitle] { color: var(--hz-color-fg); font-weight: var(--hz-weight-strong); }
[data-hz-part=gifPanel] [data-hz-part=gifPager] { display: flex; flex-direction: column; align-items: center; gap: var(--hz-space-2); padding-block: var(--hz-space-4); color: var(--hz-color-muted-fg); font-size: var(--hz-text-caption-size); }
[data-hz-part=gifPanel] [data-hz-spinner] { width: var(--hz-space-5); height: var(--hz-space-5); color: var(--hz-color-muted-fg); }
[data-hz-part=gifPanel] [data-hz-part=gifRetry] {
	height: var(--hz-space-8); padding-inline: var(--hz-space-3); border: 1px solid var(--hz-color-border); border-radius: var(--hz-radius-lg);
	background: transparent; color: var(--hz-color-fg); cursor: pointer; font: inherit; font-weight: var(--hz-weight-strong); box-shadow: var(--hz-shadow-xs);
}
[data-hz-part=gifPanel] [data-hz-part=gifRetry]:hover { background: var(--hz-color-secondary); }
[data-hz-part=gifPanel] [data-hz-part=gifLink] {
	padding: 0; border: 0; background: none; color: var(--hz-color-fg); cursor: pointer; font: inherit; font-weight: var(--hz-weight-strong);
}
[data-hz-part=gifPanel] [data-hz-part=gifLink]:hover { text-decoration: underline; text-underline-offset: 2px; }
[data-hz-part=gifPanel] [data-hz-part=gifFooter] { display: flex; flex: none; justify-content: flex-end; padding: var(--hz-space-1_5) var(--hz-space-3); border-top: 1px solid var(--hz-color-overlay-border); }
[data-hz-part=gifPanel] [data-hz-part=gifAttribution] { color: var(--hz-color-muted-fg); font-size: var(--hz-text-micro-size); font-weight: var(--hz-weight-strong); text-decoration: none; }
[data-hz-part=gifPanel] [data-hz-part=gifAttribution]:hover { color: var(--hz-color-fg); }
`

const installed = new WeakSet<Document>()
const ensureCss = (document: Document) => {
	if (installed.has(document)) return
	installed.add(document)
	const style = document.createElement("style")
	style.dataset.hzRenderer = "gifPicker"
	style.textContent = css
	document.head.append(style)
}

const textPart = (document: Document, tagName: string, name: string, text: string) => {
	const node = part(document, tagName, name)
	node.textContent = text
	return node
}

registerWebExtension(GifPicker, (container, initial, send) => {
	const document = container.ownerDocument
	ensureCss(document)
	const panel = makePopoverPanel(part(document, "div", "gifPanel"))
	panel.setAttribute("role", "dialog")
	panel.setAttribute("aria-label", "GIF picker")
	const header = part(document, "div", "gifHeader")
	const box = part(document, "label", "gifSearchBox")
	const icon = part(document, "span", "gifSearchIcon")
	icon.setAttribute("aria-hidden", "true")
	glyph(icon, "search")
	const search = part(document, "input", "search") as HTMLInputElement
	search.type = "search"
	search.placeholder = "Search KLIPY"
	search.setAttribute("aria-label", "Search GIFs")
	search.autocomplete = "off"
	box.append(icon, search)
	header.append(box)
	const chips = part(document, "div", "gifChips")
	const results = part(document, "div", "gifResults")
	results.dataset.scroll = ""
	const footer = part(document, "div", "gifFooter")
	const link = textPart(document, "a", "gifAttribution", "Powered by KLIPY") as HTMLAnchorElement
	link.href = "https://klipy.com"
	link.target = "_blank"
	link.rel = "noopener noreferrer"
	footer.append(link)
	panel.append(header, chips, results, footer)
	container.append(panel)
	let props = initial
	let opener: Element | null = null
	let timer: ReturnType<typeof setTimeout> | undefined
	let hovered: string | undefined

	const tiles = () => [...results.querySelectorAll<HTMLButtonElement>("[data-hz-part=gif]")]
	const retryButton = (name: string, label: string, event: "retry" | "retryCategories") => {
		const button = textPart(document, "button", name, label) as HTMLButtonElement
		button.type = "button"
		button.addEventListener("click", () => send(event, {}))
		return button
	}
	const state = (...children: Array<Node>) => {
		const node = part(document, "div", "gifState")
		node.append(...children)
		return node
	}

	const drawChips = () => {
		const categories = props.categories ?? []
		const searching = search.value.trim() !== ""
		if (searching || (categories.length === 0 && props.categoriesFailed !== true)) {
			chips.hidden = true
			return chips.replaceChildren()
		}
		chips.hidden = false
		if (props.categoriesFailed === true) {
			chips.dataset.hzPart = "gifNote"
			return chips.replaceChildren(
				document.createTextNode("Couldn't load categories."),
				retryButton("gifLink", "Try again", "retryCategories"),
			)
		}
		chips.dataset.hzPart = "gifChips"
		chips.replaceChildren(
			...categories.slice(0, CHIPS).map((category) => {
				const chip = textPart(document, "button", "gifChip", category.label) as HTMLButtonElement
				chip.type = "button"
				const on = props.category === category.query
				flag(chip, "selected", on)
				chip.setAttribute("aria-pressed", on ? "true" : "false")
				chip.addEventListener("click", () => send("category", { query: on ? "" : category.query }))
				return chip
			}),
		)
	}

	const tile = (gif: GifItem, index: number) => {
		const button = part(document, "button", "gif") as HTMLButtonElement
		button.type = "button"
		button.tabIndex = index === 0 ? 0 : -1
		button.setAttribute("aria-label", gif.title || "GIF")
		button.style.aspectRatio = `${gif.width} / ${gif.height}`
		const image = document.createElement("img")
		image.alt = ""
		image.loading = "lazy"
		image.draggable = false
		image.src = hovered === gif.url ? gif.animated : gif.still
		button.append(image)
		// The still, animating while hovered or focused (today's jpg, then webp).
		const animate = (on: boolean) => {
			hovered = on ? gif.url : hovered === gif.url ? undefined : hovered
			image.src = on ? gif.animated : gif.still
		}
		button.addEventListener("pointerenter", () => animate(true))
		button.addEventListener("pointerleave", () => animate(false))
		button.addEventListener("focus", () => animate(true))
		button.addEventListener("blur", () => animate(false))
		button.addEventListener("click", () => send("select", { url: gif.url }))
		return button
	}

	const drawResults = () => {
		results.setAttribute("aria-busy", props.status === "loading" ? "true" : "false")
		if (props.status === "failed") {
			const failure = props.failure ?? {
				title: "GIFs are unavailable",
				description: "Please try again.",
			}
			const node = state(
				textPart(document, "span", "gifStateTitle", failure.title),
				textPart(document, "span", "gifStateText", failure.description),
				retryButton("gifRetry", "Try again", "retry"),
			)
			node.setAttribute("role", "alert")
			return results.replaceChildren(node)
		}
		const gifs = props.gifs ?? []
		if (props.status === "loading" || (props.status === undefined && gifs.length === 0))
			return results.replaceChildren(state(spinner(document, "gifSpinner")))
		if (gifs.length === 0)
			return results.replaceChildren(
				state(
					textPart(document, "span", "gifStateTitle", "No GIFs found"),
					textPart(document, "span", "gifStateText", "Try another search."),
				),
			)
		const list = part(document, "div", "gifs")
		list.setAttribute("aria-label", "GIF results")
		list.append(...gifs.map(tile))
		const pager = part(document, "div", "gifPager")
		if (props.paging === "loading") pager.append(spinner(document, "gifSpinner"))
		else if (props.paging === "failed") {
			pager.setAttribute("role", "alert")
			pager.append(
				document.createTextNode(props.failure?.title ?? "GIFs are unavailable"),
				retryButton("gifRetry", "Try again", "retry"),
			)
		}
		results.replaceChildren(list, ...(pager.childNodes.length === 0 ? [] : [pager]))
	}

	const draw = () => {
		drawChips()
		drawResults()
	}

	search.addEventListener("input", () => {
		drawChips()
		if (timer !== undefined) clearTimeout(timer)
		timer = setTimeout(() => send("query", { text: search.value.trim() }), DEBOUNCE_MS)
	})
	search.addEventListener("keydown", (event) => {
		if (event.key !== "ArrowDown") return
		event.preventDefault()
		focusElement(tiles()[0])
	})
	// `GridListLoadMoreItem` with `scrollOffset={0.5}`: half a view from the end asks for more.
	results.addEventListener(
		"scroll",
		() => {
			if (props.paging !== "idle") return
			if (results.scrollTop + results.clientHeight >= results.scrollHeight - results.clientHeight * 0.5)
				send("reachEnd", {})
		},
		{ passive: true },
	)
	results.addEventListener("keydown", (event) => {
		const all = tiles()
		const at = all.findIndex((each) => each === document.activeElement)
		const next = at < 0 ? undefined : gridStep(event.key, at, all.length, COLUMNS)
		if (next === undefined) return
		event.preventDefault()
		for (const each of all) each.tabIndex = each === all[next] ? 0 : -1
		focusElement(all[next])
	})

	const overlay = controlledOverlay({
		outer: container,
		panel,
		modal: false,
		layer: () => ({ dismissOnOutside: true, returnFocus: opener, initialFocus: () => search }),
		place: () =>
			trackPlacement(panel, () => openerRect(opener, container), {
				side: "top",
				align: "start",
				gap: 8,
			}),
		// Opening starts over: trending and the chips (today's `open`).
		beforeShow: () => {
			if (search.value !== "") {
				search.value = ""
				send("query", { text: "" })
			}
			draw()
		},
		onDismiss: () => send("dismiss", {}),
	})
	const apply = (next: typeof initial) => {
		props = next
		if (next.open && !overlay.isShown()) opener = document.activeElement
		draw()
		overlay.setOpen(next.open)
	}
	apply(initial)
	return {
		update: apply,
		dispose: () => {
			if (timer !== undefined) clearTimeout(timer)
			overlay.setOpen(false)
			panel.remove()
		},
	}
})

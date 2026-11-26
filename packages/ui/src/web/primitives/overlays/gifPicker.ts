/**
 * The `GifPicker` extension on the web (`emoji-gif-picker`, lane A3): drawn into the `hz:ext`
 * placeholder, a non-modal search panel like the emoji picker. Results come from a `GifSource` the
 * island sets with `setGifSource` (the app's KLIPY search, `apps/web-foldkit/src/gif-picker`); with none
 * it says so. A press picks (`select` with the GIF's URL); Escape or a press outside raises `dismiss`.
 * Registered on import: `primitives.ts` loads every file in this folder.
 */
import { GifPicker } from "../../../extensions/GifPicker.ts"
import { registerWebExtension } from "../../extensions.ts"
import { focusElement } from "../../focus/focusable.ts"
import { trackPlacement } from "../../focus/position.ts"
import { makePopoverPanel } from "../../focus/surface.ts"
import { part } from "../define.ts"
import { gridStep, openerRect } from "./emojiPicker.ts"
import { controlledOverlay } from "./overlay.ts"

export interface Gif {
	readonly url: string
	readonly preview: string
	readonly title: string
}

/** Trending for an empty query, else a search. */
export interface GifSource {
	readonly search: (query: string, signal: AbortSignal) => Promise<ReadonlyArray<Gif>>
}

let source: GifSource | undefined

export const setGifSource = (next: GifSource | undefined) => {
	source = next
}

const COLUMNS = 2
const DEBOUNCE_MS = 300

registerWebExtension(GifPicker, (container, props, send) => {
	const document = container.ownerDocument
	const panel = makePopoverPanel(part(document, "div", "gifPanel"))
	panel.setAttribute("role", "dialog")
	panel.setAttribute("aria-label", "GIF picker")
	const search = part(document, "input", "search") as HTMLInputElement
	search.type = "search"
	search.placeholder = "Search GIFs"
	search.setAttribute("aria-label", "Search GIFs")
	search.autocomplete = "off"
	const grid = part(document, "div", "gifs")
	grid.dataset.scroll = ""
	const note = part(document, "p", "empty")
	panel.append(search, grid, note)
	container.append(panel)
	let opener: Element | null = null
	let pending: AbortController | undefined
	let timer: ReturnType<typeof setTimeout> | undefined

	const tiles = () => [...grid.querySelectorAll<HTMLButtonElement>("[data-hz-part=gif]")]
	const say = (text: string) => {
		note.textContent = text
		note.hidden = text === ""
	}
	const show = (gifs: ReadonlyArray<Gif>) => {
		grid.replaceChildren(
			...gifs.map((gif, index) => {
				const tile = part(document, "button", "gif") as HTMLButtonElement
				tile.type = "button"
				tile.tabIndex = index === 0 ? 0 : -1
				tile.setAttribute("aria-label", gif.title || "GIF")
				const image = document.createElement("img")
				image.src = gif.preview
				image.alt = ""
				image.loading = "lazy"
				tile.append(image)
				tile.addEventListener("click", () => send("select", { url: gif.url }))
				return tile
			}),
		)
		say(gifs.length === 0 ? "No GIFs found" : "")
	}
	const load = () => {
		pending?.abort()
		if (source === undefined) {
			show([])
			say("GIF search is not connected")
			return
		}
		const controller = new AbortController()
		pending = controller
		say("Loading")
		source.search(search.value.trim(), controller.signal).then(
			(gifs) => {
				if (!controller.signal.aborted) show(gifs)
			},
			() => {
				if (!controller.signal.aborted) say("GIFs could not load")
			},
		)
	}
	search.addEventListener("input", () => {
		if (timer !== undefined) clearTimeout(timer)
		timer = setTimeout(load, DEBOUNCE_MS)
	})
	search.addEventListener("keydown", (event) => {
		if (event.key !== "ArrowDown") return
		event.preventDefault()
		focusElement(tiles()[0])
	})
	grid.addEventListener("keydown", (event) => {
		const all = tiles()
		const at = all.findIndex((tile) => tile === document.activeElement)
		const next = at < 0 ? undefined : gridStep(event.key, at, all.length, COLUMNS)
		if (next === undefined) return
		event.preventDefault()
		for (const tile of all) tile.tabIndex = tile === all[next] ? 0 : -1
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
		beforeShow: () => {
			search.value = ""
			load()
		},
		onDismiss: () => send("dismiss", {}),
	})
	const apply = (next: { readonly open: boolean }) => {
		if (next.open && !overlay.isShown()) opener = document.activeElement
		overlay.setOpen(next.open)
	}
	apply(props)
	return {
		update: apply,
		dispose: () => {
			pending?.abort()
			if (timer !== undefined) clearTimeout(timer)
			overlay.setOpen(false)
			panel.remove()
		},
	}
})

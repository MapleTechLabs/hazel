/**
 * `hz:lightbox` on the web (lane A3): today's image viewer (`apps/web-foldkit/src/chat/image-viewer.ts`)
 * as a modal `<dialog>` over the page. Swipe, zoom (click, double tap, pinch, ctrl + wheel, the
 * buttons, `+` `-` `0`), pan with momentum and pull to dismiss are `lightbox-gestures.ts`; the counter,
 * step buttons, toolbar, thumbnail strip and the image's right-click menu (`entries`) are drawn here.
 * Opening and closing morph between the image on the page and the open slide (a View Transition).
 * A slide the user reaches raises `change`; the view's `index` moves the track; `dismiss` asks to close.
 */
import type { Attachment, MenuGroups } from "../../../vocabulary/content.ts"
import type { Rect } from "../../../vocabulary/Hazel.ts"
import { focusElement } from "../../focus/focusable.ts"
import { lockScroll } from "../../focus/isolate.ts"
import { type Layer, openLayer } from "../../focus/layers.ts"
import { measureNode } from "../../focus/measure.ts"
import { hidePanel, installOverlayStyles, isSpecimen, showPanel, whenConnected } from "../../focus/surface.ts"
import { ditherInitial } from "../../../../../../apps/web-foldkit/src/ui/dither-avatar.ts"
import { svg } from "../../icons.ts"
import { ditherLayer } from "../content/dither.ts"
import { ensureStyles as ensureContentStyles } from "../content/styles.ts"
import { play } from "../../motion.ts"
import { definePrimitive, flag, part, type Plain, type Primitive } from "../define.ts"
import { attachViewer, type Viewer } from "./lightbox-gestures.ts"
import { installLightboxStyles } from "./lightbox-styles.ts"
import { asGroups, createMenuList } from "./menu-list.ts"
import { fire } from "./overlay.ts"

/** Slides this far from the open one keep their media mounted, so a swipe lands on pixels. */
const PRELOAD = 1
const KEY_PAN_PX = 50
/** The shared `view-transition-name` the morph passes between the page's image and the slide. */
const MORPH_NAME = "hz-lightbox-media"
const PLATE = "data-hz-lightbox-plate"

const isItems = (value: Plain): value is ReadonlyArray<Attachment> & Plain => Array.isArray(value)

const icon = (document: Document, name: string, partName: string) => {
	const node = part(document, "span", partName)
	node.setAttribute("aria-hidden", "true")
	node.innerHTML = svg(name)
	return node
}

const button = (document: Document, partName: string, label: string, glyph: string, glyphPart: string) => {
	const node = part(document, "button", partName) as HTMLButtonElement
	node.type = "button"
	node.setAttribute("aria-label", label)
	node.append(icon(document, glyph, glyphPart))
	return node
}

const isReducedMotion = (window: Window | null) =>
	window?.matchMedia?.("(prefers-reduced-motion: reduce)").matches === true

const absolute = (document: Document, url: string) => {
	try {
		return new URL(url, document.baseURI).href
	} catch {
		return url
	}
}

/** A transition snapshots its first frame as is, so the plate's bitmap has to be painted and on screen. */
const isPlate = (image: HTMLImageElement) => {
	if (!image.complete || image.naturalWidth === 0) return false
	const box = image.getBoundingClientRect()
	const window = image.ownerDocument.defaultView
	return (
		box.width > 0 &&
		box.height > 0 &&
		box.bottom > 0 &&
		box.right > 0 &&
		box.top < (window?.innerHeight ?? 0) &&
		box.left < (window?.innerWidth ?? 0)
	)
}

type Transitioning = Document & {
	startViewTransition?: (update: () => void) => { readonly finished: Promise<void> }
}

export const primitive = definePrimitive("lightbox", ({ document, tag, outer }) => {
	// At create, not first open: the closed stage's hiding rule must be there before it draws.
	installOverlayStyles(document)
	installLightboxStyles(document)
	// The seeded author face's dither layer is styled with the avatar's.
	ensureContentStyles(document)
	const window = document.defaultView
	const node = outer("div")
	const stage = part(document, "dialog", "stage") as HTMLDialogElement
	stage.dataset.hzLayer = ""
	stage.setAttribute("aria-modal", "true")
	const backdrop = part(document, "div", "backdrop")
	backdrop.setAttribute("aria-hidden", "true")
	const viewport = part(document, "div", "viewport")
	viewport.tabIndex = -1
	const slides = part(document, "div", "slides")
	slides.setAttribute("role", "group")
	slides.setAttribute("aria-roledescription", "carousel")
	slides.setAttribute("aria-label", "Images")
	viewport.append(slides)
	const live = part(document, "div", "live")
	live.setAttribute("aria-live", "polite")
	live.setAttribute("aria-atomic", "true")
	const counter = part(document, "div", "counter")
	counter.setAttribute("aria-hidden", "true")
	counter.dataset.chrome = ""
	// A pointer's shortcut for what the arrow keys already do, so out of the tab order.
	const previous = button(document, "step", "Previous image", "chevron-left", "stepIcon")
	const next = button(document, "step", "Next image", "chevron-right", "stepIcon")
	for (const [step, side] of [
		[previous, "previous"],
		[next, "next"],
	] as const) {
		step.dataset.side = side
		step.dataset.chrome = ""
		step.tabIndex = -1
	}
	const toolbar = part(document, "div", "toolbar")
	toolbar.dataset.chrome = ""
	// Who shared the open item and when (its `uploader` and `meta`), top left as today's.
	const author = part(document, "div", "author")
	author.dataset.chrome = ""
	const zoomOut = button(document, "tool", "Zoom out", "minus", "toolIcon")
	const zoomIn = button(document, "tool", "Zoom in", "plus", "toolIcon")
	const close = button(document, "tool", "Close", "close", "toolIcon")
	const strip = part(document, "div", "strip")
	strip.dataset.chrome = ""
	const thumbs = part(document, "div", "thumbs")
	strip.append(thumbs)
	// Inside the dialog: outside it, a modal dialog makes the menu inert.
	const menuHost = part(document, "div", "menu")
	stage.append(backdrop, viewport, live, counter, author, previous, next, toolbar, strip, menuHost)
	node.append(stage)
	const menu = createMenuList(document, menuHost, (id) => fire(primitive, "select", { id }))
	menu.setLabel("Image actions")

	let items: ReadonlyArray<Attachment> = []
	let groups: MenuGroups = []
	let index = 0
	/** The view's `index`, kept for items that arrive after it. */
	let asked = 0
	/** A slide the view moved the track to: reaching it is not the user's `change`. */
	let driven: number | undefined
	let wanted = false
	let shown = false
	let layer: Layer | undefined
	let viewer: Viewer | undefined
	let watch: MutationObserver | undefined
	/** The overlays' shared page lock (W6's `isolate.ts`); the modal dialog makes the rest inert. */
	let unlock: (() => void) | undefined
	const unlockScroll = () => {
		unlock?.()
		unlock = undefined
	}
	const schedule = whenConnected(node)

	/** The view removed the viewer while it was open: the page gets its scroll back. */
	const release = () => {
		watch?.disconnect()
		watch = undefined
		unlockScroll()
		viewer?.dispose()
		viewer = undefined
		for (const marked of document.querySelectorAll(`[${PLATE}]`)) marked.removeAttribute(PLATE)
	}

	const clamp = (at: number) => Math.min(Math.max(Math.round(at), 0), Math.max(items.length - 1, 0))
	const slideAt = (at: number) => slides.children.item(at) as HTMLElement | null
	const activeMedia = () => slideAt(index)?.querySelector<HTMLElement>('[data-hz-part="media"]') ?? null

	const mediaOf = (item: Attachment, active: boolean): HTMLElement => {
		if (item.kind === "video" && item.url !== undefined) {
			const video = part(document, "video", "media") as HTMLVideoElement
			video.controls = true
			video.playsInline = true
			video.preload = "metadata"
			video.src = item.url
			video.setAttribute("aria-label", item.name)
			return video
		}
		if (item.kind === "file" || item.url === undefined) {
			const file = part(document, "p", "file")
			file.textContent = item.name
			return file
		}
		const image = part(document, "img", "media") as HTMLImageElement
		image.alt = item.name
		image.draggable = false
		// The opening frame is a snapshot: the bitmap has to be in it.
		image.decoding = active ? "sync" : "async"
		if (item.width !== undefined) image.width = item.width
		if (item.height !== undefined) image.height = item.height
		image.src = item.url
		return image
	}

	/** Only slides near the open one hold their media; a video left behind stops. */
	const mountNear = () => {
		items.forEach((item, at) => {
			const zoom = slideAt(at)?.firstElementChild
			if (!(zoom instanceof HTMLElement)) return
			const near = Math.abs(at - index) <= PRELOAD
			const held = zoom.firstElementChild
			if (!near) {
				if (held !== null) zoom.replaceChildren()
				return
			}
			if (held === null) zoom.append(mediaOf(item, at === index))
			else if (held instanceof HTMLVideoElement && at !== index && !held.paused) held.pause()
		})
	}

	/** The image on the page that shows the open slide: what the viewer opens from and closes into. */
	const plate = (): HTMLImageElement | undefined => {
		const url = items[index]?.url
		if (url === undefined || items[index]?.kind !== "image") return undefined
		const source = absolute(document, url)
		return [...document.querySelectorAll("img")].find(
			(image) => !node.contains(image) && (image.currentSrc || image.src) === source && isPlate(image),
		)
	}
	const markPlate = () => {
		for (const marked of document.querySelectorAll(`[${PLATE}]`)) marked.removeAttribute(PLATE)
		if (shown && !isSpecimen(node)) plate()?.setAttribute(PLATE, "")
	}

	const showZoom = (isZoomed: boolean, canZoomIn: boolean) => {
		const isImage = items[index]?.kind === "image"
		flag(stage, "zoomed", isZoomed)
		zoomOut.setAttribute("aria-disabled", String(!isImage || !isZoomed))
		zoomIn.setAttribute("aria-disabled", String(!isImage || !canZoomIn))
	}

	/** Shows slide `at`: the counter, the thumbnails, the steps, what a screen reader hears. */
	const select = (at: number) => {
		index = clamp(at)
		const count = items.length
		Array.from(slides.children).forEach((slide, each) => {
			flag(slide as HTMLElement, "active", each === index)
			if (each === index) slide.removeAttribute("aria-hidden")
			else slide.setAttribute("aria-hidden", "true")
		})
		Array.from(thumbs.children).forEach((thumb, each) => {
			if (each === index) thumb.setAttribute("aria-current", "true")
			else thumb.removeAttribute("aria-current")
		})
		counter.textContent = `${index + 1} of ${count}`
		drawAuthor(items[index])
		previous.setAttribute("aria-disabled", String(index === 0))
		next.setAttribute("aria-disabled", String(index >= count - 1))
		const item = items[index]
		live.textContent =
			item === undefined
				? ""
				: `${count > 1 ? `${index + 1} of ${count}. ` : ""}${item.caption?.title ?? item.name}`
		stage.setAttribute("aria-label", count > 1 ? "Image gallery" : "Image viewer")
		mountNear()
		// Each slide opens at rest (the gestures reset the pose when it changes).
		showZoom(false, true)
		keepThumbInView()
		markPlate()
	}

	/** Today's `md` avatar, the name in white and the time in muted ink. */
	const drawAuthor = (item: Attachment | undefined) => {
		const uploader = item?.uploader
		author.hidden = uploader === undefined
		if (uploader === undefined) return author.replaceChildren()
		const face = part(document, "span", "authorAvatar")
		face.setAttribute("aria-hidden", "true")
		if (uploader.avatar !== undefined) {
			const image = part(document, "img", "authorImage") as HTMLImageElement
			image.src = uploader.avatar
			image.alt = ""
			face.append(image)
		} else {
			const dither = ditherLayer(document)
			dither.seed(uploader.name, 40)
			const initial = part(document, "span", "authorInitial")
			initial.textContent = ditherInitial(uploader.name)
			face.dataset.seeded = ""
			face.append(dither.layer, initial)
		}
		const lines = part(document, "div", "authorLines")
		const name = part(document, "span", "authorName")
		name.textContent = uploader.name
		lines.append(name)
		if (item?.meta !== undefined) {
			const meta = part(document, "span", "authorMeta")
			meta.textContent = item.meta
			lines.append(meta)
		}
		author.replaceChildren(face, lines)
	}

	/** An embed image's title and description under it (`captionView`). */
	const captionOf = (item: Attachment) => {
		const { title, description } = item.caption ?? {}
		if (title === undefined && description === undefined) return undefined
		const caption = part(document, "div", "caption")
		if (title !== undefined) {
			const line = part(document, "p", "captionTitle")
			line.textContent = title
			caption.append(line)
		}
		if (description !== undefined) {
			const line = part(document, "p", "captionDescription")
			line.textContent = description
			caption.append(line)
		}
		return caption
	}

	/** The strip follows the open slide (today's carousel `keepSnaps`): the thumbnail stays in view. */
	const keepThumbInView = () => {
		const thumb = thumbs.children.item(index)
		if (!(thumb instanceof HTMLElement) || thumbs.clientWidth === 0) return
		const left = thumb.offsetLeft - thumbs.offsetLeft
		const right = left + thumb.offsetWidth
		const target =
			left < thumbs.scrollLeft
				? left
				: right > thumbs.scrollLeft + thumbs.clientWidth
					? right - thumbs.clientWidth
					: undefined
		if (target === undefined) return
		if (typeof thumbs.scrollTo === "function")
			thumbs.scrollTo({ left: target, behavior: isReducedMotion(window) ? "auto" : "smooth" })
		else thumbs.scrollLeft = target
	}

	/** A slide the user reached (swipe, keys, steps, thumbnails): shown at once, and told to the view. */
	const reach = (at: number) => {
		const target = clamp(at)
		if (viewer !== undefined && viewer.activeIndex() !== target) {
			viewer.goTo(target)
			return
		}
		if (target === index) return
		select(target)
		fire(primitive, "change", { index: target })
	}

	const attach = () => {
		viewer?.dispose()
		viewer = attachViewer(viewport, (event) => {
			if (event._tag === "Dismiss") fire(primitive, "dismiss")
			else if (event._tag === "Zoom") showZoom(event.isZoomed, event.canZoomIn)
			else if (event.index !== index) {
				select(event.index)
				if (driven !== event.index) fire(primitive, "change", { index: event.index })
				driven = undefined
			}
		})
	}

	const detach = () => {
		viewer?.dispose()
		viewer = undefined
		stage.removeAttribute("data-pulling")
		stage.removeAttribute("data-pull-dismissing")
		for (const zoom of slides.querySelectorAll<HTMLElement>('[data-hz-part="zoom"]')) {
			zoom.style.transform = ""
			zoom.style.touchAction = ""
		}
		showZoom(false, true)
	}

	const renderItems = () => {
		const many = items.length > 1
		flag(stage, "many", many)
		counter.hidden = !many
		previous.hidden = !many
		next.hidden = !many
		strip.hidden = !many
		slides.replaceChildren(
			...items.map((item, at) => {
				const slide = part(document, "div", "slide")
				slide.dataset.id = item.id
				slide.setAttribute("role", "group")
				slide.setAttribute("aria-roledescription", "slide")
				slide.setAttribute("aria-label", `${at + 1} of ${items.length}`)
				slide.append(part(document, "div", "zoom"))
				const caption = captionOf(item)
				if (caption !== undefined) slide.append(caption)
				return slide
			}),
		)
		thumbs.replaceChildren(
			...items.map((item, at) => {
				const thumb = part(document, "button", "thumb") as HTMLButtonElement
				thumb.type = "button"
				thumb.setAttribute("aria-label", item.name)
				thumb.addEventListener("click", () => reach(at))
				if (item.url !== undefined && item.kind !== "file") {
					const media = part(document, item.kind === "video" ? "video" : "img", "thumbMedia")
					if (media instanceof HTMLImageElement) {
						media.alt = ""
						media.draggable = false
						media.loading = "lazy"
					} else if (media instanceof HTMLVideoElement) {
						media.muted = true
						media.preload = "metadata"
						media.setAttribute("aria-hidden", "true")
					}
					media.setAttribute("src", item.url)
					thumb.append(media)
				}
				if (item.kind === "video") thumb.append(icon(document, "play", "thumbIcon"))
				return thumb
			}),
		)
		select(index)
		if (viewer !== undefined) attach()
	}

	const renderTools = () => {
		// Entries with an icon are the toolbar's buttons; every entry is in the right-click menu.
		const tools = groups.flatMap((group) =>
			group.entries
				.filter((entry) => entry.icon !== undefined && entry.entries === undefined)
				.map((entry) => {
					const tool = button(document, "tool", entry.label, entry.icon ?? "", "toolIcon")
					tool.dataset.id = entry.id
					if (entry.disabled === true) tool.setAttribute("aria-disabled", "true")
					tool.addEventListener("click", () => {
						if (entry.disabled !== true) fire(primitive, "select", { id: entry.id })
					})
					return tool
				}),
		)
		toolbar.replaceChildren(zoomOut, zoomIn, ...tools, close)
		menu.setEntries(groups)
	}

	const dismiss = () => fire(primitive, "dismiss")
	zoomOut.addEventListener("click", () => viewer?.zoomBy("out"))
	zoomIn.addEventListener("click", () => viewer?.zoomBy("in"))
	close.addEventListener("click", dismiss)
	previous.addEventListener("click", () => reach(index - 1))
	next.addEventListener("click", () => reach(index + 1))

	// The viewer's keys, wherever focus sits in it. Escape is the layer stack's (a menu above takes it
	// first); arrows turn the page at rest and move the view over a zoomed image.
	stage.addEventListener("keydown", (event) => {
		if (event.defaultPrevented || event.metaKey || event.ctrlKey || event.altKey) return
		const target = event.target instanceof Node ? event.target : null
		if (target !== null && menuHost.contains(target)) return
		if (target instanceof HTMLVideoElement && event.key !== "Home" && event.key !== "End") return
		if (event.key === "ContextMenu" || (event.shiftKey && event.key === "F10")) {
			const media = activeMedia()
			if (media instanceof HTMLImageElement) {
				event.preventDefault()
				openMenu(measureNode(media))
			}
			return
		}
		const arrow = (dx: number, dy: number) =>
			viewer?.isZoomed() === true
				? viewer.panBy(dx * KEY_PAN_PX, dy * KEY_PAN_PX)
				: reach(index + dx + dy)
		const handlers = new Map<string, () => void>([
			["ArrowLeft", () => arrow(-1, 0)],
			["ArrowRight", () => arrow(1, 0)],
			["ArrowUp", () => arrow(0, -1)],
			["ArrowDown", () => arrow(0, 1)],
			["Home", () => reach(0)],
			["End", () => reach(items.length - 1)],
			["+", () => viewer?.zoomBy("in")],
			["=", () => viewer?.zoomBy("in")],
			["-", () => viewer?.zoomBy("out")],
			["_", () => viewer?.zoomBy("out")],
			["0", () => viewer?.zoomBy("reset")],
		])
		const handler = handlers.get(event.key)
		if (handler === undefined) return
		event.preventDefault()
		event.stopPropagation()
		handler()
	})

	const openMenu = (rect: Rect) => {
		if (groups.length === 0) return
		menu.close(false)
		menu.open({
			anchor: () => rect,
			placement: { side: "bottom", align: "start", gap: 2 },
			focus: "first",
		})
	}
	// The image's menu opens on the image itself; beside it the browser's own menu shows.
	viewport.addEventListener("contextmenu", (event) => {
		const onImage = event.target instanceof HTMLImageElement && event.target === activeMedia()
		if (!onImage || groups.length === 0) return
		event.preventDefault()
		openMenu({ x: event.clientX, y: event.clientY, width: 0, height: 0 })
	})

	/** Runs `update` inside a View Transition when the engine has one and motion is allowed. */
	const morph = (
		kind: "open" | "close",
		from: HTMLElement | undefined,
		update: () => HTMLElement | undefined,
	) => {
		const transitioning = document as Transitioning
		const html = document.documentElement
		if (
			from === undefined ||
			typeof transitioning.startViewTransition !== "function" ||
			isReducedMotion(window)
		) {
			update()
			return false
		}
		from.style.viewTransitionName = MORPH_NAME
		html.dataset.hzLightboxMorph = kind
		let to: HTMLElement | undefined
		try {
			const transition = transitioning.startViewTransition(() => {
				from.style.viewTransitionName = ""
				to = update()
				if (to !== undefined) to.style.viewTransitionName = MORPH_NAME
			})
			void transition.finished.finally(() => {
				if (to !== undefined) to.style.viewTransitionName = ""
				if (html.dataset.hzLightboxMorph === kind) delete html.dataset.hzLightboxMorph
			})
			return true
		} catch {
			from.style.viewTransitionName = ""
			delete html.dataset.hzLightboxMorph
			update()
			return false
		}
	}

	const reveal = (inPlace: boolean) => {
		showPanel(stage, { modal: true, inPlace })
		shown = true
		attach()
		select(index)
		if (inPlace) return
		unlock ??= lockScroll(document)
		if (typeof MutationObserver === "function") {
			watch = new MutationObserver(() => {
				if (!node.isConnected) {
					shown = false
					release()
				}
			})
			watch.observe(document.body ?? document.documentElement, { childList: true, subtree: true })
		}
		layer = openLayer({
			panel: stage,
			modal: true,
			initialFocus: () => viewport,
			inside: () => [menu.panel],
			onDismiss: (reason) => {
				if (reason === "parent") {
					layer = undefined
					wanted = false
					hide(false)
				}
				dismiss()
			},
		})
	}

	const show = () => {
		const inPlace = isSpecimen(node)
		flag(node, "specimen", inPlace)
		flag(node, "open", true)
		const from = inPlace ? undefined : plate()
		const morphed = morph("open", from, () => {
			reveal(inPlace)
			return from === undefined ? undefined : (activeMedia() ?? undefined)
		})
		if (!morphed) void play(stage, "enter")
	}

	function hide(restoreFocus: boolean) {
		if (!shown) return
		const into = plate()
		shown = false
		menu.close(false)
		flag(node, "open", false)
		const closing = layer
		layer = undefined
		const returnTo = into?.closest<HTMLElement>("button, a[href], [tabindex]")
		closing?.close({ restoreFocus: restoreFocus && returnTo == null })
		if (restoreFocus && returnTo != null) focusElement(returnTo)
		watch?.disconnect()
		watch = undefined
		unlockScroll()
		const media = activeMedia() ?? undefined
		morph("close", into === undefined ? undefined : media, () => {
			detach()
			hidePanel(stage)
			markPlate()
			return into
		})
	}

	const present = () => {
		if (wanted && !shown) show()
		else if (!wanted && shown) hide(true)
	}

	const primitive: Primitive = {
		tag,
		outer: node,
		content: node,
		set: (name, value) => {
			if (name === "open") {
				wanted = value === true
				schedule(present)
			} else if (name === "items") {
				const previousId = items[index]?.id
				items = isItems(value) ? value : []
				// The open item keeps its place when items arrive around it.
				const kept = items.findIndex((item) => item.id === previousId)
				index = clamp(kept >= 0 ? kept : asked)
				renderItems()
			} else if (name === "index") {
				asked = typeof value === "number" ? value : 0
				const at = clamp(asked)
				if (viewer !== undefined && viewer.activeIndex() !== at) {
					driven = at
					viewer.goTo(at)
				} else if (at !== index) select(at)
			} else if (name === "entries") {
				groups = asGroups(value) ?? []
				renderTools()
			}
		},
		events: undefined,
	}
	renderTools()
	renderItems()
	return primitive
})

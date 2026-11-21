import { Effect, Option, Queue, Schema, Stream } from "effect"
import { Mount } from "foldkit"
import type { ChildAttribute, Html, HtmlBuilder } from "foldkit/html"
import { defineMessageUnion } from "foldkit/message"
import {
	IconChevronLeft,
	IconChevronRight,
	IconClose,
	IconDownload,
	IconExternalLink,
	IconImage,
	IconLink,
	IconMinus,
	IconPlus,
} from "../icons"
import { avatar } from "../ui/avatar"
import * as Menu from "../ui/menu"
import { contextMenuView, menuLabel } from "../ui/menu-view"
import { ariaButton, button } from "../ui/button"
import { containFocus, isolateOverlay, portalOverlay, watchInteractOutside } from "../ui/aria/overlay"
import { isNativeRenderer } from "../platform/renderer"
import { systemUi } from "../platform/system-ui"
import type { ChatAttachmentView } from "./attachments"
import { embedMarkdownView } from "./embeds/embed-markdown"
import { attachViewer, PART, type Viewer } from "./viewer/gestures"
import { followSlide, originPlate, releaseOrigin, VIEWER_ATTRIBUTE } from "./viewer/morph"

/**
 * The image viewer (legacy `ImageViewerModal`), a modal over the page. Its gestures follow Maple's
 * docs screenshot viewer, a port of ramka: a native scroll-snap track, zoom (click, double tap,
 * pinch, ctrl + wheel, the buttons, `+` `-` `0`) and pan with momentum up to the bitmap's own
 * pixels, and pull to dismiss. Opening and closing morph between the image on the page and the
 * viewer (`viewer/morph.ts`). The Model holds what is open and which image; zoom is the view's own.
 */

export type ImageViewerAction = "download" | "copyImage" | "copyUrl" | "openInBrowser"

/** The menu a right click on the open image opens: what the toolbar does, under the pointer. */
export const VIEWER_MENU_ID = "image-viewer-menu"

export const initViewerMenu = (): Menu.Model => Menu.init({ id: VIEWER_MENU_ID, anchor: "Pointer" })

const VIEWER_MENU_ITEMS: ReadonlyArray<readonly [ImageViewerAction, string]> = [
	["copyImage", "Copy Image"],
	["download", "Save Image"],
	["copyUrl", "Copy Media Link"],
	["openInBrowser", "Open Media Link"],
]

const viewerMenuEntries: ReadonlyArray<Menu.Entry> = [
	Menu.item("copyImage", { textValue: "Copy Image" }),
	Menu.item("download", { textValue: "Save Image" }),
	Menu.separator,
	Menu.item("copyUrl", { textValue: "Copy Media Link" }),
	Menu.item("openInBrowser", { textValue: "Open Media Link" }),
]

/** The viewer action a choice from the image's menu names, if the menu reported one. */
export const viewerMenuAction = (out: Menu.OutMessage | undefined): ImageViewerAction | null =>
	out?._tag === "SelectedItem"
		? (VIEWER_MENU_ITEMS.find(([action]) => action === out.key)?.[0] ?? null)
		: null

/** A viewer image; an embed's has a caption (its title and description) under it. */
export interface ImageViewerImage extends ChatAttachmentView {
	readonly caption?: { readonly title?: string | undefined; readonly description?: string | undefined }
}

export interface ImageViewerInputs<M> {
	readonly images: ReadonlyArray<ImageViewerImage>
	readonly index: number
	readonly author: {
		readonly name: string
		readonly avatarUrl: string | null
		readonly seed?: string
	} | null
	readonly createdAtMs: number
	readonly toClose: () => M
	readonly toSelect: (index: number) => M
	/** Toolbar side effects (downloads, copies the image or its URL with a toast, or opens a tab). */
	readonly toAction?: (action: ImageViewerAction, image: ChatAttachmentView) => M
	/**
	 * The open image's right-click menu (`initViewerMenu`), held by the parent, which reads the
	 * chosen action for the open image with `viewerMenuAction`.
	 */
	readonly menu?: { readonly model: Menu.Model; readonly toMessage: (message: Menu.Message) => M }
}

const Intent = defineMessageUnion({
	PressedClose: {},
	PressedSelect: { index: Schema.Finite },
	Swiped: { step: Schema.Finite },
})
type Intent = typeof Intent.Type

// The selected slide as the Model has it, which the track and the thumbnails follow.
const SELECTED_ATTRIBUTE = "data-selected-index"
const ZOOM_STEP_ATTRIBUTE = "data-viewer-zoom-step"

/** Slides this far from the open one keep their image mounted, so a swipe lands on pixels. */
const PRELOAD = 1
const KEY_PAN_PX = 50

const readSelected = (element: Element) => Number(element.getAttribute(SELECTED_ATTRIBUTE) ?? 0)

const NO_RELEASE = () => {}

/** Runs `follow(index)` whenever the view changes the selected index on `element`. */
const observeSelected = (element: Element, follow: (index: number) => void) => {
	const observer = new MutationObserver(() => follow(readSelected(element)))
	observer.observe(element, { attributes: true, attributeFilter: [SELECTED_ATTRIBUTE] })
	return observer
}

/** The thumbnail strip (`containScroll: "keepSnaps"`, `dragFree`), kept on the selected slide. */
const ThumbCarousel = Mount.defineStream("ImageViewerThumbCarousel", {
	messages: [Intent.PressedClose, Intent.PressedSelect, Intent.Swiped],
	execute: ({ element }) =>
		Stream.callback<Intent>(() =>
			Effect.acquireRelease(
				// Its own chunk, fetched when a viewer first opens. Without it the strip does not scroll.
				Effect.tryPromise(() => import("embla-carousel")).pipe(
					Effect.match({
						onFailure: () => NO_RELEASE,
						onSuccess: ({ default: EmblaCarousel }) => {
							if (!(element instanceof HTMLElement)) return NO_RELEASE
							const embla = EmblaCarousel(element, {
								containScroll: "keepSnaps",
								dragFree: true,
							})
							embla.scrollTo(readSelected(element))
							const observer = observeSelected(element, (index) => embla.scrollTo(index))
							return () => {
								observer.disconnect()
								embla.destroy()
							}
						},
					}),
				),
				(release) => Effect.sync(release),
			).pipe(Effect.flatMap(() => Effect.never)),
		),
})

const activeMedia = (content: Element) =>
	content.querySelector<HTMLImageElement>(`[${PART.slide}][data-active] img[${PART.media}]`)

/** The zoom buttons' limits are the gestures' to know, so they are written here, not rendered. */
const showZoom = (root: Element, content: Element, isZoomed: boolean, canZoomIn: boolean) => {
	content.toggleAttribute("data-zoomed", isZoomed)
	for (const control of root.querySelectorAll(`[${ZOOM_STEP_ATTRIBUTE}]`)) {
		const step = control.getAttribute(ZOOM_STEP_ATTRIBUTE)
		const isDisabled = step === "out" ? !isZoomed : !canZoomIn
		control.setAttribute("aria-disabled", String(isDisabled))
	}
}

/**
 * The viewer's keys, wherever focus sits and only for the viewer: taken in the capture phase and
 * stopped there, so Escape does not also close a panel of the page behind. Arrows turn the page at
 * rest and move the view over a zoomed image.
 */
const onViewerKey = (viewer: Viewer, count: number, close: () => void) => (event: KeyboardEvent) => {
	// A modified key is the browser's or the app's: ctrl and + still zooms the page.
	if (event.defaultPrevented || event.metaKey || event.ctrlKey || event.altKey) return
	// The image's menu takes its own keys: Escape closes it, not the viewer.
	if (event.target instanceof Element && event.target.closest("[data-menu-popover]")) return
	const arrow = (dx: number, dy: number) =>
		viewer.isZoomed()
			? viewer.panBy(dx * KEY_PAN_PX, dy * KEY_PAN_PX)
			: viewer.goTo(Math.min(count - 1, Math.max(0, viewer.activeIndex() + dx + dy)))
	const handlers = new Map<string, () => void>([
		["Escape", close],
		["ArrowLeft", () => arrow(-1, 0)],
		["ArrowRight", () => arrow(1, 0)],
		["ArrowUp", () => arrow(0, -1)],
		["ArrowDown", () => arrow(0, 1)],
		["Home", () => viewer.goTo(0)],
		["End", () => viewer.goTo(count - 1)],
		["+", () => viewer.zoomBy("in")],
		["=", () => viewer.zoomBy("in")],
		["-", () => viewer.zoomBy("out")],
		["_", () => viewer.zoomBy("out")],
		["0", () => viewer.zoomBy("reset")],
	])
	const handler = handlers.get(event.key)
	if (handler === undefined) return
	event.preventDefault()
	event.stopPropagation()
	handler()
}

const acquire = (open: () => () => void) =>
	Effect.acquireRelease(Effect.sync(open), (release) => Effect.sync(release))

/**
 * On the viewer's root: portal it, run the gestures on its track, hold focus and the keyboard, and
 * keep the morph's plate on the slide on view. The gestures report a slide, or a dismissal.
 */
const ImageViewerMount = Mount.defineStream("ImageViewerPortal", {
	messages: [Intent.PressedClose, Intent.PressedSelect, Intent.Swiped],
	execute: ({ element }) =>
		Stream.callback<Intent>((queue) =>
			Effect.gen(function* () {
				const content = element.querySelector(`[${PART.content}]`)
				const track = element.querySelector(`[${PART.slides}]`)
				if (!(content instanceof HTMLElement) || track === null) return yield* Effect.never
				const close = () => Queue.offerUnsafe(queue, Intent.PressedClose())
				yield* acquire(() => portalOverlay(element))
				const viewer = yield* Effect.acquireRelease(
					Effect.sync(() =>
						attachViewer(content, (event) => {
							if (event._tag === "Dismiss") return close()
							if (event._tag === "Zoom")
								return showZoom(element, content, event.isZoomed, event.canZoomIn)
							Queue.offerUnsafe(queue, Intent.PressedSelect({ index: event.index }))
						}),
					),
					(viewer) => Effect.sync(viewer.dispose),
				)
				showZoom(element, content, false, true)
				followSlide(element, activeMedia(content))
				// The Model's selection, once rendered: one from the step buttons or thumbnails moves
				// the track, and whichever moved it, the morph's plate follows the slide on view.
				yield* acquire(() => {
					const observer = observeSelected(track, (index) => {
						if (index !== viewer.activeIndex()) viewer.goTo(index)
						followSlide(element, activeMedia(content))
					})
					return () => observer.disconnect()
				})
				yield* acquire(() => {
					const onKeyDown = onViewerKey(viewer, track.children.length, close)
					document.addEventListener("keydown", onKeyDown, true)
					return () => document.removeEventListener("keydown", onKeyDown, true)
				})
				// The image's menu opens on the image itself; beside it the browser's own menu shows.
				yield* acquire(() => {
					const onContextMenu = (event: Event) => {
						const isOnImage =
							event.target instanceof Element && event.target.matches(`img[${PART.media}]`)
						if (!isOnImage) event.stopPropagation()
					}
					element.addEventListener("contextmenu", onContextMenu, true)
					return () => element.removeEventListener("contextmenu", onContextMenu, true)
				})
				yield* acquire(() => {
					const onClick = (event: Event) => {
						const control =
							event.target instanceof Element
								? event.target.closest(`[${ZOOM_STEP_ATTRIBUTE}]`)
								: null
						const step = control?.getAttribute(ZOOM_STEP_ATTRIBUTE)
						if (step === "in" || step === "out") viewer.zoomBy(step)
					}
					element.addEventListener("click", onClick)
					return () => element.removeEventListener("click", onClick)
				})
				// Focus lives in the viewer while it is open, and returns to the plate it closed into.
				yield* acquire(() => {
					const previous = document.activeElement
					const releaseContain = containFocus(element)
					content.focus({ preventScroll: true })
					return () => {
						releaseContain()
						releaseOrigin()
						const active = document.activeElement
						if (active !== null && active !== document.body && !element.contains(active)) return
						const plate = originPlate()?.closest<HTMLElement>("button, a[href], [tabindex]")
						const target = plate ?? (previous instanceof HTMLElement ? previous : null)
						if (target?.isConnected) target.focus({ preventScroll: true })
					}
				})
				return yield* Effect.never
			}),
		),
})

/**
 * The viewer in the Rune-native app, which never runs the DOM Mounts above: the host portals it
 * to the window's root and makes it modal, and Escape (the host's dismissal) closes it.
 */
const NativeImageViewerModal = Mount.defineStream("ImageViewerNativeModal", {
	messages: [Intent.PressedClose, Intent.PressedSelect, Intent.Swiped],
	execute: ({ element }) =>
		Stream.callback<Intent>((queue) =>
			Effect.gen(function* () {
				yield* acquire(() => portalOverlay(element))
				yield* isolateOverlay(element, "image-viewer")
				yield* acquire(() =>
					watchInteractOutside(element, `[${VIEWER_ATTRIBUTE}]`, () =>
						Queue.offerUnsafe(queue, Intent.PressedClose()),
					),
				)
				return yield* Effect.never
			}),
		),
})

/** The phone shell's swipe pages the native viewer (`platform/system-ui.ts`), where it has one. */
const NativeSwipePager = Mount.defineStream("ImageViewerSwipePager", {
	messages: [Intent.PressedClose, Intent.PressedSelect, Intent.Swiped],
	execute: ({ element }) =>
		Stream.callback<Intent>((queue) =>
			acquire(
				() =>
					systemUi()?.setSwipePager?.((step) => {
						// A swipe landing after this slide left the page belongs to the next slide's pager.
						if (element.isConnected) Queue.offerUnsafe(queue, Intent.Swiped({ step }))
					}) ?? NO_RELEASE,
			).pipe(Effect.flatMap(() => Effect.never)),
		),
})

const toolbarButton = <M>(
	h: HtmlBuilder<M>,
	onPress: M | undefined,
	label: string,
	icon: Html,
	zoomStep?: "in" | "out",
): Html =>
	// `TooltipTrigger` is a bare React Aria Button wrapping the action Button; the tooltip shows on hover only.
	ariaButton(h, {}, [
		button(
			h,
			{
				intent: "plain",
				size: "sq-sm",
				...(onPress === undefined ? {} : { onPress }),
				className: "text-white [--btn-overlay:rgb(255_255_255/0.1)]",
				attributes: [
					h.AriaLabel(label),
					...(zoomStep === undefined ? [] : [h.Attribute(ZOOM_STEP_ATTRIBUTE, zoomStep)]),
				],
			},
			[icon],
		),
	])

const navButton = <M>(h: HtmlBuilder<M>, side: "left" | "right", onPress: M, isDisabled: boolean): Html =>
	button(
		h,
		{
			intent: "plain",
			size: "sq-md",
			isCircle: true,
			onPress,
			className: `absolute top-1/2 ${side === "left" ? "left-4" : "right-4"} -translate-y-1/2 text-white transition-opacity [--btn-bg:rgb(0_0_0/0.5)] [--btn-overlay:rgb(0_0_0/0.7)] ${isDisabled ? "opacity-40" : ""}`,
			attributes: [
				h.AriaLabel(side === "left" ? "Previous image" : "Next image"),
				h.DataAttribute("viewer-step", ""),
				h.DataAttribute("viewer-chrome", ""),
				// A pointer's shortcut for what the arrow keys already do.
				h.Tabindex(-1),
				...(isDisabled ? [h.AriaDisabled(true)] : []),
			],
		},
		[
			side === "left"
				? IconChevronLeft(h, { className: "size-6" })
				: IconChevronRight(h, { className: "size-6" }),
		],
	)

/**
 * A thumbnail: the ring is drawn inside it (over the image), so the strip's overflow never clips it,
 * and a press only fades it in, with no button background.
 */
const thumbView = <M>(h: HtmlBuilder<M>, image: ImageViewerImage, isSelected: boolean, onPress: M): Html =>
	ariaButton(
		h,
		{
			onPress,
			className: `relative flex-[0_0_80px] cursor-pointer select-none overflow-hidden rounded-md outline-none transition-opacity duration-150 after:pointer-events-none after:absolute after:inset-0 after:rounded-md after:ring-inset focus-visible:after:ring-2 focus-visible:after:ring-ring ${
				isSelected ? "opacity-100 after:ring-2 after:ring-white" : "opacity-50 hover:opacity-80"
			}`,
			attributes: [h.AriaLabel(image.fileName), ...(isSelected ? [h.AriaCurrent("true")] : [])],
		},
		[
			h.img([
				h.Attribute("src", image.url),
				h.Attribute("alt", ""),
				h.Draggable(false),
				h.Class("block h-16 w-20 select-none object-cover"),
			]),
		],
	)

/** Marks an overlay that legacy portals from inside the message list (React tree, not DOM). */
export const LIST_PORTAL_ATTRIBUTE = "list-portal"

/** An embed image's title and description (embed markdown), under it; a long one scrolls. */
const captionView = <M>(h: HtmlBuilder<M>, caption: ImageViewerImage["caption"]): Html =>
	caption?.title || caption?.description
		? h.div(
				[
					h.Class("mt-3 max-h-[12vh] max-w-xl shrink-0 overflow-y-auto text-center"),
					h.DataAttribute("viewer-caption", ""),
				],
				[
					caption.title
						? h.p(
								[h.Class("font-medium text-sm text-white")],
								[embedMarkdownView(h, caption.title)],
							)
						: h.empty,
					caption.description
						? h.p(
								[h.Class("mt-0.5 text-white/60 text-xs")],
								[embedMarkdownView(h, caption.description)],
							)
						: h.empty,
				],
			)
		: h.empty

/**
 * In Rune, which runs none of the gestures: a press beside the image closes, one on it does
 * nothing (Rune presses the innermost element with a handler).
 */
interface NativePresses<M> {
	readonly beside: M
	readonly onImage: M
}

type TriggerRender = (attributes: ReadonlyArray<ChildAttribute>, overlay: Html) => Html

/** An item of the open image's menu: its icon and its label. */
const viewerMenuContent =
	<M>(h: HtmlBuilder<M>) =>
	(key: string): ReadonlyArray<Html> => {
		const label = VIEWER_MENU_ITEMS.find(([action]) => action === key)?.[1] ?? key
		const slot = { attributes: { "data-slot": "icon" } }
		const icon =
			key === "copyImage"
				? IconImage(h, slot)
				: key === "download"
					? IconDownload(h, slot)
					: key === "copyUrl"
						? IconLink(h, slot)
						: IconExternalLink(h, slot)
		return [icon, menuLabel(h, VIEWER_MENU_ID, key, label)]
	}

/**
 * A slide fills the viewer; the image rests in its padded box, and the box around it is backdrop
 * (a tap there closes). Only slides near the open one mount their image.
 */
const slideView = <M>(
	h: HtmlBuilder<M>,
	image: ImageViewerImage,
	index: number,
	selectedIndex: number,
	count: number,
	native?: NativePresses<M>,
): Html => {
	const isNative = native !== undefined
	const isActive = index === selectedIndex
	return h.keyed("div")(
		image.id,
		[
			h.Class(
				// One slide at a time in Rune, which sizes no `flex-basis: 100%`: pinned to the edges.
				isNative
					? "absolute inset-0 box-border flex flex-col items-center"
					: "relative box-border flex h-full min-w-full flex-[0_0_100%] flex-col items-center",
			),
			h.DataAttribute("viewer-slide", ""),
			h.Role("group"),
			h.AriaRoleDescription("slide"),
			h.AriaLabel(`${index + 1} of ${count}`),
			...(isActive ? [h.DataAttribute("active", "")] : [h.AriaHidden(true)]),
		],
		Math.abs(index - selectedIndex) > PRELOAD
			? []
			: [
					h.div(
						[
							h.Class("flex min-h-0 w-full flex-1 items-center justify-center"),
							h.DataAttribute("viewer-zoom", ""),
							...(native ? [h.OnClick(native.beside)] : []),
						],
						[
							h.img([
								h.Attribute("src", image.url),
								h.Attribute("alt", image.fileName),
								h.Draggable(false),
								// The opening frame is a snapshot: the bitmap has to be in it.
								h.Attribute("decoding", "sync"),
								h.DataAttribute("viewer-media", ""),
								...(isActive ? [h.DataAttribute("active", "")] : []),
								...(native ? [h.OnClick(native.onImage)] : []),
								// Rune sizes it to the picture fitted in its box (`natural_box`), so the
								// box around it is left to close the viewer.
								h.Class(
									"block h-auto max-h-full w-auto min-w-0 max-w-full select-none rounded-md object-contain",
								),
							]),
						],
					),
					captionView(h, image.caption),
				],
	)
}

/** What a screen reader hears on each image: its position and name, and the caption's title. */
const announcement = (image: ImageViewerImage | undefined, index: number, count: number): string =>
	image === undefined
		? ""
		: `${count > 1 ? `${index + 1} of ${count}. ` : ""}${image.caption?.title || image.fileName}`

export const imageViewerView = <M>(h: HtmlBuilder<M>, inputs: ImageViewerInputs<M>): Html => {
	const { images, author } = inputs
	const selectedIndex = Math.min(Math.max(inputs.index, 0), Math.max(images.length - 1, 0))
	const current = images[selectedIndex]
	const hasMany = images.length > 1
	// Rune runs none of the DOM gestures: one slide at a time, chosen by the Model alone.
	const isNative = isNativeRenderer()
	const select = (index: number) =>
		inputs.toSelect(Math.min(Math.max(index, 0), Math.max(images.length - 1, 0)))
	const act = (action: ImageViewerAction) =>
		inputs.toAction && current ? inputs.toAction(action, current) : undefined
	const actions: ReadonlyArray<readonly [M | undefined, string, Html, ("in" | "out")?]> = [
		// Zoom is the gestures' to do, which Rune does not run.
		...(isNative
			? []
			: ([
					[undefined, "Zoom out", IconMinus(h, { className: "size-4" }), "out"],
					[undefined, "Zoom in", IconPlus(h, { className: "size-4" }), "in"],
				] as const)),
		[act("download"), "Download", IconDownload(h, { className: "size-4" })],
		[act("copyImage"), "Copy image", IconImage(h, { className: "size-4" })],
		[act("copyUrl"), "Copy image URL", IconLink(h, { className: "size-4" })],
		[act("openInBrowser"), "Open in browser", IconExternalLink(h, { className: "size-4" })],
		[inputs.toClose(), "Close", IconClose(h, { className: "size-4" })],
	]
	const menuInputs = inputs.menu
	const menu =
		menuInputs === undefined || current === undefined
			? undefined
			: (toTrigger: TriggerRender) =>
					h.submodel({
						slotId: VIEWER_MENU_ID,
						model: menuInputs.model,
						view: contextMenuView,
						viewInputs: {
							entries: viewerMenuEntries,
							toTrigger,
							content: viewerMenuContent(h),
							className: "min-w-52",
							// Above the viewer, which sits over everything else.
							popoverClassName: "z-10000",
						},
						toParentMessage: menuInputs.toMessage,
					})
	// The trigger is the viewer's content, which stays put while slides come and go; a right click
	// beside the image never reaches it (`ImageViewerMount`). Rune runs no DOM Mounts.
	const withMenu = (render: TriggerRender) =>
		menu === undefined || isNative ? render([], h.empty) : menu(render)
	const toMessage = (intent: Intent) =>
		Intent.match(intent, {
			PressedClose: () => inputs.toClose(),
			PressedSelect: ({ index }) => select(index),
			Swiped: ({ step }) => select(selectedIndex + step),
		})
	return h.div(
		[
			h.Class("fixed inset-0 isolate z-9999"),
			h.Attribute(VIEWER_ATTRIBUTE, ""),
			// Legacy renders the viewer through a React portal inside the message list, so React's
			// pointerleave never sees the pointer leave the list for it. Hover tracking reads this.
			h.DataAttribute(LIST_PORTAL_ATTRIBUTE, ""),
			h.OnMount(Mount.mapMessage(isNative ? NativeImageViewerModal() : ImageViewerMount(), toMessage)),
		],
		[
			h.div([
				h.Class("absolute inset-0 bg-black/90"),
				// Thinned by a pull (`--viewer-pull-progress`), which only the browser's gestures make;
				// Rune draws the backdrop as it is.
				...(isNative ? [] : [h.DataAttribute("viewer-backdrop", "")]),
				h.AriaHidden(true),
			]),
			withMenu((attributes, overlay) =>
				h.div(
					[
						...attributes,
						h.Class("absolute inset-0 overflow-hidden outline-none"),
						h.DataAttribute("viewer-content", ""),
						h.Role("dialog"),
						h.AriaModal(true),
						h.AriaLabel(hasMany ? "Image gallery" : "Image viewer"),
						h.Tabindex(-1),
						...(isNative
							? [
									h.OnKeyDownPreventDefault((key) =>
										key === "ArrowLeft" || key === "ArrowUp"
											? Option.some(select(selectedIndex - 1))
											: key === "ArrowRight" || key === "ArrowDown"
												? Option.some(select(selectedIndex + 1))
												: key === "Home"
													? Option.some(select(0))
													: key === "End"
														? Option.some(select(images.length - 1))
														: Option.none(),
									),
								]
							: []),
					],
					[
						h.div(
							[
								h.Class("relative flex h-full w-full"),
								// The scroll-snap track is the browser's; in Rune it would be a bare
								// scroller the Model cannot move, so there only the open slide is drawn.
								...(isNative ? [] : [h.DataAttribute("viewer-slides", "")]),
								h.Attribute(SELECTED_ATTRIBUTE, String(selectedIndex)),
								h.Role("group"),
								h.AriaRoleDescription("carousel"),
								h.AriaLabel("Images"),
							],
							isNative
								? current === undefined
									? []
									: [
											slideView(
												h,
												current,
												selectedIndex,
												selectedIndex,
												images.length,
												{
													beside: inputs.toClose(),
													onImage: select(selectedIndex),
												},
											),
										]
								: images.map((image, index) =>
										slideView(h, image, index, selectedIndex, images.length),
									),
						),
						...(isNative && hasMany && systemUi()?.setSwipePager !== undefined
							? [
									// Remounted on every slide, so a swipe steps from the slide on view.
									h.keyed("span")(`swipe:${selectedIndex}`, [
										h.Class("hidden"),
										h.OnMount(Mount.mapMessage(NativeSwipePager(), toMessage)),
									]),
								]
							: []),
						h.div(
							[h.Class("sr-only"), h.AriaLive("polite"), h.AriaAtomic(true)],
							[announcement(current, selectedIndex, images.length)],
						),
						...(author
							? [
									h.div(
										[
											h.Class(
												"absolute top-5 left-5 flex items-center gap-2 max-md:top-[calc(env(safe-area-inset-top)+4rem)] max-md:left-3",
											),
											h.DataAttribute("viewer-chrome", ""),
											// Has no backing of its own, so a zoomed image would run under its text.
											h.DataAttribute("viewer-author", ""),
										],
										[
											avatar(h, {
												src: author.avatarUrl,
												alt: author.name,
												...(author.seed === undefined ? {} : { seed: author.seed }),
												size: "md",
											}),
											h.div(
												[h.Class("flex flex-col")],
												[
													h.span([h.Class("text-sm text-white")], [author.name]),
													h.span(
														[h.Class("text-muted-fg text-xs")],
														[new Date(inputs.createdAtMs).toLocaleString()],
													),
												],
											),
										],
									),
								]
							: []),
						...(hasMany
							? [
									isNative
										? // Rune keeps `left-1/2 -translate-x-1/2` centred at every width, so
											// on a phone the counter would sit on the author: a row places it.
											h.div(
												[
													h.Class(
														"pointer-events-none absolute inset-x-0 top-5 flex justify-center max-md:top-[calc(env(safe-area-inset-top)+4rem)] max-md:justify-end max-md:px-3",
													),
													h.DataAttribute("viewer-chrome", ""),
													h.AriaHidden(true),
												],
												[
													h.div(
														[
															h.Class(
																"rounded-md bg-black/50 px-3 py-1.5 text-sm text-white tabular-nums",
															),
														],
														[
															String(selectedIndex + 1),
															" of ",
															String(images.length),
														],
													),
												],
											)
										: h.div(
												[
													h.Class(
														"absolute top-5 left-1/2 -translate-x-1/2 rounded-md bg-black/50 px-3 py-1.5 text-sm text-white tabular-nums max-md:top-[calc(env(safe-area-inset-top)+4rem)] max-md:right-3 max-md:left-auto max-md:translate-x-0",
													),
													h.DataAttribute("viewer-chrome", ""),
													h.AriaHidden(true),
												],
												[String(selectedIndex + 1), " of ", String(images.length)],
											),
									navButton(h, "left", select(selectedIndex - 1), selectedIndex === 0),
									navButton(
										h,
										"right",
										select(selectedIndex + 1),
										selectedIndex === images.length - 1,
									),
								]
							: []),
						h.div(
							[
								h.Class(
									"absolute top-5 right-5 flex gap-1 rounded-md border border-white/10 bg-black/50 p-1 max-md:top-[calc(env(safe-area-inset-top)+0.75rem)] max-md:right-3",
								),
								h.DataAttribute("viewer-chrome", ""),
							],
							actions.map(([onPress, label, icon, zoomStep]) =>
								toolbarButton(h, onPress, label, icon, zoomStep),
							),
						),
						...(hasMany
							? [
									h.div(
										[
											h.Class(
												"pointer-events-none absolute inset-x-0 bottom-5 flex justify-center px-8 max-md:bottom-[calc(env(safe-area-inset-bottom)+1rem)] max-md:px-3",
											),
											h.DataAttribute("viewer-thumbs", ""),
											h.DataAttribute("viewer-chrome", ""),
										],
										[
											h.div(
												[
													// Embla drags the strip in a browser; Rune scrolls a
													// plain row sideways itself.
													h.Class(
														isNative
															? "pointer-events-auto flex max-w-2xl overflow-x-auto rounded-md"
															: "pointer-events-auto max-w-2xl overflow-hidden rounded-md",
													),
													h.Attribute(SELECTED_ATTRIBUTE, String(selectedIndex)),
													...(isNative
														? []
														: [
																h.OnMount(
																	Mount.mapMessage(
																		ThumbCarousel(),
																		toMessage,
																	),
																),
															]),
												],
												[
													h.div(
														// Centred in Rune's scroller, which is as wide as it may be.
														[
															h.Class(
																isNative
																	? "mx-auto flex gap-2"
																	: "flex gap-2",
															),
														],
														images.map((image, index) =>
															thumbView(
																h,
																image,
																index === selectedIndex,
																inputs.toSelect(index),
															),
														),
													),
												],
											),
										],
									),
								]
							: []),
						overlay,
					],
				),
			),
		],
	)
}

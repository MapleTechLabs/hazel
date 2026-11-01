import EmblaCarousel from "embla-carousel"
import { Effect, Queue, Schema, Stream } from "effect"
import { Mount } from "foldkit"
import type { Html, HtmlBuilder } from "foldkit/html"
import { defineMessageUnion } from "foldkit/message"
import {
	IconChevronLeft,
	IconChevronRight,
	IconClose,
	IconCopy,
	IconDownload,
	IconExternalLink,
} from "../icons"
import { avatar } from "../ui/avatar"
import { ariaButton, button } from "../ui/button"
import { portalOverlay } from "../ui/aria/overlay"
import type { ChatAttachmentView } from "./attachments"
import { embedMarkdownView } from "./embeds/embed-markdown"

/**
 * Port of `ImageViewerModal` (`components/chat/image-viewer-modal.tsx`) in its open state: a plain
 * `createPortal` to the end of `<body>`, no dialog role, no focus trap and no scroll lock.
 */

export type ImageViewerAction = "download" | "copyUrl" | "openInBrowser"

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
	/** Toolbar side effects (legacy downloads, copies the URL with a toast, or opens a tab). */
	readonly toAction?: (action: ImageViewerAction, image: ChatAttachmentView) => M
}

const Intent = defineMessageUnion({ PressedClose: {}, PressedSelect: { index: Schema.Number } })
type Intent = typeof Intent.Type

// The selected slide as the Model has it, which the carousels scroll to (embla owns their transforms).
const SELECTED_ATTRIBUTE = "data-selected-index"

const readSelected = (element: Element) => Number(element.getAttribute(SELECTED_ATTRIBUTE) ?? 0)

const NO_RELEASE = () => {}

/** Runs `follow(index)` whenever the view changes the selected index on `element`. */
const observeSelected = (element: Element, follow: (index: number) => void) => {
	const observer = new MutationObserver(() => follow(readSelected(element)))
	observer.observe(element, { attributes: true, attributeFilter: [SELECTED_ATTRIBUTE] })
	return observer
}

/**
 * The main carousel: vanilla embla on the viewport (`useEmblaCarousel({ startIndex, loop: false })`).
 * A swipe or drag selects a slide; a selection from the Model (arrows, thumbs, keys) scrolls to it.
 */
const MainCarousel = Mount.defineStream("ImageViewerMainCarousel", {
	messages: [Intent.PressedClose, Intent.PressedSelect],
	execute: ({ element }) =>
		Stream.callback<Intent>((queue) =>
			Effect.acquireRelease(
				Effect.sync(() => {
					if (!(element instanceof HTMLElement)) return NO_RELEASE
					const embla = EmblaCarousel(element, { startIndex: readSelected(element), loop: false })
					embla.on("select", () => {
						const index = embla.selectedScrollSnap()
						if (index !== readSelected(element))
							Queue.offerUnsafe(queue, Intent.PressedSelect({ index }))
					})
					const observer = observeSelected(element, (index) => {
						if (index !== embla.selectedScrollSnap()) embla.scrollTo(index)
					})
					// `imageViewer.prev` / `imageViewer.next`: embla moves at once, so fast repeats all count.
					const onKeyDown = (event: KeyboardEvent) => {
						if (event.key === "ArrowLeft") embla.scrollPrev()
						if (event.key === "ArrowRight") embla.scrollNext()
					}
					document.addEventListener("keydown", onKeyDown)
					return () => {
						document.removeEventListener("keydown", onKeyDown)
						observer.disconnect()
						embla.destroy()
					}
				}),
				(release) => Effect.sync(release),
			).pipe(Effect.flatMap(() => Effect.never)),
		),
})

/** The thumbnail strip (`containScroll: "keepSnaps"`, `dragFree`), kept on the selected slide. */
const ThumbCarousel = Mount.defineStream("ImageViewerThumbCarousel", {
	messages: [Intent.PressedClose, Intent.PressedSelect],
	execute: ({ element }) =>
		Stream.callback<Intent>(() =>
			Effect.acquireRelease(
				Effect.sync(() => {
					if (!(element instanceof HTMLElement)) return NO_RELEASE
					const embla = EmblaCarousel(element, { containScroll: "keepSnaps", dragFree: true })
					embla.scrollTo(readSelected(element))
					const observer = observeSelected(element, (index) => embla.scrollTo(index))
					return () => {
						observer.disconnect()
						embla.destroy()
					}
				}),
				(release) => Effect.sync(release),
			).pipe(Effect.flatMap(() => Effect.never)),
		),
})

// Marks what a click lands on without closing the viewer: the caption, header, counter, toolbar and thumbnails.
export const CONTENT_ATTRIBUTE = "image-viewer-content"

/** A click target on the backdrop, or on a slide around its image, rather than on the viewer's content. */
export const isBackdropTarget = (target: EventTarget | null) =>
	!(target instanceof Element) || target.closest(`img, button, [data-${CONTENT_ATTRIBUTE}]`) === null

// Embla's default `dragThreshold`: a press that moves further is a drag, not a click.
const DRAG_THRESHOLD = 10

export interface BackdropPoint {
	readonly target: EventTarget | null
	readonly x: number
	readonly y: number
}

/**
 * A press and release both on the backdrop, without a drag between them. Embla swallows the click of a
 * drag inside its viewport, but one that ends on an arrow clicks their common ancestor, outside it.
 */
export const isBackdropDismiss = (press: BackdropPoint | null, release: BackdropPoint) =>
	press !== null &&
	isBackdropTarget(press.target) &&
	isBackdropTarget(release.target) &&
	Math.hypot(release.x - press.x, release.y - press.y) < DRAG_THRESHOLD

const pointOf = (event: MouseEvent): BackdropPoint => ({
	target: event.target,
	x: event.clientX,
	y: event.clientY,
})

/** Portal + the Escape hotkey + backdrop click; the carousel owns the arrows (and swallows a drag's click). */
const ImageViewerPortal = Mount.defineStream("ImageViewerPortal", {
	messages: [Intent.PressedClose, Intent.PressedSelect],
	execute: ({ element }) =>
		Stream.callback<Intent>((queue) =>
			Effect.acquireRelease(
				Effect.sync(() => {
					const releasePortal = portalOverlay(element)
					const onKeyDown = (event: KeyboardEvent) => {
						if (event.key === "Escape") Queue.offerUnsafe(queue, Intent.PressedClose())
					}
					let press: BackdropPoint | null = null
					const onPointerDown = (event: Event) => {
						press = event instanceof MouseEvent ? pointOf(event) : null
					}
					const onClick = (event: Event) => {
						if (event instanceof MouseEvent && isBackdropDismiss(press, pointOf(event)))
							Queue.offerUnsafe(queue, Intent.PressedClose())
						press = null
					}
					document.addEventListener("keydown", onKeyDown)
					element.addEventListener("pointerdown", onPointerDown, true)
					element.addEventListener("click", onClick)
					return () => {
						document.removeEventListener("keydown", onKeyDown)
						element.removeEventListener("pointerdown", onPointerDown, true)
						element.removeEventListener("click", onClick)
						releasePortal()
					}
				}),
				(release) => Effect.sync(release),
			).pipe(Effect.flatMap(() => Effect.never)),
		),
})

const toolbarButton = <M>(h: HtmlBuilder<M>, onPress: M | undefined, label: string, icon: Html): Html =>
	// `TooltipTrigger` is a bare React Aria Button wrapping the action Button; the tooltip shows on hover only.
	ariaButton(h, {}, [
		button(
			h,
			{
				intent: "plain",
				size: "sq-sm",
				...(onPress === undefined ? {} : { onPress }),
				className: "text-white [--btn-overlay:rgb(255_255_255/0.1)]",
				attributes: [h.AriaLabel(label)],
			},
			[icon],
		),
	])

const navButton = <M>(h: HtmlBuilder<M>, side: "left" | "right", onPress: M): Html =>
	button(
		h,
		{
			intent: "plain",
			size: "sq-md",
			isCircle: true,
			onPress,
			className: `absolute top-1/2 ${side === "left" ? "left-4" : "right-4"} -translate-y-1/2 text-white [--btn-bg:rgb(0_0_0/0.5)] [--btn-overlay:rgb(0_0_0/0.7)]`,
			attributes: [h.AriaLabel(side === "left" ? "Previous image" : "Next image")],
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

const hasCaption = (image: ImageViewerImage) => !!(image.caption?.title || image.caption?.description)

/** An embed image's title and description (embed markdown), under it; a long one scrolls. */
const captionView = <M>(h: HtmlBuilder<M>, caption: ImageViewerImage["caption"]): Html =>
	caption?.title || caption?.description
		? h.div(
				[
					h.Class("max-h-[12vh] max-w-xl overflow-y-auto text-center"),
					h.DataAttribute(CONTENT_ATTRIBUTE, ""),
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

export const imageViewerView = <M>(h: HtmlBuilder<M>, inputs: ImageViewerInputs<M>): Html => {
	const { images, author } = inputs
	const selectedIndex = Math.min(Math.max(inputs.index, 0), Math.max(images.length - 1, 0))
	const current = images[selectedIndex]
	const hasMany = images.length > 1
	const act = (action: ImageViewerAction) =>
		inputs.toAction && current ? inputs.toAction(action, current) : undefined
	const actions: ReadonlyArray<readonly [M | undefined, string, Html]> = [
		[act("download"), "Download", IconDownload(h, { className: "size-4" })],
		[act("copyUrl"), "Copy image URL", IconCopy(h, { className: "size-4" })],
		[act("openInBrowser"), "Open in browser", IconExternalLink(h, { className: "size-4" })],
		[inputs.toClose(), "Close", IconClose(h, { className: "size-4" })],
	]
	const toMessage = (intent: Intent) =>
		intent._tag === "PressedClose" ? inputs.toClose() : inputs.toSelect(intent.index)
	const onMount = Mount.mapMessage(ImageViewerPortal(), toMessage)
	return h.div(
		[
			h.Class(
				"fixed inset-0 isolate z-9999 flex items-center justify-center bg-black/90 transition-opacity duration-200",
			),
			// Legacy renders the viewer through a React portal inside the message list, so React's
			// pointerleave never sees the pointer leave the list for it. Hover tracking reads this.
			h.DataAttribute(LIST_PORTAL_ATTRIBUTE, ""),
			h.OnMount(onMount),
		],
		[
			...(author
				? [
						h.div(
							[
								h.Class("absolute top-5 left-5 flex items-center gap-2"),
								h.DataAttribute(CONTENT_ATTRIBUTE, ""),
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
			h.div(
				[h.Class("relative mx-36 w-full max-w-[90vw]")],
				[
					h.div(
						[
							h.Class("overflow-hidden"),
							h.Attribute(SELECTED_ATTRIBUTE, String(selectedIndex)),
							h.OnMount(Mount.mapMessage(MainCarousel(), toMessage)),
						],
						[
							h.div(
								[h.Class("flex")],
								images.map((image) =>
									h.keyed("div")(
										image.id,
										[
											h.Class(
												"flex min-w-0 flex-[0_0_100%] flex-col items-center justify-center gap-3",
											),
										],
										[
											h.img([
												h.Attribute("src", image.url),
												h.Attribute("alt", image.fileName),
												h.Draggable(false),
												// A caption takes room under the image, clear of the thumbnail strip.
												h.Class(
													hasCaption(image)
														? "max-h-[55vh] max-w-full select-none rounded-md"
														: "max-h-[70vh] max-w-full select-none rounded-md",
												),
											]),
											captionView(h, image.caption),
										],
									),
								),
							),
						],
					),
					...(hasMany
						? [
								navButton(h, "left", inputs.toSelect(Math.max(selectedIndex - 1, 0))),
								navButton(
									h,
									"right",
									inputs.toSelect(Math.min(selectedIndex + 1, images.length - 1)),
								),
							]
						: []),
				],
			),
			...(hasMany
				? [
						h.div(
							[
								h.Class(
									"absolute top-5 left-1/2 -translate-x-1/2 rounded-md bg-black/50 px-3 py-1.5 text-sm text-white",
								),
								h.DataAttribute(CONTENT_ATTRIBUTE, ""),
							],
							[String(selectedIndex + 1), " of ", String(images.length)],
						),
					]
				: []),
			h.div(
				[
					h.Class(
						"absolute top-5 right-5 flex gap-1 rounded-md border border-white/10 bg-black/50 p-1",
					),
					h.DataAttribute(CONTENT_ATTRIBUTE, ""),
				],
				actions.map(([onPress, label, icon]) => toolbarButton(h, onPress, label, icon)),
			),
			...(hasMany
				? [
						h.div(
							[h.Class("absolute inset-x-0 bottom-5 flex justify-center px-8")],
							[
								h.div(
									[
										h.Class("max-w-2xl overflow-hidden rounded-md"),
										h.Attribute(SELECTED_ATTRIBUTE, String(selectedIndex)),
										h.DataAttribute(CONTENT_ATTRIBUTE, ""),
										h.OnMount(Mount.mapMessage(ThumbCarousel(), toMessage)),
									],
									[
										h.div(
											[h.Class("flex gap-2")],
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
		],
	)
}

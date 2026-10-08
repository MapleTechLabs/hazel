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

/**
 * Port of `ImageViewerModal` (`components/chat/image-viewer-modal.tsx`) in its open state: a plain
 * `createPortal` to the end of `<body>`, no dialog role, no focus trap and no scroll lock.
 */

export type ImageViewerAction = "download" | "copyUrl" | "openInBrowser"

export interface ImageViewerInputs<M> {
	readonly images: ReadonlyArray<ChatAttachmentView>
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
						if (index !== readSelected(element)) Queue.offerUnsafe(queue, Intent.PressedSelect({ index }))
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

/** Portal + the Escape hotkey + backdrop click (`target === currentTarget`); the carousel owns the arrows. */
const ImageViewerPortal = Mount.defineStream("ImageViewerPortal", {
	messages: [Intent.PressedClose, Intent.PressedSelect],
	execute: ({ element }) =>
		Stream.callback<Intent>((queue) =>
			Effect.acquireRelease(
				Effect.sync(() => {
					const releasePortal = portalOverlay(element, { isModal: false })
					const onKeyDown = (event: KeyboardEvent) => {
						if (event.key === "Escape") Queue.offerUnsafe(queue, Intent.PressedClose())
					}
					const onClick = (event: Event) => {
						if (event.target === event.currentTarget)
							Queue.offerUnsafe(queue, Intent.PressedClose())
					}
					document.addEventListener("keydown", onKeyDown)
					element.addEventListener("click", onClick)
					return () => {
						document.removeEventListener("keydown", onKeyDown)
						element.removeEventListener("click", onClick)
						releasePortal()
					}
				}),
				(release) => Effect.sync(release),
			).pipe(Effect.flatMap(() => Effect.never)),
		),
})

const toolbarButton = <M>(h: HtmlBuilder<M>, onPress: M | undefined, icon: Html): Html =>
	// `TooltipTrigger` is a bare React Aria Button wrapping the action Button; the tooltip shows on hover only.
	ariaButton(h, { className: "react-aria-Button" }, [
		button(
			h,
			{
				intent: "plain",
				size: "sq-sm",
				...(onPress === undefined ? {} : { onPress }),
				className: "text-white hover:bg-white/10",
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
			className: `absolute top-1/2 ${side === "left" ? "left-4" : "right-4"} -translate-y-1/2 bg-black/50 text-white hover:bg-black/70`,
			attributes: [h.AriaLabel(side === "left" ? "Previous image" : "Next image")],
		},
		[
			side === "left"
				? IconChevronLeft(h, { className: "size-6" })
				: IconChevronRight(h, { className: "size-6" }),
		],
	)

/** Marks an overlay that legacy portals from inside the message list (React tree, not DOM). */
export const LIST_PORTAL_ATTRIBUTE = "list-portal"

export const imageViewerView = <M>(h: HtmlBuilder<M>, inputs: ImageViewerInputs<M>): Html => {
	const { images, author } = inputs
	const selectedIndex = Math.min(Math.max(inputs.index, 0), Math.max(images.length - 1, 0))
	const current = images[selectedIndex]
	const hasMany = images.length > 1
	const act = (action: ImageViewerAction) =>
		inputs.toAction && current ? inputs.toAction(action, current) : undefined
	const actions: ReadonlyArray<readonly [M | undefined, Html]> = [
		[act("download"), IconDownload(h, { className: "size-4" })],
		[act("copyUrl"), IconCopy(h, { className: "size-4" })],
		[act("openInBrowser"), IconExternalLink(h, { className: "size-4" })],
		[inputs.toClose(), IconClose(h, { className: "size-4" })],
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
							[h.Class("absolute top-5 left-5 flex items-center gap-2")],
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
										[h.Class("flex min-w-0 flex-[0_0_100%] items-center justify-center")],
										[
											h.img([
												h.Attribute("src", image.url),
												h.Attribute("alt", image.fileName),
												h.Class("max-h-[70vh] max-w-full rounded-md"),
											]),
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
				],
				actions.map(([onPress, icon]) => toolbarButton(h, onPress, icon)),
			),
			...(hasMany
				? [
						h.div(
							[h.Class("absolute bottom-5 left-1/2 w-full max-w-2xl -translate-x-1/2 px-8")],
							[
								h.div(
									[
										h.Class("overflow-hidden rounded-md"),
										h.Attribute(SELECTED_ATTRIBUTE, String(selectedIndex)),
										h.OnMount(Mount.mapMessage(ThumbCarousel(), toMessage)),
									],
									[
										h.div(
											[h.Class("flex gap-2")],
											images.map((image, index) =>
												button(
													h,
													{
														intent: "plain",
														onPress: inputs.toSelect(index),
														className: `relative min-w-0 flex-[0_0_80px] overflow-hidden rounded border-2 p-0 transition-all ${
															index === selectedIndex
																? "border-white opacity-100"
																: "border-transparent opacity-50 hover:opacity-75"
														}`,
													},
													[
														h.img([
															h.Attribute("src", image.url),
															h.Attribute("alt", image.fileName),
															h.Class("h-16 w-20 object-cover"),
														]),
													],
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

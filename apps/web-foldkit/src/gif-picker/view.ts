import { Effect, Queue, Stream } from "effect"
import { Mount } from "foldkit"
import type { ChildAttribute, Html, HtmlBuilder } from "foldkit/html"
import { pickerPopover } from "../picker-popover/popover"
import { loader } from "../ui/loader"
import { searchField, searchFieldIds } from "../ui/search-field"
import { Message, type Model } from "./picker"

/** `GifPickerContent`: search, category chips, the GIF grid and the KLIPY attribution. */

type ScrollMessage = typeof Message.ScrolledNearEnd.Type

/** `GridListLoadMoreItem` with `scrollOffset={0.5}`: half a viewport from the end loads more. */
const TrackGifScroll = Mount.defineStream("TrackGifScroll", {
	messages: [Message.ScrolledNearEnd],
	execute: ({ element }) =>
		Stream.callback<ScrollMessage>((queue) =>
			Effect.acquireRelease(
				Effect.sync(() => {
					const onScroll = () => {
						if (element.scrollTop + element.clientHeight >= element.scrollHeight - element.clientHeight * 0.5)
							Queue.offerUnsafe(queue, Message.ScrolledNearEnd())
					}
					element.addEventListener("scroll", onScroll, { passive: true })
					return () => element.removeEventListener("scroll", onScroll)
				}),
				(release) => Effect.sync(release),
			).pipe(Effect.flatMap(() => Effect.never)),
		),
})

/** `SearchField autoFocus` focuses the input once it is in the popover. */
const FocusGifSearch = Mount.define("FocusGifSearch", {
	messages: [Message.CompletedFocusGifSearch],
	execute: ({ element }) =>
		Effect.sync(() => {
			requestAnimationFrame(() => element.querySelector("input")?.focus())
			return Message.CompletedFocusGifSearch()
		}),
})

const categoryChips = <M>(h: HtmlBuilder<M>, model: Model, toMessage: (message: Message) => M): Html =>
	model.categories.length === 0
		? h.empty
		: h.div(
				[h.Class("flex gap-1.5 overflow-x-auto px-3 pb-2 scrollbar-none")],
				model.categories.slice(0, 12).map((category) =>
					h.keyed("button")(
						category.query,
						[
							h.Attribute("type", "button"),
							h.Attribute("data-rac", ""),
							h.Attribute("data-react-aria-pressable", "true"),
							h.Attribute("tabindex", "0"),
							h.OnClick(toMessage(Message.ClickedCategory({ category: category.category }))),
							h.Class(
								`shrink-0 outline-none rounded-full border px-2.5 py-0.5 text-xs transition-colors ${
									model.selectedCategory === category.category
										? "border-primary bg-primary text-on-primary"
										: "border-fg/10 bg-muted/40 text-muted-fg hover:border-fg/20 hover:bg-muted hover:text-fg"
								}`,
							),
						],
						[category.category],
					),
				),
			)

const emptyRow = <M>(h: HtmlBuilder<M>, content: Html | string): Html =>
	h.div(
		[h.Role("row")],
		[h.div([h.Role("gridcell"), h.Attribute("aria-colindex", "1")], [h.div([h.Class("absolute inset-0 flex items-center justify-center")], [content])])],
	)

/** `GifPickerGrid` (a React Aria GridList in grid layout). */
const grid = <M>(h: HtmlBuilder<M>, model: Model, toMessage: (message: Message) => M): Html =>
	h.div(
		[
			h.Role("grid"),
			h.Attribute("aria-label", "GIF results"),
			h.Attribute("data-rac", ""),
			h.Attribute("data-layout", "grid"),
			h.Attribute("tabindex", "0"),
			h.Class("flex-1 columns-2 gap-2 overflow-y-auto overflow-x-hidden px-3 scrollbar-thin relative"),
			h.OnMount(Mount.mapMessage(TrackGifScroll(), toMessage)),
		],
		model.gifs.length === 0
			? [emptyRow(h, model.isLoading ? loader(h) : "No GIFs found")]
			: [
					...model.gifs.map((gif) =>
						h.keyed("div")(
							gif.slug,
							[
								h.Role("row"),
								h.Attribute("data-rac", ""),
								h.Attribute("tabindex", "-1"),
								h.Class(
									"relative mb-2 cursor-pointer break-inside-avoid overflow-hidden rounded-md bg-muted/60 outline-none transition-all hover:opacity-90 focus-visible:ring-2 focus-visible:ring-primary ",
								),
								h.Attribute("style", `aspect-ratio: ${gif.width} / ${gif.height};`),
								h.OnClick(toMessage(Message.ClickedGif({ slug: gif.slug }))),
								h.OnMouseEnter(toMessage(Message.HoveredGif({ slug: gif.slug }))),
								h.OnMouseLeave(toMessage(Message.HoveredGif({ slug: null }))),
							],
							[
								h.div(
									[h.Role("gridcell"), h.Attribute("aria-colindex", "1")],
									[
										h.img([
											h.Attribute("src", model.hoveredSlug === gif.slug ? gif.webpUrl : gif.jpgUrl),
											h.Attribute("alt", gif.title),
											h.Class("h-full w-full object-cover"),
											h.Attribute("loading", "lazy"),
											h.Attribute("draggable", "false"),
										]),
									],
								),
							],
						),
					),
					h.div(
						[h.Class(model.isLoadingMore ? "flex justify-center py-4" : "h-0")],
						model.isLoadingMore
							? [h.div([h.Class("size-5 animate-spin rounded-full border-2 border-fg/20 border-t-fg/60")])]
							: [],
					),
				],
	)

const content = <M>(h: HtmlBuilder<M>, model: Model, toMessage: (message: Message) => M): Html =>
	h.div(
		[h.Class("flex h-[420px] w-[400px] flex-col overflow-hidden rounded-lg border border-fg/15 bg-overlay shadow-lg")],
		[
			h.div(
				[h.Class("px-3 pt-3 pb-2"), h.OnMount(Mount.mapMessage(FocusGifSearch(), toMessage))],
				[
					searchField(
						h,
						{
							id: `${model.id}-search`,
							value: model.query,
							onInput: (query) => toMessage(Message.UpdatedQuery({ query })),
							onClear: toMessage(Message.UpdatedQuery({ query: "" })),
							ariaLabel: "Search GIFs",
						},
						(parts) => [parts.searchInput({ placeholder: "Search KLIPY" })],
					),
				],
			),
			model.query === "" ? categoryChips(h, model, toMessage) : h.empty,
			grid(h, model, toMessage),
			h.div(
				[h.Class("flex items-center justify-end border-t border-fg/10 px-3 py-1.5")],
				[
					h.a(
						[
							h.Attribute("href", "https://klipy.com"),
							h.Attribute("target", "_blank"),
							h.Attribute("rel", "noopener noreferrer"),
							h.Class("text-[10px] font-medium text-muted-fg transition-colors hover:text-fg"),
						],
						["Powered by KLIPY"],
					),
				],
			),
		],
	)

export const searchInputId = (model: Model) => searchFieldIds(`${model.id}-search`).input

export const view = <M>(
	h: HtmlBuilder<M>,
	model: Model,
	inputs: {
		readonly toMessage: (message: Message) => M
		readonly toTrigger: (attributes: ReadonlyArray<ChildAttribute>, overlay: Html) => Html
	},
): Html =>
	pickerPopover(h, {
		id: model.id,
		isOpen: model.isOpen,
		ariaLabel: "GIF picker",
		toMessage: (event) => inputs.toMessage(Message.GotPopoverEvent({ event })),
		toTrigger: inputs.toTrigger,
		content: () => [content(h, model, inputs.toMessage)],
	})

import { Effect, Match, Queue, Stream } from "effect"
import { AsyncData, Mount } from "foldkit"
import type { ChildAttribute, Html, HtmlBuilder } from "foldkit/html"
import { failureMessage } from "~/lib/error-messages"
import { pickerPopover } from "../picker-popover/popover"
import { button } from "../ui/button"
import { loader } from "../ui/loader"
import { searchField } from "../ui/search-field"
import { type Gif, type GifFailure, type GifPage, Message, type Model } from "./picker"

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
						if (
							element.scrollTop + element.clientHeight >=
							element.scrollHeight - element.clientHeight * 0.5
						)
							Queue.offerUnsafe(queue, Message.ScrolledNearEnd())
					}
					element.addEventListener("scroll", onScroll, { passive: true })
					return () => element.removeEventListener("scroll", onScroll)
				}),
				(release) => Effect.sync(release),
			).pipe(Effect.flatMap(() => Effect.never)),
		),
})

const failureCopy = (reason: GifFailure) =>
	failureMessage(reason, {
		ProviderFailed: {
			title: "GIFs are unavailable",
			description: "KLIPY didn't respond. Please try again.",
		},
	})

const retryButton = <M>(h: HtmlBuilder<M>, onPress: M): Html =>
	button(h, { intent: "outline", size: "sm", onPress }, ["Try again"])

const categoryChips = <M>(h: HtmlBuilder<M>, model: Model, toMessage: (message: Message) => M): Html =>
	AsyncData.matchData(model.categories, {
		onEmpty: () => h.empty,
		// The chips are a shortcut; without them search still works, so the failure stays small.
		onFailure: () =>
			h.div(
				[
					h.Class("flex items-center gap-2 px-3 pb-2 text-muted-fg text-xs"),
					h.Attribute("data-slot", "gif-categories-error"),
				],
				[
					"Couldn't load categories.",
					h.button(
						[
							h.Attribute("type", "button"),
							h.Class(
								"rounded-sm font-medium text-fg underline-offset-2 outline-none hover:underline focus-visible:ring-2 focus-visible:ring-primary",
							),
							h.OnClick(toMessage(Message.ClickedRetryFetchCategories())),
						],
						["Try again"],
					),
				],
			),
		onData: (categories) =>
			categories.length === 0
				? h.empty
				: h.div(
						[h.Class("flex gap-1.5 overflow-x-auto px-3 pb-2 scrollbar-none")],
						categories
							.slice(0, 12)
							.map((category) =>
								h.keyed("button")(
									category.query,
									[
										h.Attribute("type", "button"),
										h.Attribute(
											"aria-pressed",
											model.selectedCategory === category.category ? "true" : "false",
										),
										h.OnClick(
											toMessage(
												Message.ClickedCategory({ category: category.category }),
											),
										),
										h.Class(
											`shrink-0 outline-none rounded-full border px-2.5 py-0.5 text-xs transition-colors focus-visible:ring-2 focus-visible:ring-primary ${
												model.selectedCategory === category.category
													? "border-primary bg-primary text-on-primary"
													: "border-fg/10 bg-muted/40 text-muted-fg hover:border-fg/20 hover:bg-muted hover:text-fg"
											}`,
										),
									],
									[category.category],
								),
							),
					),
	})

const centered = <M>(h: HtmlBuilder<M>, content: ReadonlyArray<Html | string>): Html =>
	h.div(
		[h.Class("absolute inset-0 flex flex-col items-center justify-center gap-3 px-6 text-center")],
		content,
	)

const failureState = <M>(h: HtmlBuilder<M>, reason: GifFailure, toMessage: (message: Message) => M): Html => {
	const copy = failureCopy(reason)
	return h.div(
		[h.Role("alert"), h.Attribute("data-slot", "gif-picker-error")],
		[
			centered(h, [
				h.div(
					[h.Class("flex flex-col gap-1")],
					[
						h.span([h.Class("font-medium text-fg text-sm")], [copy.title]),
						copy.description === undefined
							? h.empty
							: h.span([h.Class("text-muted-fg text-xs")], [copy.description]),
					],
				),
				retryButton(h, toMessage(Message.ClickedRetryFetchGifs())),
			]),
		],
	)
}

/** One GIF: a real button (Tab reaches it, Enter and Space pick it), animating while hovered or focused. */
const gifButton = <M>(h: HtmlBuilder<M>, model: Model, gif: Gif, toMessage: (message: Message) => M): Html =>
	h.keyed("li")(
		gif.slug,
		[h.Class("mb-2 break-inside-avoid")],
		[
			h.button(
				[
					h.Attribute("type", "button"),
					h.AriaLabel(gif.title || "GIF"),
					h.Class(
						"relative block w-full cursor-pointer overflow-hidden rounded-md bg-muted/60 outline-none transition-all hover:opacity-90 focus-visible:ring-2 focus-visible:ring-primary",
					),
					h.Attribute("style", `aspect-ratio: ${gif.width} / ${gif.height};`),
					h.OnClick(toMessage(Message.ClickedGif({ slug: gif.slug }))),
					h.OnMouseEnter(toMessage(Message.HoveredGif({ slug: gif.slug }))),
					h.OnMouseLeave(toMessage(Message.HoveredGif({ slug: null }))),
					h.OnFocus(toMessage(Message.HoveredGif({ slug: gif.slug }))),
					h.OnBlur(toMessage(Message.HoveredGif({ slug: null }))),
				],
				[
					h.img([
						h.Attribute("src", model.hoveredSlug === gif.slug ? gif.webpUrl : gif.jpgUrl),
						h.Attribute("alt", ""),
						h.Class("h-full w-full object-cover"),
						h.Attribute("loading", "lazy"),
						h.Attribute("draggable", "false"),
					]),
				],
			),
		],
	)

/** The pager under the GIFs: a spinner while the next page loads, its failure with a retry. */
const moreFooter = <M>(h: HtmlBuilder<M>, model: Model, toMessage: (message: Message) => M): Html =>
	Match.valueTags(model.more, {
		Idle: () => h.empty,
		Exhausted: () => h.empty,
		Loading: () =>
			h.div(
				[h.Class("flex justify-center py-4")],
				[h.div([h.Class("size-5 animate-spin rounded-full border-2 border-fg/20 border-t-fg/60")])],
			),
		Failed: ({ reason }) =>
			h.div(
				[h.Class("flex flex-col items-center gap-2 py-4 text-muted-fg text-xs"), h.Role("alert")],
				[failureCopy(reason).title, retryButton(h, toMessage(Message.ClickedRetryFetchGifs()))],
			),
	})

const gifList = <M>(
	h: HtmlBuilder<M>,
	model: Model,
	page: GifPage,
	toMessage: (message: Message) => M,
): ReadonlyArray<Html> =>
	page.gifs.length === 0
		? [centered(h, ["No GIFs found"])]
		: [
				h.ul(
					[h.Class("columns-2 gap-2"), h.AriaLabel("GIF results")],
					page.gifs.map((gif) => gifButton(h, model, gif, toMessage)),
				),
				moreFooter(h, model, toMessage),
			]

/** `GifPickerGrid`: the results, or their loading or failure state. */
const results = <M>(h: HtmlBuilder<M>, model: Model, toMessage: (message: Message) => M): Html =>
	h.div(
		[
			h.Class("relative flex-1 overflow-y-auto overflow-x-hidden px-3 scrollbar-thin"),
			h.Attribute("aria-busy", AsyncData.isPending(model.results) ? "true" : "false"),
			h.OnMount(Mount.mapMessage(TrackGifScroll(), toMessage)),
		],
		AsyncData.matchData(model.results, {
			onEmpty: () => [centered(h, [loader(h)])],
			onFailure: (reason) => [failureState(h, reason, toMessage)],
			onData: (page) => gifList(h, model, page, toMessage),
		}),
	)

const content = <M>(h: HtmlBuilder<M>, model: Model, toMessage: (message: Message) => M): Html =>
	h.div(
		[
			h.Class(
				"flex h-[420px] w-[400px] flex-col overflow-hidden rounded-lg border border-fg/15 bg-overlay shadow-lg",
			),
		],
		[
			h.div(
				[h.Class("px-3 pt-3 pb-2")],
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
			results(h, model, toMessage),
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
		toMessage: (event) => inputs.toMessage(Message.ReceivedPopoverEvent({ event })),
		toTrigger: inputs.toTrigger,
		content: () => [content(h, model, inputs.toMessage)],
	})

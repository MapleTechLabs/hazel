import { createLazy, type Html, type HtmlBuilder } from "foldkit/html"
import { twMerge } from "tailwind-merge"
import { contentStyles, rootStyles } from "~/components/ui/split-panel/split-panel.styles"
import { cx } from "~/utils/cx"
import { IconFolders, IconHashtag, IconMsgs, IconPin } from "../../icons"
import * as MessageList from "../../mount/message-list"
import { button } from "../../ui/button"
import { composerPlaceholderView } from "./composer-placeholder"
import { dateDividerView, messageRowView } from "./message-view"
import { Message, type Model } from "./page"
import type { DisplayRow } from "./rows"

/** The channel route's content: header, tab bar, message list and composer (desktop). */

/** `ChatHeader` for a regular channel. */
const chatHeaderView = <M>(channel: Model["channel"], h: HtmlBuilder<M>): Html =>
	h.div(
		[h.Class("flex h-14 shrink-0 items-center justify-between border-border border-b bg-bg px-4")],
		[
			h.div(
				[h.Class("flex items-center gap-3")],
				channel === null
					? [h.div([h.Class("h-4 w-32 animate-pulse rounded-sm bg-secondary")], [])]
					: [
							channel.icon
								? h.span(
										[h.Attribute("data-slot", "icon"), h.Class("size-5 text-muted-fg")],
										[channel.icon],
									)
								: IconHashtag(h, { className: "size-5 text-muted-fg" }),
							h.div(
								[h.Class("flex items-center gap-2")],
								[h.h2([h.Class("font-semibold text-fg text-sm")], [channel.name])],
							),
						],
			),
			h.div(
				[h.Class("flex items-center gap-2")],
				[
					button(
						h,
						{
							intent: "plain",
							size: "sm",
							attributes: [
								h.Attribute("aria-expanded", "false"),
								h.Attribute("aria-label", "View pinned messages"),
							],
						},
						[IconPin(h, { attributes: { "data-slot": "icon" } })],
					),
				],
			),
		],
	)

/** `Tab` from `components/ui/tabs.tsx`, horizontal orientation. */
const tabView = <M>(
	h: HtmlBuilder<M>,
	options: { id: string; label: string; icon: Html; isSelected: boolean },
) =>
	h.div(
		[
			...(options.isSelected
				? [h.Attribute("aria-selected", "true"), h.Attribute("data-selected", "true")]
				: [h.Attribute("aria-selected", "false")]),
			h.Class(
				twMerge(
					twMerge(
						"group/tab rounded-lg [--tab-gutter:var(--tab-gutter-x)]",
						"[--tab-gutter-x:--spacing(2.5)] [--tab-gutter-y:--spacing(1)] first:-ml-(--tab-gutter) last:-mr-(--tab-gutter)",
						"relative isolate flex cursor-default items-center whitespace-nowrap font-medium text-sm/6 outline-hidden transition",
						"px-(--tab-gutter-x) py-(--tab-gutter-y)",
						"*:data-[slot=icon]:mr-2 *:data-[slot=icon]:-ml-0.5 *:data-[slot=icon]:size-4 *:data-[slot=icon]:shrink-0 *:data-[slot=icon]:self-center *:data-[slot=icon]:text-muted-fg selected:*:data-[slot=icon]:text-primary-subtle-fg",
						"selected:text-primary-subtle-fg text-muted-fg hover:bg-secondary selected:hover:bg-primary-subtle hover:text-fg selected:hover:text-primary-subtle-fg focus:ring-0",
						"disabled:opacity-50",
						"cursor-default",
					),
				),
			),
			h.Attribute("data-key", options.id),
			h.Attribute("data-rac", ""),
			h.Attribute("data-react-aria-pressable", "true"),
			h.Attribute("data-slot", "tab"),
			h.Attribute("role", "tab"),
			h.Attribute("tabindex", options.isSelected ? "0" : "-1"),
		],
		[
			options.icon,
			options.label,
			...(options.isSelected
				? [
						h.div(
							[
								h.Class(
									twMerge(
										"absolute bg-primary-subtle-fg transition-[translate,width,height] duration-200",
										"right-(--tab-gutter-x) -bottom-[calc(var(--tab-gutter-y)+1px)] left-(--tab-gutter-x) h-[2px]",
									),
								),
								h.Attribute("data-rac", ""),
								h.Attribute("data-slot", "selected-indicator"),
							],
							[],
						),
					]
				: []),
		],
	)

/** `ChatTabBar`: Messages and Files. */
const chatTabBarView = <M>(h: HtmlBuilder<M>): Html =>
	h.div(
		[
			h.Class(cx("flex-col", "group/tabs flex gap-4 forced-color-adjust-none")),
			h.Attribute("data-orientation", "horizontal"),
			h.Attribute("data-rac", ""),
		],
		[
			h.div(
				[
					h.Attribute("aria-orientation", "horizontal"),
					h.Class(
						twMerge([
							"[--tab-list-gutter:--spacing(1)]",
							"relative flex forced-color-adjust-none",
							"flex-row gap-x-(--tab-list-gutter) rounded-(--tab-list-rounded) border-b py-(--tab-list-gutter)",
							"px-4",
						]),
					),
					h.Attribute("data-orientation", "horizontal"),
					h.Attribute("data-rac", ""),
					h.Attribute("data-slot", "tab-list"),
					h.Attribute("role", "tablist"),
				],
				[
					tabView(h, {
						id: "messages",
						label: "Messages",
						icon: IconMsgs(h, { className: "size-4", attributes: { "data-slot": "icon" } }),
						isSelected: true,
					}),
					tabView(h, {
						id: "files",
						label: "Files",
						icon: IconFolders(h, { className: "size-4", attributes: { "data-slot": "icon" } }),
						isSelected: false,
					}),
				],
			),
		],
	)

/** One memo slot per rendered row; slots of rows that scroll away are dropped. */
const rowSlots = new Map<string, ReturnType<typeof createLazy>>()
const renderedThisFrame = new Set<string>()
const MAX_IDLE_SLOTS = 200

const rowView = <M>(row: DisplayRow, isStuck: boolean, h: HtmlBuilder<M>): Html =>
	row._tag === "DateHeader" ? dateDividerView(h, row.label, isStuck) : messageRowView(h, row)

const memoRow = <M>(h: HtmlBuilder<M>, row: DisplayRow, isStuck: boolean): Html => {
	let slot = rowSlots.get(row.key)
	if (slot === undefined) rowSlots.set(row.key, (slot = createLazy()))
	renderedThisFrame.add(row.key)
	return slot(rowView, [row, isStuck, h]) ?? h.div([], [])
}

const pruneRowSlots = () => {
	if (rowSlots.size > renderedThisFrame.size + MAX_IDLE_SLOTS)
		for (const key of rowSlots.keys()) if (!renderedThisFrame.has(key)) rowSlots.delete(key)
	renderedThisFrame.clear()
}

/** `MessageList`'s empty state. */
const emptyStateView = <M>(h: HtmlBuilder<M>): Html =>
	h.div(
		[h.Class("flex size-full flex-col items-center justify-center p-4 sm:p-8")],
		[
			h.div(
				[h.Class("relative aspect-square w-full max-w-sm")],
				[
					h.img([
						h.Attribute("src", "/images/squirrle_ocean.webp"),
						h.Attribute("alt", "squirrel"),
						h.Class(
							"mask-size-[110%_90%] mask-linear-to-r mask-from-black mask-to-transparent mask-center mask-no-repeat mask-[url(/images/image-mask.webp)] h-full w-full rounded-md bg-center bg-cover bg-no-repeat object-cover opacity-50",
						),
					]),
				],
			),
			h.p([h.Class("font-bold font-mono text-fg text-xl")], ["Quiet as an ocean gazing squirrel..."]),
		],
	)

const messageListView = <M>(
	h: HtmlBuilder<M>,
	model: Model,
	toParentMessage: (message: Message) => M,
): Html => {
	if (!model.hasLoadedMessages) return h.div([], [])
	if (model.messages.length === 0) return emptyStateView(h)
	const list = MessageList.view(h, model.list, {
		items: model.rows,
		itemToKey: (row) => row.key,
		itemToView: (row, { isStuck }) => memoRow(h, row, isStuck),
		isStickyHeader: (row) => row._tag === "DateHeader",
		toParentMessage: (message) => toParentMessage(Message.GotListMessage({ message })),
	})
	pruneRowSlots()
	return h.div(
		[
			h.Class(
				"isolate flex min-h-0 flex-1 flex-col overflow-y-auto px-4 py-2 transition-opacity duration-200",
			),
			h.Attribute("style", "overflow-anchor: auto; scroll-behavior: auto; opacity: 1;"),
		],
		[list],
	)
}

// The chrome around the list only changes with the channel, not on every scroll frame.
const lazyHeader = createLazy()
const lazyTabBar = createLazy()
const lazyComposer = createLazy()

/** `SplitPanelRoot` > `SplitPanelContent` with the channel's messages route inside. */
export const view = <M>(h: HtmlBuilder<M>, model: Model, toParentMessage: (message: Message) => M): Html =>
	h.div(
		[h.Class(rootStyles({ className: "h-[calc(100dvh-4rem)] md:h-dvh" }))],
		[
			h.div(
				[h.Class(contentStyles())],
				[
					lazyHeader(chatHeaderView, [model.channel, h]) ?? h.div([], []),
					lazyTabBar(chatTabBarView, [h]) ?? h.div([], []),
					h.div(
						[h.Class("flex min-h-0 flex-1 flex-col overflow-hidden")],
						[messageListView(h, model, toParentMessage)],
					),
					lazyComposer(composerPlaceholderView, [h]) ?? h.div([], []),
				],
			),
		],
	)

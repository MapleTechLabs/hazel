import type { Html, HtmlBuilder } from "foldkit/html"
import { IconPlus } from "../../../icons"
import { badge } from "../../../ui/badge"
import { button } from "../../../ui/button"
import { card, cardBody, cardHeader } from "../../../ui/card"
import { iconTile } from "../../../ui/icon-tile"
import { CARD_HEADER_ROW, cardTitle, emptyList, listBody, menuOf, spinner } from "./cards"
import { Message } from "./message"
import { itemsOf, type Model, type RssFeed } from "./model"
import { rowMenu } from "./row-menu"

/** Port of `components/channel-settings/rss-integration-card.tsx`. */

const rssIcon = (h: HtmlBuilder<Message>, className: string): Html =>
	h.svg(
		[
			h.Class(className),
			h.Attribute("fill", "currentColor"),
			h.Attribute("viewBox", "0 0 24 24"),
			h.Attribute("xmlns", "http://www.w3.org/2000/svg"),
		],
		[
			h.circle([h.Attribute("cx", "6.18"), h.Attribute("cy", "17.82"), h.Attribute("r", "2.18")]),
			h.path([
				h.Attribute(
					"d",
					"M4 4.44v2.83c7.03 0 12.73 5.7 12.73 12.73h2.83c0-8.59-6.97-15.56-15.56-15.56zm0 5.66v2.83c3.9 0 7.07 3.17 7.07 7.07h2.83c0-5.47-4.43-9.9-9.9-9.9z",
				),
			]),
		],
	)

/** RSS orange on its tint. */
const RSS_TILE = "border-transparent bg-[#F26522]/10 text-[#F26522]"

const INTERVAL_LABELS: Readonly<Record<number, string>> = {
	5: "5 min",
	15: "15 min",
	30: "30 min",
	60: "1 hr",
}

/** `FeedIcon` (the image-error fallback is not tracked; a broken icon stays an image). */
const feedIcon = (h: HtmlBuilder<Message>, url: string | null): Html =>
	url
		? h.img([h.Src(url), h.Alt(""), h.Class("size-8 rounded object-cover")])
		: iconTile(h, { size: "sm", className: RSS_TILE }, rssIcon(h, ""))

const rssItem = (h: HtmlBuilder<Message>, model: Model, feed: RssFeed): Html => {
	const intervalLabel = INTERVAL_LABELS[feed.pollingIntervalMinutes] ?? `${feed.pollingIntervalMinutes} min`
	return h.keyed("div")(
		feed.id,
		[
			h.Class(
				"flex items-center gap-3 rounded-lg border border-border bg-bg p-3 transition-colors hover:border-border-hover",
			),
		],
		[
			feedIcon(h, feed.feedIconUrl),
			h.div(
				[h.Class("min-w-0 flex-1")],
				[
					h.div(
						[h.Class("flex items-center gap-2")],
						[
							h.span(
								[h.Class("truncate font-medium text-fg text-sm")],
								[feed.feedTitle || feed.feedUrl],
							),
							...(feed.isEnabled ? [] : [badge(h, { intent: "secondary" }, ["Paused"])]),
							...(feed.consecutiveErrors > 0
								? [
										badge(h, { intent: "danger" }, [
											`${feed.consecutiveErrors}`,
											" ",
											feed.consecutiveErrors === 1 ? "error" : "errors",
										]),
									]
								: []),
						],
					),
					h.div(
						[h.Class("flex items-center gap-2 text-muted-fg text-xs")],
						[
							h.span([h.Class("truncate")], [feed.feedUrl]),
							h.span([h.Class("shrink-0 text-muted-fg/50")], ["·"]),
							h.span([h.Class("shrink-0")], [intervalLabel]),
						],
					),
				],
			),
			rowMenu(h, {
				kind: "rss",
				id: feed.id,
				menu: menuOf(model, "rss", feed.id),
				isEnabled: feed.isEnabled,
				isToggling: model.togglingRowIds.includes(feed.id),
				triggerClassName: "shrink-0 text-muted-fg",
				labels: { enable: "Resume", disable: "Pause", remove: "Remove" },
			}),
		],
	)
}

export const rssCard = (h: HtmlBuilder<Message>, model: Model): Html => {
	const feeds = itemsOf(model.rss)
	return card(h, {}, [
		cardHeader(
			h,
			[
				h.div(
					[h.Class("flex items-center gap-3")],
					[
						iconTile(h, { size: "md", className: RSS_TILE }, rssIcon(h, "")),
						cardTitle(
							h,
							"RSS Feeds",
							feeds.length > 0
								? [
										badge(h, { intent: "success" }, [
											`${feeds.length}`,
											" ",
											feeds.length === 1 ? "feed" : "feeds",
										]),
									]
								: [],
							"Subscribe to RSS and Atom feeds",
						),
					],
				),
				button(h, { intent: "primary", size: "sm", onPress: Message.ClickedAddFeed() }, [
					IconPlus(h, { attributes: { "data-slot": "icon" } }),
					"Add Feed",
				]),
			],
			CARD_HEADER_ROW,
		),
		cardBody(h, [
			listBody(h, "rss", model.rss.data, {
				loading: () => spinner(h),
				empty: () =>
					emptyList(
						h,
						"No RSS feeds subscribed",
						"Add a feed to receive new articles in this channel",
					),
				rows: (items) =>
					h.div(
						[h.Class("flex flex-col gap-2")],
						items.map((feed) => rssItem(h, model, feed)),
					),
			}),
		]),
	])
}

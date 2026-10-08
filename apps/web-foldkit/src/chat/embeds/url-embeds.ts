import type { Html, HtmlBuilder } from "foldkit/html"
import { IconHeart } from "../../icons"
import type { TweetView, Unfurl } from "../unfurl"

/**
 * `MessageContent.Embeds`' URL embeds: `TweetEmbed`, `YoutubeEmbed`, `GifEmbed` and `LinkPreview`
 * (`components/tweet-embed.tsx`, `youtube-embed.tsx`, `gif-embed.tsx`, `link-preview.tsx`).
 */

// MARK: Link preview

const hostOf = (url: string) => (URL.canParse(url) ? new URL(url).host : "")

/** `LinkPreview`: nothing once the fetch failed, a "Loading preview…" card until it answers. */
export const linkPreviewView = <M>(h: HtmlBuilder<M>, url: string, unfurl: Unfurl | null): Html => {
	if (unfurl === null || unfurl._tag === "Failed" || unfurl._tag === "LoadedTweet") return h.empty
	const og = unfurl._tag === "LoadedLinkPreview" ? unfurl.preview : null
	const href = og?.url || url
	const host = hostOf(href)
	const imageUrl = og?.image?.url
	return h.a(
		[
			h.Href(href),
			h.Attribute("target", "_blank"),
			h.Attribute("rel", "noopener noreferrer"),
			h.Class(
				"mt-2 block max-w-sm overflow-hidden rounded-lg border pressed:border-fg/15 bg-muted/40 pressed:bg-muted hover:border-fg/15 hover:bg-muted",
			),
		],
		[
			imageUrl
				? h.div(
						[h.Class("aspect-video w-full overflow-hidden bg-muted")],
						[h.img([h.Attribute("src", imageUrl), h.Attribute("alt", ""), h.Class("h-full w-full object-cover")])],
					)
				: h.empty,
			h.div(
				[h.Class("flex items-start border-t p-3")],
				[
					h.div(
						[h.Class("min-w-0")],
						[
							h.div([h.Class("truncate font-semibold text-sm")], [og?.title || host || url]),
							og?.description
								? h.div([h.Class("mt-0.5 line-clamp-2 text-[12px] text-fg/70")], [og.description])
								: h.empty,
							h.div([h.Class("mt-1 text-[11px] text-primary-subtle-fg")], [host]),
						],
					),
				],
			),
			unfurl._tag === "Loading"
				? h.div([h.Class("px-3 pb-3 text-[11px] text-muted-fg")], ["Loading preview…"])
				: h.empty,
		],
	)
}

// MARK: YouTube

/** `YoutubeEmbed`: the player iframe, starting at the URL's `t` when it has one. */
export const youtubeView = <M>(h: HtmlBuilder<M>, embedUrl: string): Html =>
	h.div(
		[
			h.Class(
				"mt-2 w-full max-w-xl overflow-hidden rounded-lg border border-fg/15 pressed:border-fg/15 bg-muted/40 pressed:bg-muted hover:border-fg/15 hover:bg-muted",
			),
		],
		[
			h.div(
				[h.Class("relative aspect-video w-full")],
				[
					h.iframe([
						h.Attribute("src", embedUrl),
						h.Attribute("title", "YouTube video player"),
						h.Attribute(
							"allow",
							"accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share",
						),
						h.Attribute("allowfullscreen", ""),
						h.Class("absolute inset-0 size-full"),
					]),
				],
			),
		],
	)

// MARK: GIF

/** `GifEmbed`: the GIF opens the image viewer; the attribution links to the provider. */
export const gifView = <M>(h: HtmlBuilder<M>, mediaUrl: string, isKlipy: boolean, onOpen: M | null): Html =>
	h.div(
		[h.Class("mt-1")],
		[
			h.button(
				[h.Attribute("type", "button"), h.Class("cursor-pointer"), ...(onOpen === null ? [] : [h.OnClick(onOpen)])],
				[
					h.img([
						h.Attribute("src", mediaUrl),
						h.Attribute("alt", "GIF"),
						h.Class("max-h-[300px] max-w-sm rounded-md transition-opacity hover:opacity-90"),
						h.Attribute("loading", "lazy"),
						h.Attribute("draggable", "false"),
					]),
				],
			),
			h.a(
				[
					h.Href(isKlipy ? "https://klipy.com" : "https://giphy.com"),
					h.Attribute("target", "_blank"),
					h.Attribute("rel", "noopener noreferrer"),
					h.Class("mt-0.5 block text-[10px] text-muted-fg hover:text-fg/60"),
				],
				["via ", isKlipy ? "KLIPY" : "GIPHY"],
			),
		],
	)

// MARK: Tweet

const tweetCard =
	"mt-2 flex max-w-sm flex-col gap-2 rounded-lg border border-fg/15 bg-muted/40 p-4"

const tweetSkeleton = <M>(h: HtmlBuilder<M>): Html =>
	h.div(
		[h.Class(tweetCard)],
		[
			h.div(
				[h.Class("flex flex-row gap-2")],
				[
					h.div([h.Class("size-10 shrink-0 animate-pulse rounded-full bg-muted")], []),
					h.div([h.Class("h-10 w-full animate-pulse rounded bg-muted")], []),
				],
			),
			h.div([h.Class("h-20 w-full animate-pulse rounded bg-muted")], []),
		],
	)

const tweetNotFound = <M>(h: HtmlBuilder<M>): Html =>
	h.div(
		[
			h.Class(
				"mt-2 flex max-w-sm flex-col items-center justify-center gap-2 rounded-lg border border-fg/15 bg-muted/40 p-4",
			),
		],
		[h.div([h.Class("text-muted-fg text-sm")], ["Tweet not found"])],
	)

const truncate = (value: string, length: number) =>
	value.length <= length ? value : `${value.slice(0, length - 3)}...`

const externalLink = <M>(h: HtmlBuilder<M>, href: string, className: string | null, children: ReadonlyArray<Html | string>) =>
	h.a(
		[
			h.Href(href),
			h.Attribute("target", "_blank"),
			h.Attribute("rel", "noreferrer"),
			...(className === null ? [] : [h.Class(className)]),
		],
		[...children],
	)

const verifiedIcon = <M>(h: HtmlBuilder<M>): Html =>
	h.svg(
		[h.Attribute("aria-label", "Verified Account"), h.Attribute("viewBox", "0 0 24 24"), h.Class("ml-1 inline size-4 text-verified")],
		[
			h.g(
				[h.Attribute("fill", "currentColor")],
				[
					h.path([
						h.Attribute(
							"d",
							"M22.5 12.5c0-1.58-.875-2.95-2.148-3.6.154-.435.238-.905.238-1.4 0-2.21-1.71-3.998-3.818-3.998-.47 0-.92.084-1.336.25C14.818 2.415 13.51 1.5 12 1.5s-2.816.917-3.437 2.25c-.415-.165-.866-.25-1.336-.25-2.11 0-3.818 1.79-3.818 4 0 .494.083.964.237 1.4-1.272.65-2.147 2.018-2.147 3.6 0 1.495.782 2.798 1.942 3.486-.02.17-.032.34-.032.514 0 2.21 1.708 4 3.818 4 .47 0 .92-.086 1.335-.25.62 1.334 1.926 2.25 3.437 2.25 1.512 0 2.818-.916 3.437-2.25.415.163.865.248 1.336.248 2.11 0 3.818-1.79 3.818-4 0-.174-.012-.344-.033-.513 1.158-.687 1.943-1.99 1.943-3.484zm-6.616-3.334l-4.334 6.5c-.145.217-.382.334-.625.334-.143 0-.288-.04-.416-.126l-.115-.094-2.415-2.415c-.293-.293-.293-.768 0-1.06s.768-.294 1.06 0l1.77 1.767 3.825-5.74c.23-.345.696-.436 1.04-.207.346.23.44.696.21 1.04z",
						),
					]),
				],
			),
		],
	)

const twitterIcon = <M>(h: HtmlBuilder<M>): Html =>
	h.svg(
		[
			h.Attribute("stroke", "currentColor"),
			h.Attribute("fill", "currentColor"),
			h.Attribute("stroke-width", "0"),
			h.Attribute("viewBox", "0 0 24 24"),
			h.Attribute("height", "1em"),
			h.Attribute("width", "1em"),
			h.Attribute("xmlns", "http://www.w3.org/2000/svg"),
			h.Class("size-5 items-start text-[#3BA9EE] transition-all hover:scale-105"),
		],
		[
			h.g(
				[],
				[
					h.path([h.Attribute("fill", "none"), h.Attribute("d", "M0 0h24v24H0z")]),
					h.path([
						h.Attribute(
							"d",
							"M22.162 5.656a8.384 8.384 0 0 1-2.402.658A4.196 4.196 0 0 0 21.6 4c-.82.488-1.719.83-2.656 1.015a4.182 4.182 0 0 0-7.126 3.814 11.874 11.874 0 0 1-8.62-4.37 4.168 4.168 0 0 0-.566 2.103c0 1.45.738 2.731 1.86 3.481a4.168 4.168 0 0 1-1.894-.523v.052a4.185 4.185 0 0 0 3.355 4.101 4.21 4.21 0 0 1-1.89.072A4.185 4.185 0 0 0 7.97 16.65a8.394 8.394 0 0 1-6.191 1.732 11.83 11.83 0 0 0 6.41 1.88c7.693 0 11.9-6.373 11.9-11.9 0-.18-.005-.362-.013-.54a8.496 8.496 0 0 0 2.087-2.165z",
						),
					]),
				],
			),
		],
	)

const tweetHeader = <M>(h: HtmlBuilder<M>, tweet: TweetView): Html =>
	h.div(
		[h.Class("flex flex-row justify-between")],
		[
			h.div(
				[h.Class("flex items-center space-x-2")],
				[
					externalLink(h, tweet.user.url, null, [
						h.img([
							h.Attribute("alt", tweet.user.screenName),
							h.Attribute("height", "48"),
							h.Attribute("width", "48"),
							h.Attribute("src", tweet.user.avatarUrl),
							h.Class("size-10 overflow-hidden rounded-full border border-fg/15"),
						]),
					]),
					h.div(
						[],
						[
							externalLink(h, tweet.user.url, "flex items-center whitespace-nowrap font-semibold text-sm hover:underline", [
								truncate(tweet.user.name, 20),
								tweet.user.isVerified ? verifiedIcon(h) : h.empty,
							]),
							h.div(
								[h.Class("flex items-center space-x-1")],
								[
									externalLink(h, tweet.user.url, "text-fg/70 text-sm hover:underline", [
										"@",
										truncate(tweet.user.screenName, 16),
									]),
								],
							),
						],
					),
				],
			),
			externalLink(h, tweet.url, null, [h.span([h.Class("sr-only")], ["Link to tweet"]), twitterIcon(h)]),
		],
	)

const tweetBody = <M>(h: HtmlBuilder<M>, tweet: TweetView): Html =>
	h.div(
		[h.Class("wrap-break-word leading-normal tracking-tighter")],
		tweet.entities.map((entity) =>
			entity.type === "text"
				? h.span([h.Class("text-fg text-sm")], [entity.text])
				: entity.type === "media" || entity.href === null
					? h.empty
					: h.a(
							[
								h.Href(entity.href),
								h.Attribute("target", "_blank"),
								h.Attribute("rel", "noopener noreferrer"),
								h.Class("text-primary-subtle-fg text-sm hover:underline"),
							],
							[h.span([], [entity.text])],
						),
		),
	)

const tweetMedia = <M>(h: HtmlBuilder<M>, tweet: TweetView, toOpenPhoto: ((index: number) => M) | null): Html => {
	if (tweet.video === null && tweet.photos === null) return h.empty
	return h.div(
		[h.Class("flex flex-1 items-center justify-center")],
		[
			tweet.video !== null && tweet.video.src !== null
				? h.video(
						[
							h.Attribute("poster", tweet.video.poster),
							h.Attribute("autoplay", ""),
							h.Attribute("loop", ""),
							h.Attribute("playsinline", ""),
							h.Class("rounded-lg border border-fg/15 shadow-sm"),
						],
						[
							h.source([h.Attribute("src", tweet.video.src), h.Attribute("type", "video/mp4")]),
							"Your browser does not support the video tag.",
						],
					)
				: h.empty,
			tweet.photos === null
				? h.empty
				: h.div(
						[h.Class("relative flex transform-gpu snap-x snap-mandatory gap-4 overflow-x-auto")],
						[
							h.div([h.Class("shrink-0 snap-center sm:w-2")], []),
							...tweet.photos.map((photo, index) =>
								h.button(
									[
										h.Attribute("type", "button"),
										h.Class("h-64 w-5/6 shrink-0 snap-center snap-always"),
										...(toOpenPhoto === null ? [] : [h.OnClick(toOpenPhoto(index))]),
									],
									[
										h.img([
											h.Attribute("src", photo.url),
											h.Attribute("width", String(photo.width)),
											h.Attribute("height", String(photo.height)),
											h.Attribute("alt", tweet.text),
											h.Class(
												"size-full rounded-lg border border-fg/15 object-cover shadow-sm transition-opacity hover:opacity-90",
											),
										]),
									],
								),
							),
							h.div([h.Class("shrink-0 snap-center sm:w-2")], []),
						],
					),
		],
	)
}

const metric = <M>(h: HtmlBuilder<M>, count: number, label: string, icon: Html): Html =>
	h.div(
		[h.Class("flex items-center gap-1")],
		[icon, h.span([h.Class("font-semibold")], [count.toLocaleString()]), h.span([], [label])],
	)

const tweetMetrics = <M>(h: HtmlBuilder<M>, tweet: TweetView): Html => {
	const { replyCount, retweetCount, favoriteCount } = tweet
	if (favoriteCount === null && retweetCount === null && replyCount === null) return h.empty
	return h.div(
		[h.Class("flex items-center gap-4 text-fg/70 text-xs")],
		[
			replyCount !== null && replyCount > 0 ? metric(h, replyCount, "Replies", h.empty) : h.empty,
			retweetCount !== null && retweetCount > 0 ? metric(h, retweetCount, "Retweets", h.empty) : h.empty,
			favoriteCount !== null && favoriteCount > 0
				? metric(h, favoriteCount, favoriteCount > 1 ? "Likes" : "Like", IconHeart(h, { className: "size-3 text-primary" }))
				: h.empty,
		],
	)
}

/** `TweetEmbed`: a skeleton while loading, "Tweet not found" when the fetch failed. */
export const tweetView = <M>(
	h: HtmlBuilder<M>,
	unfurl: Unfurl | null,
	toOpenPhoto: ((index: number) => M) | null,
): Html => {
	if (unfurl === null || unfurl._tag === "Loading") return tweetSkeleton(h)
	if (unfurl._tag !== "LoadedTweet") return tweetNotFound(h)
	const { tweet } = unfurl
	return h.div(
		[
			h.Class(
				"mt-2 flex max-w-sm flex-col gap-2 overflow-hidden rounded-lg border border-fg/15 pressed:border-fg/15 bg-muted/40 pressed:bg-muted p-4 hover:border-fg/15 hover:bg-muted",
			),
		],
		[tweetHeader(h, tweet), tweetBody(h, tweet), tweetMedia(h, tweet, toOpenPhoto), tweetMetrics(h, tweet)],
	)
}

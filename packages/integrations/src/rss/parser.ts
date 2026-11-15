import type RssParser from "rss-parser"

export interface RssFeedItem {
	guid: string
	title: string
	description: string
	link: string
	pubDate: string | null
	author: string | null
}

export interface RssFeedMetadata {
	title: string | null
	description: string | null
	iconUrl: string | null
}

export interface ParsedRssFeed {
	metadata: RssFeedMetadata
	items: RssFeedItem[]
}

/**
 * The parser and the entity decoder, loaded on the first feed, so they (and the XML libraries
 * under them) are not evaluated when a cold isolate (the api Worker's, its objects') starts.
 */
interface FeedTools {
	readonly parser: RssParser
	readonly decode: (html: string) => string
}

let tools: Promise<FeedTools> | undefined

const loadTools = (): Promise<FeedTools> =>
	(tools ??= Promise.all([import("rss-parser"), import("he")]).then(
		([{ default: RssParserClass }, he]) => ({
			parser: new RssParserClass({
				timeout: 10_000,
				maxRedirects: 3,
				headers: {
					"User-Agent": "HazelChat RSS Bot/1.0",
					Accept: "application/rss+xml, application/xml, text/xml, application/atom+xml",
				},
			}),
			decode: he.decode,
		}),
		(error: unknown) => {
			// A failed load is retried by the next feed.
			tools = undefined
			throw error
		},
	))

/**
 * Fetches and parses an RSS or Atom feed URL.
 * Returns normalized feed metadata and items.
 */
export const fetchAndParseFeed = async (feedUrl: string): Promise<ParsedRssFeed> => {
	const { parser, decode } = await loadTools()
	return normalizeFeed(await parser.parseURL(feedUrl), decode)
}

/**
 * Parses a feed document already fetched (with `fetch`, where `parseURL`'s node http is not
 * available, e.g. a Worker).
 */
export const parseFeed = async (xml: string): Promise<ParsedRssFeed> => {
	const { parser, decode } = await loadTools()
	return normalizeFeed(await parser.parseString(xml), decode)
}

/** The request headers a feed fetch sends. */
export const FEED_REQUEST_HEADERS = {
	"User-Agent": "HazelChat RSS Bot/1.0",
	Accept: "application/rss+xml, application/xml, text/xml, application/atom+xml",
} as const

const normalizeFeed = (
	feed: Awaited<ReturnType<RssParser["parseURL"]>>,
	decode: (html: string) => string,
): ParsedRssFeed => {
	// Try to extract a favicon from the feed link
	let iconUrl: string | null = null
	if (feed.link) {
		try {
			const url = new URL(feed.link)
			iconUrl = `${url.origin}/favicon.ico`
		} catch {
			// Ignore invalid URLs
		}
	}

	const metadata: RssFeedMetadata = {
		title: feed.title ?? null,
		description: feed.description ?? null,
		iconUrl,
	}

	const items: RssFeedItem[] = (feed.items ?? []).map((item) => ({
		guid: item.guid ?? item.link ?? item.title ?? crypto.randomUUID(),
		title: item.title ?? "Untitled",
		description: stripHtml(item.contentSnippet ?? item.content ?? item.summary ?? "", decode).slice(
			0,
			300,
		),
		link: item.link ?? "",
		pubDate: item.isoDate ?? item.pubDate ?? null,
		author: item.creator ?? item.author ?? null,
	}))

	return { metadata, items }
}

/**
 * Validates that a URL points to a valid RSS/Atom feed.
 * Returns feed metadata on success, throws on failure.
 */
export const validateFeedUrl = async (feedUrl: string): Promise<RssFeedMetadata> => {
	const result = await fetchAndParseFeed(feedUrl)
	return result.metadata
}

/**
 * Strip HTML tags from a string and decode HTML entities for plain text display.
 */
function stripHtml(html: string, decode: (html: string) => string): string {
	return decode(
		html
			.replace(/<[^>]*>/g, "")
			.replace(/\s+/g, " ")
			.trim(),
	)
}

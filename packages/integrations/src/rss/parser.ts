import he from "he"
import RssParser from "rss-parser"

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

const parser = new RssParser({
	timeout: 10_000,
	maxRedirects: 3,
	headers: {
		"User-Agent": "HazelChat RSS Bot/1.0",
		Accept: "application/rss+xml, application/xml, text/xml, application/atom+xml",
	},
})

/**
 * Fetches and parses an RSS or Atom feed URL.
 * Returns normalized feed metadata and items.
 */
export const fetchAndParseFeed = async (feedUrl: string): Promise<ParsedRssFeed> =>
	normalizeFeed(await parser.parseURL(feedUrl))

/**
 * Parses a feed document already fetched (with `fetch`, where `parseURL`'s node http is not
 * available, e.g. a Worker).
 */
export const parseFeed = async (xml: string): Promise<ParsedRssFeed> =>
	normalizeFeed(await parser.parseString(xml))

/** The request headers a feed fetch sends. */
export const FEED_REQUEST_HEADERS = {
	"User-Agent": "HazelChat RSS Bot/1.0",
	Accept: "application/rss+xml, application/xml, text/xml, application/atom+xml",
} as const

const normalizeFeed = (feed: Awaited<ReturnType<typeof parser.parseURL>>): ParsedRssFeed => {
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
		description: stripHtml(item.contentSnippet ?? item.content ?? item.summary ?? "").slice(0, 300),
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
function stripHtml(html: string): string {
	return he.decode(
		html
			.replace(/<[^>]*>/g, "")
			.replace(/\s+/g, " ")
			.trim(),
	)
}

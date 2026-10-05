"use client"

import { AsyncResult } from "effect/reactivity"
import { useAtomValue } from "@effect/atom-react"
import { useMemo } from "react"
import { LinkPreviewClient } from "~/lib/services/common/link-preview-client"

export function LinkPreview({ url }: { url: string }) {
	const previewResult = useAtomValue(LinkPreviewClient.query("linkPreview", "get", { payload: { url } }))
	const og = AsyncResult.getOrElse(previewResult, () => null)
	const isLoading = AsyncResult.isInitial(previewResult)

	const host = useMemo(() => {
		const resolvedUrl = og?.url || url
		try {
			return new URL(resolvedUrl).host
		} catch {
			return ""
		}
	}, [og, url])

	// Don't render anything if failed and no data
	if (!og && !isLoading) return null

	return (
		<a
			href={og?.url || url}
			target="_blank"
			rel="noopener noreferrer"
			className="mt-2 block max-w-sm overflow-hidden rounded-lg border pressed:border-fg/15 bg-muted/40 pressed:bg-muted hover:border-fg/15 hover:bg-muted"
		>
			{og?.image?.url && (
				<div className="aspect-video w-full overflow-hidden bg-muted">
					<img src={og.image.url} alt="" className="h-full w-full object-cover" />
				</div>
			)}
			<div className="flex items-start border-t p-3">
				<div className="min-w-0">
					<div className="truncate font-semibold text-sm">{og?.title || host || url}</div>
					{og?.description && (
						<div className="mt-0.5 line-clamp-2 text-[12px] text-fg/70">{og.description}</div>
					)}
					<div className="mt-1 text-[11px] text-primary-subtle-fg">{host}</div>
				</div>
			</div>
			{isLoading && <div className="px-3 pb-3 text-[11px] text-muted-fg">Loading preview…</div>}
		</a>
	)
}

export function extractUrls(input: string): string[] {
	const re =
		/(https?:\/\/[^\s)]+|www\.[^\s)]+|(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,}(?:\/[^\s)]*)?)/gi
	const found: string[] = []
	let m: RegExpExecArray | null
	// biome-ignore lint/suspicious/noAssignInExpressions: ...
	while ((m = re.exec(input))) {
		const raw = stripTrailingPunct(m[0])
		const href = normalizeUrl(raw)
		if (!found.includes(href)) found.push(href)
	}
	return found
}

function stripTrailingPunct(v: string): string {
	return v.replace(/[),.;!?]+$/g, "")
}

export function normalizeUrl(value: string): string {
	const v = value.trim()
	if (/^https?:\/\//i.test(v)) return v
	if (/^www\./i.test(v)) return `https://${v}`
	return `https://${v}`
}

export function isTweetUrl(url: string): boolean {
	try {
		const parsed = new URL(url)
		const isTwitterDomain =
			parsed.hostname === "twitter.com" ||
			parsed.hostname === "www.twitter.com" ||
			parsed.hostname === "x.com" ||
			parsed.hostname === "www.x.com"
		const hasStatusPath = /\/status\/\d+/.test(parsed.pathname)
		return isTwitterDomain && hasStatusPath
	} catch {
		return false
	}
}

export function extractTweetId(url: string): string | null {
	try {
		const parsed = new URL(url)
		const match = parsed.pathname.match(/\/status\/(\d+)/)
		return match?.[1] ?? null
	} catch {
		return null
	}
}

export function isYoutubeUrl(url: string): boolean {
	try {
		const parsed = new URL(url)
		const isYoutubeDomain =
			parsed.hostname === "youtube.com" ||
			parsed.hostname === "www.youtube.com" ||
			parsed.hostname === "youtu.be" ||
			parsed.hostname === "www.youtu.be"
		return isYoutubeDomain
	} catch {
		return false
	}
}

export function extractYoutubeVideoId(url: string): string | null {
	try {
		const parsed = new URL(url)

		// Handle youtu.be short links
		if (parsed.hostname === "youtu.be" || parsed.hostname === "www.youtu.be") {
			const videoId = parsed.pathname.slice(1) // Remove leading slash
			return videoId || null
		}

		// Handle youtube.com/watch?v= format
		if (parsed.hostname.includes("youtube.com")) {
			const videoId = parsed.searchParams.get("v")
			return videoId || null
		}

		return null
	} catch {
		return null
	}
}

export function extractYoutubeTimestamp(url: string): number | null {
	try {
		const parsed = new URL(url)
		const tParam = parsed.searchParams.get("t")

		if (!tParam) return null

		// Handle formats like "42s", "1m30s", "1h2m3s", or just "42" (seconds)
		let seconds = 0

		// Try parsing numeric seconds directly
		const numericMatch = tParam.match(/^(\d+)$/)
		if (numericMatch?.[1]) {
			return Number.parseInt(numericMatch[1], 10)
		}

		// Parse time formats
		const hours = tParam.match(/(\d+)h/)
		const minutes = tParam.match(/(\d+)m/)
		const secs = tParam.match(/(\d+)s/)

		if (hours?.[1]) seconds += Number.parseInt(hours[1], 10) * 3600
		if (minutes?.[1]) seconds += Number.parseInt(minutes[1], 10) * 60
		if (secs?.[1]) seconds += Number.parseInt(secs[1], 10)

		return seconds > 0 ? seconds : null
	} catch {
		return null
	}
}

/**
 * Check if a URL is a Klipy media URL
 * Matches: static.klipy.com
 */
export function isKlipyUrl(url: string): boolean {
	try {
		const parsed = new URL(url)
		return parsed.hostname === "static.klipy.com"
	} catch {
		return false
	}
}

/**
 * Check if a URL is a GIPHY media URL (kept for backward compat with existing messages)
 * Matches: media*.giphy.com, i.giphy.com, giphy.com/media, giphy.com/gifs
 */
export function isGiphyUrl(url: string): boolean {
	try {
		const parsed = new URL(url)
		const hostname = parsed.hostname
		return (
			hostname === "i.giphy.com" ||
			(hostname.startsWith("media") && hostname.endsWith(".giphy.com")) ||
			((hostname === "giphy.com" || hostname === "www.giphy.com") &&
				(/^\/media\//.test(parsed.pathname) || /^\/gifs\//.test(parsed.pathname)))
		)
	} catch {
		return false
	}
}

/**
 * Check if a URL is any GIF provider URL (Klipy or legacy Giphy)
 */
export function isGifUrl(url: string): boolean {
	return isKlipyUrl(url) || isGiphyUrl(url)
}

/**
 * Extract the direct media URL from a GIPHY URL.
 * If it's already a direct media URL (media*.giphy.com or i.giphy.com), returns as-is.
 * For page URLs (giphy.com/gifs/...), attempts to construct a media URL.
 */
export function extractGiphyMediaUrl(url: string): string {
	try {
		const parsed = new URL(url)
		const hostname = parsed.hostname

		// Already a direct media URL
		if (hostname === "i.giphy.com" || (hostname.startsWith("media") && hostname.endsWith(".giphy.com"))) {
			return url
		}

		// Page URL like giphy.com/gifs/slug-ID or giphy.com/media/ID/giphy.gif
		if (hostname === "giphy.com" || hostname === "www.giphy.com") {
			// /media/ID/giphy.gif format
			const mediaMatch = parsed.pathname.match(/^\/media\/([^/]+)/)
			if (mediaMatch?.[1]) {
				return `https://media.giphy.com/media/${mediaMatch[1]}/giphy.gif`
			}

			// /gifs/slug-ID format (ID is the last segment after the final hyphen)
			const gifsMatch = parsed.pathname.match(/^\/gifs\/.*-([a-zA-Z0-9]+)$/)
			if (gifsMatch?.[1]) {
				return `https://media.giphy.com/media/${gifsMatch[1]}/giphy.gif`
			}
		}

		return url
	} catch {
		return url
	}
}

/**
 * Check if a URL is a Linear issue URL
 * Format: https://linear.app/{workspace}/issue/{ISSUE-ID}
 */
export function isLinearIssueUrl(url: string): boolean {
	try {
		const parsed = new URL(url)
		return parsed.hostname === "linear.app" && /\/[^/]+\/issue\/[A-Z]+-\d+/i.test(parsed.pathname)
	} catch {
		return false
	}
}

/**
 * Extract the issue key from a Linear issue URL
 * Returns the issue key (e.g., "ENG-123") or null if not a valid Linear URL
 */
export function extractLinearIssueKey(url: string): string | null {
	try {
		const match = url.match(/\/issue\/([A-Z]+-\d+)/i)
		return match?.[1]?.toUpperCase() ?? null
	} catch {
		return null
	}
}

/**
 * Check if a URL is a GitHub PR URL
 * Format: https://github.com/{owner}/{repo}/pull/{number}
 */
export function isGitHubPRUrl(url: string): boolean {
	try {
		const parsed = new URL(url)
		return parsed.hostname === "github.com" && /\/[^/]+\/[^/]+\/pull\/\d+/.test(parsed.pathname)
	} catch {
		return false
	}
}

/**
 * Check if a URL is a GitHub Issue URL
 * Format: https://github.com/{owner}/{repo}/issues/{number}
 */
export function isGitHubIssueUrl(url: string): boolean {
	try {
		const parsed = new URL(url)
		return parsed.hostname === "github.com" && /\/[^/]+\/[^/]+\/issues\/\d+/.test(parsed.pathname)
	} catch {
		return false
	}
}

/**
 * Extract GitHub PR/Issue info from URL
 */
export function extractGitHubInfo(url: string): {
	owner: string
	repo: string
	number: number
	type: "pull" | "issues"
} | null {
	try {
		const parsed = new URL(url)
		const match = parsed.pathname.match(/\/([^/]+)\/([^/]+)\/(pull|issues)\/(\d+)/)
		if (!match || !match[1] || !match[2] || !match[3] || !match[4]) return null
		return {
			owner: match[1],
			repo: match[2],
			type: match[3] as "pull" | "issues",
			number: Number.parseInt(match[4], 10),
		}
	} catch {
		return null
	}
}

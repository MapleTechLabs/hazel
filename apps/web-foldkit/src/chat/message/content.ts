import type { MessageEmbed } from "@hazel/domain/models"
import {
	extractGitHubInfo,
	extractLinearIssueKey,
	extractUrls,
	isGifUrl,
	isGitHubPRUrl,
	isLinearIssueUrl,
	isTweetUrl,
	isYoutubeUrl,
} from "~/components/link-preview.utils"
import {
	type CustomElement,
	deserializeFromMarkdown,
} from "~/components/chat/slate-editor/slate-message-viewer-model"
import { isText, nodeString } from "../markdown/leaves"

/** `MessageContent.Provider`'s URL processing: which URLs embed, and the text left to display. */

export interface ProcessedUrls {
	readonly embedUrls: ReadonlyArray<string>
	readonly otherUrls: ReadonlyArray<string>
	readonly displayContent: string
}

/** URLs in paragraphs only (not code blocks, tables or quotes), deduped. */
const extractUrlsFromParagraphs = (content: string): ReadonlyArray<string> => {
	const urls: string[] = []
	for (const node of deserializeFromMarkdown(content))
		if (!isText(node) && (node as CustomElement).type === "paragraph")
			urls.push(...extractUrls(nodeString(node)))
	return [...new Set(urls)]
}

const isLinkShareMessage = (content: string, paragraphUrls: ReadonlyArray<string>) => {
	if (paragraphUrls.length === 0) return false
	let textOnly = content
	for (const url of paragraphUrls) textOnly = textOnly.replaceAll(url, "")
	return textOnly.replace(/\s+/g, " ").trim().length < 300
}

const githubKey = (url: string) => {
	const info = extractGitHubInfo(url)
	return info ? `${info.owner}/${info.repo}/${info.number}` : null
}

export const processUrls = (
	content: string,
	embeds: ReadonlyArray<MessageEmbed.MessageEmbed> | null,
): ProcessedUrls => {
	const paragraphUrls = extractUrlsFromParagraphs(content)
	if (!isLinkShareMessage(content, paragraphUrls))
		return { embedUrls: [], otherUrls: [], displayContent: content }

	const existingUrls = new Set<string>()
	const existingLinear = new Set<string>()
	const existingGitHub = new Set<string>()
	for (const url of (embeds ?? []).flatMap((embed) => [embed.url, embed.author?.url])) {
		if (!url) continue
		existingUrls.add(url)
		const linearKey = extractLinearIssueKey(url)
		if (linearKey) existingLinear.add(linearKey)
		const key = githubKey(url)
		if (key) existingGitHub.add(key)
	}

	const unique = paragraphUrls.filter((url) => !existingUrls.has(url))
	const linear = unique.filter((url) => {
		if (!isLinearIssueUrl(url)) return false
		const key = extractLinearIssueKey(url)
		return key && !existingLinear.has(key)
	})
	const github = unique.filter((url) => {
		if (!isGitHubPRUrl(url)) return false
		const key = githubKey(url)
		return key && !existingGitHub.has(key)
	})
	const embedUrls = [
		...unique.filter(isTweetUrl),
		...unique.filter(isYoutubeUrl),
		...unique.filter(isGifUrl),
		...linear,
		...github,
	]
	const otherUrls = unique.filter(
		(url) =>
			!isTweetUrl(url) &&
			!isYoutubeUrl(url) &&
			!isGifUrl(url) &&
			!isLinearIssueUrl(url) &&
			!isGitHubPRUrl(url),
	)
	let displayContent = content
	for (const url of embedUrls) displayContent = displayContent.replace(url, "")
	return { embedUrls, otherUrls, displayContent: displayContent.trim() }
}

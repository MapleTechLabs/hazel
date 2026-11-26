/**
 * What the chat leaves share (lane A5): events, rich text runs, reaction pills, attachments and link
 * cards. Every part is a `data-hz-part` node so the generated reset applies; the layout, motion and
 * hover reveals the recipes cannot say live in `styles.ts`, keyed on the same parts.
 */
import type { Attachment, Block, Embed, Reaction, Run } from "../../../vocabulary/content.ts"
import { BlockKind, RunKind } from "../../../vocabulary/content.ts"
import type { IconName } from "../../../vocabulary/options.ts"
import { svg } from "../../icons.ts"
import { part, type Plain, type Primitive } from "../define.ts"
import { chatCss } from "./styles.ts"

/** Raises `event` with `payload` if the view handles it; true when it did. */
export const fire = (primitive: Primitive, event: string, payload: Plain = {}): boolean => {
	const events = primitive.events
	const handler = events?.handlers[event]
	return handler !== undefined && events !== undefined && events.dispatch(event, handler, payload)
}

export const handles = (primitive: Primitive, event: string): boolean =>
	primitive.events?.handlers[event] !== undefined

/** Adds the chat stylesheet to `document` once. */
export const ensureStyles = (document: Document): void => {
	if (document.getElementById("hz-chat-styles") !== null) return
	const style = document.createElement("style")
	style.id = "hz-chat-styles"
	style.textContent = chatCss
	document.head.append(style)
}

/** Props arrive one at a time after create: draw once per microtask, after the last of them. */
export const batched = (draw: () => void): (() => void) => {
	let queued = false
	return () => {
		if (queued) return
		queued = true
		queueMicrotask(() => {
			queued = false
			draw()
		})
	}
}

export const text = (document: Document, tagName: string, name: string, content: string) => {
	const node = part(document, tagName, name)
	node.textContent = content
	return node
}

/** A plain button that never submits and never raises the parent's `press`. */
export const button = (
	document: Document,
	name: string,
	label: string | undefined,
	onPress: (event: MouseEvent) => void,
) => {
	const node = part(document, "button", name)
	node.setAttribute("type", "button")
	if (label !== undefined) node.setAttribute("aria-label", label)
	node.addEventListener("click", (event) => {
		event.stopPropagation()
		onPress(event)
	})
	return node
}

export const icon = (document: Document, name: IconName, partName = "icon") => {
	const node = part(document, "span", partName)
	node.setAttribute("aria-hidden", "true")
	node.dataset.name = name
	node.innerHTML = svg(name)
	return node
}

/** A tone badge drawn with the `badge` primitive's own look (`data-hz="badge"` and its options). */
export const badge = (
	document: Document,
	label: string,
	tone: string,
	options: { readonly pill?: boolean } = {},
) => {
	const node = document.createElement("span")
	node.dataset.hz = "badge"
	node.dataset.tone = tone
	node.dataset.size = "small"
	if (options.pill === true) node.setAttribute("data-pill", "")
	node.textContent = label
	return node
}

// ---------------------------------------------------------------------------
// rich text
// ---------------------------------------------------------------------------

export interface RunHandlers {
	readonly mention: (userId: string, run: number) => void
	/** True when the view handled the press: the link then does not navigate. */
	readonly link: (url: string) => boolean
}

/**
 * The blocks of a row's body. Runs are numbered across the whole body (`data-run`), the index
 * `pressMention` reports and `popover.anchorTo` finds.
 */
export const richText = (document: Document, blocks: ReadonlyArray<Block>, on: RunHandlers): Node => {
	const fragment = document.createDocumentFragment()
	let index = 0
	const runs = (into: HTMLElement, list: ReadonlyArray<Run>) => {
		for (const run of list) into.append(runNode(document, run, index++, on))
	}
	for (const block of blocks) {
		if (block[0] === BlockKind.paragraph) {
			const node = part(document, "p", "paragraph")
			runs(node, block[1])
			fragment.append(node)
		} else if (block[0] === BlockKind.code) {
			const wrap = part(document, "div", "codeBlock")
			const [, code, language] = block
			if (language !== "" && language !== "plaintext") {
				const tag = badge(document, language, "info", { pill: true })
				tag.dataset.hzPart = "language"
				wrap.append(tag)
			}
			const pre = part(document, "pre", "code")
			pre.textContent = code
			wrap.append(pre)
			fragment.append(wrap)
		} else if (block[0] === BlockKind.item) {
			const node = part(document, "div", "listItem")
			node.append(text(document, "span", "marker", block[2]))
			const content = part(document, "span", "itemText")
			runs(content, block[1])
			node.append(content)
			fragment.append(node)
		} else {
			const node = part(document, "blockquote", "quote")
			runs(node, block[1])
			fragment.append(node)
		}
	}
	return fragment
}

const runNode = (document: Document, run: Run, index: number, on: RunHandlers): Node => {
	if (typeof run === "string") return document.createTextNode(run)
	const node =
		run[0] === RunKind.mention
			? button(document, "mention", undefined, () => on.mention(run[1], index))
			: run[0] === RunKind.link
				? linkNode(document, run[1], run[2], on)
				: part(
						document,
						run[0] === RunKind.code ? "code" : run[0] === RunKind.strong ? "strong" : "span",
						run[0] === RunKind.code
							? "inlineCode"
							: run[0] === RunKind.strong
								? "strong"
								: run[0] === RunKind.emphasis
									? "emphasis"
									: "strike",
					)
	if (node.textContent === "") node.textContent = run[1]
	node.dataset.run = String(index)
	return node
}

/** A link opens on its own unless the view handles `pressLink` (then the view decides). */
const linkNode = (document: Document, label: string, url: string, on: RunHandlers) => {
	const node = part(document, "a", "link")
	node.setAttribute("href", url)
	node.setAttribute("target", "_blank")
	node.setAttribute("rel", "noopener noreferrer")
	node.textContent = label
	node.addEventListener("click", (event) => {
		event.stopPropagation()
		if (on.link(url)) event.preventDefault()
	})
	return node
}

// ---------------------------------------------------------------------------
// reactions
// ---------------------------------------------------------------------------

/** "reacted by Grace, Alan and 1 other", for the pill's tooltip. */
export const reactedBy = (reaction: Reaction): string | undefined => {
	const who = reaction.who
	if (who === undefined || who.names.length === 0) return undefined
	const names = [...who.names]
	if (who.others > 0) names.push(`${who.others} ${who.others === 1 ? "other" : "others"}`)
	const last = names.pop()
	return `reacted by ${names.length === 0 ? last : `${names.join(", ")} and ${last}`}`
}

const isImage = (emoji: string) => /^(https?:|\/|data:)/.test(emoji)

export const reactionPill = (document: Document, reaction: Reaction, onPress: () => void) => {
	const pill = button(document, "reaction", undefined, onPress)
	pill.setAttribute("aria-pressed", String(reaction.mine))
	if (reaction.mine) pill.setAttribute("data-mine", "")
	const who = reactedBy(reaction)
	const name = isImage(reaction.emoji) ? "custom emoji" : reaction.emoji
	pill.setAttribute(
		"aria-label",
		`${name} ${reaction.count} ${reaction.count === 1 ? "reaction" : "reactions"}${who ? `, ${who}` : ""}`,
	)
	if (who !== undefined) pill.title = who
	if (isImage(reaction.emoji)) {
		const image = element(document, "img", "emojiImage")
		image.src = reaction.emoji
		image.alt = ""
		pill.append(image)
	} else pill.append(text(document, "span", "emoji", reaction.emoji))
	pill.append(text(document, "span", "count", String(reaction.count)))
	return pill
}

export const reactionPills = (
	document: Document,
	reactions: ReadonlyArray<Reaction>,
	onPress: (emoji: string) => void,
	onAdd: (() => void) | undefined,
) => {
	const bar = part(document, "div", "reactions")
	for (const reaction of reactions)
		bar.append(reactionPill(document, reaction, () => onPress(reaction.emoji)))
	if (onAdd !== undefined) {
		const add = button(document, "addReaction", "Add reaction", onAdd)
		add.append(icon(document, "emoji-add"))
		bar.append(add)
	}
	return bar
}

// ---------------------------------------------------------------------------
// attachments
// ---------------------------------------------------------------------------

export interface AttachmentHandlers {
	readonly press: (id: string) => void
	readonly remove: ((id: string) => void) | undefined
}

const progressBar = (document: Document, value: number | undefined) => {
	if (value === undefined) return undefined
	const bar = part(document, "span", "progress")
	bar.setAttribute("role", "progressbar")
	bar.setAttribute("aria-valuemin", "0")
	bar.setAttribute("aria-valuemax", "100")
	const percent = Math.round(Math.min(1, Math.max(0, value)) * 100)
	bar.setAttribute("aria-valuenow", String(percent))
	const fill = part(document, "span", "progressFill")
	fill.style.width = `${percent}%`
	bar.append(fill)
	return bar
}

/** A typed media element named as a part. */
const element = <K extends "img" | "video">(document: Document, tagName: K, name: string) => {
	const node = document.createElement(tagName)
	node.dataset.hzPart = name
	return node
}

/** Today's mosaic caps a lone image at 400 by 300; whole pixels keep later rows on the pixel grid. */
const LONE_WIDTH = 400
const LONE_HEIGHT = 300

const media = (document: Document, attachment: Attachment, on: AttachmentHandlers, lone: boolean) => {
	const tile = button(document, "media", `Open ${attachment.name}`, () => on.press(attachment.id))
	tile.dataset.kind = attachment.kind
	// A lone tile takes its pixel size before the image loads, as native lays it out.
	const { width, height } = attachment
	if (lone && width !== undefined && height !== undefined && width > 0 && height > 0) {
		const scale = Math.min(1, LONE_WIDTH / width, LONE_HEIGHT / height)
		tile.style.width = `${Math.round(width * scale)}px`
		tile.style.height = `${Math.round(height * scale)}px`
	}
	if (attachment.url !== undefined && attachment.kind === "image") {
		const image = element(document, "img", "image")
		image.src = attachment.url
		image.alt = attachment.name
		image.loading = "lazy"
		tile.append(image)
	} else if (attachment.url !== undefined) {
		const video = element(document, "video", "image")
		video.src = attachment.url
		video.muted = true
		video.preload = "metadata"
		tile.append(video)
	}
	if (attachment.kind === "video") tile.append(text(document, "span", "play", "▶"))
	const bar = progressBar(document, attachment.progress)
	if (bar !== undefined) tile.append(bar)
	return tile
}

const fileCard = (document: Document, attachment: Attachment, on: AttachmentHandlers) => {
	const card = button(document, "file", undefined, () => on.press(attachment.id))
	card.append(icon(document, "paperclip", "fileIcon"))
	const info = part(document, "span", "fileInfo")
	info.append(text(document, "span", "fileName", attachment.name))
	if (attachment.size !== undefined) info.append(text(document, "span", "fileSize", attachment.size))
	card.append(info, icon(document, "download", "fileAction"))
	const bar = progressBar(document, attachment.progress)
	if (bar !== undefined) card.append(bar)
	return card
}

/** Images and videos in a grid, then files as cards; each removable when `on.remove` is set. */
export const attachments = (document: Document, list: ReadonlyArray<Attachment>, on: AttachmentHandlers) => {
	const grid = part(document, "div", "attachments")
	const visual = list.filter((each) => each.kind !== "file")
	const files = list.filter((each) => each.kind === "file")
	const wrap = (attachment: Attachment, node: HTMLElement) => {
		const remove = on.remove
		if (remove === undefined) return node
		const cell = part(document, "div", "cell")
		const close = button(document, "remove", `Remove ${attachment.name}`, () => remove(attachment.id))
		close.append(icon(document, "close"))
		cell.append(node, close)
		return cell
	}
	if (visual.length > 0) {
		const mosaic = part(document, "div", "mosaic")
		mosaic.dataset.count = String(Math.min(visual.length, 4))
		for (const each of visual) mosaic.append(wrap(each, media(document, each, on, visual.length === 1)))
		grid.append(mosaic)
	}
	if (files.length > 0) {
		const column = part(document, "div", "files")
		for (const each of files) column.append(wrap(each, fileCard(document, each, on)))
		grid.append(column)
	}
	return grid
}

// ---------------------------------------------------------------------------
// link cards
// ---------------------------------------------------------------------------

const hostOf = (url: string) => {
	try {
		return new URL(url).host.replace(/^www\./, "")
	} catch {
		return url
	}
}

/** A link preview card (`linkPreviewView`): title, description, site, then the image. */
export const embedCard = (document: Document, embed: Embed, onClick: (event: MouseEvent) => void) => {
	const card = part(document, "a", "card")
	card.setAttribute("href", embed.url)
	card.setAttribute("target", "_blank")
	card.setAttribute("rel", "noopener noreferrer")
	const site = embed.site ?? hostOf(embed.url)
	const body = part(document, "span", "cardText")
	body.append(text(document, "span", "title", embed.title ?? site))
	if (embed.description !== undefined) body.append(text(document, "span", "description", embed.description))
	body.append(text(document, "span", "site", site))
	card.append(body)
	if (embed.image !== undefined) {
		const frame = part(document, "span", "cardMedia")
		const image = element(document, "img", "image")
		image.src = embed.image
		image.alt = ""
		image.loading = "lazy"
		frame.append(image)
		card.append(frame)
	}
	card.addEventListener("click", onClick)
	return card
}

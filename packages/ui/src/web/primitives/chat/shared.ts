/**
 * What the chat leaves share (lane A5): events, rich text runs, reaction pills, attachments and link
 * cards. Every part is a `data-hz-part` node so the generated reset applies; the layout, motion and
 * hover reveals the recipes cannot say live in `styles.ts`, keyed on the same parts.
 */
import type { Attachment, Block, Embed, Reaction, Run } from "../../../vocabulary/content.ts"
import { BlockKind, RunKind } from "../../../vocabulary/content.ts"
import type { AttachmentLayout, IconName } from "../../../vocabulary/options.ts"
import { ditherInitial } from "../../../../../../apps/web-foldkit/src/ui/dither-avatar.ts"
import { fileIconSvg } from "../../file-icons.ts"
import { svg } from "../../icons.ts"
import { mark } from "../../motion.ts"
import { ditherLayer } from "../content/dither.ts"
import { flag, part, type Plain, type Primitive } from "../define.ts"
import { attachTip } from "../overlays/tooltip.ts"
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
	/** A code block's copy button, drawn only when set; `block` is the block's index in the body. */
	readonly copyCode?: ((block: number) => void) | undefined
}

/**
 * The blocks of a row's body. Runs are numbered across the whole body (`data-hz-run`), the index
 * `pressMention` reports and `popover.anchorTo` finds.
 */
export const richText = (document: Document, blocks: ReadonlyArray<Block>, on: RunHandlers): Node => {
	const fragment = document.createDocumentFragment()
	let index = 0
	const runs = (into: HTMLElement, list: ReadonlyArray<Run>) => {
		for (const run of list) into.append(runNode(document, run, index++, on))
	}
	blocks.forEach((block, at) => {
		if (block[0] === BlockKind.paragraph) {
			const node = part(document, "p", "paragraph")
			runs(node, block[1])
			fragment.append(node)
		} else if (block[0] === BlockKind.code) {
			const wrap = part(document, "div", "codeBlock")
			const [, code, language] = block
			// Today's corner (`codeBlockView`): the language pill, then the copy button on hover.
			const controls = part(document, "div", "codeControls")
			if (language !== "" && language !== "plaintext") {
				const tag = badge(document, language, "info", { pill: true })
				tag.dataset.hzPart = "language"
				controls.append(tag)
			}
			const copy = on.copyCode
			if (copy !== undefined) {
				const press = button(document, "copyCode", "Copy code", () => copy(at))
				press.title = "Copy code"
				press.append(icon(document, "copy"))
				controls.append(press)
			}
			if (controls.childElementCount > 0) wrap.append(controls)
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
	})
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
	node.dataset.hzRun = String(index)
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
	// Today's `ReactionUserList`: "A, B and C", or "A, B, C, and 2 others".
	if (who.others > 0)
		return `reacted by ${who.names.join(", ")}, and ${who.others} ${who.others === 1 ? "other" : "others"}`
	const names = [...who.names]
	const last = names.pop()
	return `reacted by ${names.length === 0 ? last : `${names.join(", ")} and ${last}`}`
}

/** Today's reaction tooltip delay (`delayMs: 300`). */
const REACTION_TIP_MS = 300

const isImage = (emoji: string) => /^(https?:|\/|data:)/.test(emoji)

/** Counts by emoji from the last draw: a new pill enters, a rise pops and rolls up, a fall rolls down. */
export type ReactionCounts = ReadonlyMap<string, number>

export const countsOf = (reactions: ReadonlyArray<Reaction>): ReactionCounts =>
	new Map(reactions.map((reaction) => [reaction.emoji, reaction.count]))

export const reactionPill = (
	document: Document,
	reaction: Reaction,
	onPress: () => void,
	previous?: ReactionCounts,
) => {
	const pill = button(document, "reaction", undefined, onPress)
	pill.setAttribute("aria-pressed", String(reaction.mine))
	if (reaction.mine) pill.setAttribute("data-mine", "")
	const who = reactedBy(reaction)
	const name = isImage(reaction.emoji) ? "custom emoji" : reaction.emoji
	pill.setAttribute(
		"aria-label",
		`${name} ${reaction.count} ${reaction.count === 1 ? "reaction" : "reactions"}${who ? `, ${who}` : ""}`,
	)
	// Today's styled tooltip after 300ms: the emoji large over who reacted (`reactionButton`).
	if (who !== undefined)
		pill.append(
			attachTip(
				document,
				pill,
				() => {
					const face = isImage(reaction.emoji)
						? element(document, "img", "tipEmojiImage")
						: text(document, "span", "tipEmoji", reaction.emoji)
					if (face instanceof HTMLImageElement) {
						face.src = reaction.emoji
						face.alt = ""
					}
					return [face, text(document, "span", "tipText", who)]
				},
				{ delay: REACTION_TIP_MS, look: "reaction" },
			),
		)
	if (isImage(reaction.emoji)) {
		const image = element(document, "img", "emojiImage")
		image.src = reaction.emoji
		image.alt = ""
		pill.append(image)
	} else pill.append(text(document, "span", "emoji", reaction.emoji))
	// Today's `countView`: the number in a clipping box, so it can roll.
	const box = part(document, "span", "countBox")
	const count = text(document, "span", "count", String(reaction.count))
	box.append(count)
	pill.append(box)
	const before = previous?.get(reaction.emoji)
	if (previous !== undefined && before === undefined) mark(pill, "enter")
	else if (before !== undefined && reaction.count !== before) {
		mark(count, reaction.count > before ? "countUp" : "countDown")
		const emoji = pill.querySelector<HTMLElement>('[data-hz-part="emoji"]')
		if (reaction.count > before && emoji !== null) mark(emoji, "pop")
	}
	return pill
}

export const reactionPills = (
	document: Document,
	reactions: ReadonlyArray<Reaction>,
	onPress: (emoji: string) => void,
	onAdd: (() => void) | undefined,
	previous?: ReactionCounts,
) => {
	const bar = part(document, "div", "reactions")
	for (const reaction of reactions)
		bar.append(reactionPill(document, reaction, () => onPress(reaction.emoji), previous))
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
	/** A failed attachment's press; without it a failed one raises `press`. */
	readonly retry?: ((id: string) => void) | undefined
	/** A tile's or row's own download button, drawn only when set (`p4-media-download`). */
	readonly download?: ((id: string) => void) | undefined
	/** How many more there are: the last grid tile reads "+N See all" and presses this instead. */
	readonly more?: { readonly count: number; readonly press: () => void } | undefined
}

/**
 * A control that holds its own buttons (a download button inside a row): a `div` with the button
 * role, pressed by click, Enter or Space, since a `<button>` cannot nest another.
 */
const pressable = (document: Document, name: string, label: string, onPress: () => void) => {
	const node = part(document, "div", name)
	node.setAttribute("role", "button")
	node.tabIndex = 0
	node.setAttribute("aria-label", label)
	node.addEventListener("click", (event) => {
		event.stopPropagation()
		onPress()
	})
	node.addEventListener("keydown", (event) => {
		if (event.target !== node || (event.key !== "Enter" && event.key !== " ")) return
		event.preventDefault()
		onPress()
	})
	return node
}

/** Today's download button (`downloadOverlay`, the row's `sq-sm` plain button). */
const downloadButton = (document: Document, attachment: Attachment, download: (id: string) => void) => {
	const press = button(document, "download", `Download ${attachment.name}`, () => download(attachment.id))
	press.append(icon(document, "download"))
	return press
}

/** A picture whose media fails to load leaves the grid, as today's `FailedToLoadMedia` drops it. */
const dropOnError = (media: HTMLElement | undefined, node: HTMLElement) =>
	media?.addEventListener("error", () => (node.closest('[data-hz-part="cell"]') ?? node).remove(), {
		once: true,
	})

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

/** The press of one attachment: `retry` when it failed and the view retries, else `press`. */
const pressOf = (attachment: Attachment, on: AttachmentHandlers) => () => {
	if (attachment.failed === true && on.retry !== undefined) on.retry(attachment.id)
	else on.press(attachment.id)
}

const labelOf = (attachment: Attachment, on: AttachmentHandlers) =>
	attachment.failed === true && on.retry !== undefined
		? `Retry ${attachment.name}`
		: `Open ${attachment.name}`

/** What a failed attachment shows: a warning, "Upload failed" and, when it retries, "Retry". */
const failure = (document: Document, on: AttachmentHandlers) => {
	const node = part(document, "span", "failure")
	node.append(icon(document, "warning"), text(document, "span", "failureText", "Upload failed"))
	if (on.retry !== undefined) node.append(text(document, "span", "retryLabel", "Retry"))
	return node
}

/** The picture of an image or video, when it has a url. */
const picture = (document: Document, attachment: Attachment, lazy: boolean) => {
	if (attachment.url === undefined || attachment.kind === "file") return undefined
	if (attachment.kind === "image") {
		const image = element(document, "img", "image")
		image.src = attachment.url
		image.alt = attachment.name
		if (lazy) image.loading = "lazy"
		return image
	}
	const video = element(document, "video", "image")
	video.src = attachment.url
	video.muted = true
	video.preload = "metadata"
	return video
}

/** Today's mosaic caps a lone image at 400 by 300; whole pixels keep later rows on the pixel grid. */
const LONE_WIDTH = 400
const LONE_HEIGHT = 300

const media = (document: Document, attachment: Attachment, on: AttachmentHandlers, lone: boolean) => {
	const tile = button(document, "media", labelOf(attachment, on), pressOf(attachment, on))
	tile.dataset.kind = attachment.kind
	flag(tile, "failed", attachment.failed)
	// A lone tile takes its pixel size before the image loads, as native lays it out.
	const { width, height } = attachment
	if (lone && width !== undefined && height !== undefined && width > 0 && height > 0) {
		const scale = Math.min(1, LONE_WIDTH / width, LONE_HEIGHT / height)
		tile.style.width = `${Math.round(width * scale)}px`
		tile.style.height = `${Math.round(height * scale)}px`
	}
	const shown = picture(document, attachment, true)
	if (shown !== undefined) tile.append(shown)
	if (attachment.kind === "video") tile.append(text(document, "span", "play", "▶"))
	if (attachment.failed === true) tile.append(failure(document, on))
	const bar = progressBar(document, attachment.progress)
	if (bar !== undefined) tile.append(bar)
	return tile
}

const fileCard = (document: Document, attachment: Attachment, on: AttachmentHandlers) => {
	const card = button(
		document,
		"file",
		attachment.failed === true ? labelOf(attachment, on) : undefined,
		pressOf(attachment, on),
	)
	flag(card, "failed", attachment.failed)
	card.append(icon(document, "paperclip", "fileIcon"))
	const info = part(document, "span", "fileInfo")
	info.append(text(document, "span", "fileName", attachment.name))
	if (attachment.failed === true) info.append(failure(document, on))
	else if (attachment.size !== undefined) info.append(text(document, "span", "fileSize", attachment.size))
	card.append(info)
	if (attachment.failed !== true) card.append(icon(document, "download", "fileAction"))
	const bar = progressBar(document, attachment.progress)
	if (bar !== undefined) card.append(bar)
	return card
}

/** The icon a file list row or a file tile leads with. */
const kindIcon = (attachment: Attachment): IconName =>
	attachment.kind === "image" ? "image" : attachment.kind === "video" ? "play" : "paperclip"

/** Today's centred play badge (`playBadge`), for the grid and masonry tiles. */
const playBadge = (document: Document) => {
	const badge = part(document, "span", "playBadge")
	badge.setAttribute("aria-hidden", "true")
	badge.append(icon(document, "play"))
	return badge
}

/**
 * One tile of the files page's grid (`gridItem`) or masonry (`masonryItem`): the picture cropped
 * square or at its own aspect, a play badge and length on a video, a file's icon and name.
 */
const tile = (document: Document, attachment: Attachment, on: AttachmentHandlers, masonry: boolean) => {
	const download = attachment.failed === true ? undefined : on.download
	const node =
		download === undefined
			? button(document, "tile", labelOf(attachment, on), pressOf(attachment, on))
			: pressable(document, "tile", labelOf(attachment, on), pressOf(attachment, on))
	node.dataset.kind = attachment.kind
	flag(node, "failed", attachment.failed)
	const { width, height } = attachment
	// Masonry keeps each picture's own aspect; before it loads, the pixel size holds the space.
	if (masonry && width !== undefined && height !== undefined && width > 0 && height > 0)
		node.style.aspectRatio = `${width} / ${height}`
	const shown = picture(document, attachment, masonry)
	if (shown !== undefined) {
		node.append(shown)
		dropOnError(shown, node)
		// An unsized masonry tile takes the loaded picture's own height (`p4-masonry-natural-size`).
		if (masonry && node.style.aspectRatio === "") naturalAspect(shown, node)
	} else if (attachment.failed !== true) {
		const empty = part(document, "span", "tileEmpty")
		empty.append(icon(document, kindIcon(attachment), "tileIcon"))
		if (attachment.kind === "file") empty.append(text(document, "span", "tileName", attachment.name))
		node.append(empty)
	}
	if (attachment.kind === "video" && attachment.failed !== true) node.append(playBadge(document))
	if (attachment.duration !== undefined && attachment.failed !== true)
		node.append(text(document, "span", "duration", attachment.duration))
	if (attachment.failed === true) {
		const failed = failure(document, on)
		// A file has no picture to recognise it by: its name sits under "Upload failed".
		if (attachment.kind === "file")
			failed.children[1]?.after(text(document, "span", "tileName", attachment.name))
		node.append(failed)
	}
	const bar = progressBar(document, attachment.progress)
	if (bar !== undefined) node.append(bar)
	if (download !== undefined) {
		const overlay = part(document, "span", "tileActions")
		overlay.append(downloadButton(document, attachment, download))
		node.append(overlay)
	}
	return node
}

const naturalAspect = (media: HTMLImageElement | HTMLVideoElement, node: HTMLElement) => {
	const size = () =>
		media instanceof HTMLImageElement
			? { width: media.naturalWidth, height: media.naturalHeight }
			: { width: media.videoWidth, height: media.videoHeight }
	const apply = () => {
		const { width, height } = size()
		if (width > 0 && height > 0) node.style.aspectRatio = `${width} / ${height}`
	}
	media.addEventListener(media instanceof HTMLImageElement ? "load" : "loadedmetadata", apply, {
		once: true,
	})
	apply()
}

/** The last grid tile when there are more: the picture under "+N" and "See all" (`seeAllItem`). */
const seeAllTile = (
	document: Document,
	attachment: Attachment,
	more: NonNullable<AttachmentHandlers["more"]>,
) => {
	const node = button(document, "tile", `See all, ${more.count} more`, more.press)
	node.dataset.kind = attachment.kind
	node.dataset.more = ""
	const shown = picture(document, attachment, false)
	if (shown !== undefined) node.append(shown)
	const cover = part(document, "span", "moreCover")
	cover.append(
		text(document, "span", "moreCount", `+${more.count}`),
		text(document, "span", "moreLabel", "See all"),
	)
	node.append(cover)
	return node
}

/** A file row's leading icon: its type's coloured icon, else one by kind. */
const rowIcon = (document: Document, attachment: Attachment) => {
	if (attachment.fileType === undefined || attachment.failed === true)
		return icon(document, kindIcon(attachment), "rowIcon")
	const node = part(document, "span", "rowIcon")
	node.setAttribute("aria-hidden", "true")
	node.dataset.fileType = attachment.fileType
	node.append(fileIconSvg(document, attachment.fileType))
	return node
}

/** Who uploaded a row's file: today's `xs` avatar (a picture, else the seeded face) and the name. */
const uploaderOf = (document: Document, uploader: NonNullable<Attachment["uploader"]>) => {
	const node = part(document, "span", "uploader")
	const face = part(document, "span", "uploaderAvatar")
	face.setAttribute("aria-hidden", "true")
	if (uploader.avatar !== undefined) {
		const image = element(document, "img", "image")
		image.src = uploader.avatar
		image.alt = ""
		face.append(image)
	} else {
		const dither = ditherLayer(document)
		dither.seed(uploader.name, 24)
		face.dataset.seeded = ""
		face.append(dither.layer, text(document, "span", "initials", ditherInitial(uploader.name)))
	}
	node.append(face, text(document, "span", "uploaderName", uploader.name))
	return node
}

/** One row of the files page's list (`documentItem`): icon, name, size and length, a download cue. */
const listRow = (document: Document, attachment: Attachment, on: AttachmentHandlers) => {
	const download = attachment.failed === true ? undefined : on.download
	const row =
		download === undefined
			? button(document, "row", labelOf(attachment, on), pressOf(attachment, on))
			: pressable(document, "row", labelOf(attachment, on), pressOf(attachment, on))
	row.dataset.kind = attachment.kind
	flag(row, "failed", attachment.failed)
	row.append(rowIcon(document, attachment))
	const info = part(document, "span", "fileInfo")
	info.append(text(document, "span", "fileName", attachment.name))
	const meta = [attachment.size, attachment.duration, attachment.meta].filter((each) => each !== undefined)
	if (attachment.failed === true) info.append(failure(document, on))
	else if (meta.length > 0) {
		// Today's `flex gap-2` line with a hidden `·` between the size and the time.
		const line = part(document, "span", "fileSize")
		meta.forEach((each, index) => {
			if (index > 0) {
				const dot = text(document, "span", "metaDot", "·")
				dot.setAttribute("aria-hidden", "true")
				line.append(dot)
			}
			line.append(text(document, "span", "metaPart", each))
		})
		info.append(line)
	}
	row.append(info)
	if (attachment.uploader !== undefined && attachment.failed !== true)
		row.append(uploaderOf(document, attachment.uploader))
	// Its own download button when the view downloads, else a cue that a press downloads.
	if (download !== undefined) row.append(downloadButton(document, attachment, download))
	else if (attachment.failed !== true) row.append(icon(document, "download", "fileAction"))
	const bar = progressBar(document, attachment.progress)
	if (bar !== undefined) row.append(bar)
	return row
}

/**
 * Attachments in a `layout`: the message's `mosaic` (images and videos, then files as cards), or the
 * files page's `grid`, `masonry` and `list` of every attachment in order. Each is removable when
 * `on.remove` is set.
 */
export const attachments = (
	document: Document,
	list: ReadonlyArray<Attachment>,
	on: AttachmentHandlers,
	layout: AttachmentLayout = "mosaic",
) => {
	const grid = part(document, "div", "attachments")
	const wrap = (attachment: Attachment, node: HTMLElement) => {
		const remove = on.remove
		if (remove === undefined) return node
		const cell = part(document, "div", "cell")
		const close = button(document, "remove", `Remove ${attachment.name}`, () => remove(attachment.id))
		close.append(icon(document, "close"))
		cell.append(node, close)
		return cell
	}
	if (layout !== "mosaic") {
		const holder = part(
			document,
			"div",
			layout === "list" ? "rows" : layout === "grid" ? "tiles" : "masonry",
		)
		const more = layout === "grid" && on.more !== undefined && on.more.count > 0 ? on.more : undefined
		list.forEach((each, index) =>
			holder.append(
				wrap(
					each,
					layout === "list"
						? listRow(document, each, on)
						: more !== undefined && index === list.length - 1
							? seeAllTile(document, each, more)
							: tile(document, each, on, layout === "masonry"),
				),
			),
		)
		grid.append(holder)
		return grid
	}
	const visual = list.filter((each) => each.kind !== "file")
	const files = list.filter((each) => each.kind === "file")
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

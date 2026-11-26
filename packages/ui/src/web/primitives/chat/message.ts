/**
 * `hz:message` (lane A5): one chat row drawn from its data (`content.ts` `MessageRow`), today's
 * `chat/message/row.ts`. A leaf: the row is one structured prop, redrawn as a whole when it changes;
 * the states are flags (`data-<flag>`), and the hover toolbar is part of the row.
 */
import type { MessageRow } from "../../../vocabulary/content.ts"
import type { IconName, MessageAction } from "../../../vocabulary/options.ts"
import { ditherInitial } from "../../../../../../apps/web-foldkit/src/ui/dither-avatar.ts"
import { mark } from "../../motion.ts"
import { ditherLayer } from "../content/dither.ts"
import { ensureStyles as ensureContentStyles } from "../content/styles.ts"
import { definePrimitive, flag, part, type Primitive } from "../define.ts"
import {
	attachments,
	badge,
	batched,
	button,
	embedCard,
	ensureStyles,
	fire,
	handles,
	icon,
	countsOf,
	type ReactionCounts,
	reactionPills,
	richText,
	text,
} from "./shared.ts"

const flags = ["grouped", "pinned", "highlighted", "entering", "pending", "failed"] as const
type Flag = (typeof flags)[number]
const isFlag = (name: string): name is Flag => flags.some((each) => each === name)

/** Each action's toolbar label and icon (`toolbar.ts`); `react` opens the picker (`addReaction`). */
const actionLook = {
	react: { label: "Add reaction", icon: "emoji-add" },
	reply: { label: "Reply", icon: "reply" },
	thread: { label: "Reply in thread", icon: "thread" },
	copy: { label: "Copy message", icon: "copy" },
	edit: { label: "Edit message", icon: "edit" },
	pin: { label: "Pin message", icon: "pin" },
	unpin: { label: "Unpin message", icon: "pin" },
	issue: { label: "Create issue", icon: "lightbulb" },
	// iOS only (native selection on a bitmap row): the web's toolbar leaves it out, its text is selectable.
	selectText: { label: "Select text", icon: "copy" },
	delete: { label: "Delete message", icon: "trash" },
} as const satisfies Record<MessageAction, { readonly label: string; readonly icon: IconName }>

const EMOJI_ONLY =
	/^(?:\p{Extended_Pictographic}|\p{Regional_Indicator}|[\u{1F3FB}-\u{1F3FF}\uFE0F\u200D\u20E3])+$/u

/** One plain paragraph of emoji and spaces only. */
const isEmojiOnly = (body: MessageRow["body"]) => {
	const block = body[0]
	if (body.length !== 1 || block === undefined || block[0] !== 0) return false
	const runs = block[1]
	if (!runs.every((run) => typeof run === "string")) return false
	const text = runs.join("").replace(/\s/g, "")
	return text !== "" && EMOJI_ONLY.test(text)
}

const isRow = (value: unknown): value is MessageRow =>
	typeof value === "object" && value !== null && "time" in value && "body" in value

export const primitive = definePrimitive("message", ({ document, tag, outer }) => {
	ensureStyles(document)
	// The seeded avatar's dither layer is styled with the avatar's (`content/styles.ts`).
	ensureContentStyles(document)
	const node = outer("div")
	node.setAttribute("role", "article")
	// Focusable for the keyboard (the list's arrow navigation); only keyboard focus draws the ring.
	node.tabIndex = -1
	let row: MessageRow | undefined
	/** The flags that are on. */
	const on = new Set<Flag>()
	// Reaction counts at the last draw; undefined until then, so a row's first pills do not move.
	let counts: ReactionCounts | undefined

	/** A picture, else today's dither seeded by the name under its one initial (`avatar-seed-tint`). */
	const avatar = (
		name: string | undefined,
		initials: string | undefined,
		url: string | undefined,
		options: { readonly decorative: boolean; readonly px: number },
	) => {
		const box = part(document, "span", "avatarImage")
		if (url !== undefined) {
			const image = document.createElement("img")
			image.dataset.hzPart = "image"
			image.src = url
			image.alt = ""
			box.append(image)
		} else if (name !== undefined && name.trim() !== "") {
			const dither = ditherLayer(document)
			dither.seed(name, options.px)
			const initial = part(document, "span", "initials")
			initial.textContent = ditherInitial(name)
			box.dataset.seeded = ""
			box.append(dither.layer, initial)
		} else if (initials !== undefined) box.textContent = initials
		if (options.decorative) box.setAttribute("aria-hidden", "true")
		return box
	}

	const header = (data: MessageRow) => {
		const head = part(document, "div", "header")
		const author = button(document, "author", undefined, () => fire(primitive, "pressAuthor"))
		author.textContent = data.author ?? ""
		head.append(author)
		if (data.status !== undefined) head.append(text(document, "span", "status", data.status))
		if (data.provider !== undefined) {
			const label = data.provider === "slack" ? "Slack" : "Discord"
			const mark = icon(document, data.provider, "provider")
			mark.removeAttribute("aria-hidden")
			mark.setAttribute("role", "img")
			mark.setAttribute("aria-label", `Synced from ${label}`)
			mark.title = `Synced from ${label}`
			head.append(mark)
		}
		for (const each of data.badges ?? []) head.append(badge(document, each.label, each.tone))
		head.append(
			text(document, "span", "time", data.edited === true ? `${data.time} (edited)` : data.time),
		)
		if (on.has("pinned")) {
			const pinned = part(document, "span", "pinnedLabel")
			pinned.title = "Pinned message"
			pinned.append(icon(document, "pin"), text(document, "span", "pinnedText", "Pinned"))
			head.append(pinned)
		}
		return head
	}

	const reply = (data: NonNullable<MessageRow["reply"]>) => {
		const wrap = part(document, "div", "reply")
		const curve = part(document, "span", "replyCurve")
		curve.setAttribute("aria-hidden", "true")
		const line = button(document, "replyLine", `Jump to ${data.author}'s message`, () =>
			fire(primitive, "pressReply"),
		)
		const face = avatar(data.author, data.initials, undefined, { decorative: true, px: 16 })
		face.dataset.hzPart = "replyAvatar"
		line.append(
			face,
			text(document, "span", "replyAuthor", data.author),
			text(document, "span", "replyText", data.text === "" ? "Click to see attachment" : data.text),
		)
		wrap.append(curve, line)
		return wrap
	}

	const thread = (data: NonNullable<MessageRow["thread"]>) => {
		const card = button(
			document,
			"thread",
			`Open thread${data.name === undefined ? "" : ` ${data.name}`}, ${data.count} ${data.count === 1 ? "message" : "messages"}`,
			() => fire(primitive, "pressThread"),
		)
		const top = part(document, "span", "threadTop")
		if (data.name !== undefined) top.append(text(document, "span", "threadName", data.name))
		// Today's count and chevron are one span (`gap-0.5`), after the name.
		const count = text(
			document,
			"span",
			"threadCount",
			`${data.count} ${data.count === 1 ? "Message" : "Messages"}`,
		)
		count.append(icon(document, "chevron-right"))
		top.append(count)
		const last = part(document, "span", "threadLast")
		const face = avatar(data.author, data.initials, undefined, { decorative: true, px: 16 })
		face.dataset.hzPart = "threadAvatar"
		last.append(
			face,
			text(document, "span", "threadAuthor", data.author),
			text(document, "span", "threadPreview", data.preview),
			text(document, "span", "threadTime", data.time),
		)
		card.append(top, last)
		return card
	}

	const toolbar = (data: MessageRow) => {
		const quick = data.quick ?? []
		// The web's text is selectable already, so its toolbar leaves `selectText` out.
		const actions = (data.actions ?? []).filter((action) => action !== "selectText")
		if (quick.length === 0 && actions.length === 0) return undefined
		const bar = part(document, "div", "toolbar")
		bar.setAttribute("role", "toolbar")
		bar.setAttribute("aria-label", "Message actions")
		for (const emoji of quick) {
			const press = button(document, "quick", `React with ${emoji}`, () =>
				fire(primitive, "pressReaction", { emoji }),
			)
			press.textContent = emoji
			bar.append(press)
		}
		if (quick.length > 0 && actions.length > 0) bar.append(part(document, "span", "separator"))
		for (const action of actions) {
			const look = actionLook[action]
			const press = button(document, "tool", look.label, () =>
				// `react` opens the screen's picker: through `addReaction` when handled, else as an action.
				action === "react" && handles(primitive, "addReaction")
					? fire(primitive, "addReaction")
					: fire(primitive, "action", { action }),
			)
			press.title = look.label
			press.dataset.action = action
			press.append(icon(document, look.icon))
			bar.append(press)
		}
		return bar
	}

	const draw = batched(() => {
		node.replaceChildren()
		const data = row
		if (data === undefined) return
		// A grouped row still shows its author when it quotes another message (today's `showAvatar`).
		const showHeader = !on.has("grouped") || data.reply !== undefined
		node.setAttribute(
			"aria-label",
			[data.author, data.time, on.has("pinned") ? "pinned" : undefined].filter(Boolean).join(", "),
		)
		if (data.reply !== undefined) node.append(reply(data.reply))
		const main = part(document, "div", "main")
		if (showHeader && data.thread !== undefined) {
			const spine = part(document, "span", "spine")
			spine.setAttribute("aria-hidden", "true")
			main.append(spine)
		}
		if (showHeader) {
			const face = button(document, "avatar", data.author, () => fire(primitive, "pressAuthor"))
			face.append(
				avatar(data.author, data.initials, data.avatar, {
					decorative: data.author === undefined,
					px: 40,
				}),
			)
			main.append(face)
		} else main.append(text(document, "span", "gutterTime", data.time))
		const body = part(document, "div", "body")
		if (showHeader && data.author !== undefined) body.append(header(data))
		const content = part(document, "div", "text")
		// A body of only emoji is drawn large, as today's `text-2xl` (`isEmojiOnly`).
		if (isEmojiOnly(data.body)) content.dataset.emojiOnly = ""
		content.append(
			richText(document, data.body, {
				mention: (userId, run) => fire(primitive, "pressMention", { userId, run }),
				link: (url) => fire(primitive, "pressLink", { url }),
			}),
		)
		body.append(content)
		if ((data.files ?? []).length > 0)
			body.append(
				attachments(document, data.files ?? [], {
					press: (id) => fire(primitive, "pressAttachment", { id }),
					remove: undefined,
				}),
			)
		for (const embed of data.embeds ?? [])
			body.append(
				embedCard(document, embed, (event) => {
					event.stopPropagation()
					if (fire(primitive, "pressLink", { url: embed.url })) event.preventDefault()
				}),
			)
		if ((data.reactions ?? []).length > 0)
			body.append(
				reactionPills(
					document,
					data.reactions ?? [],
					(emoji) => fire(primitive, "pressReaction", { emoji }),
					handles(primitive, "addReaction") ? () => fire(primitive, "addReaction") : undefined,
					counts,
				),
			)
		counts = countsOf(data.reactions ?? [])
		if (data.thread !== undefined) body.append(thread(data.thread))
		if (on.has("failed")) {
			const status = part(document, "div", "failure")
			status.setAttribute("role", "status")
			status.append(icon(document, "warning"), text(document, "span", "failureText", "Not sent."))
			const retry = button(document, "retry", undefined, () => fire(primitive, "retry"))
			retry.textContent = "Retry"
			status.append(retry)
			body.append(status)
		}
		main.append(body)
		node.append(main)
		const bar = toolbar(data)
		if (bar !== undefined) node.append(bar)
	})

	node.addEventListener("contextmenu", (event) => {
		if (fire(primitive, "longPress")) event.preventDefault()
	})

	const primitive: Primitive = {
		tag,
		outer: node,
		content: node,
		set: (name, value) => {
			if (name === "row") row = isRow(value) ? value : undefined
			else if (isFlag(name)) {
				// A live arrival rises in once (`recipe.motion` enter, today's `animate-message-enter`).
				if (name === "entering" && value === true && !on.has(name)) mark(node, "enter")
				if (value === true) on.add(name)
				else on.delete(name)
				flag(node, name, value)
			} else return
			draw()
		},
		events: undefined,
	}
	return primitive
})

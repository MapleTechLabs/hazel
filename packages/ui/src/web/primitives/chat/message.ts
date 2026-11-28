/**
 * `hz:message` (lane A5): one chat row drawn from its data (`content.ts` `MessageRow`), today's
 * `chat/message/row.ts`. A leaf: the row is one structured prop, redrawn as a whole when it changes;
 * the states are flags (`data-<flag>`), and the hover toolbar is part of the row. A right click opens
 * a menu at the pointer from the row's own `quick` and `actions` (today's context menu).
 */
import type { MenuGroups, MessageRow } from "../../../vocabulary/content.ts"
import type { IconName, MessageAction } from "../../../vocabulary/options.ts"
import { ditherInitial } from "../../../../../../apps/web-foldkit/src/ui/dither-avatar.ts"
import { mark } from "../../motion.ts"
import { ditherLayer } from "../content/dither.ts"
import { ensureStyles as ensureContentStyles } from "../content/styles.ts"
import { definePrimitive, flag, part, type Primitive } from "../define.ts"
import { createMenuList } from "../overlays/menu-list.ts"
import { attachTip } from "../overlays/tooltip.ts"
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
	copyImage: { label: "Copy image", icon: "image" },
	copyImageUrl: { label: "Copy image address", icon: "link" },
	copyId: { label: "Copy message ID", icon: "copy" },
} as const satisfies Record<MessageAction, { readonly label: string; readonly icon: IconName }>

/** The right-click menu's groups and labels, in today's order (`contextMenuEntries`). */
const menuGroups: ReadonlyArray<ReadonlyArray<MessageAction>> = [
	["react"],
	["reply", "edit", "thread", "issue"],
	["copy", "copyImage", "copyImageUrl", "pin", "unpin"],
	["delete", "copyId"],
]
/** Today's menu words and icons, where they differ from the toolbar's. */
const menuLook = {
	...actionLook,
	copy: { label: "Copy text", icon: "copy" },
	pin: { label: "Pin message", icon: "star" },
	unpin: { label: "Unpin message", icon: "unpin" },
	issue: { label: "Create issue", icon: "support" },
} as const satisfies Record<MessageAction, { readonly label: string; readonly icon: IconName }>

type Looks = Readonly<Record<MessageAction, { readonly label: string; readonly icon: IconName }>>

/** The row's actions as menu groups; `selectText` is iOS only, as on the toolbar. */
const menuOf = (actions: ReadonlyArray<MessageAction>, looks: Looks): MenuGroups =>
	menuGroups
		.map((group) => ({
			entries: group
				.filter((action) => actions.includes(action))
				.map((action) => {
					const look = looks[action]
					return {
						id: action,
						label: look.label,
						icon: look.icon,
						destructive: action === "delete",
					}
				}),
		}))
		.filter((group) => group.entries.length > 0)

/** The actions today's toolbar keeps on the bar, in its order, and those its More menu holds. */
const barActions: ReadonlyArray<MessageAction> = ["react", "copy", "edit", "reply", "delete"]
const moreActions: ReadonlyArray<MessageAction> = ["thread", "issue", "pin", "unpin"]
/** Only over an image: the right-click menu's image entries. */
const imageActions: ReadonlyArray<MessageAction> = ["copyImage", "copyImageUrl"]
/** The More menu's look (`overlay-views.ts`): thread, support and star icons. */
const moreLook = {
	...menuLook,
	pin: { label: "Pin message", icon: "star" },
	unpin: { label: "Unpin message", icon: "star" },
} as const satisfies Record<MessageAction, { readonly label: string; readonly icon: IconName }>
/** Today's toolbar tooltips wait React Aria's 1.5s. */
const TOOL_TIP_MS = 1500

const isAction = (id: string): id is MessageAction => Object.hasOwn(actionLook, id)

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
		const face = avatar(data.author, data.initials, data.avatar, { decorative: true, px: 16 })
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
		const face = avatar(data.author, data.initials, data.avatar, { decorative: true, px: 16 })
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

	/** A toolbar button with today's styled tooltip (React Aria's 1.5s delay). */
	const tool = (name: string, label: string, onPress: (event: MouseEvent) => void) => {
		const press = button(document, name, label, onPress)
		return {
			press,
			tip: attachTip(document, press, () => [label], { delay: TOOL_TIP_MS, look: "panel" }),
		}
	}

	const toolbar = (data: MessageRow) => {
		const quick = data.quick ?? []
		// The web's text is selectable already, so its toolbar leaves `selectText` out.
		const actions: ReadonlyArray<MessageAction> = (data.actions ?? []).filter(
			(action) => action !== "selectText",
		)
		// Today's bar keeps `react copy edit reply delete`; the rest fold into More (`moreMenuEntries`).
		const onBar = barActions.filter((action) => actions.includes(action))
		const more = actions.filter((action) => moreActions.includes(action))
		if (quick.length === 0 && actions.length === 0) return undefined
		const bar = part(document, "div", "toolbar")
		bar.setAttribute("role", "toolbar")
		bar.setAttribute("aria-label", "Message actions")
		for (const emoji of quick) {
			const { press, tip } = tool("quick", `React with ${emoji}`, () =>
				fire(primitive, "pressReaction", { emoji }),
			)
			press.textContent = emoji
			bar.append(press, tip)
		}
		if (quick.length > 0 && actions.length > 0) bar.append(part(document, "span", "separator"))
		for (const action of onBar) {
			const look = actionLook[action]
			const { press, tip } = tool("tool", look.label, () =>
				// `react` opens the screen's picker: through `addReaction` when handled, else as an action.
				action === "react" && handles(primitive, "addReaction")
					? fire(primitive, "addReaction")
					: fire(primitive, "action", { action }),
			)
			press.dataset.action = action
			press.append(icon(document, look.icon))
			bar.append(press, tip)
		}
		if (more.length > 0) {
			if (onBar.length > 0) bar.append(part(document, "span", "separator"))
			const { press, tip } = tool("tool", "More actions", () => {
				const rect = press.getBoundingClientRect()
				// One group, no separators, as today's More menu.
				const entries = menuOf(more, moreLook).flatMap((group) => group.entries)
				menuImage = undefined
				openMenu(
					[{ entries }],
					{ x: rect.left, y: rect.top, width: rect.width, height: rect.height },
					{
						placement: { side: "bottom", align: "end", gap: 4 },
						quick: [],
						trigger: press,
						flag: "more-open",
					},
				)
			})
			press.dataset.action = "more"
			press.setAttribute("aria-haspopup", "menu")
			press.append(icon(document, "dots-vertical"))
			bar.append(press, tip)
		}
		return bar
	}

	const draw = batched(() => {
		// The menu host stays put: moving an open popover would close it.
		for (const child of [...node.childNodes]) if (child !== menuHost) child.remove()
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
				// The copy button shows when the screen copies (`copyCode`, through `Clipboard`).
				copyCode: handles(primitive, "copyCode")
					? (block) => fire(primitive, "copyCode", { block })
					: undefined,
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

	// The right-click menu: its host is a `contextMenu` (the overlay recipe), kept in the row across draws.
	const menuHost = document.createElement("div")
	menuHost.dataset.hz = "contextMenu"
	menuHost.dataset.hzPart = "menu"
	node.append(menuHost)
	const menu = createMenuList(document, menuHost, (action) => {
		if (!isAction(action)) return
		if (action === "react" && handles(primitive, "addReaction")) fire(primitive, "addReaction")
		else if (imageActions.includes(action) && menuImage !== undefined)
			fire(primitive, "action", { action, image: menuImage })
		else fire(primitive, "action", { action })
	})
	/** The attachment image the right-click menu opened over, which its image entries copy. */
	let menuImage: string | undefined
	menu.setLabel("Message actions")

	/** Today's header of quick reactions over the entries (`contextMenuHeader`). */
	const quickHeader = (quick: ReadonlyArray<string>) => {
		const header = part(document, "div", "menuQuick")
		header.setAttribute("role", "group")
		header.setAttribute("aria-label", "Quick reactions")
		for (const emoji of quick) {
			// An `item` so the menu's arrow keys reach it; it reacts on its own, the menu never picks it.
			const item = part(document, "div", "item")
			item.tabIndex = -1
			item.setAttribute("role", "menuitem")
			item.setAttribute("aria-label", `React with ${emoji}`)
			item.textContent = emoji
			const react = () => {
				menu.close(true)
				fire(primitive, "pressReaction", { emoji })
			}
			item.addEventListener("click", react)
			item.addEventListener("keydown", (event) => {
				if (event.key !== "Enter" && event.key !== " ") return
				event.preventDefault()
				event.stopPropagation()
				react()
			})
			header.append(item)
		}
		return header
	}

	const openMenu = (
		groups: MenuGroups,
		anchor: { readonly x: number; readonly y: number; readonly width: number; readonly height: number },
		options: {
			readonly placement: {
				readonly side: "bottom"
				readonly align: "start" | "end"
				readonly gap: number
			}
			readonly quick: ReadonlyArray<string>
			readonly trigger?: HTMLElement
			/** The row flag set while it is open (the toolbar stays shown under its More menu). */
			readonly flag?: "menuOpen" | "more-open"
		},
	): boolean => {
		if (groups.length === 0 && options.quick.length === 0) return false
		menu.close(false)
		menu.setEntries(groups)
		if (options.quick.length > 0) menu.panel.prepend(quickHeader(options.quick))
		menu.open({
			anchor: () => anchor,
			placement: options.placement,
			focus: "first",
			inside: () => [options.trigger],
			onClose: () => flag(node, options.flag ?? "menuOpen", false),
		})
		flag(node, options.flag ?? "menuOpen", true)
		return true
	}

	/** The right-click menu at the pointer: quick reactions over every action (today's context menu). */
	const openContextMenu = (x: number, y: number, image?: string): boolean => {
		menuImage = image
		const actions = (row?.actions ?? []).filter(
			(action) => action !== "selectText" && (image !== undefined || !imageActions.includes(action)),
		)
		return openMenu(
			menuOf(actions, menuLook),
			{ x, y, width: 0, height: 0 },
			{
				placement: { side: "bottom", align: "start", gap: 2 },
				quick: row?.quick ?? [],
			},
		)
	}

	node.addEventListener("contextmenu", (event) => {
		if (event.target instanceof Node && menuHost.contains(event.target)) {
			event.preventDefault()
			return
		}
		// Without actions the screen decides (its long-press sheet, `longPress`).
		const image =
			event.target instanceof HTMLImageElement &&
			event.target.closest('[data-hz-part="media"]') !== null
				? event.target.currentSrc || event.target.src
				: undefined
		if (openContextMenu(event.clientX, event.clientY, image) || fire(primitive, "longPress"))
			event.preventDefault()
	})
	node.addEventListener("keydown", (event) => {
		if (event.target !== node) return
		if (event.key !== "ContextMenu" && !(event.shiftKey && event.key === "F10")) return
		const rect = node.getBoundingClientRect()
		if (openContextMenu(rect.left, rect.top + rect.height / 2)) event.preventDefault()
	})

	const primitive: Primitive = {
		tag,
		outer: node,
		content: node,
		set: (name, value) => {
			// An unchanged prop leaves the row's DOM (and any open toolbar or selection) as it is.
			if (name === "row") {
				const next = isRow(value) ? value : undefined
				if (next === row) return
				row = next
			} else if (isFlag(name)) {
				if ((value === true) === on.has(name)) return
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

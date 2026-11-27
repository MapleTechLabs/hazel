// Owned by lane A4 (`docs/hazel-ui.md`, "Phase 2: lanes"). `hz:item`: a sidebar row. The control (a
// link with `href`, else a button) is the row's box and holds the content parent, so slots never move.
import { rollCount } from "../../motion.ts"
import { definePrimitive, flag, option, part, type Primitive } from "../define.ts"
import { ensureSheet, fire, listens, textOf } from "../list/runtime.ts"

/** A touch held this long is a long press. */
const LONG_PRESS_MS = 500
/** A touch that drifts further than this many px is a scroll, not a press. */
const LONG_PRESS_SLOP = 10

// The thread elbow (`thread-elbow`, today's `threadBranch` in `channels-sidebar/items.ts`): from the
// row's bottom edge, the branch eases off the spine 27px up into the row's middle.
const BRANCH = "C1.75 -20 4 -16 11 -16"
const SPINE_THROUGH = `M1.75 0V-100M1.75 -27${BRANCH}`
const SPINE_TO_BRANCH = `M1.75 -100V-27${BRANCH}`

const I = '[data-hz="item"]'
// `large` and `conversation` share the grid; `conversation` then moves its metrics (`conversationCss`).
const LARGE = ':is([data-leading-size="large"], [data-leading-size="conversation"])'
const CONTROL = '> [data-hz-part="control"]'
const SLOT = (name: string) =>
	`> [data-hz-part="control"] > [data-hz-part="content"] > [data-hz-slot="${name}"]`

// Unread marks (`item-unread-pip`, `item-unread-dot`): the sidebar's edge pip (`sidebarUnreadPip`) and
// activity's brand dot in its own 8px column. Large rows beside a dotted row keep that column empty.
const unreadCss = `
${I} ${CONTROL} > [data-hz-part="unread"] { display: none; }
${I}[data-unread="pip"] ${CONTROL}::before {
	content: ""; position: absolute; top: 50%; inset-inline-start: 0; translate: 0 -50%; pointer-events: none;
	width: var(--hz-space-1); height: var(--hz-space-2); background: var(--hz-color-fg);
	border-start-end-radius: var(--hz-radius-full); border-end-end-radius: var(--hz-radius-full);
}
${I}[data-unread="dot"] ${CONTROL} > [data-hz-part="unread"],
:has(> ${I}[data-unread="dot"]) > ${I}${LARGE} ${CONTROL} > [data-hz-part="unread"] {
	display: flex; order: -1; align-items: center; justify-content: center; flex-shrink: 0;
	width: var(--hz-space-2); align-self: stretch;
}
${I}[data-unread="dot"] ${CONTROL} > [data-hz-part="unread"]::before {
	content: ""; width: var(--hz-space-2); height: var(--hz-space-2); border-radius: var(--hz-radius-full);
	background: var(--hz-color-primary);
}
/* Inline and zero-sized: an out-of-flow label would part the name ("design , unread"). */
${I} [data-hz-part="unreadLabel"] { font-size: 0; line-height: 0; clip-path: inset(50%); }
`

// The `actions` slot (`item-hover-trailing`, `item-hover-action`): hidden until the row is hovered or
// holds focus, always shown without hover. A regular row lays it over its end, as today's dots trigger;
// a large row keeps its column and shows it below today's `md`, as activity's "Mark as read".
const actionsCss = `
${I} ${SLOT("actions")} {
	display: flex; align-items: center; justify-content: flex-end; opacity: 0;
	transition: opacity var(--hz-duration-fast) var(--hz-ease-standard);
}
${I}:is(:hover, :focus-within) ${SLOT("actions")} { opacity: 1; }
@media (hover: none) { ${I} ${SLOT("actions")} { opacity: 1; } }
@media (width < 48rem) { ${I}${LARGE} ${SLOT("actions")} { opacity: 1; } }
${I}:not(${LARGE}) ${SLOT("actions")} {
	position: absolute; inset-block: 0; inset-inline-end: 0; padding-inline-end: var(--hz-space-1_5);
}
/* Today's badge (\`right-1.5\`, \`group-hover:right-8\`) makes room for the row's options: it slides
   24px toward the start on hover, a transform so the title never reflows (reduced motion: instant). */
${I}:not(${LARGE}) ${CONTROL} > [data-hz-part="badge"] {
	transition: translate var(--hz-duration-fast) var(--hz-ease-out);
}
${I}:is(:hover, :focus-within):not(${LARGE}):has(${SLOT("actions")} > *) ${CONTROL} > [data-hz-part="badge"] {
	translate: calc(-1 * var(--hz-space-6)) 0;
}
${I}:is(:hover, :focus-within):not(${LARGE}):has(${SLOT("actions")} > *):dir(rtl) ${CONTROL} > [data-hz-part="badge"] {
	translate: var(--hz-space-6) 0;
}
${I}:has(${SLOT("actions")} :focus-visible) ${CONTROL} { background-color: var(--hz-color-wash); }
`

// `titleLines` and `subtitleLines` `2`: the text wraps and clamps at two lines.
const clamp =
	"white-space: normal; overflow-wrap: anywhere; display: -webkit-box; -webkit-box-orient: vertical; -webkit-line-clamp: 2;"
const linesCss = `
${I}[data-title-lines="2"] ${CONTROL} > [data-hz-part="title"] { ${clamp} }
${I}[data-subtitle-lines="2"] ${CONTROL} > [data-hz-part="subtitle"] { ${clamp} }
`

// `leadingSize` `large` (`item-leading-size`): today's activity row. A 40px leading column, top
// aligned; the trailing slot on the title's line, the subtitle under both; the dot column first.
const largeCss = `
${I}${LARGE} ${CONTROL} {
	transition: color var(--hz-duration-fast) var(--hz-ease-standard),
		background-color var(--hz-duration-fast) var(--hz-ease-standard);
	display: grid; align-items: start; column-gap: 0; row-gap: 0; border-radius: 0;
	grid-template-columns: auto minmax(0, 1fr) auto auto;
	grid-template-rows: auto minmax(0, 1fr);
	grid-template-areas: "leading title trailing actions" "leading subtitle subtitle actions";
}
${I}[data-leading-size="large"] ${CONTROL} {
	padding: var(--hz-space-3) var(--hz-space-4); color: var(--hz-color-fg);
	min-height: calc(var(--hz-space-10) + var(--hz-space-1_5) + 2 * var(--hz-space-3));
	font-size: var(--hz-text-label-size); line-height: var(--hz-text-label-leading);
}
${I}${LARGE}[data-badged] ${CONTROL} {
	grid-template-areas: "leading title trailing actions" "leading subtitle badge actions";
}
${I}${LARGE}[data-unread="dot"] ${CONTROL},
:has(> ${I}[data-unread="dot"]) > ${I}${LARGE} ${CONTROL} {
	grid-template-columns: auto auto minmax(0, 1fr) auto auto;
	grid-template-areas: "unread leading title trailing actions" "unread leading subtitle subtitle actions";
}
${I}${LARGE}[data-unread="dot"][data-badged] ${CONTROL},
:has(> ${I}[data-unread="dot"]) > ${I}${LARGE}[data-badged] ${CONTROL} {
	grid-template-areas: "unread leading title trailing actions" "unread leading subtitle badge actions";
}
${I}${LARGE} ${CONTROL} > [data-hz-part="unread"] {
	grid-area: unread; height: var(--hz-space-10); margin-inline-end: var(--hz-space-3);
}
/* The leading column adds no height of its own (a spanning item skews the rows); the row's min-height
   holds it, 6px taller than the avatar as today's 16/24 line box is. */
${I}${LARGE} ${SLOT("leading")} {
	grid-area: leading; display: flex; width: auto; height: 0; margin-inline-end: var(--hz-space-3);
}
${I}${LARGE} ${CONTROL} > [data-hz-part="title"] { grid-area: title; }
${I}[data-leading-size="large"] ${CONTROL} > [data-hz-part="title"] { color: var(--hz-color-fg); }
${I}${LARGE} ${SLOT("trailing")} { grid-area: trailing; margin-inline-start: var(--hz-space-2); }
${I}${LARGE} ${CONTROL} > [data-hz-part="subtitle"] {
	grid-area: subtitle; margin-top: var(--hz-space-0_5);
}
${I}[data-leading-size="large"] ${CONTROL} > [data-hz-part="subtitle"] { color: var(--hz-color-muted-fg); }
${I}${LARGE} ${CONTROL} > [data-hz-part="badge"] {
	grid-area: badge; align-self: start; justify-self: end; margin: var(--hz-space-0_5) 0 0 var(--hz-space-2);
}
${I}${LARGE} ${SLOT("actions")} {
	grid-area: actions; align-self: center; margin-inline-start: var(--hz-space-4);
}
${I}${LARGE}:has(${SLOT("actions")} > *) ${CONTROL} { padding-inline-end: var(--hz-space-3); }
/* A web-only hint for sidebar rows; a large row has no place for it. */
${I}${LARGE} ${CONTROL} > [data-hz-part="shortcut"] { display: none; }
`

// `leadingSize` `conversation` (`item-conversation-row`): today's DM row. The avatar 2px down
// (`pt-0.5`), the time on the title's baseline. The row's minimum: the avatar's column is 48px
// (2px over it, 6px under it from today's 16/24 line box) plus its 10px padding.
const conversationCss = `
${I}[data-leading-size="conversation"] ${CONTROL} {
	min-height: calc(var(--hz-space-10) + var(--hz-space-0_5) + var(--hz-space-1_5) + 2 * var(--hz-space-2_5));
}
${I}[data-leading-size="conversation"] ${SLOT("leading")} { margin-top: var(--hz-space-0_5); }
${I}[data-leading-size="conversation"] ${CONTROL} > [data-hz-part="title"],
${I}[data-leading-size="conversation"] ${SLOT("trailing")} { align-self: baseline; }
/* Today's preview breaks words (\`break-words\`), so its clamp ends mid-word as the kit's does. */
${I}[data-leading-size="conversation"] ${CONTROL} > [data-hz-part="subtitle"] { overflow-wrap: break-word; }
/* Today's countBadge keeps text-2xs's own 1.5 line box (16.5px) inside its 20px pill, 2px under the
   preview's top. The time and the count each take their own width, so the preview runs to the count. */
${I}[data-leading-size="conversation"] ${CONTROL} > [data-hz-part="badge"] {
	line-height: 1.5; margin-top: var(--hz-space-1);
}
${I}[data-leading-size="conversation"]:not([data-unread="dot"]) ${CONTROL} {
	grid-template-columns: auto minmax(0, 1fr) auto auto auto;
	grid-template-areas: "leading title trailing trailing actions" "leading subtitle subtitle subtitle actions";
}
${I}[data-leading-size="conversation"]:not([data-unread="dot"])[data-badged] ${CONTROL} {
	grid-template-areas: "leading title trailing trailing actions" "leading subtitle subtitle badge actions";
}
`

// A bare icon in `trailing` (`p4-item-trailing-icon`) draws at the icon size, as in `leading`: 20px
// compact, 16px regular (the account card's chevron, `size-5 sm:size-4`); the switcher's stays 16px.
const trailingIconCss = `
${I} ${SLOT("trailing")} > [data-hz=icon] { width: var(--hz-space-5); height: var(--hz-space-5); flex-shrink: 0; }
@media (width >= 40rem) { ${I} ${SLOT("trailing")} > [data-hz=icon] { width: var(--hz-space-4); height: var(--hz-space-4); } }
${I}[data-style="switcher"] ${SLOT("trailing")} > [data-hz=icon] { width: var(--hz-space-4); height: var(--hz-space-4); }
`

// \`style\` \`switcher\` and \`account\` (\`p4-sidebar-account-card\`): the face fills the 32pt leading
// slot as a rounded square (\`isSquare\`, \`rounded-xl\`); the trigger fills its row and the chevron
// sits at its end. The card's email hugs the name (\`-mt-0.5\`) and stops at \`max-w-36\`.
const TRIGGER = ':is([data-style="switcher"], [data-style="account"])'
const styleCss = `
${I}${TRIGGER} ${SLOT("leading")} > [data-hz=avatar],
${I}${TRIGGER} ${SLOT("leading")} > [data-hz=avatar] > :is([data-hz-part=image], [data-hz-part=dither]) {
	width: 100%; height: 100%; border-radius: var(--hz-radius-xl); corner-shape: squircle;
}
${I}${TRIGGER} ${SLOT("trailing")} { margin-inline-start: auto; }
/* The menu around the trigger fills the row, as today's \`w-full\` trigger. */
[data-hz=menu]:has(> [data-hz-part=content] > [data-hz-slot=trigger] > ${I}${TRIGGER}),
[data-hz=menu] > [data-hz-part=content]:has(> [data-hz-slot=trigger] > ${I}${TRIGGER}),
[data-hz=menu] > [data-hz-part=content] > [data-hz-slot=trigger]:has(> ${I}${TRIGGER}) { display: flex; width: 100%; min-width: 0; }
/* Today's switcher name tops the logo (its span has no \`items-center\`); the chevron stays centred. */
${I}[data-style="switcher"] ${CONTROL} > [data-hz-part="title"] { align-self: start; }
${I}[data-style="account"][data-subtitled] ${CONTROL} { align-items: center; row-gap: 0; }
${I}[data-style="account"][data-subtitled] ${SLOT("leading")} { grid-row: 1 / span 2; }
${I}[data-style="account"] ${CONTROL} > [data-hz-part="subtitle"] {
	margin-top: calc(var(--hz-space-0_5) * -1); max-width: calc(4 * var(--hz-space-9));
}
`

// What the recipe cannot say: slot order inside the row, the subtitle's second line, the elbow's
// position, and a disabled link taking no clicks.
const css = `
[data-hz="item"] > [data-hz-part="control"] { position: relative; }
[data-hz="item"] > [data-hz-part="control"] > [data-hz-part="title"],
[data-hz="item"] > [data-hz-part="control"] > [data-hz-part="subtitle"] { order: 1; min-width: 0; }
[data-hz="item"] > [data-hz-part="control"] > [data-hz-part="badge"] { order: 2; overflow: hidden; }
/* The count rolls inside the pill (today's reaction count: \`inline-flex overflow-hidden\`). */
[data-hz="item"] [data-hz-part="badge"] > [data-hz-part="count"] { display: inline-block; }
/* An empty trailing slot (a DM row's) takes no gap, or the badge sits 8px off today's place. */
[data-hz="item"] > [data-hz-part="control"] > [data-hz-part="content"] > [data-hz-slot="trailing"]:empty { display: none; }
/* Today's sidebar badge sits 6px from the row's end (\`right-1.5\`), inside the row's 8px padding. */
[data-hz="item"]:not(${LARGE}) > [data-hz-part="control"] > [data-hz-part="badge"] {
	margin-inline-end: calc(var(--hz-space-0_5) * -1);
}
[data-hz="item"] > [data-hz-part="control"] > [data-hz-part="shortcut"] { order: 3; }
/* Today's palette hint (\`hidden lg:inline absolute top-1/2 right-2 font-mono\`): a desk hint, at the row's end. */
[data-hz="item"]:not(${LARGE}) > [data-hz-part="control"] > [data-hz-part="shortcut"] {
	position: absolute; top: 50%; inset-inline-end: var(--hz-space-2); translate: 0 -50%;
	font-family: var(--hz-font-mono);
}
@media (width < 64rem) { [data-hz="item"] > [data-hz-part="control"] > [data-hz-part="shortcut"] { display: none; } }
[data-hz="item"] > [data-hz-part="control"] > [data-hz-part="content"] > [data-hz-slot="trailing"] { order: 4; }
[data-hz="item"][data-subtitled] > [data-hz-part="control"] {
	display: grid; grid-template-columns: auto minmax(0, 1fr) auto auto auto;
	grid-template-areas: "leading title badge shortcut trailing" "leading subtitle badge shortcut trailing";
	column-gap: var(--hz-space-2);
}
[data-hz="item"][data-subtitled] > [data-hz-part="control"] > [data-hz-part="content"] > [data-hz-slot="leading"] { grid-area: leading; }
[data-hz="item"][data-subtitled] > [data-hz-part="control"] > [data-hz-part="title"] { grid-area: title; }
[data-hz="item"][data-subtitled] > [data-hz-part="control"] > [data-hz-part="subtitle"] { grid-area: subtitle; }
[data-hz="item"][data-subtitled] > [data-hz-part="control"] > [data-hz-part="badge"] { grid-area: badge; }
[data-hz="item"][data-subtitled] > [data-hz-part="control"] > [data-hz-part="shortcut"] { grid-area: shortcut; }
[data-hz="item"][data-subtitled] > [data-hz-part="control"] > [data-hz-part="content"] > [data-hz-slot="trailing"] { grid-area: trailing; }
[data-hz="item"][data-nested] > [data-hz-part="control"] { margin-inline-start: calc(var(--hz-space-6) + var(--hz-space-0_5)); }
[data-hz="item"] > [data-hz-part="control"] > [data-hz-part="elbow"] {
	position: absolute; bottom: 0; inset-inline-start: calc(-1 * var(--hz-space-3));
	width: var(--hz-space-3); height: var(--hz-space-8); pointer-events: none;
	color: color-mix(in oklab, var(--hz-color-fg) 15%, transparent);
}
[data-hz="item"][data-disabled] > [data-hz-part="control"] { pointer-events: none; }
[data-hz="item"] > [data-hz-part="control"]:focus-visible {
	outline: 2px solid var(--hz-color-ring); outline-offset: -2px;
}
@media (forced-colors: active) {
	[data-hz="item"][data-selected] > [data-hz-part="control"] { outline: 1px solid Highlight; }
}
${unreadCss}
${actionsCss}
${linesCss}
${largeCss}
${conversationCss}
${trailingIconCss}
${styleCss}
`

const elbowOf = (document: Document) => {
	const ns = "http://www.w3.org/2000/svg"
	const outerSvg = document.createElementNS(ns, "svg")
	outerSvg.setAttribute("data-hz-part", "elbow")
	outerSvg.setAttribute("aria-hidden", "true")
	const inner = document.createElementNS(ns, "svg")
	inner.setAttribute("y", "100%")
	inner.setAttribute("overflow", "visible")
	const path = document.createElementNS(ns, "path")
	path.setAttribute("fill", "none")
	path.setAttribute("stroke", "currentColor")
	path.setAttribute("stroke-width", "1.5")
	path.setAttribute("stroke-linecap", "round")
	inner.append(path)
	outerSvg.append(inner)
	return { node: outerSvg, path }
}

export const primitive = definePrimitive("item", ({ document, tag, outer }) => {
	ensureSheet(document, "item", css)
	const node = outer("div")
	const content = part(document, "span", "content")
	const title = part(document, "span", "title")
	const subtitle = part(document, "span", "subtitle")
	subtitle.hidden = true
	const badge = part(document, "span", "badge")
	badge.hidden = true
	// The number in its own box, which a change replaces so it rolls (`recipe.motion` countUp/Down).
	let count = part(document, "span", "count")
	badge.append(count)
	const shortcut = part(document, "kbd", "shortcut")
	shortcut.hidden = true
	const elbow = elbowOf(document)
	// The dot's column, and the unread state in words for a screen reader (the marks are drawn only).
	const unread = part(document, "span", "unread")
	unread.setAttribute("aria-hidden", "true")
	const unreadLabel = part(document, "span", "unreadLabel")
	// The label lives inside the title, so the name reads as one phrase ("design, unread").
	const titleText = document.createTextNode("")
	title.append(titleText)
	let control: HTMLElement = part(document, "button", "control")
	control.setAttribute("type", "button")
	control.append(unread, content, title, subtitle, badge, shortcut)
	node.append(control)
	// A control in `actions` sits inside the row's link: its click must not follow the link.
	node.addEventListener("click", (event) => {
		if (event.target instanceof Element && event.target.closest('[data-hz-slot="actions"]') !== null)
			event.preventDefault()
	})

	let href: string | undefined
	let selected = false
	let disabled = false
	let badgeCount = 0

	// Link vs button: a new control takes the same parts, so the content parent never leaves the item
	// and the renderer's nodes are untouched. A disabled row is a disabled button, or a link with no href.
	const swap = () => {
		const wanted = href === undefined ? "BUTTON" : "A"
		if (control.tagName !== wanted) {
			const next = part(document, wanted.toLowerCase(), "control")
			if (wanted === "BUTTON") next.setAttribute("type", "button")
			next.append(...control.childNodes)
			control.replaceWith(next)
			control = next
		}
		if (control instanceof HTMLButtonElement) control.disabled = disabled
		if (control instanceof HTMLAnchorElement) {
			if (disabled) {
				control.removeAttribute("href")
				control.setAttribute("role", "link")
				control.setAttribute("aria-disabled", "true")
			} else {
				control.setAttribute("href", href ?? "")
				control.removeAttribute("role")
				control.removeAttribute("aria-disabled")
			}
		}
		// The recipe's \`linked\` state: a linking row takes today's link weight.
		flag(node, "linked", control instanceof HTMLAnchorElement)
		if (selected) control.setAttribute("aria-current", "page")
		else control.removeAttribute("aria-current")
	}

	// A touch held still is a long press; the click that ends it is not a press.
	let hold: ReturnType<typeof setTimeout> | undefined
	let origin = { x: 0, y: 0 }
	const cancelHold = () => {
		if (hold !== undefined) clearTimeout(hold)
		hold = undefined
	}
	node.addEventListener("pointerdown", (event) => {
		if (event.pointerType === "mouse" || !listens(primitive, "longPress")) return
		origin = { x: event.clientX, y: event.clientY }
		cancelHold()
		hold = setTimeout(() => {
			hold = undefined
			if (!fire(primitive, "longPress")) return
			// Window capture runs before Effect UI's document delegation, so the press never fires.
			const view = document.defaultView
			const swallow = (click: Event) => {
				if (click.target instanceof Node && node.contains(click.target)) {
					click.preventDefault()
					click.stopPropagation()
				}
			}
			view?.addEventListener("click", swallow, { capture: true, once: true })
			setTimeout(() => view?.removeEventListener("click", swallow, { capture: true }), 800)
		}, LONG_PRESS_MS)
	})
	node.addEventListener("pointermove", (event) => {
		if (Math.hypot(event.clientX - origin.x, event.clientY - origin.y) > LONG_PRESS_SLOP) cancelHold()
	})
	node.addEventListener("pointerup", cancelHold)
	node.addEventListener("pointercancel", cancelHold)
	node.addEventListener("contextmenu", (event) => {
		// The long press is the row's; the browser's touch callout would fight it.
		if (hold !== undefined) event.preventDefault()
	})

	const primitive: Primitive = {
		tag,
		outer: node,
		content,
		set: (name, value) => {
			if (name === "title") {
				titleText.data = textOf(value)
			} else if (name === "subtitle") {
				subtitle.textContent = textOf(value)
				subtitle.hidden = textOf(value) === ""
				flag(node, "subtitled", textOf(value) !== "")
			} else if (name === "badge") {
				const previous = badgeCount
				badgeCount = typeof value === "number" ? value : 0
				badge.hidden = badgeCount <= 0
				count = rollCount(count, badgeCount > 0 ? String(badgeCount) : "", previous, badgeCount)
				flag(node, "badged", badgeCount > 0)
			} else if (name === "shortcut") {
				shortcut.textContent = textOf(value)
				shortcut.hidden = textOf(value) === ""
				shortcut.setAttribute("aria-hidden", "true")
				if (textOf(value) === "") control.removeAttribute("aria-keyshortcuts")
				else control.setAttribute("aria-keyshortcuts", textOf(value))
			} else if (name === "href") {
				href = typeof value === "string" ? value : undefined
				swap()
			} else if (name === "selected") {
				selected = value === true
				flag(node, "selected", value)
				swap()
			} else if (name === "disabled") {
				disabled = value === true
				flag(node, "disabled", value)
				swap()
			} else if (name === "emphasized") flag(node, "emphasized", value)
			else if (name === "muted") flag(node, "muted", value)
			else if (name === "unread") {
				option(node, "unread", value)
				// Today's words: "Unread:" before an activity row, ", unread" after a channel's name.
				if (value === "dot") {
					unreadLabel.textContent = "Unread: "
					title.prepend(unreadLabel)
				} else if (value === "pip") {
					unreadLabel.textContent = ", unread"
					title.append(unreadLabel)
				} else unreadLabel.remove()
			} else if (name === "titleLines") option(node, "title-lines", value)
			else if (name === "subtitleLines") option(node, "subtitle-lines", value)
			else if (name === "leadingSize") option(node, "leading-size", value)
			else if (name === "style") option(node, "style", value)
			else if (name === "nested") {
				option(node, "nested", value)
				if (value === "middle" || value === "last") {
					elbow.path.setAttribute("d", value === "last" ? SPINE_TO_BRANCH : SPINE_THROUGH)
					if (!elbow.node.isConnected) control.prepend(elbow.node)
				} else elbow.node.remove()
			}
		},
		events: undefined,
	}
	return primitive
})

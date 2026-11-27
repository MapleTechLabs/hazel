// Owned by lane A1 (`docs/hazel-ui.md`, "Phase 2: lanes").
import type { Logo } from "../../../vocabulary/content.ts"
import { glyph } from "../../icons.ts"
import { definePrimitive, flag, option, part, type Plain, type Primitive } from "../define.ts"
import { ensureStyles } from "./styles.ts"

/** `customers/ui/identity.ts`'s initials tints, in its order: a name keeps its colour everywhere. */
const tints = [
	["primary-subtle", "primary-subtle-fg"],
	["info-subtle", "info-subtle-fg"],
	["success-subtle", "success-subtle-fg"],
	["warning-subtle", "warning-subtle-fg"],
	["danger-subtle", "danger-subtle-fg"],
	["secondary", "secondary-fg"],
] as const

/** Its `tintIndex`: FNV-1a over the trimmed, lowercased name. */
const tintOf = (name: string) => {
	let hash = 0x811c9dc5
	for (const char of name.trim().toLowerCase()) {
		hash ^= char.codePointAt(0) ?? 0
		hash = Math.imul(hash, 0x01000193)
	}
	return tints[(hash >>> 0) % tints.length] ?? tints[0]
}

const isLogo = (value: unknown): value is Logo =>
	typeof value === "object" &&
	value !== null &&
	typeof (value as { name?: unknown }).name === "string" &&
	typeof (value as { initials?: unknown }).initials === "string"

/** A company's mark (`companyLogo` at `2xs`): its https logo, else its first initial on its tint. */
const drawLogo = (node: HTMLElement, logo: Logo) => {
	const src = logo.src !== undefined && logo.src.startsWith("https:") ? logo.src : undefined
	node.replaceChildren()
	if (src !== undefined) {
		const image = node.ownerDocument.createElement("img")
		image.setAttribute("src", src)
		image.setAttribute("alt", "")
		image.setAttribute("referrerpolicy", "no-referrer")
		image.style.width = "100%"
		image.style.height = "100%"
		image.style.objectFit = "cover"
		image.style.borderRadius = "inherit"
		node.style.backgroundColor = "var(--hz-color-secondary)"
		node.style.color = ""
		node.append(image)
		return
	}
	const [fill, ink] = tintOf(logo.name)
	node.style.backgroundColor = `var(--hz-color-${fill})`
	node.style.color = `var(--hz-color-${ink})`
	// At 16px two letters do not fit: the first one only.
	node.textContent = [...(logo.initials || logo.name)][0]?.toUpperCase() ?? ""
}

export const primitive = definePrimitive("channelIcon", ({ document, tag, outer }) => {
	ensureStyles(document)
	const node = outer("span")
	node.style.position = "relative"
	const icon = part(document, "span", "glyph")
	icon.setAttribute("aria-hidden", "true")
	const emoji = part(document, "span", "emoji")
	const logo = part(document, "span", "logo")
	logo.setAttribute("aria-hidden", "true")
	// The marks are cut from the surface the icon sits on (`--hz-cutout`, `styles.ts`).
	const lock = part(document, "span", "lock")
	lock.title = "Private channel"
	const lockIcon = part(document, "span", "lockIcon")
	lockIcon.setAttribute("aria-hidden", "true")
	glyph(lockIcon, "lock")
	lock.append(lockIcon)
	const partners = part(document, "span", "partners")
	const sync = part(document, "span", "sync")
	const syncLogo = part(document, "span", "syncLogo")
	syncLogo.setAttribute("aria-hidden", "true")
	sync.append(syncLogo)
	node.append(icon, emoji, logo, lock, partners, sync)
	let isPrivate = false
	let emojiText = ""
	let customer: Logo | undefined
	let partnerList: ReadonlyArray<Logo> = []
	let provider = "none"
	const draw = () => {
		const glyphShown = customer === undefined && emojiText === ""
		icon.hidden = !glyphShown
		if (glyphShown) glyph(icon, isPrivate ? "lock" : "hashtag")
		emoji.hidden = customer !== undefined || emojiText === ""
		emoji.textContent = emojiText
		logo.hidden = customer === undefined
		if (customer !== undefined) drawLogo(logo, customer)
		// The logo hides the channel's own lock, so a private customer channel wears it as a mark.
		lock.hidden = !(customer !== undefined && isPrivate)
		const shown = partnerList.slice(0, 2)
		partners.hidden = shown.length === 0
		partners.title =
			shown.length === 0 ? "" : `Shared with ${partnerList.map((partner) => partner.name).join(", ")}`
		partners.replaceChildren(
			...shown.map((partner) => {
				const mark = part(document, "span", "partner")
				mark.setAttribute("aria-hidden", "true")
				drawLogo(mark, partner)
				return mark
			}),
		)
		flag(node, "partnered", shown.length > 0)
		sync.hidden = provider !== "slack" && provider !== "discord"
		sync.dataset.provider = provider
		sync.title =
			provider === "slack" ? "Synced with Slack" : provider === "discord" ? "Synced with Discord" : ""
		glyph(syncLogo, sync.hidden ? undefined : provider)
	}
	draw()
	const primitive: Primitive = {
		tag,
		outer: node,
		content: node,
		set: (name: string, value: Plain) => {
			if (name === "private") {
				flag(node, "private", value)
				isPrivate = value === true
			} else if (name === "tile") {
				flag(node, "tile", value)
				return
			} else if (name === "emoji") emojiText = typeof value === "string" ? value : ""
			else if (name === "customer") customer = isLogo(value) ? value : undefined
			else if (name === "partners") partnerList = Array.isArray(value) ? value.filter(isLogo) : []
			else if (name === "sync") {
				option(node, "sync", value)
				provider = typeof value === "string" ? value : "none"
			} else return
			draw()
		},
		events: undefined,
	}
	return primitive
})

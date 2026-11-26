import type { Html, HtmlBuilder } from "foldkit/html"
import { IconHashtag } from "../../../../apps/web-foldkit/src/icons/index.ts"
import { avatar, type AvatarProps } from "../../../../apps/web-foldkit/src/ui/avatar.ts"
import { channelIcon } from "../../../../apps/web-foldkit/src/ui/channel-icon.ts"
import { heading } from "../../../../apps/web-foldkit/src/ui/heading.ts"
import { iconTile } from "../../../../apps/web-foldkit/src/ui/icon-tile.ts"
import { kbd } from "../../../../apps/web-foldkit/src/ui/kbd.ts"
import { presenceDot } from "../../../../apps/web-foldkit/src/ui/presence-dot.ts"

/**
 * The kit side of lane A1's parity tags: today's avatar, group DM pair, icon tile, channel icon,
 * overline label, key cap and the DMs people strip, with the content of their fixtures' base cases.
 */

type H = HtmlBuilder<never>

/** A shrink-wrapping box carrying the specimen id, so the measured box is the component's own. */
const specimen = (h: H, id: string, child: Html): Html =>
	h.div(
		[h.Class("frame-button")],
		[h.div([h.Class("inline-flex"), h.Attribute("data-specimen", id)], [child])],
	)

/** `page/chat-index/mobile-dms.ts`'s group DM mark: two `xs` avatars resized to 28px, diagonally. */
const pair = (h: H): Html =>
	h.div(
		[h.Class("relative size-10 shrink-0")],
		["Ada Lovelace", "Grace Hopper"].map((name, index) =>
			avatar(h, {
				size: "xs",
				className: `absolute size-7 ring-2 ring-bg ${index === 0 ? "top-0 left-0" : "right-0 bottom-0"}`,
				seed: name,
				fallbackIcon: true,
			}),
		),
	)

const people: ReadonlyArray<{
	readonly first: string
	readonly name: string
	readonly presence?: "online" | "away"
	readonly unread: boolean
}> = [
	{ first: "Grace", name: "Grace Hopper", presence: "online", unread: true },
	{ first: "Alan", name: "Alan Turing", presence: "away", unread: false },
	{ first: "Katherine", name: "Katherine Johnson", unread: false },
]

/** The kit's `xl` avatar, seeded by the full name, with the presence dot when there is one. */
const avatarOf = (h: H, person: (typeof people)[number]): AvatarProps => {
	const props: AvatarProps = { size: "xl", alt: person.name, seed: person.name, fallbackIcon: true }
	if (person.presence === undefined) return props
	return { ...props, badge: presenceDot(h, person.presence, "sm") }
}

/** `mobile-dms.ts`'s `peopleStrip`, markup for markup. */
const strip = (h: H): Html =>
	h.nav(
		[
			h.AriaLabel("People"),
			h.Attribute("data-specimen", "people-strip"),
			h.Class("flex snap-x gap-3 overflow-x-auto px-4 pt-4 pb-1 [scrollbar-width:none]"),
		],
		people.map((person) =>
			h.a(
				[
					h.Href("#"),
					h.Class(
						"flex w-14 shrink-0 snap-start flex-col items-center gap-1.5 transition-opacity duration-100 active:opacity-60",
					),
				],
				[
					avatar(h, avatarOf(h, person)),
					h.span(
						[
							h.Class(
								`w-full truncate text-center text-xs ${person.unread ? "font-semibold text-fg" : "text-muted-fg"}`,
							),
						],
						[person.first],
					),
				],
			),
		),
	)

export const contentSpecimens = (h: H): Html =>
	h.div(
		[],
		[
			h.div(
				[h.Class("frames frame-buttons")],
				[
					specimen(h, "avatar-medium", avatar(h, { size: "md", seed: "Grace Hopper" })),
					specimen(h, "avatar-pair", pair(h)),
					specimen(h, "icon-tile-neutral", iconTile(h, { size: "md" }, IconHashtag(h))),
					specimen(h, "channel-icon", channelIcon(h, { icon: null })),
					specimen(h, "text-overline", heading(h, { variant: "label" }, ["Today"])),
					specimen(h, "text-kbd", kbd(h, { size: "md" }, "⌘K")),
				],
			),
			h.div(
				[h.Class("frames"), h.Attribute("style", "flex-direction: column; align-items: stretch;")],
				[h.div([h.Attribute("style", "max-width: 720px;")], [strip(h)])],
			),
		],
	)

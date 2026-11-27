import type { OrganizationId } from "@hazel/schema"
import type { Html, HtmlBuilder } from "foldkit/html"
import { twMerge } from "tailwind-merge"
import { companyLogo } from "../customers/ui/identity"
import { IconHashtag, IconLock } from "../icons"
import { discordLogo, slackLogo } from "../page/settings/chat-sync/brand-icons"

/**
 * A channel's icon, the one way every surface draws a channel: its emoji or `#`, or the logo of the
 * customer it is linked to, with marks for what it is connected to (the Connect partner orgs, the
 * Slack or Discord chat sync bridge) and a lock when a customer channel is private.
 */

/** The platform chat sync bridges a channel to. */
export type ChannelSyncProvider = "slack" | "discord"

/** An organization the channel is shared with through Connect. */
export interface ChannelPartner {
	readonly id: OrganizationId
	readonly name: string
	readonly logoUrl: string | null
}

/** The customer the channel is linked to. */
export interface ChannelCustomerMark {
	readonly name: string
	readonly logoUrl: string | null
}

/** What a channel is linked or connected to: what its icon marks. */
export interface ChannelLinks {
	readonly customer: ChannelCustomerMark | null
	readonly partners: ReadonlyArray<ChannelPartner>
	readonly syncProvider: ChannelSyncProvider | null
}

export const NO_CHANNEL_LINKS: ChannelLinks = { customer: null, partners: [], syncProvider: null }

/** Channels' links by id; only channels with some are listed. Data, not a function: it rides on `Shared`. */
export type ChannelLinksMap = ReadonlyMap<string, ChannelLinks>

/** The channel's links, `NO_CHANNEL_LINKS` when it has none. */
export const linksFor = (map: ChannelLinksMap | undefined, channelId: string): ChannelLinks =>
	map?.get(channelId) ?? NO_CHANNEL_LINKS

/**
 * `sm` 16px (20px on phones: the sidebar and menu rows), `md` 20px (headers), `lg` 32px (an empty
 * state's tile). `xs` 14px is for inline mentions in text.
 */
export type ChannelIconSize = "xs" | "sm" | "md" | "lg"

/** What the icon sits on: the marks are cut out of it. */
export type ChannelIconSurface = "sidebar" | "bg" | "overlay" | "secondary"

const GLYPH = {
	xs: "size-3.5",
	sm: "size-5 sm:size-4",
	md: "size-5",
	lg: "size-8",
} as const satisfies Record<ChannelIconSize, string>

const EMOJI = {
	xs: "text-xs/none",
	sm: "text-base/none sm:text-sm/none",
	md: "text-lg/none",
	lg: "text-3xl/none",
} as const satisfies Record<ChannelIconSize, string>

const MARK = {
	xs: "size-2.5",
	sm: "size-3",
	md: "size-3.5",
	lg: "size-5",
} as const satisfies Record<ChannelIconSize, string>

const PROVIDER_LOGO = {
	slack: { xs: "size-1.5", sm: "size-2", md: "size-2.5", lg: "size-3.5" },
	discord: { xs: "size-2", sm: "size-2.5", md: "size-3", lg: "size-4" },
} as const satisfies Record<ChannelSyncProvider, Record<ChannelIconSize, string>>

const LOCK = {
	xs: "size-1.5!",
	sm: "size-2!",
	md: "size-2.5!",
	lg: "size-3.5!",
} as const satisfies Record<ChannelIconSize, string>

const PARTNER = {
	xs: "size-2.5",
	sm: "size-3",
	md: "size-3.5",
	lg: "size-5",
} as const satisfies Record<ChannelIconSize, string>

const SURFACE = {
	sidebar: { fill: "bg-sidebar", ring: "ring-sidebar" },
	bg: { fill: "bg-bg", ring: "ring-bg" },
	overlay: { fill: "bg-overlay", ring: "ring-overlay" },
	secondary: { fill: "bg-secondary", ring: "ring-secondary" },
} as const satisfies Record<ChannelIconSurface, { fill: string; ring: string }>

export interface ChannelIconProps {
	/** The channel's own emoji; null draws `#`, or a lock for a private channel. */
	readonly icon: string | null
	readonly isPrivate?: boolean
	readonly links?: ChannelLinks
	readonly size?: ChannelIconSize
	readonly surface?: ChannelIconSurface
	/** The colour of the `#`; the sidebar leaves it to its row's state. */
	readonly className?: string
}

const glyph = <M>(h: HtmlBuilder<M>, props: ChannelIconProps, size: ChannelIconSize): Html => {
	const customer = props.links?.customer ?? null
	if (customer !== null)
		return companyLogo(h, {
			name: customer.name,
			logoUrl: customer.logoUrl,
			size: "2xs",
			className: twMerge(GLYPH[size], size === "lg" && "rounded-lg text-sm"),
		})
	return props.icon
		? h.span(
				[
					h.Attribute("data-slot", "icon"),
					h.Class(twMerge("inline-flex items-center justify-center", GLYPH[size], EMOJI[size])),
				],
				[props.icon],
			)
		: (props.isPrivate ? IconLock : IconHashtag)(h, { className: twMerge(GLYPH[size], props.className) })
}

const partnerMarks = <M>(
	h: HtmlBuilder<M>,
	partners: ReadonlyArray<ChannelPartner>,
	size: ChannelIconSize,
	ring: string,
): Html => {
	if (partners.length === 0) return h.empty
	// The org's logo, else its initial on its tint (`companyLogo`, as customers show); the title names them all.
	return h.span(
		[
			h.Class("absolute -right-1 -bottom-0.5 flex items-end -space-x-1"),
			h.Title(`Shared with ${partners.map((partner) => partner.name).join(", ")}`),
		],
		partners.slice(0, 2).map((partner) =>
			companyLogo(h, {
				name: partner.name,
				logoUrl: partner.logoUrl,
				size: "2xs",
				className: twMerge("rounded-sm leading-none ring-[1.5px]", PARTNER[size], ring),
			}),
		),
	)
}

const syncMark = <M>(
	h: HtmlBuilder<M>,
	provider: ChannelSyncProvider,
	size: ChannelIconSize,
	fill: string,
	hasPartners: boolean,
): Html =>
	h.span(
		[
			h.Class(
				twMerge(
					"absolute -right-1 flex items-center justify-center rounded-full",
					MARK[size],
					fill,
					// The partner marks take the bottom corner.
					hasPartners ? "-top-1" : "-bottom-0.5",
				),
			),
			h.Title(provider === "slack" ? "Synced with Slack" : "Synced with Discord"),
		],
		[
			provider === "slack"
				? slackLogo(h, PROVIDER_LOGO.slack[size])
				: discordLogo(h, PROVIDER_LOGO.discord[size]),
		],
	)

/** A private customer channel's lock, top-left (the logo hides the channel's own lock; the right takes the other marks). */
const lockMark = <M>(h: HtmlBuilder<M>, size: ChannelIconSize, fill: string): Html =>
	h.span(
		[
			h.Class(
				twMerge(
					"absolute -top-1 -left-1 flex items-center justify-center rounded-full",
					MARK[size],
					fill,
				),
			),
			h.Title("Private channel"),
		],
		// `!`: a sidebar row sizes every `data-slot=icon` (the lock is one) like its own icon.
		[IconLock(h, { className: LOCK[size] })],
	)

export const channelIcon = <M>(h: HtmlBuilder<M>, props: ChannelIconProps): Html => {
	const size = props.size ?? "sm"
	const surface = SURFACE[props.surface ?? "bg"]
	const links = props.links ?? NO_CHANNEL_LINKS
	const hasPartners = links.partners.length > 0
	const isPrivateCustomer = links.customer !== null && props.isPrivate === true
	const hasMarks = hasPartners || links.syncProvider !== null || isPrivateCustomer
	// Positioned only for the marks: needless positioned spans slow every hit test.
	return h.span(
		[
			// The icon slot rows and menus size and space; `data-channel-icon` names it for tests and iOS.
			h.Attribute("data-slot", "icon"),
			h.Attribute("data-channel-icon", ""),
			h.Class(
				hasMarks
					? "relative inline-flex shrink-0 items-center justify-center"
					: "inline-flex shrink-0 items-center justify-center",
			),
		],
		[
			glyph(h, props, size),
			...(isPrivateCustomer ? [lockMark(h, size, surface.fill)] : []),
			...(hasPartners ? [partnerMarks(h, links.partners, size, surface.ring)] : []),
			...(links.syncProvider !== null
				? [syncMark(h, links.syncProvider, size, surface.fill, hasPartners)]
				: []),
		],
	)
}

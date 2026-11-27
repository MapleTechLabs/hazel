import type { Html, HtmlBuilder } from "foldkit/html"
import {
	environmentBadge,
	kindChip,
	severityChip,
	severityGlyph,
	stageBadge,
} from "../../../../apps/web-foldkit/src/customers/ui/badges.ts"
import { meter } from "../../../../apps/web-foldkit/src/customers/charts/sparkline.ts"
import { connectCard } from "../../../../apps/web-foldkit/src/customers/ui/connect-card.ts"
import { sourceChip, sourceMark } from "../../../../apps/web-foldkit/src/customers/ui/identity.ts"
import { IconBrainSparkle, IconClock, IconHashtag } from "../../../../apps/web-foldkit/src/icons/index.ts"
import { badge } from "../../../../apps/web-foldkit/src/ui/badge.ts"
import { avatar, type AvatarProps } from "../../../../apps/web-foldkit/src/ui/avatar.ts"
import { callout } from "../../../../apps/web-foldkit/src/ui/callout.ts"
import { channelIcon } from "../../../../apps/web-foldkit/src/ui/channel-icon.ts"
import { heading } from "../../../../apps/web-foldkit/src/ui/heading.ts"
import { iconTile } from "../../../../apps/web-foldkit/src/ui/icon-tile.ts"
import { kbd } from "../../../../apps/web-foldkit/src/ui/kbd.ts"
import { presenceDot } from "../../../../apps/web-foldkit/src/ui/presence-dot.ts"
import { thoughtLine } from "./kit-legacy/thought-line.ts"

/**
 * The kit side of lane A1's parity tags: today's avatar, group DM pair, icon tile, channel icon,
 * overline label, key cap and the DMs people strip, with the content of their fixtures' base cases;
 * phase 4's icon tile tones and callout.
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

/** `page/chat/channel/view.ts` `emptyStateView` (9096d67a1): the masked squirrel over its mono line. */
const emptyChannel = (h: H): Html =>
	h.div(
		[h.Class("flex size-full flex-col items-center justify-center p-4 sm:p-8")],
		[
			h.div(
				[h.Class("relative aspect-square w-full max-w-sm")],
				[
					h.img([
						h.Attribute("src", "/images/squirrle_ocean.webp"),
						h.Attribute("alt", "squirrel"),
						h.Class(
							"mask-size-[110%_90%] mask-linear-to-r mask-from-black mask-to-transparent mask-center mask-no-repeat mask-[url(/images/image-mask.webp)] h-full w-full rounded-md bg-center bg-cover bg-no-repeat object-cover opacity-50",
						),
					]),
				],
			),
			h.p([h.Class("font-bold font-mono text-fg text-xl")], ["Quiet as an ocean gazing squirrel..."]),
		],
	)

/** Customers' chips (PK0's `badges.ts`, `sla-chip.ts`, `identity.ts`), with their fixtures' content. */
const customerChips = (h: H): ReadonlyArray<Html> => [
	specimen(h, "badge-severity", severityChip(h, "high")),
	specimen(h, "badge-kind", kindChip(h, "risk")),
	specimen(h, "badge-trial", stageBadge(h, "trialing", { trialDaysLeft: 4 })),
	specimen(
		h,
		"badge-sla",
		badge(h, { intent: "quiet", attributes: [h.Title("Standard policy · due Mon 09:50")] }, [
			IconClock(h, { attributes: { "data-slot": "icon" } }),
			h.span([h.Class("truncate")], ["Reply due in 3h 10m"]),
		]),
	),
	specimen(h, "badge-source", sourceChip(h, "hazel")),
	specimen(h, "icon-tile-mark", sourceMark(h, "hazel", { size: "md" })),
	specimen(h, "badge-environment", environmentBadge(h, "production-eu-west-1")),
	specimen(h, "meter-over", meter(h, { value: 130, limit: 100, ariaLabel: "Seats: 130% of limit" })),
	// `evidence.ts` `lines`: a figure over its caption, right-aligned.
	specimen(
		h,
		"evidence-lines",
		h.div(
			[h.Class("flex min-w-0 flex-col items-end gap-0.5 text-right")],
			[
				h.span(
					[h.Class("whitespace-nowrap font-medium text-fg text-sm tabular-nums")],
					["14d quiet"],
				),
				h.span([h.Class("whitespace-nowrap text-muted-fg text-xs tabular-nums")], ["was 12 active"]),
			],
		),
	),
	specimen(
		h,
		"thought-line",
		thoughtLine(
			h,
			{
				isRunning: false,
				label: "Thought",
				doneLabel: "Thought",
				icon: IconBrainSparkle(h),
				hasClock: false,
				isOpen: false,
				onToggle: () => undefined as never,
				bodyId: "thought-body",
				tone: "danger",
			},
			[],
		),
	),
	// One of `signalCounts`' runs: the bars and the count.
	specimen(
		h,
		"badge-count",
		h.span(
			[h.Class("inline-flex items-center gap-2.5 text-sm tabular-nums")],
			[
				h.span(
					[h.Class("inline-flex items-center gap-1")],
					[severityGlyph(h, "high", { labelled: false }), "2"],
				),
			],
		),
	),
]

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
					...(["primary", "success", "warning", "danger"] as const).map((intent) =>
						specimen(
							h,
							`icon-tile-${intent}`,
							iconTile(h, { size: "md", intent }, IconHashtag(h)),
						),
					),
					specimen(h, "channel-icon", channelIcon(h, { icon: null })),
					specimen(h, "text-overline", heading(h, { variant: "label" }, ["Today"])),
					specimen(h, "text-kbd", kbd(h, { size: "md" }, "⌘K")),
					...customerChips(h),
				],
			),
			h.div(
				[h.Class("frames"), h.Attribute("style", "flex-direction: column; align-items: stretch;")],
				[h.div([h.Attribute("style", "max-width: 720px;")], [strip(h)])],
			),
			h.div(
				[h.Class("frames"), h.Attribute("style", "flex-direction: column; align-items: stretch;")],
				[
					h.div(
						[
							h.Attribute("style", "max-width: 720px;"),
							h.Attribute("data-specimen", "empty-channel"),
						],
						[emptyChannel(h)],
					),
					h.div(
						[h.Attribute("style", "max-width: 720px;"), h.Attribute("data-specimen", "fact-row")],
						[
							// `evidence.ts` `fact`: a justified `dl` row.
							h.div(
								[h.Class("flex items-baseline justify-between gap-4 text-sm")],
								[
									h.dt([h.Class("text-muted-fg")], ["Projected by Dec 1"]),
									h.dd([h.Class("text-right text-fg tabular-nums")], ["1,240 · 124%"]),
								],
							),
						],
					),
					h.div(
						[
							h.Attribute("style", "max-width: 720px;"),
							h.Attribute("data-specimen", "connect-card"),
						],
						[
							connectCard(h, {
								provider: "hazel",
								status: {
									_tag: "Connected",
									syncedAt: null,
									summary: "214 organizations · 1,862 users",
								},
								now: new Date(0),
								description: "Members and channels.",
							}),
						],
					),
				],
			),
			h.div(
				[h.Class("frames")],
				[
					specimen(
						h,
						"callout-warning",
						callout(h, { intent: "warning", title: "Export paused" }, [
							"Resumes in a few minutes.",
						]),
					),
				],
			),
		],
	)

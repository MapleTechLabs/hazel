// Effect UI is a public preview: every API is experimental by design here.
// @effect-diagnostics experimentalApiUsage:off
/**
 * A linked channel's customer at a glance (`docs/customers/channels.md`, "In the channel"; today's
 * `page/chat/customer-card.ts`): the header chip and the card it opens, with the stage, revenue,
 * owner, seats, last active day, open signals and the ways out. Desktop: hovering the chip shows the
 * card, a press pins it until Escape or a press outside. A phone: a press opens it in a sheet.
 */
import { UiSchema } from "@effect/ui"
import { ChannelCustomer } from "@hazel/domain/models"
import { Hazel } from "@hazel/ui/vocabulary/index"
import { Schema } from "effect"
import { dayToMs, formatMoney, formatRelative } from "../../customers/data/format"
import { safeSourceUrl, sourceLabel } from "../../customers/data/providers"
import { initialsOf } from "../format"

/** The `channel_customers` row as the card reads it (no timestamp; `company` as one row or none). */
const { updatedAt: _updatedAt, ...glanceFields } = ChannelCustomer.Schema.fields
export const CustomerGlance = Schema.Struct({
	...glanceFields,
	accountLogoUrl: Schema.NullOr(Schema.String),
	company: Schema.NullOr(Schema.Struct({ description: Schema.optional(Schema.NullOr(Schema.String)) })),
})
export type CustomerGlance = typeof CustomerGlance.Type

export const CustomerCardProps = Schema.Struct({
	customer: CustomerGlance,
	/** The owner's display name; null without an owner (or one no longer in the org). */
	ownerName: Schema.NullOr(Schema.String),
	customerHref: Schema.String,
	queueHref: Schema.String,
	nowMs: Schema.Finite,
	isMobile: Schema.Boolean,
})
export type CustomerCardProps = typeof CustomerCardProps.Type

export const CustomerCardModel = Schema.Struct({
	/** Pressed open (desktop): the card stays until Escape or a press outside. */
	isPinned: Schema.Boolean,
	/** A phone's sheet. */
	isSheetOpen: Schema.Boolean,
})
export type CustomerCardModel = typeof CustomerCardModel.Type

export const CustomerCardMessage = UiSchema.TaggedEnum({
	PressedChip: {},
	DismissedCard: {},
	DismissedSheet: {},
})
export type CustomerCardMessage = typeof CustomerCardMessage.Type

/**
 * A row projected before the glance existed (its org has not had a snapshot since): every glance
 * sets the stage, so a missing one means "not synced yet", not an empty account.
 */
export const hasGlance = (customer: CustomerGlance): boolean => customer.lifecycleStage !== null

const STAGE = {
	lead: { label: "Lead", tone: "neutral" },
	trialing: { label: "Trialing", tone: "info" },
	active: { label: "Active", tone: "success" },
	past_due: { label: "Past due", tone: "warning" },
	churned: { label: "Churned", tone: "neutral" },
} as const

/** `$2,400/mo · Pro`; null while nothing pays and there is no plan. */
export const revenueText = (customer: CustomerGlance): string | null => {
	const mrr =
		customer.mrrMinor === null || customer.mrrMinor === 0
			? null
			: `${formatMoney(customer.mrrMinor, customer.currency ?? "USD")}/mo`
	const parts = [mrr, customer.planName].filter((part) => part !== null)
	return parts.length === 0 ? null : parts.join(" · ")
}

export const seatsText = (customer: CustomerGlance): string | null =>
	customer.seatsUsed === null
		? null
		: customer.seatsLimit === null
			? `${customer.seatsUsed}`
			: `${customer.seatsUsed} of ${customer.seatsLimit}`

/** `3d ago` (from the day's start, so today reads `Today`). */
export const lastActiveText = (day: string, nowMs: number): string => {
	const at = dayToMs(day)
	const today = dayToMs(new Date(nowMs).toISOString().slice(0, 10))
	return at >= today ? "Today" : formatRelative(new Date(at), new Date(nowMs))
}

export const signalCountText = (count: number) =>
	count === 0 ? "No open signals" : `${count} open ${count === 1 ? "signal" : "signals"}`

export const CustomerCard = Hazel.component({
	name: "CustomerCard",
	props: CustomerCardProps,
	model: CustomerCardModel,
	message: CustomerCardMessage,
}).make({
	init: () => ({ isPinned: false, isSheetOpen: false }),
	update: {
		PressedChip: ($) =>
			$.props.isMobile ? $.evolve({ isSheetOpen: () => true }) : $.evolve({ isPinned: (pinned) => !pinned }),
		// A hover card asks to close when the pointer leaves; it stays armed for the next hover.
		DismissedCard: ($) => ($.model.isPinned ? $.evolve({ isPinned: () => false }) : $.model),
		DismissedSheet: ($) => $.evolve({ isSheetOpen: () => false }),
	},
	view: (h, model) => {
		const props = h.props
		const { customer } = props
		const logo = h.avatar
			.name(customer.accountName)
			.initials(initialsOf(customer.accountName))
			.src(customer.accountLogoUrl ?? undefined)
			.size("medium")
		const name = h.link.label(customer.accountName).href(props.customerHref)
		const openCustomer = h.link.key("open").label("Open customer").href(props.customerHref)

		const pending = () => [
			h.stack.key("who").axis("horizontal").align("center").children(logo, name),
			h.text
				.key("pending")
				.role("caption")
				.tone("muted")
				.children("Revenue and signals show here after the next customer sync."),
			openCustomer,
		]

		const full = () => {
			const stage = customer.lifecycleStage === null ? null : STAGE[customer.lifecycleStage]
			const revenue = revenueText(customer)
			const seats = seatsText(customer)
			const hidden = customer.openSignalCount - customer.topSignals.length
			const description = customer.company?.description?.trim() ?? ""
			const muted = (text: string) => h.text.tone("muted").children(text)
			// HAZEL-GAP(customer-card-company): today's company facts chips and links under the name.
			return [
				h.stack
					.key("who")
					.axis("horizontal")
					.align("start")
					.children(
						logo,
						h.stack
							.density("tight")
							.align("start")
							.children(
								name,
								stage === null ? undefined : h.badge.label(stage.label).tone(stage.tone),
							),
					),
				description === ""
					? undefined
					: h.text.key("about").role("caption").tone("muted").children(description),
				h.section
					.key("facts")
					.style("list")
					.children(
						h.property.key("revenue").label("Revenue").children(revenue === null ? muted("No MRR") : h.text.numeric().children(revenue)),
						h.property
							.key("owner")
							.label("Owner")
							.children(props.ownerName === null ? muted("No owner") : h.text.children(props.ownerName)),
						seats === null
							? undefined
							: h.property.key("seats").label("Seats").children(h.text.numeric().children(seats)),
						h.property
							.key("active")
							.label("Last active")
							.children(
								customer.lastActiveDay === null
									? muted("Never")
									: h.text.children(lastActiveText(customer.lastActiveDay, props.nowMs)),
							),
					),
				h.section
					.key("signals")
					.style("list")
					.title(signalCountText(customer.openSignalCount))
					.children(
						...customer.topSignals.map((signal) =>
							h.item.key(signal.id).title(signal.title).subtitle(signal.reason),
						),
						customer.openSignalCount === 0
							? undefined
							: h.link.key("queue").label("Queue").href(props.queueHref),
						hidden > 0
							? h.link.key("more").label(`${hidden} more on the customer page`).href(props.customerHref)
							: undefined,
					),
				// HAZEL-GAP(customer-card-provider-marks): today's provider links are logo buttons.
				h.stack
					.key("out")
					.axis("horizontal")
					.align("center")
					.children(
						openCustomer,
						...customer.sourceLinks.flatMap((link) => {
							const href = safeSourceUrl(link.provider, link.url)
							return href === null
								? []
								: [
										h.link
											.key(link.provider)
											.label(`Open in ${sourceLabel(link.provider)}`)
											.href(href),
									]
						}),
					),
			]
		}

		const body = () => h.stack.children(...(hasGlance(customer) ? full() : pending()))
		const isOpen = props.isMobile ? model.isSheetOpen : model.isPinned
		// HAZEL-GAP(customer-chip): today's chip is a bordered 12px office mark and name, not a chip button.
		const chip = h.button
			.label(customer.accountName)
			.icon("office")
			.variant("chip")
			.size("xsmall")
			.selected(isOpen)
			.on("press", CustomerCardMessage.PressedChip())
		if (props.isMobile)
			return h.stack.children(
				chip,
				h.sheet
					.open(model.isSheetOpen)
					.title(`${customer.accountName} at a glance`)
					.on("dismiss", CustomerCardMessage.DismissedSheet())
					.children(body()),
			)
		// HAZEL-GAP(popover-hover-interactive): a hover card takes no presses; a press pins it first.
		return h.popover
			.open()
			.trigger(model.isPinned ? "press" : "hover")
			.anchor(chip)
			.on("dismiss", CustomerCardMessage.DismissedCard())
			.children(h.frame.surface("overlay").children(body()))
	},
})


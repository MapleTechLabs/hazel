/**
 * A linked channel's customer at a glance (`docs/customers/channels.md`, "In the channel"): the
 * header chip, and the card it opens: health and why, stage, plan, MRR, owner, seats, last active,
 * open signals and the ways out (the customer page, the queue, the providers). From the org source
 * (`channel_customers`), so nothing opens the Customers source.
 *
 * Desktop: hovering the chip shows the card after a moment; it stays while the pointer is on the
 * chip or the card, and a click pins it until Escape or a click outside. A phone: a tap opens the
 * same card in a bottom sheet.
 */
import type { ChannelCustomer } from "@hazel/domain/models"
import type { HealthStatus } from "@hazel/domain/customers"
import { Duration, Effect, Option, Schema } from "effect"
import { Command, Mount } from "foldkit"
import type { Html, HtmlBuilder } from "foldkit/html"
import { defineMessageUnion } from "foldkit/message"
import { modifyFields } from "foldkit/struct"
import { twMerge } from "tailwind-merge"
import { dayToMs, formatMoney, formatRelative } from "../../customers/format"
import { HEALTH_FILL, healthBadge, severityGlyph, stageBadge } from "../../customers/ui/badges"
import { safeSourceUrl } from "../../customers/providers"
import { companyLogo, SOURCE_LABEL, sourceLogo } from "../../customers/ui/identity"
import { descriptionClass, linkClass, moreLink, titleClass } from "../../customers/ui/surface"
import { IconOffice } from "../../icons"
import { ariaButton } from "../../ui/button"
import * as Modal from "../../ui/modal"
import * as Sheet from "../../ui/sheet"

// MODEL

/** `waiting`: hovered, before the card shows; `hover`: shown while hovered; `pinned`: clicked open. */
export const Phase = Schema.Literals(["closed", "waiting", "hover", "pinned"])
export type Phase = typeof Phase.Type

export const Model = Schema.Struct({
	phase: Phase,
	/** The pointer left the chip and card: the card closes unless it comes back within the grace. */
	isLeaving: Schema.Boolean,
	/** Tells the latest hover or leave timer from stale ones. */
	token: Schema.Number,
	/** A phone's bottom sheet. */
	sheet: Modal.Model,
})
export type Model = typeof Model.Type

const SHEET_ID = "channel-customer-sheet"
const CARD_ID = "channel-customer-card"
const CHIP_ID = "channel-customer-chip"

export const init = (): Model => ({
	phase: "closed",
	isLeaving: false,
	token: 0,
	sheet: Modal.init(SHEET_ID),
})

// MESSAGE

export const Message = defineMessageUnion({
	HoveredChip: {},
	EnteredCard: {},
	LeftHover: {},
	ElapsedOpenDelay: { token: Schema.Number },
	ElapsedLeaveDelay: { token: Schema.Number },
	PressedChip: { isMobile: Schema.Boolean },
	PressedEscape: {},
	PressedOutside: {},
	GotSheetMessage: { message: Modal.Message },
	CompletedPositionCard: {},
	CompletedFocusChip: {},
	CompletedFocusCard: {},
})
export type Message = typeof Message.Type

// COMMANDS

/** Long enough that passing over the header does not flash the card. */
const OPEN_DELAY = Duration.millis(350)
/** Room to cross from the chip to the card. */
const LEAVE_GRACE = Duration.millis(200)

const WaitBeforeCustomerCard = Command.define("WaitBeforeCustomerCard", {
	args: { token: Schema.Number },
	messages: [Message.ElapsedOpenDelay],
	execute: ({ token }) => Effect.sleep(OPEN_DELAY).pipe(Effect.as(Message.ElapsedOpenDelay({ token }))),
})

const WaitBeforeCustomerCardClose = Command.define("WaitBeforeCustomerCardClose", {
	args: { token: Schema.Number },
	messages: [Message.ElapsedLeaveDelay],
	execute: ({ token }) => Effect.sleep(LEAVE_GRACE).pipe(Effect.as(Message.ElapsedLeaveDelay({ token }))),
})

const FocusCustomerChip = Command.define("FocusCustomerChip", {
	messages: [Message.CompletedFocusChip],
	execute: Effect.sync(() => document.getElementById(CHIP_ID)?.focus()).pipe(
		Effect.as(Message.CompletedFocusChip()),
	),
})

/** A pinned card takes focus, so Tab and Escape work from inside it. */
const FocusCustomerCard = Command.define("FocusCustomerCard", {
	messages: [Message.CompletedFocusCard],
	execute: Effect.sync(() =>
		requestAnimationFrame(() => document.getElementById(CARD_ID)?.focus({ preventScroll: true })),
	).pipe(Effect.as(Message.CompletedFocusCard())),
})

/**
 * Under the chip, its left edge aligned (fixed, so nothing in the header clips it), kept on screen;
 * placed again when the window resizes.
 */
const PositionCard = Mount.define("PositionCustomerCard", {
	messages: [Message.CompletedPositionCard],
	execute: ({ element }) =>
		Effect.acquireRelease(
			Effect.sync(() => {
				const place = () => {
					const chip = element.ownerDocument.getElementById(CHIP_ID)
					if (chip === null || !(element instanceof HTMLElement)) return
					const rect = chip.getBoundingClientRect()
					const width = element.offsetWidth
					element.style.top = `${rect.bottom}px`
					element.style.left = `${Math.max(12, Math.min(rect.left, window.innerWidth - width - 12))}px`
					element.style.visibility = "visible"
				}
				place()
				window.addEventListener("resize", place)
				return () => window.removeEventListener("resize", place)
			}),
			(release) => Effect.sync(release),
		).pipe(Effect.as(Message.CompletedPositionCard())),
})

// UPDATE

export type UpdateReturn = Readonly<{ model: Model; commands?: ReadonlyArray<Command.Command<Message>> }>

const closed = (model: Model): Model =>
	modifyFields(model, { phase: () => "closed" as const, isLeaving: () => false })

export const update = (model: Model, message: Message): UpdateReturn =>
	Message.match<UpdateReturn>(message, {
		HoveredChip: () => {
			if (model.phase !== "closed") return { model: modifyFields(model, { isLeaving: () => false }) }
			const token = model.token + 1
			return {
				model: modifyFields(model, { phase: () => "waiting" as const, token: () => token }),
				commands: [WaitBeforeCustomerCard({ token })],
			}
		},
		EnteredCard: () => ({ model: modifyFields(model, { isLeaving: () => false }) }),
		ElapsedOpenDelay: ({ token }) => ({
			model:
				model.phase === "waiting" && token === model.token
					? modifyFields(model, { phase: () => "hover" as const })
					: model,
		}),
		LeftHover: () => {
			if (model.phase === "waiting") return { model: closed(model) }
			if (model.phase !== "hover") return { model }
			const token = model.token + 1
			return {
				model: modifyFields(model, { isLeaving: () => true, token: () => token }),
				commands: [WaitBeforeCustomerCardClose({ token })],
			}
		},
		ElapsedLeaveDelay: ({ token }) => ({
			model:
				model.phase === "hover" && model.isLeaving && token === model.token ? closed(model) : model,
		}),
		PressedChip: ({ isMobile }) => {
			if (isMobile) return withSheet(model, Modal.open(model.sheet))
			return model.phase === "pinned"
				? { model: closed(model) }
				: {
						model: modifyFields(model, {
							phase: () => "pinned" as const,
							isLeaving: () => false,
						}),
						commands: [FocusCustomerCard()],
					}
		},
		PressedEscape: () =>
			model.phase === "closed" ? { model } : { model: closed(model), commands: [FocusCustomerChip()] },
		PressedOutside: () => ({ model: closed(model) }),
		GotSheetMessage: ({ message: sheetMessage }) =>
			withSheet(model, Modal.update(model.sheet, sheetMessage)),
		CompletedPositionCard: () => ({ model }),
		CompletedFocusChip: () => ({ model }),
		CompletedFocusCard: () => ({ model }),
	})

const withSheet = (model: Model, result: ReturnType<typeof Modal.update>): UpdateReturn => ({
	model: modifyFields(model, { sheet: () => result.model }),
	commands: Command.mapMessages(result.commands ?? [], (inner: Modal.Message) =>
		Message.GotSheetMessage({ message: inner }),
	),
})

// VIEW

/** What the card shows besides the row: the owner's name, the links, the clock. */
export type CardContext = Readonly<{
	customer: ChannelCustomer.Type
	/** The owner's display name; null without an owner (or one no longer in the org). */
	ownerName: string | null
	customerHref: string
	queueHref: string
	nowMs: number
	/**
	 * Later sections (support issues, SLAs) render here, between the signals and the links. Empty
	 * for now.
	 */
	support?: ReadonlyArray<Html>
}>

const HEALTH_CHIP_LABEL = {
	healthy: "healthy",
	at_risk: "at risk",
	critical: "critical",
	unknown: "health unknown",
} as const satisfies Record<HealthStatus, string>

/** Whether the chip's card (or a phone's sheet) is showing: all the header needs of the Model. */
export const isOpenOf = (model: Model, isMobile: boolean): boolean =>
	isMobile ? model.sheet.isOpen : model.phase === "hover" || model.phase === "pinned"

/** Whether the card holds the keyboard: the channel's hotkeys stand down meanwhile. */
export const isPinnedOf = (model: Model): boolean => model.phase === "pinned" || model.sheet.isOpen

/** Escape alone: the card handles it, and stops it from reaching the channel's hotkeys. */
const escapeKey = <M>(h: HtmlBuilder<M>, toMessage: (message: Message) => M) =>
	h.OnKeyDownPreventDefault((key) =>
		key === "Escape" ? Option.some(toMessage(Message.PressedEscape())) : Option.none(),
	)

/**
 * The header chip: the health dot and the customer's name; it opens the card. Above a pinned card's
 * backdrop (`z-50`), so a second press on it closes the card instead of landing on the backdrop.
 */
export const chip = <M>(
	h: HtmlBuilder<M>,
	options: Readonly<{
		customer: ChannelCustomer.Type
		isOpen: boolean
		isMobile: boolean
		toMessage: (message: Message) => M
	}>,
): Html => {
	const { customer, isOpen, toMessage } = options
	return ariaButton(
		h,
		{
			className: twMerge(
				"relative z-50 inline-flex min-w-0 shrink items-center gap-1.5 rounded-md border border-border px-1.5 py-0.5 text-muted-fg text-xs outline-hidden transition-colors hover:bg-secondary hover:text-fg focus-visible:ring-2 focus-visible:ring-ring/70",
				isOpen && "bg-secondary text-fg",
			),
			onPress: toMessage(Message.PressedChip({ isMobile: options.isMobile })),
			attributes: [
				h.Id(CHIP_ID),
				h.AriaLabel(`Customer: ${customer.accountName}, ${HEALTH_CHIP_LABEL[customer.healthStatus]}`),
				h.AriaExpanded(isOpen),
				h.AriaHasPopup("dialog"),
				...(isOpen
					? [h.Attribute("aria-controls", options.isMobile ? Modal.dialogId(SHEET_ID) : CARD_ID)]
					: []),
				...(options.isMobile
					? []
					: [
							h.OnMouseEnter(toMessage(Message.HoveredChip())),
							h.OnMouseLeave(toMessage(Message.LeftHover())),
							escapeKey(h, toMessage),
						]),
			],
		},
		[
			customer.healthStatus === "unknown"
				? IconOffice(h, { className: "size-3 shrink-0" })
				: h.span([
						h.AriaHidden(true),
						h.Class(
							twMerge("size-1.5 shrink-0 rounded-full", HEALTH_FILL[customer.healthStatus]),
						),
					]),
			h.span([h.Class("truncate")], [customer.accountName]),
		],
	)
}

/** The desktop card under the chip, while hovered or pinned; a pinned card closes on a click outside. */
export const card = <M>(
	h: HtmlBuilder<M>,
	options: Readonly<{ context: CardContext; model: Model; toMessage: (message: Message) => M }>,
): Html => {
	const { model, toMessage } = options
	if (model.phase !== "hover" && model.phase !== "pinned") return h.empty
	return h.div(
		[],
		[
			...(model.phase === "pinned"
				? [
						h.div([
							h.Class("fixed inset-0 z-40"),
							h.AriaHidden(true),
							h.OnClick(toMessage(Message.PressedOutside())),
						]),
					]
				: []),
			h.keyed("div")(
				`customer-card-${options.context.customer.accountId}`,
				[
					h.Id(CARD_ID),
					h.Role("dialog"),
					h.Tabindex(-1),
					h.AriaLabel(`${options.context.customer.accountName} at a glance`),
					// The padding bridges the gap from the chip, so crossing it does not leave.
					h.Class("invisible fixed z-50 w-88 pt-1.5"),
					h.OnMount(Mount.mapMessage(PositionCard(), toMessage)),
					h.OnMouseEnter(toMessage(Message.EnteredCard())),
					h.OnMouseLeave(toMessage(Message.LeftHover())),
					escapeKey(h, toMessage),
				],
				[
					h.div(
						[
							h.Class(
								"overflow-hidden rounded-xl border border-border bg-overlay text-sm shadow-md outline-hidden",
							),
						],
						[cardBody(h, options.context)],
					),
				],
			),
		],
	)
}

/** A phone's bottom sheet with the card. */
export const sheet = <M>(
	h: HtmlBuilder<M>,
	options: Readonly<{ context: CardContext; model: Model; toMessage: (message: Message) => M }>,
): Html =>
	h.submodel({
		slotId: SHEET_ID,
		model: options.model.sheet,
		view: Sheet.view,
		viewInputs: {
			toContent: () => [cardBody(h, options.context)],
			side: "bottom",
			ariaLabel: `${options.context.customer.accountName} at a glance`,
			className: "max-h-[85dvh] overflow-y-auto p-0",
		},
		toParentMessage: (message: Modal.Message) => options.toMessage(Message.GotSheetMessage({ message })),
	})

const SECTION = "flex flex-col gap-2 border-border border-t px-4 py-3"

const fact = <M>(h: HtmlBuilder<M>, label: string, value: Html | string) =>
	h.div(
		[h.Class("flex min-w-0 items-baseline justify-between gap-3")],
		[
			h.dt([h.Class("shrink-0 text-muted-fg")], [label]),
			h.dd([h.Class("min-w-0 truncate text-right text-fg tabular-nums")], [value]),
		],
	)

const muted = <M>(h: HtmlBuilder<M>, text: string) => h.span([h.Class("text-muted-fg")], [text])

/** `$2,400/mo · Pro`; `No MRR` while nothing pays. */
const revenueText = (customer: ChannelCustomer.Type): string | null => {
	const mrr =
		customer.mrrMinor === null || customer.mrrMinor === 0
			? null
			: `${formatMoney(customer.mrrMinor, customer.currency ?? "USD")}/mo`
	const parts = [mrr, customer.planName].filter((part) => part !== null)
	return parts.length === 0 ? null : parts.join(" · ")
}

const seatsText = (customer: ChannelCustomer.Type): string | null =>
	customer.seatsUsed === null
		? null
		: customer.seatsLimit === null
			? `${customer.seatsUsed}`
			: `${customer.seatsUsed} of ${customer.seatsLimit}`

/** `3d ago` (from the day's start, so today reads `Today`). */
const lastActiveText = (day: string, nowMs: number): string => {
	const at = dayToMs(day)
	const today = dayToMs(new Date(nowMs).toISOString().slice(0, 10))
	if (at >= today) return "Today"
	return formatRelative(new Date(at), new Date(nowMs))
}

/** The card's content, shared by the hover card, the sheet and the gallery. */
export const cardBody = <M>(h: HtmlBuilder<M>, context: CardContext): Html => {
	const { customer } = context
	const revenue = revenueText(customer)
	const seats = seatsText(customer)
	const hiddenSignals = customer.openSignalCount - customer.topSignals.length
	return h.div(
		[h.Class("flex flex-col")],
		[
			// Who, and how they are doing.
			h.div(
				[h.Class("flex items-start gap-3 px-4 pt-4 pb-3")],
				[
					companyLogo(h, {
						name: customer.accountName,
						logoUrl: customer.accountLogoUrl ?? null,
						size: "md",
					}),
					h.div(
						[h.Class("flex min-w-0 flex-1 flex-col gap-1")],
						[
							h.a(
								[
									h.Href(context.customerHref),
									h.Class(twMerge(titleClass, "truncate hover:underline")),
								],
								[customer.accountName],
							),
							h.div(
								[h.Class("flex flex-wrap items-center gap-1.5")],
								[
									customer.healthStatus === "unknown"
										? healthBadge(h, { status: customer.healthStatus })
										: healthBadge(h, {
												status: customer.healthStatus,
												score: customer.healthScore,
											}),
									...(customer.lifecycleStage === null
										? []
										: [stageBadge(h, customer.lifecycleStage)]),
								],
							),
						],
					),
				],
			),
			...(customer.healthStatus === "unknown"
				? [
						h.p(
							[h.Class(twMerge(descriptionClass, "px-4 pb-3 text-xs"))],
							["No health score yet: it needs a connected source with usage or billing."],
						),
					]
				: customer.healthWhy === null
					? []
					: [h.p([h.Class(twMerge(descriptionClass, "px-4 pb-3 text-xs"))], [customer.healthWhy])]),
			// The account's facts.
			h.dl(
				[h.Class(twMerge(SECTION, "gap-1.5"))],
				[
					fact(h, "Revenue", revenue ?? muted(h, "No MRR")),
					fact(h, "Owner", context.ownerName ?? muted(h, "No owner")),
					...(seats === null ? [] : [fact(h, "Seats", seats)]),
					fact(
						h,
						"Last active",
						customer.lastActiveDay === null
							? muted(h, "Never")
							: lastActiveText(customer.lastActiveDay, context.nowMs),
					),
				],
			),
			// What needs attention.
			h.div(
				[h.Class(SECTION)],
				[
					h.div(
						[h.Class("flex items-center justify-between gap-3")],
						[
							h.span(
								[h.Class("font-medium text-fg")],
								[
									customer.openSignalCount === 0
										? "No open signals"
										: `${customer.openSignalCount} open ${customer.openSignalCount === 1 ? "signal" : "signals"}`,
								],
							),
							...(customer.openSignalCount === 0
								? []
								: [moreLink(h, context.queueHref, "Queue")]),
						],
					),
					...(customer.topSignals.length === 0
						? []
						: [
								h.ul(
									[h.Class("flex flex-col gap-1.5")],
									customer.topSignals.map((signal) =>
										h.li(
											[h.Class("flex min-w-0 items-start gap-2")],
											[
												h.span(
													[h.Class("pt-1")],
													[severityGlyph(h, signal.severity)],
												),
												h.div(
													[h.Class("flex min-w-0 flex-col")],
													[
														h.span([h.Class("truncate text-fg")], [signal.title]),
														h.span(
															[h.Class("truncate text-muted-fg text-xs")],
															[signal.reason],
														),
													],
												),
											],
										),
									),
								),
							]),
					...(hiddenSignals > 0
						? [
								h.a(
									[h.Href(context.customerHref), h.Class(twMerge(linkClass, "text-xs"))],
									[`${hiddenSignals} more on the customer page`],
								),
							]
						: []),
				],
			),
			// Later: support issues and SLAs (`context.support`).
			...(context.support === undefined || context.support.length === 0
				? []
				: [h.div([h.Class(SECTION), h.DataAttribute("slot", "support")], context.support)]),
			// Ways out.
			h.div(
				[
					h.Class(
						"flex flex-wrap items-center gap-1.5 border-border border-t bg-secondary/40 px-4 py-2.5",
					),
				],
				[
					h.a(
						[h.Href(context.customerHref), h.Class(twMerge(linkClass, "mr-auto"))],
						["Open customer"],
					),
					...customer.sourceLinks.flatMap((link) => {
						const href = safeSourceUrl(link.provider, link.url)
						return href === null
							? []
							: [
									h.a(
										[
											h.Href(href),
											h.Target("_blank"),
											h.Rel("noreferrer"),
											h.AriaLabel(
												`${customer.accountName} in ${SOURCE_LABEL[link.provider]}`,
											),
											h.Title(`Open in ${SOURCE_LABEL[link.provider]}`),
											h.Class(
												"inline-flex size-7 items-center justify-center rounded-md border border-border bg-bg outline-hidden transition-colors hover:bg-secondary focus-visible:ring-2 focus-visible:ring-ring/70",
											),
										],
										[sourceLogo(h, link.provider)],
									),
								]
					}),
				],
			),
		],
	)
}

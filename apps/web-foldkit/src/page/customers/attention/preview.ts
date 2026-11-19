import { TEMPLATES } from "@hazel/domain/customers"
import type * as Customers from "@hazel/domain/customers"
import type { Attribute, Html, HtmlBuilder } from "foldkit/html"
import { twMerge } from "tailwind-merge"
import type { AccountRow, SignalRow } from "../../../customers/queries"
import { formatCount, formatDate, formatMoney, formatRelative } from "../../../customers/format"
import { environmentCounts, environmentsHintOf } from "../../../customers/groups"
import { healthBadge, kindChip, severityChip, STAGE_LABEL } from "../../../customers/ui/badges"
import { evidenceDetail } from "../../../customers/ui/evidence"
import { companyLogo, personLabel, sourceMark } from "../../../customers/ui/identity"
import { kbd } from "../../../customers/ui/shortcuts"
import { IconClose, IconCopy } from "../../../icons"
import { button } from "../../../ui/button"
import { link } from "../../../ui/link"
import { customerRoute, hrefOf } from "../../../route"
import { loader } from "../../../ui/loader"
import { Message } from "./message"
import { type Model, rowIds, type Viewer } from "./model"
import { otherSignalRow, type RowContext } from "./rows"
import { heading } from "../../../ui/heading"

/** The side panel for the selected signal (Wonder: Queue Selected With Preview). */

/** A link to the customer's page; without an org, the children alone. */
const toCustomer = (
	h: HtmlBuilder<Message>,
	href: string | null,
	attributes: ReadonlyArray<Attribute<Message>>,
	children: Array<Html | string>,
	className?: string,
): Html =>
	href === null
		? h.span([h.Class(className ?? "")], children)
		: link(h, { href, className: twMerge("text-inherit", className), attributes }, children)

const section = (h: HtmlBuilder<Message>, title: string, children: ReadonlyArray<Html>, aside?: Html): Html =>
	h.section(
		[h.Class("flex flex-col gap-3 border-border border-t px-5 py-4")],
		[
			h.div(
				[h.Class("flex items-center justify-between")],
				[h.h3([h.Class("text-muted-fg text-sm")], [title]), ...(aside ? [aside] : [])],
			),
			...children,
		],
	)

const stat = (h: HtmlBuilder<Message>, label: string, value: Html | string, detail: string | null): Html =>
	h.div(
		[h.Class("flex min-w-0 flex-col gap-0.5")],
		[
			h.span([h.Class("text-muted-fg text-xs")], [label]),
			typeof value === "string"
				? h.span([h.Class("font-medium text-fg text-sm tabular-nums")], [value])
				: value,
			...(detail === null ? [] : [h.span([h.Class("truncate text-muted-fg text-xs")], [detail])]),
		],
	)

const summary = (h: HtmlBuilder<Message>, account: AccountRow, owner: string | null): Html =>
	h.div(
		[h.Class("grid grid-cols-2 gap-3 px-5 py-4 md:grid-cols-4")],
		[
			stat(h, "MRR", formatMoney(account.mrrMinor, account.currency), account.planName),
			stat(
				h,
				"Health",
				healthBadge(h, {
					status: account.healthStatus,
					score: account.healthScore,
					className: "w-fit",
				}),
				null,
			),
			stat(
				h,
				"Active 30d",
				`${formatCount(account.activeUsers30d)} of ${formatCount(account.contactCount)}`,
				account.seatsLimit === null
					? null
					: account.seatsUsed === null
						? `${account.seatsLimit} seats`
						: `${account.seatsUsed} / ${account.seatsLimit} seats`,
			),
			stat(h, "Owner", owner ?? "Unowned", `${STAGE_LABEL[account.lifecycleStage]} stage`),
		],
	)

const contactRow = (h: HtmlBuilder<Message>, row: Customers.ContactRow, nowMs: number): Html => {
	const { contact } = row
	const name = contact.name ?? contact.email ?? "Unknown"
	const lastSeen =
		contact.lastSeenAt === null
			? "Never seen"
			: `Seen ${formatRelative(contact.lastSeenAt, new Date(nowMs))}`
	return h.li(
		[h.Class("flex items-center gap-3")],
		[
			h.div(
				[h.Class("flex min-w-0 flex-1 flex-col")],
				[
					h.span(
						[h.Class("flex items-center gap-2")],
						[
							personLabel(
								h,
								{ name, avatarUrl: contact.avatarUrl },
								{ className: "font-medium" },
							),
							...(contact.role === null
								? []
								: [
										h.span(
											[h.Class("rounded bg-secondary px-1 text-2xs text-muted-fg")],
											[contact.role],
										),
									]),
						],
					),
					h.span(
						[h.Class("truncate pl-8 text-muted-fg text-xs")],
						[[contact.title, contact.email].filter((part) => part !== null).join(" · ")],
					),
				],
			),
			h.span(
				[
					h.Class(
						twMerge(
							"shrink-0 text-xs",
							row.status === "active" ? "text-muted-fg" : "text-warning-subtle-fg",
						),
					),
				],
				[lastSeen],
			),
			...(contact.email === null
				? []
				: [
						button(
							h,
							{
								intent: "plain",
								size: "sq-xs",
								onPress: Message.PressedCopyEmail({ email: contact.email }),
								attributes: [h.AriaLabel(`Copy ${contact.email}`)],
							},
							[IconCopy(h, { className: "size-4" })],
						),
					]),
		],
	)
}

const eventRow = (h: HtmlBuilder<Message>, event: Customers.Event, nowMs: number): Html =>
	h.li(
		[h.Class("flex items-start gap-3")],
		[
			h.span(
				[h.Class("w-12 shrink-0 pt-1 text-muted-fg text-xs")],
				[formatDate(event.occurredAt, { now: new Date(nowMs) })],
			),
			sourceMark(h, event.provider, { className: "size-7" }),
			h.span([h.Class("min-w-0 pt-1 text-fg text-sm")], [event.title]),
		],
	)

/** Contacts and the timeline come with the account's detail. */
const detailSections = (h: HtmlBuilder<Message>, model: Model, nowMs: number): ReadonlyArray<Html> => {
	const data = model.detail?.data
	if (data === undefined) return []
	if (data._tag === "Loading" || data._tag === "Idle")
		return [h.div([h.Class("flex justify-center py-8")], [loader(h, { className: "size-6" })])]
	if (data._tag === "Failure")
		return [
			h.div(
				[h.Class("flex flex-col items-center gap-2 px-5 py-8 text-center text-muted-fg text-sm")],
				[
					"Couldn't load this account's contacts and activity.",
					button(h, { intent: "outline", size: "sm", onPress: Message.PressedRetryDetail() }, [
						"Try again",
					]),
				],
			),
		]
	const detail = data.data
	return [
		section(
			h,
			"Contacts to reach",
			detail.contactsToReach.length === 0
				? [h.p([h.Class("text-muted-fg text-sm")], ["No contacts yet."])]
				: [
						h.ul(
							[h.Class("flex flex-col gap-3")],
							detail.contactsToReach.map((row) => contactRow(h, row, nowMs)),
						),
					],
		),
		section(
			h,
			"Recent activity",
			detail.recentEvents.length === 0
				? [h.p([h.Class("text-muted-fg text-sm")], ["Nothing recorded yet."])]
				: [
						h.ul(
							[h.Class("flex flex-col gap-3")],
							detail.recentEvents.map((event) => eventRow(h, event, nowMs)),
						),
					],
		),
	]
}

export const previewPanel = (
	h: HtmlBuilder<Message>,
	model: Model,
	signal: SignalRow,
	viewer: Viewer,
	orgSlug: string | null,
	actions: ReadonlyArray<Html>,
): Html => {
	const accountsById = new Map((model.accounts ?? []).map((account) => [account.id, account]))
	const membersById = new Map(model.members.map((member) => [member.id, member]))
	const account = accountsById.get(signal.accountId)
	if (account === undefined) return h.empty
	const ids = rowIds(model, viewer)
	const position = ids.indexOf(signal.id)
	const others = (model.signals ?? []).filter(
		(other) => other.accountId === signal.accountId && other.id !== signal.id && other.status === "open",
	)
	const counts = environmentCounts(model.accounts ?? [])
	const context: RowContext = {
		nowMs: viewer.nowMs,
		accountsById,
		environmentCounts: counts,
		membersById,
		selectedId: signal.id,
		actions: [],
	}
	const href = orgSlug === null ? null : hrefOf(customerRoute(orgSlug, account.id))
	const owner = account.ownerUserId === null ? null : (membersById.get(account.ownerUserId)?.name ?? null)
	return h.aside(
		[
			h.AriaLabel(`${account.name}: ${signal.title}`),
			h.Class(
				// Below lg it slides over the queue (a row press opens it there too); a phone's fills the
				// screen, clear of the notch and the home indicator.
				"flex w-[440px] shrink-0 flex-col overflow-y-auto border-border border-l bg-bg max-lg:fixed max-lg:inset-y-0 max-lg:right-0 max-lg:z-30 max-lg:max-w-full max-lg:shadow-lg max-md:w-full max-md:border-l-0 max-md:pt-[env(safe-area-inset-top)] max-md:pb-[env(safe-area-inset-bottom)]",
			),
		],
		[
			h.div(
				[h.Class("flex items-center justify-between px-5 pt-4")],
				[
					h.span(
						[h.Class("flex items-center gap-2 text-muted-fg text-sm")],
						[
							kbd(h, "J"),
							kbd(h, "K"),
							position < 0 ? "" : `Signal ${position + 1} of ${ids.length}`,
						],
					),
					button(
						h,
						{
							intent: "plain",
							size: "sq-xs",
							className: "max-md:size-10",
							onPress: Message.ClosedPreview(),
							attributes: [h.AriaLabel("Close preview")],
						},
						[IconClose(h, { className: "size-4" })],
					),
				],
			),
			h.div(
				[h.Class("flex items-start gap-3 px-5 pt-4")],
				[
					// The logo and the name open the customer (as Enter does); the logo is out of the tab order.
					toCustomer(
						h,
						href,
						[h.Tabindex(-1), h.AriaHidden(true)],
						[companyLogo(h, { name: account.name, logoUrl: account.logoUrl, size: "md" })],
						"shrink-0",
					),
					h.div(
						[h.Class("flex min-w-0 flex-1 flex-col")],
						[
							heading(h, { variant: "title", className: "truncate" }, [
								toCustomer(h, href, [], [account.name], "hover:underline"),
							]),
							h.span(
								[h.Class("truncate text-muted-fg text-xs")],
								[
									[
										account.domain,
										environmentsHintOf(counts.get(account.id) ?? 0),
										`since ${formatDate(new Date(account.firstSeenAtMs), { withYear: true })}`,
									]
										.filter((part) => part !== null)
										.join(" · "),
								],
							),
						],
					),
				],
			),
			h.div([h.Class("flex flex-wrap items-center gap-1.5 px-5 pt-3 pb-4")], [...actions]),
			h.div([h.Class("border-border border-t")], [summary(h, account, owner)]),
			h.section(
				[h.Class("flex flex-col gap-3 border-border border-t px-5 py-4")],
				[
					h.div(
						[h.Class("flex items-center gap-2")],
						[
							kindChip(h, signal.kind),
							h.h3([h.Class("min-w-0 flex-1 truncate font-semibold text-fg")], [signal.title]),
							severityChip(h, signal.severity),
						],
					),
					h.p([h.Class("text-fg-2 text-sm")], [signal.reason]),
					h.p(
						[h.Class("text-muted-fg text-xs")],
						[
							`Opened ${formatDate(new Date(signal.openedAtMs), { now: new Date(viewer.nowMs) })} · Rule: ${TEMPLATES[signal.template].name}`,
						],
					),
					evidenceDetail(h, signal.evidence, {
						now: new Date(viewer.nowMs),
						className: "rounded-lg border border-border p-3",
					}),
				],
			),
			...(others.length === 0
				? []
				: [
						section(
							h,
							`Other open signals · ${others.length}`,
							others.map((other) => otherSignalRow(h, other, context)),
						),
					]),
			...detailSections(h, model, viewer.nowMs),
		],
	)
}

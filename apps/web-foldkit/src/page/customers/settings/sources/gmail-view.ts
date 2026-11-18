import type { Html } from "foldkit/html"
import { formatCount, formatDate, formatRelative } from "../../../../customers/format"
import { providerOf } from "../../../../customers/providers"
import { segmented } from "../../../../customers/ui/filter-bar"
import { personLabel, sourceMark } from "../../../../customers/ui/identity"
import { IconArrowPath } from "../../../../icons"
import { AppRoute, hrefOf } from "../../../../route"
import { button } from "../../../../ui/button"
import { heading } from "../../../../ui/heading"
import { settingsHeader, settingsPage } from "../shared"
import { mappingCard } from "./detail-view"
import { Message } from "./message"
import { gmailLookbackOf, isLive, mailboxesOf, mailboxOf, type Model, runningRunOf, statusOf } from "./model"
import {
	addsList,
	canManage,
	type Context,
	errorBanner,
	gmailConnectLink,
	progressLine,
} from "./overview-view"
import { callout, card, cardHeader, eyebrow, formatClock, type H, statusBadge } from "./parts"
import type { ConnectionRow } from "./queries"
import { lookbackSegments } from "./settings-view"

/**
 * Gmail's source page (`docs/customers/gmail.md`): one connection per mailbox, each member connecting
 * their own over Google sign-in (a navigation to the API, which comes back with `?gmail=`). Sync,
 * lookback and disconnect are the mailbox's owner's or an admin's.
 */

const fact = (h: H, label: string, value: Html | string, detail?: string): Html =>
	h.div(
		[h.Class("flex min-w-0 flex-col gap-1")],
		[
			eyebrow(h, label),
			typeof value === "string"
				? h.p([h.Class("truncate font-medium text-fg text-sm")], [value])
				: value,
			...(detail === undefined ? [] : [h.p([h.Class("truncate text-muted-fg text-xs")], [detail])]),
		],
	)

const lastSyncFact = (h: H, model: Model, connection: ConnectionRow, context: Context): Html => {
	const now = new Date(context.nowMs)
	const running = runningRunOf(model, connection.id)
	if (running !== undefined)
		return fact(
			h,
			"Last sync",
			"Running now",
			`Started ${formatRelative(new Date(running.startedAtMs), now)}`,
		)
	return fact(
		h,
		"Last sync",
		connection.lastSuccessAtMs === null
			? "Not synced yet"
			: formatRelative(new Date(connection.lastSuccessAtMs), now),
		!isLive(connection) || connection.nextSyncAtMs === null
			? undefined
			: `Next at ${formatClock(connection.nextSyncAtMs)}`,
	)
}

const lookback = (h: H, model: Model, connection: ConnectionRow, context: Context): Html => {
	const days = gmailLookbackOf(model, connection)
	return h.div(
		[h.Class("flex flex-wrap items-center justify-between gap-3 border-border border-t pt-4")],
		[
			h.div(
				[h.Class("flex min-w-0 flex-col gap-0.5")],
				[
					heading(h, { variant: "subsection", level: 4 }, ["Lookback"]),
					h.p([h.Class("text-muted-fg text-xs")], ["How much past mail a backfill reads."]),
				],
			),
			canManage(connection, context)
				? segmented(h, {
						ariaLabel: `Lookback of ${mailboxOf(connection)}`,
						segments: lookbackSegments(days),
						selected: String(days),
						onSelect: (key) =>
							Message.ClickedGmailLookback({ connectionId: connection.id, days: Number(key) }),
						className: model.isSavingSettings ? "pointer-events-none opacity-60" : undefined,
					})
				: h.p([h.Class("text-fg text-sm")], [`${formatCount(days)} days`]),
		],
	)
}

const mailboxActions = (
	h: H,
	model: Model,
	connection: ConnectionRow,
	context: Context,
): ReadonlyArray<Html> => {
	if (!canManage(connection, context)) return []
	if (!isLive(connection)) return [gmailConnectLink(h, context, "Reconnect")]
	return [
		...(statusOf(model, connection) === "syncing"
			? []
			: [
					button(
						h,
						{
							intent: "outline",
							size: "sm",
							isPending: model.syncing.includes(connection.id),
							onPress: Message.PressedSyncNow({ connectionId: connection.id }),
						},
						[IconArrowPath(h, { attributes: { "data-slot": "icon" } }), "Sync now"],
					),
				]),
		button(
			h,
			{
				intent: "outline",
				size: "sm",
				className: "text-danger-subtle-fg",
				onPress: Message.PressedDisconnect({ connectionId: connection.id }),
			},
			["Disconnect…"],
		),
	]
}

const mailboxCard = (h: H, model: Model, connection: ConnectionRow, context: Context): Html => {
	const now = new Date(context.nowMs)
	const owner = model.members.find((member) => member.id === connection.connectedBy) ?? null
	const running = runningRunOf(model, connection.id)
	const live = isLive(connection)
	return card(h, [
		h.div(
			[h.Class("flex flex-wrap items-start gap-3")],
			[
				h.div(
					[h.Class("flex min-w-0 flex-1 basis-48 flex-col gap-0.5")],
					[
						h.div(
							[h.Class("flex flex-wrap items-center gap-2")],
							[
								heading(h, { variant: "section", level: 3, className: "truncate" }, [
									mailboxOf(connection),
								]),
								statusBadge(h, statusOf(model, connection)),
							],
						),
						h.p(
							[h.Class("text-muted-fg text-sm")],
							[
								live || connection.disconnectedAtMs === null
									? `Connected ${formatDate(new Date(connection.connectedAtMs), { now })}`
									: `Disconnected ${formatDate(new Date(connection.disconnectedAtMs), { now })}. Emails already imported stay.`,
							],
						),
					],
				),
				h.div(
					[h.Class("flex items-center gap-2")],
					[...mailboxActions(h, model, connection, context)],
				),
			],
		),
		...(running === undefined ? [] : [progressLine(h, running, context)]),
		...(connection.status === "error" ? [errorBanner(h, connection, context, false)] : []),
		h.div(
			[h.Class("grid grid-cols-2 gap-4 sm:grid-cols-4")],
			[
				fact(
					h,
					"Connected by",
					owner === null
						? h.p([h.Class("text-muted-fg text-sm")], ["A former member"])
						: personLabel(h, owner),
				),
				lastSyncFact(h, model, connection, context),
				fact(h, "Emails imported", formatCount(connection.stats.events)),
				fact(
					h,
					"Backfill",
					connection.backfilledAtMs === null
						? live
							? "In progress"
							: "Not finished"
						: `Done ${formatDate(new Date(connection.backfilledAtMs), { now })}`,
				),
			],
		),
		...(live ? [lookback(h, model, connection, context)] : []),
	])
}

const noMailboxes = (h: H, context: Context): Html =>
	card(h, [
		cardHeader(h, "No mailbox connected", providerOf("gmail").blurb),
		addsList(h, "gmail"),
		h.div(
			[h.Class("border-border border-t pt-4")],
			[gmailConnectLink(h, context, "Connect Gmail", "primary")],
		),
	])

export const gmailView = (h: H, model: Model, context: Context): Html => {
	const mailboxes = mailboxesOf(model)
	return settingsPage(h, [
		settingsHeader(h, {
			crumbs: [
				{
					label: "Data sources",
					href: hrefOf(AppRoute.CustomersSettingsSources({ orgSlug: context.orgSlug })),
				},
				{ label: "Gmail" },
			],
			leading: sourceMark(h, "gmail", { size: "md" }),
			title: "Gmail",
			subtitle: providerOf("gmail").syncMode,
			actions:
				mailboxes.length === 0
					? []
					: [
							gmailConnectLink(
								h,
								context,
								mailboxes.some(isLive) ? "Connect another mailbox" : "Connect Gmail",
								"primary",
							),
						],
		}),
		callout(h, {
			tone: "info",
			message: {
				title: "Imported emails are shared with this organization",
				description:
					"Every Customers member of this organization can read the emails imported from your mailbox, bodies included. Only emails with known customers are imported; the rest are read and dropped.",
			},
		}),
		...(model.connections === null
			? [h.p([h.Class("text-muted-fg text-sm")], ["Loading…"])]
			: mailboxes.length === 0
				? [noMailboxes(h, context)]
				: [
						h.section(
							[h.Class("flex flex-col gap-3")],
							[
								heading(
									h,
									{ variant: "subsection", level: 2, className: "flex items-center gap-2" },
									[
										"Mailboxes",
										h.span(
											[h.Class("font-normal text-muted-fg tabular-nums")],
											[formatCount(mailboxes.length)],
										),
									],
								),
								...mailboxes.map((connection) => mailboxCard(h, model, connection, context)),
							],
						),
					]),
		mappingCard(h, "gmail"),
	])
}

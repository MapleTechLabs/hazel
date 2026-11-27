// Effect UI is a public preview: every API is experimental by design here.
// @effect-diagnostics experimentalApiUsage:off
/**
 * The side panel for the selected signal (today's `web-foldkit/src/page/customers/attention/preview.ts`,
 * Wonder: Queue Selected With Preview): the account, the row's actions, its numbers, the signal and
 * its evidence, the account's other open signals, then contacts to reach and recent activity.
 */
import { Query } from "@effect/ui"
import { HazelRpc } from "@hazel/client-data"
import * as Customers from "@hazel/domain/customers"
import { TEMPLATES } from "@hazel/domain/customers"
import { CustomerAccountId, OrganizationId } from "@hazel/schema"
import type { Hazel } from "@hazel/ui/vocabulary/index"
import { Effect, Schema } from "effect"
import { formatCount, formatDate, formatMoney, formatRelative } from "../data/format"
import { customerAccountOf, environmentsHintOf, queueNameOf } from "../data/groups"
import type { AccountRow, MemberRow, SignalRow } from "../data/queries"
import { kindChip, severityChip, STAGE_LABEL } from "../ui/badges"
import { evidenceDetail } from "../ui/evidence"
import { kbd } from "../ui/filter-bar"
import { companyLogo, personAvatar, sourceMark } from "../ui/identity"
import { personOf } from "./model"

/** The account's summary, contacts to reach and recent timeline; `attempt` counts "Try again". */
export class GetAccountDetail extends Query.Service<GetAccountDetail>()("hazel/customers/GetAccountDetail", {
	args: { organizationId: OrganizationId, accountId: CustomerAccountId, attempt: Schema.Finite },
	success: Customers.AccountDetail,
	error: Schema.Literal("Failed"),
	staleTime: "1 minute",
}) {
	static readonly layer = this.toLayer(
		Effect.gen(function* () {
			const rpc = yield* HazelRpc
			return ({ organizationId, accountId }) =>
				rpc("customers.account.detail", { organizationId, accountId }).pipe(
					Effect.tapError((error) => Effect.logWarning("account detail failed", error)),
					// A deleted account reads like an unreachable one: the panel offers a retry.
					Effect.mapError(() => "Failed" as const),
				)
		}),
	)
}

/** The detail as the panel draws it. */
export type DetailState =
	| { readonly _tag: "Loading" }
	| { readonly _tag: "Failed" }
	| { readonly _tag: "Loaded"; readonly detail: Customers.AccountDetail }

export interface PreviewOptions<Msg> {
	readonly signal: SignalRow
	readonly account: AccountRow
	readonly accounts: ReadonlyArray<AccountRow>
	readonly signals: ReadonlyArray<SignalRow>
	readonly members: ReadonlyArray<MemberRow>
	readonly environmentCounts: ReadonlyMap<string, number>
	/** The selected row's place among the rows j/k walk. */
	readonly position: number
	readonly total: number
	readonly nowMs: number
	/** The customer's page, or null before the org has a slug. */
	readonly customerHref: string | null
	readonly actions: ReadonlyArray<Hazel.NoTextInput<Msg>>
	readonly detail: DetailState
	readonly onClose: Msg
	readonly onPressSignal: (signalId: SignalRow["id"]) => Msg
	readonly onRetry: Msg
	readonly onCopyEmail: (email: string) => Msg
}

const sectionOf = <Msg>(h: Hazel.H<Msg>, title: string, ...children: ReadonlyArray<Hazel.NoTextInput<Msg>>) =>
	h.stack
		.density("compact")
		.inset("page")
		.children(h.heading.level("3").children(title), ...children)

const stat = <Msg>(h: Hazel.H<Msg>, label: string, value: string, detail: string | null) =>
	h.stack
		.density("none")
		.children(
			h.text.role("caption").tone("muted").children(label),
			h.text.strong().truncate().children(value),
			detail === null ? null : h.text.role("caption").tone("muted").truncate().children(detail),
		)

const contactRow = <Msg>(h: Hazel.H<Msg>, row: Customers.ContactRow, options: PreviewOptions<Msg>) => {
	const { contact } = row
	const name = contact.name ?? contact.email ?? "Unknown"
	const lastSeen =
		contact.lastSeenAt === null
			? "Never seen"
			: `Seen ${formatRelative(contact.lastSeenAt, new Date(options.nowMs))}`
	const email = contact.email
	return h.item
		.key(contact.id)
		.title(name)
		.subtitle([contact.title, contact.email].filter((part) => part !== null).join(" · "))
		.leading(personAvatar(h, { name, avatarUrl: contact.avatarUrl }))
		.trailing(
			h.stack
				.axis("horizontal")
				.density("compact")
				.align("center")
				.children(
					contact.role === null ? null : h.badge.style("quiet").size("small").label(contact.role),
					h.text
						.role("caption")
						.tone(row.status === "active" ? "muted" : "warning")
						.children(lastSeen),
					email === null
						? null
						: h.button
								.label(`Copy ${email}`)
								.icon("copy")
								.iconOnly()
								.variant("ghost")
								.size("xsmall")
								.on("press", options.onCopyEmail(email)),
				),
		)
}

const eventRow = <Msg>(h: Hazel.H<Msg>, event: Customers.Event, nowMs: number) =>
	h.item
		.key(event.id)
		.title(event.title)
		.subtitle(formatDate(event.occurredAt, { now: new Date(nowMs) }))
		.leading(sourceMark(h, event.provider, { size: "xs" }))

/** Contacts and the timeline come with the account's detail. */
const detailSections = <Msg>(h: Hazel.H<Msg>, options: PreviewOptions<Msg>) => {
	const { detail } = options
	if (detail._tag === "Loading") return [h.progress.style("spinner").label("Loading account...")]
	if (detail._tag === "Failed")
		return [
			h.emptyState
				.title("Couldn't load this account's contacts and activity.")
				.action(
					h.button.label("Try again").variant("outline").size("small").on("press", options.onRetry),
				),
		]
	const { contactsToReach, recentEvents } = detail.detail
	return [
		h.divider,
		sectionOf(
			h,
			"Contacts to reach",
			contactsToReach.length === 0
				? h.text.tone("muted").children("No contacts yet.")
				: h.stack
						.density("none")
						.children(...contactsToReach.map((row) => contactRow(h, row, options))),
		),
		h.divider,
		sectionOf(
			h,
			"Recent activity",
			recentEvents.length === 0
				? h.text.tone("muted").children("Nothing recorded yet.")
				: h.stack
						.density("none")
						.children(...recentEvents.map((event) => eventRow(h, event, options.nowMs))),
		),
	]
}

export const previewPanel = <Msg>(h: Hazel.H<Msg>, options: PreviewOptions<Msg>) => {
	const { account, signal, nowMs } = options
	const accountsById = new Map(options.accounts.map((row) => [row.id, row]))
	const membersById = new Map(options.members.map((member) => [member.id, member]))
	const owner = personOf(membersById, customerAccountOf(account, accountsById).ownerUserId)
	const others = options.signals.filter(
		(other) => other.accountId === signal.accountId && other.id !== signal.id && other.status === "open",
	)
	const name = queueNameOf(account)
	const facts = [
		account.domain,
		environmentsHintOf(options.environmentCounts.get(account.id) ?? 0),
		`since ${formatDate(new Date(account.firstSeenAtMs), { withYear: true })}`,
	]
		.filter((part) => part !== null)
		.join(" · ")
	return h.scroll.key("attention-preview").children(
		h.stack
			.axis("horizontal")
			.align("center")
			.inset("bar")
			.children(
				kbd(h, "J"),
				kbd(h, "K"),
				h.text
					.tone("muted")
					.children(
						options.position < 0 ? "" : `Signal ${options.position + 1} of ${options.total}`,
					),
				h.spacer,
				h.button
					.label("Close preview")
					.icon("close")
					.iconOnly()
					.variant("ghost")
					.size("xsmall")
					.on("press", options.onClose),
			),
		h.stack
			.axis("horizontal")
			.density("compact")
			.align("start")
			.inset("bar")
			.children(
				companyLogo(h, { name, logoUrl: account.logoUrl, size: "md" }),
				h.stack.density("none").children(
					// HAZEL-GAP(pk2-heading-link): today the account's name is a title-sized link to its page.
					options.customerHref === null
						? h.heading.level("2").children(name)
						: h.link.label(name).href(options.customerHref),
					h.text.role("caption").tone("muted").truncate().children(facts),
				),
			),
		h.stack
			.axis("horizontal")
			.density("compact")
			.wrap()
			.inset("bar")
			.children(...options.actions),
		h.divider,
		h.stack
			.inset("page")
			.children(
				h.grid
					.columns("3")
					.children(
						stat(h, "MRR", formatMoney(account.mrrMinor, account.currency), account.planName),
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
						stat(
							h,
							"Owner",
							owner?.name ?? "Unowned",
							`${STAGE_LABEL[account.lifecycleStage]} stage`,
						),
					),
			),
		h.divider,
		h.stack
			.density("compact")
			.inset("page")
			.children(
				h.stack
					.axis("horizontal")
					.density("compact")
					.align("start")
					.children(
						kindChip(h, signal.kind),
						h.heading.level("3").children(signal.title),
						h.spacer,
						severityChip(h, signal.severity),
					),
				h.text.children(signal.reason),
				h.text
					.role("caption")
					.tone("muted")
					.children(
						`Opened ${formatDate(new Date(signal.openedAtMs), { now: new Date(nowMs) })} · Rule: ${TEMPLATES[signal.template].name}`,
					),
				h.frame
					.surface("inset")
					.children(evidenceDetail(h, signal.evidence, { now: new Date(nowMs) })),
			),
		...(others.length === 0
			? []
			: [
					h.divider,
					sectionOf(
						h,
						`Other open signals · ${others.length}`,
						...others.map((other) =>
							h.item
								.key(other.id)
								.title(other.title)
								.subtitle(other.reason)
								.leading(severityChip(h, other.severity))
								.trailing(personAvatar(h, personOf(membersById, other.assigneeUserId)))
								.on("press", options.onPressSignal(other.id)),
						),
					),
				]),
		...detailSections(h, options),
	)
}

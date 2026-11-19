import { Color, Detail, Icon } from "@raycast/api"
import { usePromise } from "@raycast/utils"
import { CustomerActions, channelUrl, providerLinks } from "./customer-actions"
import { HEALTH, STAGE, SOURCE, date, httpsUrl, md, money, relative } from "./lib/format"
import type { Account, AccountDetail, ChannelLink, Organization, Signal } from "./lib/models"
import { call } from "./lib/rpc"

/** `customers.account.detail`. */
export const fetchDetail = (organizationId: string, accountId: string) =>
	call<AccountDetail>("customers.account.detail", { organizationId, accountId })

const SEVERITY_ICON = { high: "🔴", medium: "🟠", low: "🟡" } as const
const HEALTH_LABEL = {
	usage: "Usage",
	engagement: "Engagement",
	billing: "Billing",
	signals: "Signals",
} as const

/** The page: what needs attention first, then health, billing, who to reach and what happened. */
export const detailMarkdown = (
	account: Account,
	signals: ReadonlyArray<Signal>,
	detail: AccountDetail | undefined,
) => {
	const health = HEALTH[account.healthStatus]
	const lines: Array<string> = [
		`# ${md(account.name)}`,
		[
			`**${health.label}${account.healthScore === null ? "" : ` · ${account.healthScore}`}**`,
			STAGE[account.lifecycleStage],
			account.planName === null ? null : md(account.planName),
			account.mrrMinor > 0 ? `${money(account.mrrMinor, account.currency)}/mo` : null,
		]
			.filter((part) => part !== null)
			.join(" · "),
	]

	const open = signals.filter((signal) => signal.status === "open")
	if (open.length > 0) {
		lines.push("## Needs attention")
		for (const signal of open) {
			const icon = signal.kind === "opportunity" ? "✨" : SEVERITY_ICON[signal.severity]
			lines.push(
				`- ${icon} **${md(signal.title)}** — ${md(signal.reason)} _(${relative(signal.openedAt)})_`,
			)
		}
	}
	if (detail === undefined) return lines.join("\n\n")

	const overdue = detail.openInvoices
	if (overdue.length > 0 || detail.subscriptions.length > 0 || detail.upcomingInvoice !== null) {
		lines.push("## Billing")
		for (const invoice of overdue) {
			const reason = invoice.declineReason === null ? "" : ` — ${md(invoice.declineReason)}`
			const due = invoice.dueAt === null ? "" : `, due ${date(invoice.dueAt)}`
			const invoiceUrl = httpsUrl(invoice.hostedUrl)
			lines.push(
				`- ⚠️ **${money(invoice.amountDueMinor, invoice.currency)} ${invoice.status}**${due}${reason}` +
					(invoiceUrl === null ? "" : ` · [Invoice](<${invoiceUrl}>)`),
			)
		}
		for (const subscription of detail.subscriptions) {
			const ends = subscription.cancelAtPeriodEnd ? "cancels" : "renews"
			lines.push(
				`- ${subscription.planName === null ? "Subscription" : md(subscription.planName)} · ${money(subscription.mrrMinor, subscription.currency)}/mo · ${subscription.status}` +
					(subscription.currentPeriodEnd === null
						? ""
						: ` · ${ends} ${date(subscription.currentPeriodEnd)}`) +
					(subscription.quantity > 1 ? ` · ${subscription.quantity} seats` : ""),
			)
		}
		const next = detail.upcomingInvoice
		if (next !== null) {
			lines.push(
				`- Next invoice: ${money(next.amountDueMinor, next.currency)}${next.dueAt === null ? "" : ` on ${date(next.dueAt)}`}`,
			)
		}
	}

	const components = detail.health?.components ?? []
	if (components.length > 0) {
		lines.push(
			"## Health",
			[
				"| | Score | Why |",
				"| --- | --- | --- |",
				...components.map(
					(component) =>
						`| ${HEALTH_LABEL[component.key]} | ${component.excluded || component.score === null ? "—" : component.score} | ${md(component.why)} |`,
				),
			].join("\n"),
		)
	}

	if (detail.contactsToReach.length > 0) {
		lines.push("## Who to reach")
		for (const { contact, status } of detail.contactsToReach) {
			const who = md(contact.name ?? contact.email ?? "Unknown")
			const email = contact.email !== null && contact.name !== null ? ` · ${md(contact.email)}` : ""
			const role = contact.title ?? contact.role
			const roleText = role === null ? null : md(role)
			const seen =
				contact.lastSeenAt === null
					? status === "never_active"
						? "never active"
						: null
					: `seen ${relative(contact.lastSeenAt)}`
			lines.push(
				`- **${who}**${email}${[roleText, seen]
					.filter(Boolean)
					.map((part) => ` · ${part}`)
					.join("")}`,
			)
		}
	}

	if (detail.recentEvents.length > 0) {
		lines.push("## Recent activity")
		for (const event of detail.recentEvents) {
			lines.push(
				`- ${relative(event.occurredAt)} · ${SOURCE[event.provider].label} · ${md(event.title)}`,
			)
		}
	}
	return lines.join("\n\n")
}

/** One customer: synced row and signals at once, the rest (`customers.account.detail`) when it loads. */
export function CustomerDetail(props: {
	readonly organization: Organization
	readonly account: Account
	readonly signals: ReadonlyArray<Signal>
	readonly links: ReadonlyArray<ChannelLink>
}) {
	const { organization, signals, links } = props
	const detail = usePromise(fetchDetail, [organization.id, props.account.id], {
		failureToastOptions: { title: "Could not load the customer" },
	})
	const account = detail.data?.account ?? props.account
	const health = HEALTH[account.healthStatus]
	const trend = account.activeUsersTrendPct
	return (
		<Detail
			navigationTitle={account.name}
			isLoading={detail.isLoading}
			markdown={detailMarkdown(account, signals, detail.data)}
			metadata={
				<Detail.Metadata>
					<Detail.Metadata.TagList title="Health">
						<Detail.Metadata.TagList.Item
							text={
								account.healthScore === null
									? health.label
									: `${health.label} · ${account.healthScore}`
							}
							color={health.color}
						/>
					</Detail.Metadata.TagList>
					<Detail.Metadata.Label title="Stage" text={STAGE[account.lifecycleStage]} />
					<Detail.Metadata.Label
						title="MRR"
						text={account.mrrMinor > 0 ? money(account.mrrMinor, account.currency) : "—"}
					/>
					{account.planName !== null && (
						<Detail.Metadata.Label title="Plan" text={account.planName} />
					)}
					{account.trialEndsAt !== null && account.lifecycleStage === "trialing" && (
						<Detail.Metadata.Label title="Trial ends" text={date(account.trialEndsAt)} />
					)}
					<Detail.Metadata.Separator />
					<Detail.Metadata.Label
						title="Active users (30d)"
						text={`${account.activeUsers30d}${trend === null ? "" : ` (${trend >= 0 ? "+" : ""}${Math.round(trend)}%)`}`}
						icon={
							trend === null
								? undefined
								: {
										source: trend >= 0 ? Icon.ArrowUp : Icon.ArrowDown,
										tintColor: trend >= 0 ? Color.Green : Color.Red,
									}
						}
					/>
					{account.seatsUsed !== null && (
						<Detail.Metadata.Label
							title="Seats"
							text={
								account.seatsLimit === null
									? `${account.seatsUsed}`
									: `${account.seatsUsed} of ${account.seatsLimit}`
							}
						/>
					)}
					<Detail.Metadata.Label title="Contacts" text={`${account.contactCount}`} />
					{account.lastActiveAt !== null && (
						<Detail.Metadata.Label title="Last active" text={relative(account.lastActiveAt)} />
					)}
					<Detail.Metadata.Label title="Customer since" text={date(account.firstSeenAt)} />
					{account.churnedAt !== null && (
						<Detail.Metadata.Label title="Churned" text={date(account.churnedAt)} />
					)}
					<Detail.Metadata.Separator />
					{account.domains.map((domain) => (
						<Detail.Metadata.Link
							key={domain}
							title="Domain"
							text={domain}
							target={`https://${domain}`}
						/>
					))}
					{links.flatMap((link, index) => {
						const url = channelUrl(organization, link)
						return url === null
							? []
							: [
									<Detail.Metadata.Link
										key={link.id}
										title={index === 0 ? "Channel" : ""}
										text="Open in Hazel"
										target={url}
									/>,
								]
					})}
					{providerLinks(detail.data).map((link) => (
						<Detail.Metadata.Link
							key={`${link.provider}:${link.externalId}`}
							title={SOURCE[link.provider].label}
							text={link.environment ?? link.externalId}
							target={link.url}
						/>
					))}
					{account.tags.length > 0 && (
						<Detail.Metadata.TagList title="Tags">
							{account.tags.map((tag) => (
								<Detail.Metadata.TagList.Item key={tag} text={tag} />
							))}
						</Detail.Metadata.TagList>
					)}
				</Detail.Metadata>
			}
			actions={
				<CustomerActions
					organization={organization}
					account={account}
					links={links}
					detail={detail.data}
					onRefresh={detail.revalidate}
				/>
			}
		/>
	)
}

/** The account's logo when it is https (as on the web), else a building. */
export const accountIcon = (account: Account) => {
	const logo = httpsUrl(account.logoUrl)
	return logo === null ? Icon.Building : { source: logo, fallback: Icon.Building }
}

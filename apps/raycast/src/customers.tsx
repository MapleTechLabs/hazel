import { Icon, List } from "@raycast/api"
import { useCachedPromise, useCachedState } from "@raycast/utils"
import { useMemo, useState } from "react"
import { CustomerActions } from "./customer-actions"
import { CustomerDetail, accountIcon, fetchDetail } from "./customer-detail"
import { HEALTH, STAGE, money, risk } from "./lib/format"
import type { Account, ChannelLink, Organization, Signal } from "./lib/models"
import { call } from "./lib/rpc"
import { type SyncStatus, useCustomers } from "./lib/use-customers"

export const fetchOrganizations = () =>
	call<{ organizations: ReadonlyArray<Organization> }>("customers.organizations", {}).then(
		(result) => result.organizations,
	)

const STATUS_LABEL = {
	connecting: "Syncing…",
	live: "Live",
	offline: "Offline, showing the saved list",
	unavailable: "No Customers area",
} satisfies Record<SyncStatus, string>

const groupBy = <A extends { readonly accountId: string }>(rows: Readonly<Record<string, A>>) => {
	const groups = new Map<string, Array<A>>()
	for (const row of Object.values(rows)) {
		const group = groups.get(row.accountId)
		if (group === undefined) groups.set(row.accountId, [row])
		else group.push(row)
	}
	return groups
}

const accessories = (account: Account): Array<List.Item.Accessory> => {
	const open = risk(account)
	const health = HEALTH[account.healthStatus]
	return [
		...(open.count > 0
			? [{ icon: open.icon, text: `${open.count}`, tooltip: `${open.count} open risks` }]
			: []),
		...(account.lifecycleStage !== "active" ? [{ text: STAGE[account.lifecycleStage] }] : []),
		...(account.mrrMinor > 0
			? [{ text: money(account.mrrMinor, account.currency), tooltip: "MRR" }]
			: []),
		{
			tag: {
				value: account.healthScore === null ? health.label : `${account.healthScore}`,
				color: health.color,
			},
			tooltip: `Health: ${health.label}`,
		},
	]
}

export default function Command() {
	const organizations = useCachedPromise(fetchOrganizations, [], {
		failureToastOptions: { title: "Could not load your organizations" },
	})
	const [chosenId, setChosenId] = useCachedState<string | undefined>("organization", undefined)
	const organization =
		organizations.data?.find((candidate) => candidate.id === chosenId) ?? organizations.data?.[0]
	const { state, status } = useCustomers(organization?.id)
	const [selectedId, setSelectedId] = useState<string | null>(null)

	// The selected customer's detail, so the list offers its Clerk, Stripe and Autumn links too.
	const detail = useCachedPromise(fetchDetail, [organization?.id ?? "", selectedId ?? ""], {
		execute:
			organization !== undefined && selectedId !== null && state.accounts[selectedId] !== undefined,
		keepPreviousData: false,
		onError: () => undefined,
	})

	const accounts = useMemo(
		() =>
			Object.values(state.accounts).sort(
				(a, b) => b.mrrMinor - a.mrrMinor || a.name.localeCompare(b.name),
			),
		[state.accounts],
	)
	const signals = useMemo(() => groupBy<Signal>(state.signals), [state.signals])
	const links = useMemo(() => groupBy<ChannelLink>(state.links), [state.links])

	return (
		<List
			isLoading={organizations.isLoading || status === "connecting"}
			searchBarPlaceholder="Search customers by name, domain, plan or tag"
			onSelectionChange={setSelectedId}
			searchBarAccessory={
				(organizations.data?.length ?? 0) > 1 ? (
					<List.Dropdown tooltip="Organization" value={organization?.id} onChange={setChosenId}>
						{organizations.data?.map((candidate) => (
							<List.Dropdown.Item
								key={candidate.id}
								title={candidate.name}
								value={candidate.id}
							/>
						))}
					</List.Dropdown>
				) : undefined
			}
		>
			{status === "unavailable" ? (
				<List.EmptyView
					icon={Icon.PersonLines}
					title="No customers here"
					description={`${organization?.name ?? "This organization"} has no Customers area, or you are not a member.`}
				/>
			) : (
				<List.EmptyView
					icon={Icon.PersonLines}
					title={status === "connecting" ? "Syncing customers…" : "No customers"}
					description="Connect Clerk, Stripe or Autumn in Hazel's Customers settings to see them here."
				/>
			)}
			{organization !== undefined && (
				<List.Section
					title={organization.name}
					subtitle={`${accounts.length} · ${STATUS_LABEL[status]}`}
				>
					{accounts.map((account) => {
						const accountSignals = signals.get(account.id) ?? []
						const accountLinks = links.get(account.id) ?? []
						return (
							<List.Item
								key={account.id}
								id={account.id}
								icon={accountIcon(account)}
								title={account.name}
								subtitle={account.planName ?? account.domains[0]}
								keywords={[
									...account.domains,
									...account.tags,
									...(account.planName === null ? [] : [account.planName]),
								]}
								accessories={accessories(account)}
								actions={
									<CustomerActions
										organization={organization}
										account={account}
										links={accountLinks}
										detail={selectedId === account.id ? detail.data : undefined}
										details={
											<CustomerDetail
												organization={organization}
												account={account}
												signals={accountSignals}
												links={accountLinks}
											/>
										}
									/>
								}
							/>
						)
					})}
				</List.Section>
			)}
		</List>
	)
}

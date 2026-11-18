import { Action, ActionPanel, Icon, Keyboard, List } from "@raycast/api"
import { useCachedState, usePromise } from "@raycast/utils"
import { useEffect, useMemo, useState } from "react"
import { CustomerActions, SignOutAction } from "./customer-actions"
import { CustomerDetail, accountIcon, fetchDetail } from "./customer-detail"
import { HEALTH, STAGE, money, relative, risk } from "./lib/format"
import type { Account, ChannelLink, Signal } from "./lib/models"
import { useCustomers } from "./lib/use-customers"

/** How long a selection rests before its detail loads (arrowing through the list loads nothing). */
const PREFETCH_DELAY_MS = 400

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
			? [
					{
						icon: open.icon,
						text: `${open.count}`,
						tooltip: `${open.count} open risk${open.count === 1 ? "" : "s"}`,
					},
				]
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
	const [chosenId, setChosenId] = useCachedState<string | undefined>("organization", undefined)
	const customers = useCustomers(chosenId)
	const { state, organization, organizations } = customers
	const [selectedId, setSelectedId] = useState<string | null>(null)
	const [restingId, setRestingId] = useState<string | null>(null)
	useEffect(() => {
		const timer = setTimeout(() => setRestingId(selectedId), PREFETCH_DELAY_MS)
		return () => clearTimeout(timer)
	}, [selectedId])

	// The resting selection's detail, so the list offers its Clerk, Stripe and Autumn links too.
	const detail = usePromise(fetchDetail, [organization?.id ?? "", restingId ?? ""], {
		execute: organization !== undefined && restingId !== null && state.accounts[restingId] !== undefined,
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

	const syncLabel = customers.isSyncing
		? "Syncing…"
		: customers.syncedAt === undefined
			? "Not synced yet"
			: `Synced ${relative(new Date(customers.syncedAt).toISOString())}`
	const emptyView = customers.isUnavailable
		? {
				title: "No customers here",
				description: `${organization?.name ?? "This organization"} has no Customers area, or you are not a member.`,
			}
		: customers.isSyncing
			? { title: "Syncing customers…" }
			: customers.failure !== undefined
				? {
						title: "Could not reach Hazel",
						description: `${customers.failure}\n\nPress ⌘R to try again.`,
					}
				: {
						title: "No customers",
						description:
							"Connect Clerk, Stripe or Autumn in Hazel's Customers settings to see them here.",
					}
	const syncAction = (
		<Action
			title="Sync Now"
			icon={Icon.ArrowClockwise}
			onAction={customers.syncNow}
			shortcut={Keyboard.Shortcut.Common.Refresh}
		/>
	)

	return (
		<List
			isLoading={customers.isSyncing}
			searchBarPlaceholder="Search customers by name, domain, plan or tag"
			onSelectionChange={setSelectedId}
			searchBarAccessory={
				(organizations?.length ?? 0) > 1 ? (
					<List.Dropdown tooltip="Organization" value={organization?.id} onChange={setChosenId}>
						{organizations?.map((candidate) => (
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
			<List.EmptyView
				icon={customers.failure !== undefined ? Icon.Warning : Icon.PersonLines}
				{...emptyView}
				actions={
					<ActionPanel>
						{syncAction}
						<SignOutAction />
					</ActionPanel>
				}
			/>
			{organization !== undefined && (
				<List.Section title={organization.name} subtitle={`${accounts.length} · ${syncLabel}`}>
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
										detail={
											detail.data?.account.id === account.id ? detail.data : undefined
										}
										syncAction={syncAction}
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

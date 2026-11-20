import type { CustomerAccountId } from "@hazel/schema"

/**
 * Customer groups: a customer with several environments (Maple's US and EU regions) is one account
 * per environment, the environments pointing at the group's primary (`primaryAccountId`). Each
 * account keeps its own numbers; these helpers only keep a group's accounts together. An account
 * whose primary is not among the live accounts stands alone.
 */

export type GroupMember = Readonly<{ id: CustomerAccountId; primaryAccountId: CustomerAccountId | null }>

/** The account's group: its primary's id when that primary is live (in `liveIds`), else its own. */
export const groupIdOf = (account: GroupMember, liveIds: ReadonlySet<string>): CustomerAccountId =>
	account.primaryAccountId !== null && liveIds.has(account.primaryAccountId)
		? account.primaryAccountId
		: account.id

const idsOf = (accounts: ReadonlyArray<GroupMember>): ReadonlySet<string> =>
	new Set(accounts.map((account) => account.id))

/**
 * `rows` (filtered and sorted) with each group's rows together: a group sits where its first row
 * is, its primary first, then its environments in their order. `liveIds` are every live account's
 * ids, so a row whose primary is filtered out still joins its group's other rows.
 */
export const groupRows = <A extends GroupMember>(
	rows: ReadonlyArray<A>,
	liveIds: ReadonlySet<string>,
): ReadonlyArray<A> => {
	const groups = new Map<string, Array<A>>()
	for (const row of rows) {
		const groupId = groupIdOf(row, liveIds)
		const group = groups.get(groupId)
		if (group === undefined) groups.set(groupId, [row])
		else if (row.id === groupId) group.unshift(row)
		else group.push(row)
	}
	return [...groups.values()].flat()
}

/**
 * `rows` (filtered and sorted) with each environment moved under its primary, when that primary is
 * among `rows`; every other row keeps its sorted place, so the top-level rows stay in sort order.
 */
export const nestUnderPrimaries = <A extends GroupMember>(rows: ReadonlyArray<A>): ReadonlyArray<A> => {
	const nestedIds = nestedIdsOf(rows)
	const children = new Map<string, Array<A>>()
	for (const row of rows) {
		if (row.primaryAccountId === null || !nestedIds.has(row.id)) continue
		const siblings = children.get(row.primaryAccountId)
		if (siblings === undefined) children.set(row.primaryAccountId, [row])
		else siblings.push(row)
	}
	return rows.flatMap((row) => (nestedIds.has(row.id) ? [] : [row, ...(children.get(row.id) ?? [])]))
}

/** The rows shown under their primary: environments whose primary is among `rows`. */
export const nestedIdsOf = (rows: ReadonlyArray<GroupMember>): ReadonlySet<string> => {
	const ids = idsOf(rows)
	return new Set(
		rows
			.filter((row) => row.primaryAccountId !== null && ids.has(row.primaryAccountId))
			.map((row) => row.id),
	)
}

/** The account's group, primary first, then its environments in `accounts` order; empty when it stands alone. */
export const groupOf = <A extends GroupMember>(
	accounts: ReadonlyArray<A>,
	accountId: CustomerAccountId,
): ReadonlyArray<A> => {
	const liveIds = idsOf(accounts)
	const account = accounts.find((candidate) => candidate.id === accountId)
	if (account === undefined) return []
	const groupId = groupIdOf(account, liveIds)
	const members = groupRows(
		accounts.filter((candidate) => groupIdOf(candidate, liveIds) === groupId),
		liveIds,
	)
	return members.length > 1 ? members : []
}

/** How many live environments each primary has (absent: none). */
export const environmentCounts = (accounts: ReadonlyArray<GroupMember>): ReadonlyMap<string, number> => {
	const liveIds = idsOf(accounts)
	const counts = new Map<string, number>()
	for (const account of accounts) {
		const groupId = groupIdOf(account, liveIds)
		if (groupId !== account.id) counts.set(groupId, (counts.get(groupId) ?? 0) + 1)
	}
	return counts
}

/** `+2 environments`, or null for none. */
export const environmentsHintOf = (count: number): string | null =>
	count === 0 ? null : `+${count} environment${count === 1 ? "" : "s"}`

// CHANGES (what the store does, applied to the rows at once)

/** `customers.account.link`: `accountId` and the environments it is primary of join `primaryAccountId`'s group. */
export const linkedTo = <A extends GroupMember>(
	accounts: ReadonlyArray<A>,
	accountId: CustomerAccountId,
	primaryAccountId: CustomerAccountId,
): ReadonlyArray<A> =>
	accounts.map((account) =>
		account.id === accountId || account.primaryAccountId === accountId
			? { ...account, primaryAccountId }
			: account,
	)

/** `customers.account.unlink`: the environment stands alone. */
export const unlinked = <A extends GroupMember>(
	accounts: ReadonlyArray<A>,
	accountId: CustomerAccountId,
): ReadonlyArray<A> =>
	accounts.map((account) => (account.id === accountId ? { ...account, primaryAccountId: null } : account))

/** `customers.account.setPrimary`: the environment leads its group; the old primary and the others point at it. */
export const madePrimary = <A extends GroupMember>(
	accounts: ReadonlyArray<A>,
	accountId: CustomerAccountId,
): ReadonlyArray<A> => {
	const oldId = accounts.find((account) => account.id === accountId)?.primaryAccountId ?? null
	if (oldId === null) return accounts
	return accounts.map((account) =>
		account.id === accountId
			? { ...account, primaryAccountId: null }
			: account.id === oldId || account.primaryAccountId === oldId
				? { ...account, primaryAccountId: accountId }
				: account,
	)
}

/** `Acme Robotics (EU)`: an account told apart from its group's others, which often share its name. */
export const accountLabelOf = (account: Readonly<{ name: string; environment: string | null }>): string =>
	account.environment === null ? account.name : `${account.name} (${account.environment})`

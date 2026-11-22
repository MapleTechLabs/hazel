import { type ChannelCustomerMark, type ChannelLinks, type ChannelLinksMap } from "../../ui/channel-icon"
import type { Model } from "./model"
import { partnerOrgsByChannel, syncProviderByChannel } from "./rows"

/**
 * What each channel is linked or connected to (its customer, its Connect partner orgs, its chat sync
 * platform), for `channelIcon`. The sidebar already streams all three for the org, so every surface
 * that draws a channel reads them from here (`Shared.channelLinks`) and marks it the same way.
 */

interface Inputs {
	readonly channelCustomers: Model["channelCustomers"]
	readonly connectMounts: Model["connectMounts"]
	readonly organizations: Model["organizations"]
	readonly organizationId: Model["organizationId"]
	readonly syncedChannels: Model["syncedChannels"]
}

const build = (inputs: Inputs): ChannelLinksMap => {
	const partners = partnerOrgsByChannel(inputs.connectMounts, inputs.organizations, inputs.organizationId)
	const sync = syncProviderByChannel(inputs.syncedChannels)
	const customers = new Map<string, ChannelCustomerMark>(
		inputs.channelCustomers.map((row) => [
			row.channelId,
			{ name: row.accountName, logoUrl: row.accountLogoUrl },
		]),
	)
	// One object per channel, so a memoized row that takes its links keeps its memo across renders.
	const links = new Map<string, ChannelLinks>()
	const ids = new Set<string>([...partners.keys(), ...sync.keys(), ...customers.keys()])
	for (const id of ids)
		links.set(id, {
			customer: customers.get(id) ?? null,
			partners: partners.get(id) ?? [],
			syncProvider: sync.get(id) ?? null,
		})
	return links
}

// Pure memo on the frozen rows: the map keeps its identity until one of them changes.
const memo = new WeakMap<
	Model["channelCustomers"],
	{ readonly inputs: Inputs; readonly result: ChannelLinksMap }
>()

export const channelLinksOf = (model: Model): ChannelLinksMap => {
	const cached = memo.get(model.channelCustomers)
	if (
		cached !== undefined &&
		cached.inputs.connectMounts === model.connectMounts &&
		cached.inputs.organizations === model.organizations &&
		cached.inputs.organizationId === model.organizationId &&
		cached.inputs.syncedChannels === model.syncedChannels
	)
		return cached.result
	const inputs: Inputs = {
		channelCustomers: model.channelCustomers,
		connectMounts: model.connectMounts,
		organizations: model.organizations,
		organizationId: model.organizationId,
		syncedChannels: model.syncedChannels,
	}
	const result = build(inputs)
	memo.set(model.channelCustomers, { inputs, result })
	return result
}

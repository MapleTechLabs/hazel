import type { Model } from "./model"
import type { ChannelEntry, RowCustomer } from "./rows"

/**
 * Channels linked to a customer (`docs/customers/channels.md`) get their own Customers section:
 * they leave the default and custom sections, and are listed by customer name, then channel name.
 * A favorite stays in Favorites only (the section queries already leave favorites out).
 */
export interface CustomerChannel {
	readonly entry: ChannelEntry
	readonly customer: RowCustomer
}

export interface SplitChannels {
	/** `model.sectionChannels` without the customer channels; a key's list keeps its identity when none left. */
	readonly sectionChannels: Readonly<Record<string, ReadonlyArray<ChannelEntry>>>
	readonly customerChannels: ReadonlyArray<CustomerChannel>
}

// Pure memo on the frozen inputs, so the filtered lists (and each row's customer, a row memo arg)
// keep their identity across renders.
const splitMemo = new WeakMap<
	Model["sectionChannels"],
	{ readonly channelCustomers: Model["channelCustomers"]; readonly result: SplitChannels }
>()

export const splitCustomerChannels = (model: Model): SplitChannels => {
	const cached = splitMemo.get(model.sectionChannels)
	if (cached !== undefined && cached.channelCustomers === model.channelCustomers) return cached.result
	const result = split(model.sectionChannels, model.channelCustomers)
	splitMemo.set(model.sectionChannels, { channelCustomers: model.channelCustomers, result })
	return result
}

const split = (
	sectionChannels: Model["sectionChannels"],
	channelCustomers: Model["channelCustomers"],
): SplitChannels => {
	if (channelCustomers.length === 0) return { sectionChannels, customerChannels: [] }
	const customerByChannel = new Map<string, RowCustomer>(
		channelCustomers.map((row) => [
			row.channelId,
			{ name: row.accountName, logoUrl: row.accountLogoUrl },
		]),
	)
	const remaining: Record<string, ReadonlyArray<ChannelEntry>> = {}
	const customers: Array<CustomerChannel> = []
	for (const [key, entries] of Object.entries(sectionChannels)) {
		const kept = entries.filter((entry) => {
			const customer = customerByChannel.get(entry.channel.id)
			if (customer === undefined) return true
			customers.push({ entry, customer })
			return false
		})
		remaining[key] = kept.length === entries.length ? entries : kept
	}
	customers.sort(
		(a, b) =>
			a.customer.name.localeCompare(b.customer.name) ||
			a.entry.channel.name.localeCompare(b.entry.channel.name),
	)
	return { sectionChannels: remaining, customerChannels: customers }
}

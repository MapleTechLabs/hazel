import * as Customers from "@hazel/domain/customers"
import { CustomerViewLayoutId, type OrganizationId, type UserId } from "@hazel/schema"
import { optimisticAction } from "@hazel/effect-db-collection"
import { Clock, Effect } from "effect"
import { customerViewLayoutCollection } from "~/db/collections"
import { HazelRpc } from "../rpc"

/**
 * A person's arrangement of the customers views (`Customers.ViewLayoutDraft`), shared by the list's
 * tabs and the sidebar: one order for both, and the views the sidebar leaves out. Keys are the
 * list's `?view=` values, with `current` for "Current customers" (whose `?view=` is none).
 */

/** "Current customers": the list's default tab. */
export const CURRENT_KEY = "current"
/** "All customers": also its `?view=`. */
export const ALL_KEY = "all"

/** The layout in effect (just its keys): the saved one, else the default. */
export const layoutOf = (saved: Customers.ViewLayoutDraft | null): Customers.ViewLayoutDraft =>
	saved === null ? Customers.DEFAULT_VIEW_LAYOUT : { order: saved.order, sidebarHidden: saved.sidebarHidden }

/**
 * `items` (in their default order) in the layout's order. One the order leaves out (a view made
 * since) goes right after the item before it in the default order.
 */
export const arrange = <A>(
	items: ReadonlyArray<A>,
	keyOf: (item: A) => string,
	order: ReadonlyArray<string>,
): ReadonlyArray<A> => {
	const rank = new Map(order.map((key, index) => [key, index]))
	const placed = items
		.filter((item) => rank.has(keyOf(item)))
		.sort((left, right) => (rank.get(keyOf(left)) ?? 0) - (rank.get(keyOf(right)) ?? 0))
	items.forEach((item, index) => {
		if (rank.has(keyOf(item))) return
		const before = index === 0 ? undefined : items[index - 1]
		placed.splice(before === undefined ? 0 : placed.indexOf(before) + 1, 0, item)
	})
	return placed
}

/** `key` moved to `toIndex` among the other keys (the drop index `DragAndDrop` answers). */
export const moveKey = (
	keys: ReadonlyArray<string>,
	key: string,
	toIndex: number,
): ReadonlyArray<string> => {
	const others = keys.filter((entry) => entry !== key)
	return [...others.slice(0, toIndex), key, ...others.slice(toIndex)]
}

/** `key` one place earlier or later. */
export const stepKey = (keys: ReadonlyArray<string>, key: string, step: -1 | 1): ReadonlyArray<string> => {
	const index = keys.indexOf(key)
	return index < 0 ? keys : moveKey(keys, key, Math.max(0, Math.min(keys.length - 1, index + step)))
}

/**
 * The full order after reordering the keys a list shows (the sidebar leaves some out): the shown
 * keys take their new order in the places they held, the others stay put.
 */
export const reorderShown = (
	all: ReadonlyArray<string>,
	shown: ReadonlyArray<string>,
	reordered: ReadonlyArray<string>,
): ReadonlyArray<string> => {
	const isShown = new Set(shown)
	let next = 0
	return all.map((key) => (isShown.has(key) ? (reordered[next++] ?? key) : key))
}

export const isInSidebar = (layout: Customers.ViewLayoutDraft, key: string): boolean =>
	!layout.sidebarHidden.includes(key)

export const withSidebar = (
	layout: Customers.ViewLayoutDraft,
	key: string,
	isShown: boolean,
): Customers.ViewLayoutDraft => ({
	...layout,
	sidebarHidden: isShown
		? layout.sidebarHidden.filter((entry) => entry !== key)
		: [...layout.sidebarHidden.filter((entry) => entry !== key), key],
})

// ACTION

export interface LayoutSave {
	readonly organizationId: OrganizationId
	readonly userId: UserId
	/** The synced row's id; null before the first save. */
	readonly layoutId: CustomerViewLayoutId | null
	readonly layout: Customers.ViewLayoutDraft
}

const saveLayout = optimisticAction({
	collections: [customerViewLayoutCollection],
	onMutate: (props: LayoutSave & { readonly at: Date; readonly newId: CustomerViewLayoutId }) => {
		const values = { order: [...props.layout.order], sidebarHidden: [...props.layout.sidebarHidden] }
		if (props.layoutId === null)
			customerViewLayoutCollection.insert({
				id: props.newId,
				organizationId: props.organizationId,
				userId: props.userId,
				...values,
				createdAt: props.at,
				updatedAt: props.at,
			})
		else
			customerViewLayoutCollection.update(props.layoutId, (row) => {
				Object.assign(row, values)
			})
		return {}
	},
	mutate: (props) =>
		Effect.gen(function* () {
			const client = yield* HazelRpc
			const result = yield* client("customers.view.layout", {
				organizationId: props.organizationId,
				layout: props.layout,
			})
			return { data: result.data, transactionId: result.transactionId }
		}),
})

/** Saves the whole layout; the synced row (and every view of it) shows it at once. */
export const saveLayoutAction = (props: LayoutSave) =>
	Effect.gen(function* () {
		const at = new Date(yield* Clock.currentTimeMillis)
		const newId = CustomerViewLayoutId.make(crypto.randomUUID())
		yield* saveLayout({ ...props, at, newId })
	})

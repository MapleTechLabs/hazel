import type * as Customers from "@hazel/domain/customers"
import { CustomerSavedViewId, type OrganizationId, type UserId } from "@hazel/schema"
import { optimisticAction } from "@hazel/effect-db-collection"
import { and, eq, isNull, or } from "@tanstack/db"
import { Clock, Effect, type Stream } from "effect"
import { customerSavedViewCollection } from "~/db/collections"
import { withCustomersSource } from "../../../customers/queries"
import { liveQueryStream } from "../../../data/live-query"
import { HazelRpc } from "../../../rpc"
import type { ViewRow } from "./model"

/** The list's own live query (views with their filters) and the saved-view actions. */

const toViewRow = (view: Customers.SavedView): ViewRow => ({
	id: view.id,
	name: view.name,
	builtInKey: view.builtInKey,
	ownerUserId: view.ownerUserId,
	position: view.position,
	filters: view.filters,
	sort: view.sort,
	columns: view.columns,
})

/** Shared views (built-ins included) and `userId`'s own, in tab order. */
export const viewRowsStream = <Message>(
	organizationId: OrganizationId,
	userId: UserId,
	toMessage: (views: ReadonlyArray<ViewRow>) => Message,
): Stream.Stream<Message> =>
	withCustomersSource(
		organizationId,
		liveQueryStream<Customers.SavedView, Message>(
			(q) =>
				q
					.from({ view: customerSavedViewCollection })
					.where(({ view }) =>
						and(
							eq(view.organizationId, organizationId),
							isNull(view.deletedAt),
							or(isNull(view.ownerUserId), eq(view.ownerUserId, userId)),
						),
					)
					.orderBy(({ view }) => view.position, "asc"),
			(rows) => toMessage(rows.map(toViewRow)),
		),
	)

// ACTIONS

interface ViewCreate {
	readonly organizationId: OrganizationId
	readonly userId: UserId
	readonly view: Customers.ViewDraft
	readonly isShared: boolean
	readonly position: number
}

const createView = optimisticAction({
	collections: [customerSavedViewCollection],
	onMutate: (props: ViewCreate & { readonly viewId: CustomerSavedViewId; readonly at: Date }) => {
		customerSavedViewCollection.insert({
			id: props.viewId,
			organizationId: props.organizationId,
			name: props.view.name,
			ownerUserId: props.isShared ? null : props.userId,
			builtInKey: null,
			filters: props.view.filters,
			sort: props.view.sort,
			columns: [...props.view.columns],
			position: props.position,
			createdBy: props.userId,
			createdAt: props.at,
			updatedAt: props.at,
			deletedAt: null,
		})
		return { viewId: props.viewId }
	},
	mutate: (props) =>
		Effect.gen(function* () {
			const client = yield* HazelRpc
			const result = yield* client("customers.view.create", {
				organizationId: props.organizationId,
				id: props.viewId,
				view: props.view,
				shared: props.isShared,
			})
			return { data: result.data, transactionId: result.transactionId }
		}),
})

/** A new personal (or, for admins, shared) view; answers its id. */
export const createViewAction = (props: ViewCreate) =>
	Effect.gen(function* () {
		const viewId = CustomerSavedViewId.make(crypto.randomUUID())
		const at = new Date(yield* Clock.currentTimeMillis)
		yield* createView({ ...props, viewId, at })
		return viewId
	})

/** Replaces the view's name, filters, sort and columns. */
export const updateViewAction = optimisticAction({
	collections: [customerSavedViewCollection],
	onMutate: (props: {
		readonly organizationId: OrganizationId
		readonly viewId: CustomerSavedViewId
		readonly view: Customers.ViewDraft
	}) => {
		customerSavedViewCollection.update(props.viewId, (view) => {
			Object.assign(view, { ...props.view, columns: [...props.view.columns] })
		})
		return { viewId: props.viewId }
	},
	mutate: (props) =>
		Effect.gen(function* () {
			const client = yield* HazelRpc
			const result = yield* client("customers.view.update", {
				organizationId: props.organizationId,
				viewId: props.viewId,
				view: props.view,
			})
			return { data: result.data, transactionId: result.transactionId }
		}),
})

export const deleteViewAction = optimisticAction({
	collections: [customerSavedViewCollection],
	onMutate: (props: { readonly organizationId: OrganizationId; readonly viewId: CustomerSavedViewId }) => {
		customerSavedViewCollection.delete(props.viewId)
		return { viewId: props.viewId }
	},
	mutate: (props) =>
		Effect.gen(function* () {
			const client = yield* HazelRpc
			const result = yield* client("customers.view.delete", {
				organizationId: props.organizationId,
				viewId: props.viewId,
			})
			return { data: result, transactionId: result.transactionId }
		}),
})

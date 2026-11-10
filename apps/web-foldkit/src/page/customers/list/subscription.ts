import { OrganizationId, UserId } from "@hazel/schema"
import { Effect, Queue, Schema, Stream } from "effect"
import { Subscription } from "foldkit"
import {
	accountsStream,
	connectedProvidersStream,
	orgMembersStream,
	settingsSummaryStream,
	signalsStream,
} from "../../../customers/queries"
import type { PageSubscriptionInput } from "../../contract"
import { viewRowsStream } from "./data"
import { Message } from "./message"
import type { ListKey, Model } from "./model"

/** The list's live rows, and its keyboard while nothing else holds it. */

type Input = PageSubscriptionInput<Model>

const KEYS = new Map<string, ListKey>([
	["j", "next"],
	["ArrowDown", "next"],
	["k", "previous"],
	["ArrowUp", "previous"],
	["Enter", "open"],
	["x", "select"],
	["/", "search"],
	["Escape", "escape"],
])

const elementOf = (target: EventTarget | null): HTMLElement | null =>
	typeof HTMLElement !== "undefined" && target instanceof HTMLElement ? target : null

/** The list key a keydown means; none while typing, with a modifier, or Enter on a button or link. */
export const listKeyOf = (event: {
	readonly key: string
	readonly target: EventTarget | null
	readonly altKey: boolean
	readonly ctrlKey: boolean
	readonly metaKey: boolean
}): ListKey | null => {
	const element = elementOf(event.target)
	if (event.altKey || event.ctrlKey || event.metaKey) return null
	if (
		element !== null &&
		(element.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(element.tagName))
	)
		return null
	const key = KEYS.get(event.key.length === 1 ? event.key.toLowerCase() : event.key)
	if (key === undefined) return null
	if (key === "open" && element?.closest("button, a, [role=menuitem]") != null) return null
	return key
}

const holdsKeyboard = (model: Model) =>
	model.saveModal.isOpen ||
	model.filterPopover.isOpen ||
	model.columnsPopover.isOpen ||
	model.tagPopover.isOpen ||
	[model.sortMenu, model.viewMenu, model.ownerMenu].some((menu) => menu.popup._tag === "Open")

const organization = { organizationId: Schema.NullOr(OrganizationId) }
const organizationOf = ({ shared }: Input) => ({ organizationId: shared.organization?.id ?? null })

export const subscriptions = Subscription.make<Input, Message>()((entry) => ({
	accounts: entry(organization, {
		modelToDependencies: organizationOf,
		dependenciesToStream: ({ organizationId }) =>
			organizationId === null
				? Stream.empty
				: accountsStream(organizationId, (accounts) => Message.UpdatedAccounts({ accounts })),
	}),
	signals: entry(organization, {
		modelToDependencies: organizationOf,
		dependenciesToStream: ({ organizationId }) =>
			organizationId === null
				? Stream.empty
				: signalsStream(organizationId, (signals) => Message.UpdatedSignals({ signals })),
	}),
	views: entry(
		{ organizationId: Schema.NullOr(OrganizationId), userId: Schema.NullOr(UserId) },
		{
			modelToDependencies: ({ shared }) => ({
				organizationId: shared.organization?.id ?? null,
				userId: shared.currentUser?.id ?? null,
			}),
			dependenciesToStream: ({ organizationId, userId }) =>
				organizationId === null || userId === null
					? Stream.empty
					: viewRowsStream(organizationId, userId, (views) => Message.UpdatedViews({ views })),
		},
	),
	members: entry(organization, {
		modelToDependencies: organizationOf,
		dependenciesToStream: ({ organizationId }) =>
			organizationId === null
				? Stream.empty
				: orgMembersStream(organizationId, (members) => Message.UpdatedMembers({ members })),
	}),
	connections: entry(organization, {
		modelToDependencies: organizationOf,
		dependenciesToStream: ({ organizationId }) =>
			organizationId === null
				? Stream.empty
				: connectedProvidersStream(organizationId, (providers) =>
						Message.UpdatedConnectedProviders({ providers }),
					),
	}),
	lastComputedAt: entry(organization, {
		modelToDependencies: organizationOf,
		dependenciesToStream: ({ organizationId }) =>
			organizationId === null
				? Stream.empty
				: settingsSummaryStream(organizationId, (settings) =>
						Message.UpdatedLastComputedAt({
							lastComputedAtMs: settings?.lastComputedAtMs ?? null,
						}),
					),
	}),
	keys: entry(
		{ isActive: Schema.Boolean },
		{
			modelToDependencies: ({ model, shared }) => ({
				isActive: !shared.isOverlayOpen && !holdsKeyboard(model),
			}),
			dependenciesToStream: ({ isActive }) =>
				isActive
					? Stream.callback<Message>((queue) =>
							Effect.acquireRelease(
								Effect.sync(() => {
									const onKeyDown = (event: KeyboardEvent) => {
										const key = listKeyOf(event)
										if (key === null) return
										event.preventDefault()
										Queue.offerUnsafe(queue, Message.PressedListKey({ key }))
									}
									document.addEventListener("keydown", onKeyDown)
									return onKeyDown
								}),
								(onKeyDown) =>
									Effect.sync(() => document.removeEventListener("keydown", onKeyDown)),
							).pipe(Effect.flatMap(() => Effect.never)),
						)
					: Stream.empty,
		},
	),
}))

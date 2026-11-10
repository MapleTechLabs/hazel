import type * as Customers from "@hazel/domain/customers"
import { OrganizationId } from "@hazel/schema"
import { eq } from "@tanstack/db"
import { Option, Schema, Stream } from "effect"
import { Subscription } from "foldkit"
import { customerSettingsCollection } from "~/db/collections"
import { accountsStream, withCustomersSource } from "../../../../customers/queries"
import { liveQueryStream } from "../../../../data/live-query"
import * as Slider from "../../../../ui/slider"
import type { PageSubscriptionInput } from "../../../contract"
import { Message } from "./message"
import { type Model, type SavedSettings, SliderId } from "./model"
import { SLIDER_MESSAGE } from "./update"

type Input = PageSubscriptionInput<Model>

/** The org's full health settings; null until the object has seeded its settings row. */
const settingsStream = <M>(
	organizationId: OrganizationId,
	toMessage: (settings: SavedSettings | null) => M,
): Stream.Stream<M> =>
	withCustomersSource(
		organizationId,
		liveQueryStream<Customers.Settings, M>(
			(q) =>
				q
					.from({ settings: customerSettingsCollection })
					.where(({ settings }) => eq(settings.organizationId, organizationId))
					.findOne(),
			(rows) => {
				const row = rows[0]
				return toMessage(
					row === undefined
						? null
						: { id: row.id, health: row.health, reportingCurrency: row.reportingCurrency },
				)
			},
		),
	)

const organization = { organizationId: Schema.NullOr(OrganizationId) }
const organizationOf = ({ shared }: Input) => ({ organizationId: shared.organization?.id ?? null })

const live = Subscription.make<Input, Message>()((entry) => ({
	settings: entry(organization, {
		modelToDependencies: organizationOf,
		dependenciesToStream: ({ organizationId }) =>
			organizationId === null
				? Stream.empty
				: settingsStream(organizationId, (settings) => Message.UpdatedSettings({ settings })),
	}),
	accounts: entry(organization, {
		modelToDependencies: organizationOf,
		dependenciesToStream: ({ organizationId }) =>
			organizationId === null
				? Stream.empty
				: accountsStream(organizationId, (accounts) => Message.UpdatedAccounts({ accounts })),
	}),
}))

/** Each Slider's drag, under its own keys (`usageDragPointer`, …). */
export const sliderSubscriptions = Subscription.aggregate<Input, Message>()(
	...SliderId.literals.map((id) => {
		const lifted = Subscription.lift(Slider.subscriptions)<Input, Message>({
			read: ({ model }) => Option.some(model.sliders[id]),
			toParentMessage: SLIDER_MESSAGE[id],
		})
		return { [`${id}DragPointer`]: lifted.dragPointer, [`${id}DragEscape`]: lifted.dragEscape }
	}),
)

export const subscriptions = Subscription.aggregate<Input, Message>()(live, sliderSubscriptions)

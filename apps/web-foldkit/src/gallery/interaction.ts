import { Option } from "effect"
import { Subscription, Update } from "foldkit"
import * as Interaction from "../ui/aria/interaction"

/** The interaction Submodel wiring every gallery entry repeats: fold, lifted subscriptions, view wiring. */
export const embedInteraction = <Model extends { readonly interaction: Interaction.Model }, Message>(
	toParentMessage: (message: Interaction.Message) => Message,
) => ({
	fold: Update.foldChild({
		update: Interaction.update,
		read: (model: Model) => Option.some(model.interaction),
		write: (model: Model, interaction: Interaction.Model): Model => ({ ...model, interaction }),
		toParentMessage,
	}),
	subscriptions: Subscription.lift(Interaction.subscriptions)<Model, Message>({
		read: (model) => Option.some(model.interaction),
		toParentMessage,
	}),
	wiring: (model: Model): Interaction.Wiring<Message> => ({ model: model.interaction, toParentMessage }),
})

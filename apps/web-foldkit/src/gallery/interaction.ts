import { Function } from "effect"
import * as Interaction from "../ui/aria/interaction"

/** The interaction Submodel wiring every gallery entry repeats: fold, lifted subscriptions, view wiring. */
export const embedInteraction = <Model extends { readonly interaction: Interaction.Model }, Message>(
	toParentMessage: (message: Interaction.Message) => Message,
) => Interaction.embed<Model, Message>(toParentMessage, Function.identity)

import { definePage } from "../contract"
import { Message } from "./message"
import { Model } from "./model"
import { subscriptions } from "./subscription"
import { init, sharedChanged, update } from "./update"
import { view } from "./view"

/** `/onboarding`: one instance per visit; `?step=` changes come from the page itself. */
export const page = definePage(
	"Onboarding",
	{ Model, Message },
	{ routes: ["Onboarding"], key: () => "Onboarding", init, update, view, subscriptions, sharedChanged },
)

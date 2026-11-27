import { definePage } from "../contract"
import { Message } from "./message"
import { Model } from "./model"
import { subscriptions } from "./subscription"
import { init, routeChanged, update } from "./update"
import { view } from "./view"

/**
 * `/onboarding`: the steps the native shell (`shared-screens/src/onboarding`) does not draw yet, shown
 * in its `legacyStep` slot. One instance per visit; `?step=` changes from the shell arrive as `routeChanged`.
 */
export const page = definePage(
	"Onboarding",
	{ Model, Message },
	{ routes: ["Onboarding"], key: () => "Onboarding", init, update, view, subscriptions, routeChanged },
)

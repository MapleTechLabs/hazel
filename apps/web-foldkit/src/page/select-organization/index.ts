import { definePage } from "../contract"
import { Message } from "./message"
import { Model } from "./model"
import { subscriptions } from "./subscription"
import { init, update } from "./update"
import { view } from "./view"

/** `/select-organization` */
export const page = definePage(
	"SelectOrganization",
	{ Model, Message },
	{ routes: ["SelectOrganization"], init, update, view, subscriptions },
)

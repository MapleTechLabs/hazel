import { definePage } from "../contract"
import { Message } from "./message"
import { Model } from "./model"
import { subscriptions } from "./subscription"
import { init, update } from "./update"
import { view } from "./view"

/** `/$orgSlug`: the org home member directory. */
export const page = definePage(
	"OrgHome",
	{ Model, Message },
	{ routes: ["OrgHome"], init, update, view, subscriptions },
)

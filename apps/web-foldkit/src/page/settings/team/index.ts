import { definePage } from "../../contract"
import { Message } from "./message"
import { Model } from "./model"
import { subscriptions } from "./subscription"
import { init, update } from "./update"
import { view } from "./view"

/** `/$orgSlug/settings/team` */
export const page = definePage(
	"TeamSettings",
	{ Model, Message },
	{ routes: ["TeamSettings"], init, update, view, subscriptions },
)

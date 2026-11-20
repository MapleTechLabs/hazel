import { definePage } from "../../contract"
import { Message } from "./message"
import { Model } from "./model"
import { init, sharedChanged, update } from "./update"
import { view } from "./view"

/** `/$orgSlug/customers/support`: response times, % within SLA and breaches (`docs/customers/sla.md`). */
export const page = definePage(
	"CustomersSupportReport",
	{ Model, Message },
	{ routes: ["CustomersSupportReport"], init, update, view, sharedChanged },
)

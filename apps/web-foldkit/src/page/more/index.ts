import { definePage } from "../contract"
import { Message } from "./message"
import { Model } from "./model"
import { init, update } from "./update"
import { view } from "./view"

/** `/$orgSlug/more`: a phone's More tab. */
export const page = definePage(
	"OrgMore",
	{ Model, Message },
	{
		routes: ["OrgMore"],
		init: () => init(),
		update: (model, message) => update(model, message),
		view,
	},
)

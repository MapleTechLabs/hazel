import { definePage } from "../../contract"
import { Message } from "./message"
import { Model } from "./model"
import { init, update } from "./update"
import { view } from "./view"

/** `/auth/register`: a verified provider identity with no Hazel account yet picks a name. */
export const page = definePage(
	"AuthRegister",
	{ Model, Message },
	{ routes: ["AuthRegister"], init, update, view },
)

import { definePage } from "../../contract"
import { Message } from "./message"
import { Model } from "./model"
import { init, update } from "./update"
import { view } from "./view"

/** `/sign-in` and `/sign-up`: GitHub, Google or a passkey. One instance across old Clerk sub-paths. */
export const page = definePage(
	"SignIn",
	{ Model, Message },
	{ routes: ["SignIn", "SignUp"], key: (route) => route._tag, init, update, view },
)

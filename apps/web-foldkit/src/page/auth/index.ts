import { Option, Schema } from "effect"
import { Submodel } from "foldkit"
import type { RouteOf } from "../../route"
import { definePage, type PageReturn, type PageViewInputs } from "../contract"
import { ClerkMountMessage, clerkComponent } from "./clerk-mount"

/** `sign-in/$.tsx` and `sign-up/$.tsx`: Clerk's prebuilt form (the root adds the centered layout). */

const Model = Schema.Struct({ redirectUrl: Schema.NullOr(Schema.String) })
type Model = typeof Model.Type
const Message = ClerkMountMessage
type Message = ClerkMountMessage

export const init = (route: RouteOf<"SignIn" | "SignUp">): PageReturn<Model, Message> => ({
	model: { redirectUrl: Option.getOrNull(route.redirectUrl) },
})

// Mount results need no state change: the form is Clerk's from here on.
export const update = (model: Model): PageReturn<Model, Message> => ({ model })

const toMessage = (message: ClerkMountMessage): Message => message

export const signInView = Submodel.defineView<Model, Message, PageViewInputs>((model, _inputs, h) => {
	const redirect = model.redirectUrl ?? "/"
	return clerkComponent(
		h,
		"SignIn",
		{
			routing: "path",
			path: "/sign-in",
			signUpUrl: "/sign-up",
			fallbackRedirectUrl: redirect,
			signUpFallbackRedirectUrl: redirect,
		},
		toMessage,
	)
})

export const signUpView = Submodel.defineView<Model, Message, PageViewInputs>((model, _inputs, h) => {
	const redirect = model.redirectUrl ?? "/"
	return clerkComponent(
		h,
		"SignUp",
		{
			routing: "path",
			path: "/sign-up",
			signInUrl: "/sign-in",
			fallbackRedirectUrl: redirect,
			signInFallbackRedirectUrl: redirect,
		},
		toMessage,
	)
})

// Clerk's own sub-routes (the splat) stay inside one form instance.
export const signInPage = definePage(
	"SignIn",
	{ Model, Message },
	{ routes: ["SignIn"], key: () => "SignIn", init, update, view: signInView },
)

export const signUpPage = definePage(
	"SignUp",
	{ Model, Message },
	{ routes: ["SignUp"], key: () => "SignUp", init, update, view: signUpView },
)

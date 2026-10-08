import { Schema } from "effect"
import { Submodel } from "foldkit"
import { ClerkMountMessage, clerkComponent } from "../../auth/clerk-mount"
import { definePage, type PageReturn, type PageViewInputs } from "../../contract"

/** `_app/onboarding/setup-organization.tsx`: Clerk's `<CreateOrganization>`, centered. */

const Model = Schema.Struct({})
type Model = typeof Model.Type
type Message = ClerkMountMessage

const toMessage = (message: ClerkMountMessage): Message => message

/** The `<CreateOrganization>` props legacy passes on both of its screens. */
export const createOrganizationProps = {
	routing: "hash",
	skipInvitationScreen: true,
	afterCreateOrganizationUrl: "/",
} as const

export const view = Submodel.defineView<Model, Message, PageViewInputs>((_model, _inputs, h) =>
	h.div(
		[h.Class("flex min-h-screen items-center justify-center bg-bg p-4")],
		[clerkComponent(h, "CreateOrganization", createOrganizationProps, toMessage)],
	),
)

export const page = definePage(
	"OnboardingSetupOrganization",
	{ Model, Message: ClerkMountMessage },
	{
		routes: ["OnboardingSetupOrganization"],
		init: (): PageReturn<Model, Message> => ({ model: {} }),
		update: (model): PageReturn<Model, Message> => ({ model }),
		view,
	},
)

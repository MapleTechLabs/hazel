import { Schema } from "effect"
import { Submodel } from "foldkit"
import { definePage, type PageReturn, type PageViewInputs } from "../../contract"
import * as CreateWorkspace from "../../create-workspace"

/** `_app/onboarding/setup-organization.tsx`: create a workspace, centered. */

const Model = Schema.Struct({ form: CreateWorkspace.Model })
type Model = typeof Model.Type
const Message = CreateWorkspace.Message
type Message = CreateWorkspace.Message

export const update = (model: Model, message: Message): PageReturn<Model, Message> => {
	const result = CreateWorkspace.update(model.form, message)
	return { ...result, model: { form: result.model } }
}

const toMessage = (message: Message): Message => message

export const view = Submodel.defineView<Model, Message, PageViewInputs>((model, _inputs, h) =>
	h.div(
		[h.Class("flex min-h-screen items-center justify-center bg-bg p-4")],
		[
			h.div(
				[h.Class("flex w-full max-w-sm flex-col gap-6")],
				[
					h.div(
						[h.Class("space-y-2 text-center")],
						[
							h.h1([h.Class("font-semibold text-2xl text-fg")], ["Create your workspace"]),
							h.p(
								[h.Class("text-muted-fg text-sm")],
								["A workspace is where your team's channels and conversations live."],
							),
						],
					),
					CreateWorkspace.view(h, model.form, toMessage),
				],
			),
		],
	),
)

export const page = definePage(
	"OnboardingSetupOrganization",
	{ Model, Message },
	{
		routes: ["OnboardingSetupOrganization"],
		init: (): PageReturn<Model, Message> => ({ model: { form: CreateWorkspace.init() } }),
		update,
		view,
	},
)

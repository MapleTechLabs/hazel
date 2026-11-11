import { Option } from "effect"
import { Command } from "foldkit"
import { modifyFields } from "foldkit/struct"
import { AppRoute, organizationRoute } from "../../route"
import type { PageReturn } from "../contract"
import * as CreateWorkspace from "../create-workspace"
import { PageOutMessage } from "../out-message"
import { Message } from "./message"
import { type Model, Organizations } from "./model"

type Return = PageReturn<Model, Message>

const navigate = (model: Model, route: AppRoute): Return => ({
	model,
	outMessage: PageOutMessage.RequestedNavigation({ route, replace: false }),
})

export const init = (): Return => ({
	model: { organizations: Organizations.Loading(), createWorkspace: CreateWorkspace.init() },
})

export const update = (model: Model, message: Message): Return =>
	Message.match<Return>(message, {
		UpdatedOrganizations: ({ organizations }) => {
			// The live query re-emits after the redirect; the page is already leaving.
			if (model.organizations._tag === "Redirected") return { model }
			const [single] = organizations
			// `<Navigate>` with a single organization: there is nothing to pick.
			return organizations.length === 1 && single
				? navigate(
						modifyFields(model, { organizations: () => Organizations.Redirected() }),
						organizationRoute(single),
					)
				: {
						model: modifyFields(model, {
							organizations: () => Organizations.Loaded({ organizations }),
						}),
					}
		},
		ClickedOrganization: ({ organization }) => navigate(model, organizationRoute(organization)),
		// Not `/onboarding`: it sends an onboarded user (anyone with organizations to pick) back to `/`.
		ClickedCreateNew: () =>
			navigate(model, AppRoute.OnboardingSetupOrganization({ orgId: Option.none() })),
		GotCreateWorkspaceMessage: ({ message: child }) => {
			const result = CreateWorkspace.update(model.createWorkspace, child)
			return {
				model: modifyFields(model, { createWorkspace: () => result.model }),
				commands: Command.mapMessages(result.commands, (message) =>
					Message.GotCreateWorkspaceMessage({ message }),
				),
			}
		},
	})

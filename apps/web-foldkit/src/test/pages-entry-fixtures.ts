import { OrganizationId, OrganizationMemberId } from "@hazel/schema"
import { Option, Schema } from "effect"
import type { Shared } from "../page/contract"
import { Message } from "../page/onboarding/message"
import type { Membership, Model, StepForm } from "../page/onboarding/model"
import { init, update } from "../page/onboarding/update"
import { currentUser, makeShared, uuid } from "./pages-fixtures"

/** Fixtures for the entry pages (onboarding, home, inbox, join, select-organization, profile, auth). */

/** A signed-in user who has not finished onboarding and belongs to no organization yet. */
export const newcomer: Shared = makeShared({
	orgSlug: null,
	organization: null,
	member: null,
	currentUser: { ...currentUser, firstName: "Nora", lastName: "Newcomer", isOnboarded: false, organizationId: null },
})

/** A membership with a slug: the user was invited into an existing organization. */
export const invitedMembership: Membership = {
	organizationId: Schema.decodeSync(OrganizationId)(uuid(20)),
	memberId: Schema.decodeSync(OrganizationMemberId)(uuid(21)),
	name: "Hazel Labs",
	slug: "hazel",
}

/** A creator's membership: the organization has no slug yet. */
export const creatorMembership: Membership = { ...invitedMembership, slug: null }

export const onboardingRoute = (urlStep: string | null) => ({
	_tag: "Onboarding" as const,
	orgId: Option.none(),
	step: Option.fromNullishOr(urlStep),
})

/** The onboarding page once the browser timezone and the membership are known. */
export const onboardingAt = (
	urlStep: string | null,
	membership: Membership | null = null,
	shared: Shared = newcomer,
): Model =>
	[
		Message.GotBrowserTimezone({ browserTimezone: "UTC" }),
		Message.UpdatedMembership({ membership }),
	].reduce((model, message) => update(model, message, shared).model, init(onboardingRoute(urlStep), shared).model)

/** Replaces the current step's form, for states a test reaches faster by construction. */
export const withForm = (model: Model, form: StepForm): Model => ({ ...model, form })

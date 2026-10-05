import { CreateOrganization, useOrganizationList } from "@clerk/react"
import { eq, useLiveQuery } from "@tanstack/react-db"
import { useEffect } from "react"
import { CardDescription, CardTitle } from "~/components/ui/card"
import { Loader } from "~/components/ui/loader"
import { organizationCollection, organizationMemberCollection } from "~/db/collections"
import { useAuth } from "~/lib/auth"
import { OnboardingNavigation } from "./onboarding-navigation"

interface OrgSetupStepProps {
	onBack: () => void
	/** Called with { organizationId } once our DB has picked up the Clerk org via webhook. */
	onContinue: (data: { name: string; slug: string; organizationId: string }) => void
}

/**
 * Onboarding step that delegates org creation to Clerk's <CreateOrganization/>.
 * Once Clerk fires the org.created webhook → our DB has the row → we advance.
 */
export function OrgSetupStep({ onBack, onContinue }: OrgSetupStepProps) {
	const { user } = useAuth()
	const { userMemberships } = useOrganizationList({ userMemberships: true })

	const clerkOrgSlug = userMemberships?.data?.[0]?.organization.slug
	const clerkOrgName = userMemberships?.data?.[0]?.organization.name

	// Watch our local DB for the org appearing (via Clerk webhook).
	const { data: localOrg } = useLiveQuery({
		query: (q) => {
			if (!user?.id || !clerkOrgSlug) return undefined
			return q
				.from({ member: organizationMemberCollection })
				.innerJoin({ org: organizationCollection }, ({ member, org }) =>
					eq(member.organizationId, org.id),
				)
				.where(({ member, org }) => eq(member.userId, user.id) && eq(org.slug, clerkOrgSlug))
				.findOne()
		},
		queryKey: [user?.id, clerkOrgSlug],
	})

	// Auto-advance once both Clerk says the org exists AND our DB has the row.
	useEffect(() => {
		if (clerkOrgSlug && clerkOrgName && localOrg?.org?.id) {
			onContinue({
				name: clerkOrgName,
				slug: clerkOrgSlug,
				organizationId: localOrg.org.id,
			})
		}
	}, [clerkOrgSlug, clerkOrgName, localOrg?.org?.id, onContinue])

	return (
		<div className="space-y-6">
			<div className="flex flex-col space-y-1.5 px-1">
				<CardTitle>Set up your workspace</CardTitle>
				<CardDescription>Name your organization and pick a workspace URL.</CardDescription>
			</div>

			{clerkOrgSlug && !localOrg ? (
				<div className="flex flex-col items-center justify-center gap-3 py-8">
					<Loader className="size-6" />
					<p className="text-muted-fg text-sm">Provisioning your workspace…</p>
				</div>
			) : (
				<CreateOrganization routing="hash" skipInvitationScreen />
			)}

			<OnboardingNavigation onBack={onBack} canContinue={false} />
		</div>
	)
}

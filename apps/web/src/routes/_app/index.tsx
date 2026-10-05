import { and, eq, useLiveQuery } from "@tanstack/react-db"
import { createFileRoute, Navigate } from "@tanstack/react-router"
import { Loader } from "~/components/loader"
import { organizationCollection, organizationMemberCollection } from "~/db/collections"
import { useAuth } from "~/lib/auth"

export const Route = createFileRoute("/_app/")({
	component: RouteComponent,
})

function RouteComponent() {
	const { user, isLoading: isAuthLoading } = useAuth()

	const {
		data: membership,
		isLoading,
		isReady,
	} = useLiveQuery({
		query: (q) => {
			return q
				.from({ member: organizationMemberCollection })
				.innerJoin({ org: organizationCollection }, ({ member, org }) =>
					eq(member.organizationId, org.id),
				)
				.where(({ member }) =>
					// If user has organizationId from JWT, filter by it
					// Otherwise, find any membership (for returning users without org context)
					user?.organizationId
						? and(eq(member.userId, user?.id), eq(member.organizationId, user?.organizationId))
						: eq(member.userId, user?.id),
				)
				.findOne()
		},
		queryKey: [user?.id, user?.organizationId],
	})

	if (isLoading || isAuthLoading || !isReady) {
		return <Loader />
	}

	if (!user) {
		throw new Error("Should never get here without user loaded")
	}

	if (!user.isOnboarded) {
		const orgId = membership?.org.id
		return <Navigate to="/onboarding" search={orgId ? { orgId } : undefined} />
	}

	if (membership) {
		const org = membership.org

		if (!org.slug) {
			return <Navigate to="/onboarding/setup-organization" search={{ orgId: org.id }} />
		}

		// User has a membership with a valid org - go directly to that org
		// This works for both:
		// - Users with JWT org context (membership filtered by that org)
		// - Users without JWT org context (membership is their first/any org)
		return <Navigate to="/$orgSlug" params={{ orgSlug: org.slug }} />
	}

	// User is onboarded but has no memberships found
	// Send to select-organization to handle the edge cases
	return <Navigate to="/select-organization" />
}

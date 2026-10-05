import { CreateOrganization } from "@clerk/react"
import type { OrganizationId } from "@hazel/schema"
import { eq, useLiveQuery } from "@tanstack/react-db"
import { createFileRoute, Navigate, useNavigate } from "@tanstack/react-router"
import { Loader } from "~/components/loader"
import { Avatar } from "~/components/ui/avatar"
import { Button } from "~/components/ui/button"
import { organizationCollection, organizationMemberCollection } from "~/db/collections"
import { restartWebLogin, useAuth } from "~/lib/auth"
import { getOrganizationRoute } from "~/utils/organization-navigation"

export const Route = createFileRoute("/_app/select-organization/")({
	component: RouteComponent,
})

function RouteComponent() {
	const navigate = useNavigate()

	const { user, isLoading: isAuthLoading } = useAuth()

	const {
		data: userOrganizations,
		isLoading,
		isReady,
	} = useLiveQuery({
		query: (q) =>
			user?.id
				? q
						.from({ member: organizationMemberCollection })
						.innerJoin({ org: organizationCollection }, ({ member, org }) =>
							eq(member.organizationId, org.id),
						)
						.where(({ member }) => eq(member.userId, user.id))
						.orderBy(({ member }) => member.joinedAt, "asc")
						.select(({ member, org }) => ({ member, org }))
				: undefined,
		queryKey: [user?.id],
	})

	if (isLoading || isAuthLoading || !isReady) {
		return <Loader />
	}

	if (!user) {
		// Kick off Clerk's hosted sign-in; `restartWebLogin` handles the return URL.
		restartWebLogin({ returnTo: "/select-organization" })
		return <Loader />
	}

	if (userOrganizations && userOrganizations.length === 1) {
		const singleOrg = userOrganizations[0]
		if (singleOrg) {
			const route = getOrganizationRoute(singleOrg.org)
			return <Navigate to={route.to} search={route.search} />
		}
	}

	// No organizations → let the user create one via Clerk's hosted component.
	// (Previously redirected to /onboarding, which looped when the user was
	// already onboarded: onboarding → / → select-organization → /onboarding → …)
	if (!userOrganizations || userOrganizations.length === 0) {
		return (
			<div className="flex min-h-screen items-center justify-center bg-bg p-4">
				<div className="flex w-full max-w-lg flex-col items-center gap-6">
					<div className="text-center">
						<h1 className="font-semibold text-2xl">Create your workspace</h1>
						<p className="mt-2 text-muted-fg text-sm">
							Get started by creating or joining an organization.
						</p>
					</div>
					<CreateOrganization routing="hash" skipInvitationScreen afterCreateOrganizationUrl="/" />
				</div>
			</div>
		)
	}

	const handleSelectOrganization = (org: { id: OrganizationId; slug: string | null }) => {
		const route = getOrganizationRoute(org)
		navigate({ to: route.to, search: route.search })
	}

	const getOrgInitials = (name: string) => {
		return name
			.split(" ")
			.map((word) => word.charAt(0).toUpperCase())
			.slice(0, 2)
			.join("")
	}

	return (
		<div className="flex min-h-screen items-center justify-center bg-bg px-4">
			<div className="w-full max-w-md">
				<div className="mb-8 text-center">
					<h1 className="mb-2 font-semibold text-2xl text-fg">Select an organization</h1>
					<p className="text-muted-fg text-sm">Choose which organization you'd like to access</p>
				</div>

				<div className="flex flex-col gap-3">
					{userOrganizations.map(({ org, member }) => (
						<button
							key={org.id}
							type="button"
							onClick={() => handleSelectOrganization(org)}
							className="flex w-full items-center gap-4 rounded-xl border border-border bg-bg p-4 text-left transition-all hover:border-primary hover:bg-secondary/50 focus:outline-none focus:ring-2 focus:ring-primary focus:ring-offset-2"
						>
							<Avatar
								src={org.logoUrl}
								initials={getOrgInitials(org.name)}
								className="size-12"
							/>
							<div className="flex flex-1 flex-col">
								<span className="font-medium text-fg text-sm">{org.name}</span>
								{org.slug && <span className="text-muted-fg text-xs">@{org.slug}</span>}
							</div>
							<div className="flex items-center gap-2">
								<span className="rounded-full bg-primary/10 px-2.5 py-0.5 font-medium text-primary text-xs">
									{member.role.charAt(0).toUpperCase() + member.role.slice(1)}
								</span>
								<svg
									className="size-5 text-muted-fg"
									fill="none"
									strokeWidth="2"
									stroke="currentColor"
									viewBox="0 0 24 24"
								>
									<path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
								</svg>
							</div>
						</button>
					))}
				</div>

				<div className="mt-6 text-center">
					<p className="text-muted-fg text-xs">
						Don't see your organization?{" "}
						<Button
							intent="plain"
							size="sm"
							onPress={() =>
								navigate({
									to: "/onboarding",
								})
							}
							className="text-xs"
						>
							Create a new one
						</Button>
					</p>
				</div>
			</div>
		</div>
	)
}

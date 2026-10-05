import { eq, useLiveQuery } from "@tanstack/react-db"
import { createFileRoute, Navigate } from "@tanstack/react-router"
import { type } from "arktype"
import { AnimatePresence, motion } from "motion/react"
import { useCallback, useEffect } from "react"
import type { OnboardingStep } from "~/atoms/onboarding-atoms"
import { InviteTeamStep } from "~/components/onboarding/invite-team-step"
import { OnboardingLayout } from "~/components/onboarding/onboarding-layout"
import { ProfileInfoStep } from "~/components/onboarding/profile-info-step"
import { RoleStep } from "~/components/onboarding/role-step"
import { ThemeSelectionStep } from "~/components/onboarding/theme-selection-step"
import { TimezoneSelectionStep } from "~/components/onboarding/timezone-selection-step"
import { UseCaseStep } from "~/components/onboarding/use-case-step"
import { WelcomeStep } from "~/components/onboarding/welcome-step"
import { Loader } from "~/components/ui/loader"
import { organizationCollection, organizationMemberCollection } from "~/db/collections"
import { useOnboarding } from "~/hooks/use-onboarding"
import { useAuth } from "~/lib/auth"

const searchSchema = type({
	"step?": "string",
	"orgId?": "string",
})

export const Route = createFileRoute("/_app/onboarding/")({
	component: RouteComponent,
	validateSearch: searchSchema,
})

function RouteComponent() {
	const { user } = useAuth()
	const navigate = Route.useNavigate()
	const { step: urlStep } = Route.useSearch()

	// Reverse guard: if the user somehow lands here after finishing, just bounce
	// to the app root. Prevents a "completed → onboarding → /" loop when the
	// post-finalize redirect lands here before the app root settles.
	if (user?.isOnboarded) {
		return <Navigate to="/" />
	}

	// Fetch user's organizations to determine if they're creating or joining
	const { data: userOrganizations } = useLiveQuery({
		query: (q) =>
			user?.id
				? q
						.from({ member: organizationMemberCollection })
						.innerJoin({ org: organizationCollection }, ({ member, org }) =>
							eq(member.organizationId, org.id),
						)
						.where(({ member }) => eq(member.userId, user.id))
						.orderBy(({ member }) => member.createdAt, "asc")
						.findOne()
				: undefined,
		queryKey: [user?.id],
	})

	const orgId = userOrganizations?.org.id
	const organization = userOrganizations?.org
	const organizationMemberId = userOrganizations?.member.id

	// Update URL when step changes (preserve orgId if present)
	const handleStepChange = useCallback(
		(step: OnboardingStep) => {
			navigate({ search: (prev) => ({ ...prev, step }), replace: true })
		},
		[navigate],
	)

	const onboarding = useOnboarding({
		orgId,
		organization: organization
			? {
					id: organization.id,
					name: organization.name,
					slug: organization.slug || undefined,
				}
			: undefined,
		organizationMemberId,
		initialStep: urlStep,
		onStepChange: handleStepChange,
	})

	// Auto-redirect when onboarding is completed. We force a full page reload
	// so the cached user.me query doesn't come back stale (with isOnboarded=false)
	// — which would bounce the user right back here via /_app/index.tsx's
	// isOnboarded guard.
	useEffect(() => {
		if (onboarding.currentStep === "completed") {
			const slug = onboarding.data.orgSlug || organization?.slug
			window.location.assign(slug ? `/${slug}` : "/")
		}
	}, [onboarding.currentStep, onboarding.data.orgSlug, organization?.slug])

	// Animation variants based on direction with blur effect
	const variants = {
		enter: (direction: "forward" | "backward") => ({
			x: direction === "forward" ? 20 : -20,
			opacity: 0,
			filter: "blur(4px)",
		}),
		center: {
			x: 0,
			opacity: 1,
			filter: "blur(0px)",
		},
		exit: (direction: "forward" | "backward") => ({
			x: direction === "forward" ? -20 : 20,
			opacity: 0,
			filter: "blur(4px)",
		}),
	}

	return (
		<OnboardingLayout
			currentStep={onboarding.currentStepNumber}
			totalSteps={onboarding.totalSteps}
			direction={onboarding.direction}
		>
			<AnimatePresence mode="wait" initial={false} custom={onboarding.direction}>
				{onboarding.currentStep === "welcome" && (
					<motion.div
						key="welcome"
						custom={onboarding.direction}
						variants={variants}
						initial="enter"
						animate="center"
						exit="exit"
						transition={{ duration: 0.3, ease: "easeInOut" }}
					>
						<WelcomeStep
							onContinue={onboarding.handleWelcomeContinue}
							isCreatingOrg={onboarding.isCreator}
							organizationName={onboarding.initialOrganization?.name}
						/>
					</motion.div>
				)}

				{onboarding.currentStep === "profileInfo" && (
					<motion.div
						key="profileInfo"
						custom={onboarding.direction}
						variants={variants}
						initial="enter"
						animate="center"
						exit="exit"
						transition={{ duration: 0.3, ease: "easeInOut" }}
					>
						<ProfileInfoStep
							onBack={onboarding.goBack}
							onContinue={onboarding.handleProfileInfoContinue}
							defaultFirstName={user?.firstName || ""}
							defaultLastName={user?.lastName || ""}
						/>
					</motion.div>
				)}

				{onboarding.currentStep === "timezoneSelection" && (
					<motion.div
						key="timezoneSelection"
						custom={onboarding.direction}
						variants={variants}
						initial="enter"
						animate="center"
						exit="exit"
						transition={{ duration: 0.3, ease: "easeInOut" }}
					>
						<TimezoneSelectionStep
							onBack={onboarding.goBack}
							onContinue={onboarding.handleTimezoneContinue}
							defaultTimezone={onboarding.data.timezone}
						/>
					</motion.div>
				)}

				{onboarding.currentStep === "themeSelection" && (
					<motion.div
						key="themeSelection"
						custom={onboarding.direction}
						variants={variants}
						initial="enter"
						animate="center"
						exit="exit"
						transition={{ duration: 0.3, ease: "easeInOut" }}
					>
						<ThemeSelectionStep
							onBack={onboarding.goBack}
							onContinue={onboarding.handleThemeContinue}
						/>
					</motion.div>
				)}

				{onboarding.currentStep === "useCases" && (
					<motion.div
						key="useCases"
						custom={onboarding.direction}
						variants={variants}
						initial="enter"
						animate="center"
						exit="exit"
						transition={{ duration: 0.3, ease: "easeInOut" }}
					>
						<UseCaseStep
							onBack={onboarding.goBack}
							onContinue={onboarding.handleUseCasesContinue}
							defaultSelection={onboarding.data.useCases}
						/>
					</motion.div>
				)}

				{onboarding.currentStep === "role" && (
					<motion.div
						key="role"
						custom={onboarding.direction}
						variants={variants}
						initial="enter"
						animate="center"
						exit="exit"
						transition={{ duration: 0.3, ease: "easeInOut" }}
					>
						<RoleStep
							onBack={onboarding.goBack}
							onContinue={onboarding.handleRoleContinue}
							defaultSelection={onboarding.data.role}
						/>
					</motion.div>
				)}

				{onboarding.currentStep === "teamInvitation" && (
					<motion.div
						key="teamInvitation"
						custom={onboarding.direction}
						variants={variants}
						initial="enter"
						animate="center"
						exit="exit"
						transition={{ duration: 0.3, ease: "easeInOut" }}
					>
						<InviteTeamStep
							onBack={onboarding.goBack}
							onContinue={onboarding.handleTeamInviteContinue}
							onSkip={onboarding.handleTeamInviteSkip}
							organizationId={onboarding.data.createdOrgId || orgId}
						/>
					</motion.div>
				)}

				{onboarding.currentStep === "finalization" && (
					<motion.div
						key="processing"
						custom={onboarding.direction}
						variants={variants}
						initial="enter"
						animate="center"
						exit="exit"
						transition={{ duration: 0.3, ease: "easeInOut" }}
					>
						<div className="flex flex-col items-center justify-center space-y-4 py-12 text-center">
							<Loader className="size-12" />
							<p className="font-medium text-lg">Setting up your workspace...</p>
							<p className="text-muted-fg text-sm">This will just take a moment</p>
							{onboarding.error && <p className="text-danger text-sm">{onboarding.error}</p>}
						</div>
					</motion.div>
				)}
			</AnimatePresence>
		</OnboardingLayout>
	)
}

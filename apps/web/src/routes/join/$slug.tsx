import { AsyncResult } from "effect/reactivity"
import { useAtomSet, useAtomValue } from "@effect/atom-react"
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router"
import { Match } from "effect"
import { motion } from "motion/react"
import { useState } from "react"
import { toast } from "sonner"
import { getOrgBySlugPublicQuery, joinViaPublicInviteMutation } from "~/atoms/organization-atoms"
import { Logo } from "~/components/logo"
import { Avatar } from "~/components/ui/avatar"
import { Button } from "~/components/ui/button"
import { Loader } from "~/components/ui/loader"
import { useAuth } from "~/lib/auth"
import { exitToastAsync } from "~/lib/toast-exit"
import { getOnboardingImage } from "~/lib/helper/get-onboarding-image"

export const Route = createFileRoute("/join/$slug")({
	component: JoinPage,
})

const cardVariants = {
	hidden: { opacity: 0, y: 20, filter: "blur(8px)" },
	visible: {
		opacity: 1,
		y: 0,
		filter: "blur(0px)",
		transition: { duration: 0.4, ease: "easeOut" as const },
	},
}

function JoinPage() {
	const { slug } = Route.useParams()
	const navigate = useNavigate()
	const { user, login, isLoading: authLoading } = useAuth()
	const [isJoining, setIsJoining] = useState(false)

	const orgResult = useAtomValue(getOrgBySlugPublicQuery(slug))
	const joinOrg = useAtomSet(joinViaPublicInviteMutation, { mode: "promiseExit" })

	const isLoading = orgResult._tag === "Initial" || orgResult.waiting

	const handleSignIn = () => {
		login({
			returnTo: `/join/${slug}`,
		})
	}

	const handleJoin = async () => {
		setIsJoining(true)
		try {
			const result = await exitToastAsync(
				joinOrg({
					payload: { slug },
				}),
			)
				.loading("Joining workspace...")
				.successMessage("Successfully joined workspace!")
				.onErrorTag("OrganizationNotFoundError", () => ({
					title: "Organization not found",
					description: "This organization may have been deleted.",
					isRetryable: false,
				}))
				.onErrorTag("PublicInviteDisabledError", () => ({
					title: "Public invites disabled",
					description: "This organization has disabled public invites.",
					isRetryable: false,
				}))
				.onErrorTag("AlreadyMemberError", () => ({
					title: "Already a member",
					description: "You're already a member of this workspace.",
					isRetryable: false,
				}))
				.run()

			if (result._tag === "Success") {
				navigate({
					to: "/$orgSlug",
					params: { orgSlug: slug },
				})
			}
			setIsJoining(false)
		} catch (error: any) {
			if (error?._tag === "AlreadyMemberError") {
				toast.info("You're already a member of this workspace")
				navigate({
					to: "/$orgSlug",
					params: { orgSlug: slug },
				})
			}
			setIsJoining(false)
		}
	}

	const getInitials = (name: string) => {
		const words = name.split(" ")
		if (words.length >= 2) {
			return `${words[0]?.charAt(0)}${words[1]?.charAt(0)}`.toUpperCase()
		}
		return name.substring(0, 2).toUpperCase()
	}

	// Loading state
	if (isLoading || authLoading) {
		return (
			<main className="grid h-dvh grid-cols-1 lg:grid-cols-2">
				{/* Left panel - hidden on mobile */}
				<div className="relative hidden h-full flex-col p-10 text-white lg:flex">
					<img
						src={getOnboardingImage()}
						alt="Background"
						className="absolute inset-0 size-full object-cover object-top-left"
						style={{ imageRendering: "pixelated" }}
					/>
					<Link to="/" className="relative z-20 flex items-center gap-2">
						<Logo className="size-8 text-white" />
						<strong className="font-semibold">Hazel</strong>
					</Link>
				</div>

				{/* Right panel - loading */}
				<div className="flex h-full flex-col items-center justify-center p-6 lg:p-12">
					<div className="flex flex-col items-center gap-4">
						<Loader className="size-8" />
						<p className="text-muted-fg">Loading workspace...</p>
					</div>
				</div>
			</main>
		)
	}

	const org = AsyncResult.getOrElse(orgResult, () => null)

	// Organization not found or not public
	if (!org) {
		return (
			<main className="grid h-dvh grid-cols-1 lg:grid-cols-2">
				{/* Left panel - hidden on mobile */}
				<div className="relative hidden h-full flex-col p-10 text-white lg:flex">
					<img
						src={getOnboardingImage()}
						alt="Background"
						className="absolute inset-0 size-full object-cover object-top-left"
						style={{ imageRendering: "pixelated" }}
					/>
					<Link to="/" className="relative z-20 flex items-center gap-2">
						<Logo className="size-8 text-white" />
						<strong className="font-semibold">Hazel</strong>
					</Link>
				</div>

				{/* Right panel - error */}
				<div className="flex h-full flex-col p-6 lg:p-12">
					{/* Mobile logo */}
					<div className="mb-8 lg:hidden">
						<Link to="/" className="flex items-center gap-2">
							<Logo className="size-8" />
							<strong className="font-semibold text-fg">Hazel</strong>
						</Link>
					</div>

					<motion.div
						variants={cardVariants}
						initial="hidden"
						animate="visible"
						className="m-auto flex w-full max-w-sm flex-col items-center text-center"
					>
						<div className="mb-6 flex size-20 items-center justify-center rounded-2xl bg-danger/10">
							<svg
								className="size-10 text-danger"
								fill="none"
								viewBox="0 0 24 24"
								stroke="currentColor"
							>
								<path
									strokeLinecap="round"
									strokeLinejoin="round"
									strokeWidth={1.5}
									d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"
								/>
							</svg>
						</div>

						<h1 className="mb-2 font-semibold text-2xl text-fg">Workspace Not Found</h1>
						<p className="mb-8 text-muted-fg">
							This invite link is invalid or the workspace doesn't have public invites enabled.
						</p>

						<Link to="/">
							<Button intent="secondary">Go to Home</Button>
						</Link>
					</motion.div>
				</div>
			</main>
		)
	}

	return (
		<main className="grid h-dvh grid-cols-1 lg:grid-cols-2">
			{/* Left panel - visual (desktop only) */}
			<div className="relative hidden h-full flex-col p-10 text-white lg:flex">
				<img
					src={getOnboardingImage()}
					alt="Background"
					className="absolute inset-0 size-full object-cover object-top-left"
					style={{ imageRendering: "pixelated" }}
				/>

				<Link to="/" className="relative z-20 flex items-center gap-2">
					<Logo className="size-8 text-white" />
					<strong className="font-semibold">Hazel</strong>
				</Link>

				<div className="relative z-20 mt-auto rounded-xl bg-black/60 p-6 ring ring-white/10 backdrop-blur-sm">
					<p className="text-lg text-white">
						You've been invited to join a workspace. Accept the invitation to start collaborating
						with your team.
					</p>
				</div>
			</div>

			{/* Right panel - join content */}
			<div className="flex h-full flex-col p-6 lg:p-12">
				{/* Mobile logo */}
				<div className="mb-8 lg:hidden">
					<Link to="/" className="flex items-center gap-2">
						<Logo className="size-8" />
						<strong className="font-semibold text-fg">Hazel</strong>
					</Link>
				</div>

				<motion.div
					variants={cardVariants}
					initial="hidden"
					animate="visible"
					className="m-auto flex w-full max-w-sm flex-col items-center text-center"
				>
					{/* Organization Avatar */}
					<Avatar
						src={org.logoUrl}
						initials={getInitials(org.name)}
						size="4xl"
						className="mb-6 shadow-lg"
					/>

					{/* Organization Name */}
					<h1 className="mb-2 font-semibold text-3xl text-fg">{org.name}</h1>

					{/* Member Count */}
					<p className="mb-8 text-muted-fg">
						{org.memberCount} {org.memberCount === 1 ? "member" : "members"}
					</p>

					{/* Action Area */}
					{!user ? (
						<div className="w-full space-y-3">
							<Button intent="primary" className="w-full" onPress={handleSignIn}>
								Sign in to Join
							</Button>
							<p className="text-muted-fg text-sm">
								Already have an account?{" "}
								<Link to="/" className="text-fg underline underline-offset-2">
									Go home
								</Link>
							</p>
						</div>
					) : (
						<div className="w-full space-y-3">
							<Button
								intent="primary"
								className="w-full"
								onPress={handleJoin}
								isDisabled={isJoining}
							>
								{isJoining ? (
									<>
										<Loader className="size-4" />
										Joining...
									</>
								) : (
									"Join Workspace"
								)}
							</Button>
							<p className="text-muted-fg text-sm">
								Wrong workspace?{" "}
								<Link to="/" className="text-fg underline underline-offset-2">
									Go home
								</Link>
							</p>
						</div>
					)}
				</motion.div>
			</div>
		</main>
	)
}

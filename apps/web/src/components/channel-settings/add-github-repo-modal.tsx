import { AsyncResult } from "effect/reactivity"
import { useAtomSet, useAtomValue } from "@effect/atom-react"
import type { OrganizationId } from "@hazel/schema"
import type { GitHubSubscription } from "@hazel/domain/models"
import type { ChannelId } from "@hazel/schema"
import { useState } from "react"
import { createGitHubSubscriptionMutation } from "~/atoms/github-subscription-atoms"
import { Button } from "~/components/ui/button"
import { Checkbox } from "~/components/ui/checkbox"
import { Input, InputGroup } from "~/components/ui/input"
import {
	Modal,
	ModalBody,
	ModalClose,
	ModalContent,
	ModalFooter,
	ModalHeader,
	ModalTitle,
} from "~/components/ui/modal"
import { HazelApiClient } from "~/lib/services/common/atom-client"
import { exitToast } from "~/lib/toast-exit"

type GitHubEventType = typeof GitHubSubscription.GitHubEventType.Type

const EVENT_OPTIONS: { id: GitHubEventType; label: string; description: string }[] = [
	{ id: "push", label: "Push", description: "Commits pushed to branches" },
	{ id: "pull_request", label: "Pull Requests", description: "PR opened, closed, or merged" },
	{ id: "issues", label: "Issues", description: "Issue opened, closed, or commented" },
	{ id: "release", label: "Releases", description: "New releases published" },
	{ id: "deployment_status", label: "Deployments", description: "Deployment status changes" },
	{ id: "workflow_run", label: "Workflows", description: "GitHub Actions workflow runs" },
	{ id: "star", label: "Stars", description: "Repository starred or unstarred" },
]

interface AddGitHubRepoModalProps {
	channelId: ChannelId
	organizationId: OrganizationId
	isOpen: boolean
	onClose: () => void
	onSuccess: () => void
}

export function AddGitHubRepoModal({
	channelId,
	organizationId,
	isOpen,
	onClose,
	onSuccess,
}: AddGitHubRepoModalProps) {
	const [selectedRepo, setSelectedRepo] = useState<{
		id: number
		fullName: string
		owner: string
		name: string
	} | null>(null)
	const [enabledEvents, setEnabledEvents] = useState<GitHubEventType[]>(["push", "pull_request", "issues"])
	const [branchFilter, setBranchFilter] = useState("")
	const [isCreating, setIsCreating] = useState(false)
	const [searchQuery, setSearchQuery] = useState("")

	// Fetch repositories
	const repositoriesResult = useAtomValue(
		HazelApiClient.query("integration-resources", "getGitHubRepositories", {
			params: { orgId: organizationId },
			query: { page: 1, perPage: 100 },
		}),
	)

	const createSubscription = useAtomSet(createGitHubSubscriptionMutation, { mode: "promiseExit" })

	const handleToggleEvent = (eventId: GitHubEventType) => {
		setEnabledEvents((prev) =>
			prev.includes(eventId) ? prev.filter((e) => e !== eventId) : [...prev, eventId],
		)
	}

	const handleSubmit = async () => {
		if (!selectedRepo || enabledEvents.length === 0) return

		setIsCreating(true)
		const exit = await createSubscription({
			payload: {
				channelId,
				repositoryId: selectedRepo.id,
				repositoryFullName: selectedRepo.fullName,
				repositoryOwner: selectedRepo.owner,
				repositoryName: selectedRepo.name,
				enabledEvents: [...enabledEvents],
				branchFilter: branchFilter.trim() || null,
			},
		})

		exitToast(exit)
			.onSuccess(() => {
				onSuccess()
				handleClose()
			})
			.successMessage(`Subscribed to ${selectedRepo.fullName}`)
			.onErrorTag("GitHubSubscriptionExistsError", () => ({
				title: "Already subscribed",
				description: "This channel is already subscribed to this repository.",
				isRetryable: false,
			}))
			.onErrorTag("GitHubNotConnectedError", () => ({
				title: "GitHub not connected",
				description: "Connect GitHub in organization settings first.",
				isRetryable: false,
			}))
			.onErrorTag("ChannelNotFoundError", () => ({
				title: "Channel not found",
				description: "This channel may have been deleted.",
				isRetryable: false,
			}))
			.run()
		setIsCreating(false)
	}

	const handleClose = () => {
		setSelectedRepo(null)
		setEnabledEvents(["push", "pull_request", "issues"])
		setBranchFilter("")
		setSearchQuery("")
		onClose()
	}

	// Get repositories from result
	const repositories = AsyncResult.builder(repositoriesResult)
		.onSuccess((data) => data?.repositories ?? [])
		.orElse(() => [])

	// Filter repositories by search query
	const filteredRepos = searchQuery
		? repositories.filter((repo) => repo.fullName.toLowerCase().includes(searchQuery.toLowerCase()))
		: repositories

	return (
		<Modal isOpen={isOpen} onOpenChange={(open) => !open && handleClose()}>
			<ModalContent size="lg">
				<ModalHeader>
					<ModalTitle>Add GitHub Repository</ModalTitle>
				</ModalHeader>

				<ModalBody>
					<div className="flex flex-col gap-4">
						{/* Repository selector */}
						<div className="flex flex-col gap-2">
							<label className="font-medium text-fg text-sm">Repository</label>
							{AsyncResult.builder(repositoriesResult)
								.onInitial(() => (
									<div className="flex h-32 items-center justify-center rounded-lg border border-border">
										<div className="flex items-center gap-2 text-muted-fg">
											<div className="size-4 animate-spin rounded-full border-2 border-muted-fg/30 border-t-primary" />
											<span className="text-sm">Loading repositories...</span>
										</div>
									</div>
								))
								.onFailure(() => (
									<div className="flex h-32 items-center justify-center rounded-lg border border-border border-dashed">
										<p className="text-muted-fg text-sm">Failed to load repositories</p>
									</div>
								))
								.onSuccess(() =>
									selectedRepo ? (
										<div className="flex items-center justify-between rounded-lg border border-accent bg-accent/5 p-3">
											<div className="flex items-center gap-3">
												<div className="flex size-8 items-center justify-center rounded bg-accent/10">
													<svg
														className="size-4 text-accent-fg"
														fill="currentColor"
														viewBox="0 0 16 16"
													>
														<path d="M2 2.5A2.5 2.5 0 0 1 4.5 0h8.75a.75.75 0 0 1 .75.75v12.5a.75.75 0 0 1-.75.75h-2.5a.75.75 0 0 1 0-1.5h1.75v-2h-8a1 1 0 0 0-.714 1.7.75.75 0 1 1-1.072 1.05A2.495 2.495 0 0 1 2 11.5Zm10.5-1h-8a1 1 0 0 0-1 1v6.708A2.486 2.486 0 0 1 4.5 9h8ZM5 12.25v3.25a.25.25 0 0 0 .4.2l1.45-1.087a.25.25 0 0 1 .3 0L8.6 15.7a.25.25 0 0 0 .4-.2v-3.25a.25.25 0 0 0-.25-.25h-3.5a.25.25 0 0 0-.25.25Z" />
													</svg>
												</div>
												<span className="font-medium text-fg text-sm">
													{selectedRepo.fullName}
												</span>
											</div>
											<Button
												intent="plain"
												size="sm"
												onPress={() => setSelectedRepo(null)}
											>
												Change
											</Button>
										</div>
									) : (
										<div className="flex flex-col gap-2">
											<InputGroup>
												<Input
													placeholder="Search repositories..."
													value={searchQuery}
													onChange={(e) => setSearchQuery(e.target.value)}
												/>
											</InputGroup>
											<div className="max-h-48 overflow-y-auto rounded-lg border border-border">
												{filteredRepos.length === 0 ? (
													<div className="flex items-center justify-center py-6 text-muted-fg text-sm">
														{searchQuery
															? "No repositories found"
															: "No repositories available"}
													</div>
												) : (
													<div className="divide-y divide-border">
														{filteredRepos.map((repo) => (
															<button
																key={repo.id}
																type="button"
																onClick={() =>
																	setSelectedRepo({
																		id: repo.id,
																		fullName: repo.fullName,
																		owner: repo.owner.login,
																		name: repo.name,
																	})
																}
																className="group flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left transition-colors hover:bg-accent hover:text-accent-fg focus:bg-accent focus:text-accent-fg focus:outline-none"
															>
																<div className="flex size-6 shrink-0 items-center justify-center rounded bg-bg-muted group-hover:bg-accent-fg/10 group-focus:bg-accent-fg/10">
																	<svg
																		className="size-3.5 text-muted-fg group-hover:text-accent-fg group-focus:text-accent-fg"
																		fill="currentColor"
																		viewBox="0 0 16 16"
																	>
																		<path d="M2 2.5A2.5 2.5 0 0 1 4.5 0h8.75a.75.75 0 0 1 .75.75v12.5a.75.75 0 0 1-.75.75h-2.5a.75.75 0 0 1 0-1.5h1.75v-2h-8a1 1 0 0 0-.714 1.7.75.75 0 1 1-1.072 1.05A2.495 2.495 0 0 1 2 11.5Zm10.5-1h-8a1 1 0 0 0-1 1v6.708A2.486 2.486 0 0 1 4.5 9h8ZM5 12.25v3.25a.25.25 0 0 0 .4.2l1.45-1.087a.25.25 0 0 1 .3 0L8.6 15.7a.25.25 0 0 0 .4-.2v-3.25a.25.25 0 0 0-.25-.25h-3.5a.25.25 0 0 0-.25.25Z" />
																	</svg>
																</div>
																<span className="truncate font-medium text-sm">
																	{repo.fullName}
																</span>
																{repo.private && (
																	<span className="shrink-0 rounded-full bg-warning-subtle px-1.5 py-0.5 text-warning-subtle-fg text-xs group-hover:bg-accent-fg/10 group-hover:text-accent-fg">
																		Private
																	</span>
																)}
															</button>
														))}
													</div>
												)}
											</div>
										</div>
									),
								)
								.render()}
						</div>

						{/* Event types */}
						{selectedRepo && (
							<>
								<div className="flex flex-col gap-2">
									<label className="font-medium text-fg text-sm">Event Types</label>
									<p className="text-muted-fg text-xs">
										Select which events to receive notifications for.
									</p>
									<div className="grid grid-cols-2 gap-2">
										{EVENT_OPTIONS.map((event) => {
											const isSelected = enabledEvents.includes(event.id)
											return (
												<label
													key={event.id}
													className={`flex cursor-pointer items-start gap-3 rounded-lg border p-3 transition-all ${
														isSelected
															? "border-accent bg-accent/5"
															: "border-border hover:border-border-hover hover:bg-bg-muted"
													}`}
												>
													<Checkbox
														isSelected={isSelected}
														onChange={() => handleToggleEvent(event.id)}
														className="mt-0.5"
													/>
													<div className="flex flex-col gap-0.5">
														<span className="font-medium text-fg text-sm">
															{event.label}
														</span>
														<span className="text-muted-fg text-xs">
															{event.description}
														</span>
													</div>
												</label>
											)
										})}
									</div>
								</div>

								{/* Branch filter (only for push events) */}
								{enabledEvents.includes("push") && (
									<div className="flex flex-col gap-2">
										<label className="font-medium text-fg text-sm">
											Branch Filter (Optional)
										</label>
										<p className="text-muted-fg text-xs">
											Only receive push events for branches matching this pattern.
										</p>
										<InputGroup>
											<Input
												placeholder="e.g., main, release/*, feature/*"
												value={branchFilter}
												onChange={(e) => setBranchFilter(e.target.value)}
											/>
										</InputGroup>
									</div>
								)}
							</>
						)}
					</div>
				</ModalBody>

				<ModalFooter>
					<ModalClose intent="secondary">Cancel</ModalClose>
					<Button
						intent="primary"
						onPress={handleSubmit}
						isDisabled={!selectedRepo || enabledEvents.length === 0 || isCreating}
					>
						{isCreating ? "Adding..." : "Add Repository"}
					</Button>
				</ModalFooter>
			</ModalContent>
		</Modal>
	)
}

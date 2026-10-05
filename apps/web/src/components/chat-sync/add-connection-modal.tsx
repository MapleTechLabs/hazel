import { AsyncResult } from "effect/reactivity"
import { useAtomSet, useAtomValue } from "@effect/atom-react"
import type { OrganizationId } from "@hazel/schema"
import { useNavigate } from "@tanstack/react-router"
import { useMemo, useState } from "react"
import { Button } from "~/components/ui/button"
import { Description, Label } from "~/components/ui/field"
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
import { HazelRpcClient } from "~/lib/services/common/rpc-atom-client"
import { exitToast } from "~/lib/toast-exit"

interface DiscordGuild {
	id: string
	name: string
	icon: string | null
	owner: boolean
}

interface AddConnectionModalProps {
	organizationId: OrganizationId
	orgSlug: string
	isOpen: boolean
	onClose: () => void
	onSuccess: () => void
}

export function AddConnectionModal({
	organizationId,
	orgSlug,
	isOpen,
	onClose,
	onSuccess,
}: AddConnectionModalProps) {
	const navigate = useNavigate()
	const [selectedGuild, setSelectedGuild] = useState<DiscordGuild | null>(null)
	const [guildSearch, setGuildSearch] = useState("")
	const [isCreating, setIsCreating] = useState(false)

	const guildsResult = useAtomValue(
		HazelApiClient.query("integration-resources", "getDiscordGuilds", {
			params: { orgId: organizationId },
		}),
	)

	const createConnection = useAtomSet(HazelRpcClient.mutation("chatSync.connection.create"), {
		mode: "promiseExit",
	})

	const guilds = useMemo(
		() =>
			AsyncResult.builder(guildsResult)
				.onSuccess((data) => data?.guilds ?? [])
				.orElse(() => []),
		[guildsResult],
	)

	const filteredGuilds =
		guildSearch.trim().length === 0
			? guilds
			: guilds.filter((guild) => guild.name.toLowerCase().includes(guildSearch.toLowerCase()))

	const handleClose = () => {
		setSelectedGuild(null)
		setGuildSearch("")
		onClose()
	}

	const handleConnectDiscord = () => {
		navigate({
			to: "/$orgSlug/settings/integrations/$integrationId",
			params: {
				orgSlug,
				integrationId: "discord",
			},
		})
	}

	const handleSubmit = async () => {
		if (!selectedGuild) return
		setIsCreating(true)

		const exit = await createConnection({
			payload: {
				organizationId,
				provider: "discord",
				externalWorkspaceId: selectedGuild.id,
				externalWorkspaceName: selectedGuild.name,
			},
		})

		exitToast(exit)
			.onSuccess(() => {
				onSuccess()
				handleClose()
			})
			.successMessage("Discord connection created")
			.onErrorTag("ChatSyncConnectionExistsError", () => ({
				title: "Connection already exists",
				description: "A connection to this Discord server already exists in your workspace.",
				isRetryable: false,
			}))
			.onErrorTag("ChatSyncIntegrationNotConnectedError", () => ({
				title: "Discord not connected",
				description: "Connect Discord first to load your guilds.",
				isRetryable: false,
			}))
			.run()

		setIsCreating(false)
	}

	return (
		<Modal>
			<ModalContent isOpen={isOpen} onOpenChange={(open) => !open && handleClose()} size="md">
				<ModalHeader>
					<div className="flex items-center gap-3">
						<div className="flex size-10 items-center justify-center rounded-xl bg-[#5865F2]/[0.06]">
							<svg viewBox="0 0 24 24" className="size-6" fill="#5865F2">
								<path d="M20.317 4.37a19.791 19.791 0 0 0-4.885-1.515.074.074 0 0 0-.079.037c-.21.375-.444.864-.608 1.25a18.27 18.27 0 0 0-5.487 0 12.64 12.64 0 0 0-.617-1.25.077.077 0 0 0-.079-.037A19.736 19.736 0 0 0 3.677 4.37a.07.07 0 0 0-.032.027C.533 9.046-.32 13.58.099 18.057a.082.082 0 0 0 .031.057 19.9 19.9 0 0 0 5.993 3.03.078.078 0 0 0 .084-.028 14.09 14.09 0 0 0 1.226-1.994.076.076 0 0 0-.041-.106 13.107 13.107 0 0 1-1.872-.892.077.077 0 0 1-.008-.128 10.2 10.2 0 0 0 .372-.292.074.074 0 0 1 .077-.01c3.928 1.793 8.18 1.793 12.062 0a.074.074 0 0 1 .078.01c.12.098.246.198.373.292a.077.077 0 0 1-.006.127 12.299 12.299 0 0 1-1.873.892.077.077 0 0 0-.041.107c.36.698.772 1.362 1.225 1.993a.076.076 0 0 0 .084.028 19.839 19.839 0 0 0 6.002-3.03.077.077 0 0 0 .032-.054c.5-5.177-.838-9.674-3.549-13.66a.061.061 0 0 0-.031-.03zM8.02 15.33c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.956-2.419 2.157-2.419 1.21 0 2.176 1.095 2.157 2.42 0 1.333-.956 2.418-2.157 2.418zm7.975 0c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.955-2.419 2.157-2.419 1.21 0 2.176 1.095 2.157 2.42 0 1.333-.946 2.418-2.157 2.418z" />
							</svg>
						</div>
						<ModalTitle>Connect Discord Server</ModalTitle>
					</div>
				</ModalHeader>

				<ModalBody className="flex flex-col gap-5">
					{AsyncResult.isInitial(guildsResult) && (
						<div className="flex items-center justify-center py-8">
							<div className="flex items-center gap-3 text-muted-fg">
								<div className="size-5 animate-spin rounded-full border-2 border-border border-t-primary" />
								<span className="text-sm">Loading Discord guilds...</span>
							</div>
						</div>
					)}
					{AsyncResult.isFailure(guildsResult) && (
						<div className="rounded-lg border border-border bg-bg-muted/20 p-4">
							<p className="font-medium text-fg text-sm">Connect Discord first</p>
							<p className="mt-1 text-muted-fg text-sm">
								Authorize Discord in Integrations so we can load your guilds.
							</p>
							<Button
								intent="secondary"
								size="sm"
								onPress={handleConnectDiscord}
								className="mt-3"
							>
								Open Discord Integration
							</Button>
						</div>
					)}
					{AsyncResult.isSuccess(guildsResult) && (
						<div className="flex flex-col gap-3">
							<Label>Discord Server</Label>
							{selectedGuild ? (
								<div className="flex items-center justify-between rounded-lg border border-border bg-bg-muted/30 px-3 py-2.5">
									<div className="flex items-center gap-2">
										<span className="font-medium text-fg text-sm">
											{selectedGuild.name}
										</span>
									</div>
									<button
										type="button"
										onClick={() => setSelectedGuild(null)}
										className="text-muted-fg text-xs transition-colors hover:text-fg"
									>
										Change
									</button>
								</div>
							) : (
								<>
									<InputGroup>
										<Input
											placeholder="Search servers..."
											value={guildSearch}
											onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
												setGuildSearch(e.target.value)
											}
											autoFocus
										/>
									</InputGroup>
									<div className="max-h-56 overflow-y-auto rounded-lg border border-border">
										{filteredGuilds.length === 0 ? (
											<div className="px-3 py-6 text-center text-muted-fg text-sm">
												No Discord servers found
											</div>
										) : (
											filteredGuilds.map((guild) => (
												<button
													key={guild.id}
													type="button"
													onClick={() => setSelectedGuild(guild)}
													className="flex w-full items-center justify-between px-3 py-2 text-left text-sm transition-colors hover:bg-secondary/50"
												>
													<span className="truncate text-fg">{guild.name}</span>
													{guild.owner && (
														<span className="rounded bg-secondary px-1.5 py-0.5 text-[10px] text-muted-fg">
															Owner
														</span>
													)}
												</button>
											))
										)}
									</div>
								</>
							)}
							<Description>Select the Discord server you want to sync with Hazel.</Description>
						</div>
					)}
				</ModalBody>

				<ModalFooter>
					<ModalClose intent="secondary">Cancel</ModalClose>
					<Button
						intent="primary"
						onPress={handleSubmit}
						isDisabled={!selectedGuild || isCreating || !AsyncResult.isSuccess(guildsResult)}
						isPending={isCreating}
					>
						{isCreating ? "Connecting..." : "Connect"}
					</Button>
				</ModalFooter>
			</ModalContent>
		</Modal>
	)
}

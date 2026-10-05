import { AsyncResult } from "effect/reactivity"
import { useAtomSet, useAtomValue } from "@effect/atom-react"
import type { OrganizationId } from "@hazel/schema"
import type { IntegrationConnection } from "@hazel/domain/models"
import { createFileRoute, notFound, useNavigate } from "@tanstack/react-router"
import { Exit, Option } from "effect"
import { useEffect, useRef, useState } from "react"
import { toast } from "sonner"
import { GitHubSubscriptionsSection } from "~/components/integrations/github-subscriptions-section"
import { MapleIntegrationContent } from "~/components/integrations/maple-integration-content"
import { OpenStatusIntegrationContent } from "~/components/integrations/openstatus-integration-content"
import { RailwayIntegrationContent } from "~/components/integrations/railway-integration-content"
import { RssSubscriptionsSection } from "~/components/integrations/rss-subscriptions-section"
import { Button, buttonStyles } from "~/components/ui/button"
import { Input, InputGroup } from "~/components/ui/input"
import { SectionHeader } from "~/components/ui/section-header"
import { SectionLabel } from "~/components/ui/section-label"
import { Switch, SwitchLabel } from "~/components/ui/switch"
import { useIntegrationConnection } from "~/db/hooks"
import { useOrganization } from "~/hooks/use-organization"
import { useAuth } from "~/lib/auth"
import { HazelApiClient } from "~/lib/services/common/atom-client"
import { exitToast } from "~/lib/toast-exit"
import {
	type ConfigOption,
	getBrandfetchIcon,
	getIntegrationById,
	type Integration,
	validIntegrationIds,
} from "../../../../../lib/integrations/__data"

type IntegrationProvider = IntegrationConnection.IntegrationProvider

/**
 * Search params for OAuth callback redirect
 */
interface IntegrationSearchParams {
	connection_status?: "success" | "error"
	error_code?: string
	provider?: string
}

/**
 * Get user-friendly error message from error code
 */
const getErrorMessageFromCode = (errorCode?: string): string => {
	switch (errorCode) {
		case "token_exchange_failed":
			return "Could not authenticate with the provider. Please try again."
		case "account_info_failed":
			return "Could not fetch your account information."
		case "db_error":
			return "A database error occurred. Please try again."
		case "encryption_error":
			return "A security error occurred. Please try again."
		case "invalid_state":
			return "The connection request expired. Please try again."
		default:
			return "An unexpected error occurred. Please try again."
	}
}

export const Route = createFileRoute("/_app/$orgSlug/settings/integrations/$integrationId")({
	component: IntegrationConfigPage,
	validateSearch: (search: Record<string, unknown>): IntegrationSearchParams => ({
		connection_status: search.connection_status as IntegrationSearchParams["connection_status"],
		error_code: search.error_code as string | undefined,
		provider: search.provider as string | undefined,
	}),
	beforeLoad: ({ params }) => {
		if (!validIntegrationIds.includes(params.integrationId)) {
			throw notFound()
		}
	},
})

function IntegrationConfigPage() {
	const { orgSlug, integrationId } = Route.useParams()
	const { connection_status, error_code } = Route.useSearch()
	const navigate = useNavigate()
	const { user } = useAuth()
	const { organizationId } = useOrganization()
	const integration = getIntegrationById(integrationId)
	const [isConnecting, setIsConnecting] = useState(false)
	const [isDisconnecting, setIsDisconnecting] = useState(false)
	const [pendingVerification, setPendingVerification] = useState(false)

	// Query connection from TanStack DB collection (real-time sync via Electric)
	// Only used for OAuth-based integrations (not OpenStatus)
	const { connection, isConnected } = useIntegrationConnection(
		organizationId ?? null,
		integrationId as IntegrationProvider,
	)

	// Derive isVerifying from pending + connection state
	const isVerifying = pendingVerification && !isConnected

	// Set pending verification when OAuth callback succeeds (detect transition
	// during render — setState during render is legal and bails out otherwise).
	const prevConnectionStatusRef = useRef(connection_status)
	if (connection_status !== prevConnectionStatusRef.current) {
		prevConnectionStatusRef.current = connection_status
		if (connection_status === "success") {
			setPendingVerification(true)
		}
	}

	// Handle OAuth callback side effects (toast + clear search params)
	useEffect(() => {
		if (!connection_status || !integration) return

		if (connection_status === "success") {
			toast.success(`Connected to ${integration.name}`, {
				description: "Your account has been successfully connected.",
			})
		} else if (connection_status === "error") {
			const errorMessage = getErrorMessageFromCode(error_code)
			toast.error(`Failed to connect to ${integration.name}`, {
				description: errorMessage,
			})
		}

		// Clear search params
		navigate({
			to: "/$orgSlug/settings/integrations/$integrationId",
			params: { orgSlug, integrationId },
			search: {},
			replace: true,
		})
	}, [connection_status, error_code, integration, orgSlug, integrationId, navigate])

	// Mutation for OAuth flow - get authorization URL then redirect
	const getOAuthUrlMutation = useAtomSet(HazelApiClient.mutation("integrations", "getOAuthUrl"), {
		mode: "promiseExit",
	})

	// Mutation for API key connection
	const connectApiKeyMutation = useAtomSet(HazelApiClient.mutation("integrations", "connectApiKey"), {
		mode: "promiseExit",
	})

	// Mutation for disconnect
	const disconnectMutation = useAtomSet(HazelApiClient.mutation("integrations", "disconnect"), {
		mode: "promiseExit",
	})

	if (!integration) {
		return null
	}

	const externalAccountName = connection?.externalAccountName ?? null

	const handleConnect = async () => {
		if (!organizationId) return
		setIsConnecting(true)

		// Make authenticated API call to get OAuth URL, then redirect
		// This ensures the bearer token auth is properly sent
		const exit = await getOAuthUrlMutation({
			params: { orgId: organizationId, provider: integrationId as IntegrationProvider },
			query: { level: "organization" },
		})

		if (Exit.isSuccess(exit)) {
			// Redirect to OAuth provider
			window.location.href = exit.value.authorizationUrl
		} else {
			setIsConnecting(false)
			toast.error(`Failed to connect to ${integration?.name ?? "integration"}`, {
				description: "Could not initiate the connection. Please try again.",
			})
		}
	}

	const handleDisconnect = async () => {
		if (!organizationId) return
		setIsDisconnecting(true)
		const exit = await disconnectMutation({
			params: { orgId: organizationId, provider: integrationId as IntegrationProvider },
			query: { level: "organization" },
		})

		exitToast(exit)
			.onErrorTag("IntegrationNotConnectedError", () => ({
				title: "Integration not connected",
				description: "This integration is already disconnected.",
				isRetryable: false,
			}))
			.onErrorTag("UnsupportedProviderError", () => ({
				title: "Unsupported provider",
				description: "This integration provider is not supported.",
				isRetryable: false,
			}))
			.run()
		// Status will be refetched automatically
		setIsDisconnecting(false)
	}

	const handleConnectApiKey = async (token: string, baseUrl: string) => {
		if (!organizationId) return
		setIsConnecting(true)

		const exit = await connectApiKeyMutation({
			params: { orgId: organizationId, provider: integrationId as IntegrationProvider },
			payload: { token, baseUrl },
		})

		if (Exit.isSuccess(exit)) {
			toast.success(`Connected to ${integration?.name ?? "integration"}`, {
				description: `Connected as ${exit.value.externalAccountName ?? "your space"}.`,
			})
		} else {
			exitToast(exit)
				.onErrorTag("InvalidApiKeyError", (error) => ({
					title: "Invalid credentials",
					description: error.message,
					isRetryable: true,
				}))
				.onErrorTag("UnsupportedProviderError", () => ({
					title: "Unsupported provider",
					description: "This integration does not support API key connections.",
					isRetryable: false,
				}))
				.onError(() => ({
					title: "Connection failed",
					description: "Could not connect this integration. Please try again.",
					isRetryable: true,
				}))
				.run()
		}

		setIsConnecting(false)
	}

	const handleBack = () => {
		navigate({ to: "/$orgSlug/settings/integrations", params: { orgSlug } })
	}

	// OpenStatus, Railway, RSS, and Maple use webhook/polling-based integration (per-channel), not OAuth
	const isWebhookIntegration =
		integrationId === "openstatus" ||
		integrationId === "railway" ||
		integrationId === "rss" ||
		integrationId === "maple"

	const isApiKeyIntegration = integration?.connectionType === "api-key"

	return (
		<div className="flex flex-col gap-6 px-4 lg:px-8">
			{/* Back link */}
			<button
				type="button"
				onClick={handleBack}
				className="-ml-1 flex w-fit items-center gap-1 text-muted-fg text-sm transition-colors hover:text-fg"
			>
				<svg className="size-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
					<path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
				</svg>
				<span>Back to integrations</span>
			</button>

			{/* Header */}
			<SectionHeader.Root className="border-none pb-0">
				<SectionHeader.Group>
					<div className="flex items-center gap-4">
						<div
							className="flex size-16 shrink-0 items-center justify-center overflow-hidden rounded-2xl shadow-md ring-1 ring-black/8"
							style={{ backgroundColor: `${integration.brandColor}10` }}
						>
							<img
								src={
									integration.logoSrc ??
									getBrandfetchIcon(integration.logoDomain, {
										theme: "light",
										type: integration.logoType,
									})
								}
								alt={`${integration.name} logo`}
								className="size-12 object-contain"
							/>
						</div>
						<div className="flex flex-col gap-1">
							<div className="flex items-center gap-3">
								<SectionHeader.Heading>{integration.name}</SectionHeader.Heading>
								{!isWebhookIntegration && <ConnectionBadge connected={isConnected} />}
							</div>
							<SectionHeader.Subheading>{integration.description}</SectionHeader.Subheading>
						</div>
					</div>
				</SectionHeader.Group>
			</SectionHeader.Root>

			{/* Main content */}
			<div className="grid gap-8 lg:grid-cols-[1fr_320px]">
				{/* Left column - Connection & Config (or webhook-based integration content) */}
				<div className="flex flex-col gap-8">
					{isWebhookIntegration ? (
						// Webhook-based integrations: Show channel-based webhook configuration
						organizationId &&
						(integrationId === "openstatus" ? (
							<OpenStatusIntegrationContent organizationId={organizationId} />
						) : integrationId === "railway" ? (
							<RailwayIntegrationContent organizationId={organizationId} />
						) : integrationId === "rss" ? (
							<RssSubscriptionsSection organizationId={organizationId} />
						) : integrationId === "maple" ? (
							<MapleIntegrationContent organizationId={organizationId} />
						) : null)
					) : isApiKeyIntegration ? (
						<>
							{/* API-key integration: Connection card */}
							<div className="overflow-hidden rounded-xl border border-border bg-bg">
								<div className="border-border border-b bg-bg-muted/30 px-5 py-3">
									<h3 className="font-semibold text-fg text-sm">Connection</h3>
								</div>
								<div className="p-5">
									{isConnected ? (
										<ConnectedState
											integration={integration}
											connection={connection}
											externalAccountName={externalAccountName}
											isDisconnecting={isDisconnecting}
											onDisconnect={handleDisconnect}
										/>
									) : (
										<ApiKeyConnectionForm
											integration={integration}
											isConnecting={isConnecting}
											onConnect={handleConnectApiKey}
										/>
									)}
								</div>
							</div>
						</>
					) : (
						<>
							{/* OAuth-based integration: Connection card */}
							<div className="overflow-hidden rounded-xl border border-border bg-bg">
								<div className="border-border border-b bg-bg-muted/30 px-5 py-3">
									<h3 className="font-semibold text-fg text-sm">Connection</h3>
								</div>
								<div className="p-5">
									{isVerifying ? (
										<VerifyingState integration={integration} />
									) : isConnected ? (
										<ConnectedState
											integration={integration}
											connection={connection}
											externalAccountName={externalAccountName}
											isDisconnecting={isDisconnecting}
											onDisconnect={handleDisconnect}
											onConfigure={handleConnect}
											isConfiguring={isConnecting}
										/>
									) : (
										<DisconnectedState
											integration={integration}
											isConnecting={isConnecting}
											onConnect={handleConnect}
										/>
									)}
								</div>
							</div>

							{/* Configuration */}
							{isConnected && (
								<div className="overflow-hidden rounded-xl border border-border bg-bg">
									<div className="border-border border-b bg-bg-muted/30 px-5 py-3">
										<h3 className="font-semibold text-fg text-sm">Configuration</h3>
									</div>
									<div className="flex flex-col divide-y divide-border">
										{integration.configOptions.map((option) => (
											<ConfigOptionRow key={option.id} option={option} />
										))}
									</div>
								</div>
							)}

							{/* GitHub Repository Access */}
							{isConnected && integrationId === "github" && organizationId && (
								<GitHubRepositoryAccessSection organizationId={organizationId} />
							)}

							{/* GitHub Channel Subscriptions */}
							{isConnected && integrationId === "github" && organizationId && (
								<GitHubSubscriptionsSection organizationId={organizationId} />
							)}
						</>
					)}
				</div>

				{/* Right column - Features */}
				<div className="lg:sticky lg:top-6 lg:self-start">
					<div className="overflow-hidden rounded-xl border border-border bg-bg">
						<div className="border-border border-b bg-bg-muted/30 px-5 py-3">
							<h3 className="font-semibold text-fg text-sm">Features</h3>
						</div>
						<div className="p-5">
							<p className="mb-4 text-muted-fg text-sm leading-relaxed">
								{integration.fullDescription}
							</p>
							<ul className="flex flex-col gap-2.5">
								{integration.features.map((feature) => (
									<li key={feature} className="flex items-center gap-2.5 text-sm">
										<div className="flex size-5 shrink-0 items-center justify-center rounded-sm bg-success-subtle">
											<svg
												className="size-3 text-success-subtle-fg"
												fill="none"
												viewBox="0 0 24 24"
												stroke="currentColor"
												strokeWidth={3}
											>
												<path
													strokeLinecap="round"
													strokeLinejoin="round"
													d="M5 13l4 4L19 7"
												/>
											</svg>
										</div>
										<span className="text-fg">{feature}</span>
									</li>
								))}
							</ul>
						</div>
					</div>
				</div>
			</div>
		</div>
	)
}

function ConnectionBadge({ connected }: { connected: boolean }) {
	return (
		<span
			className={`inline-flex items-center gap-1.5 rounded-sm px-2.5 py-0.5 font-medium text-xs ${
				connected ? "bg-success-subtle text-success-subtle-fg" : "bg-muted text-muted-fg"
			}`}
		>
			<span className={`size-1.5 rounded-full ${connected ? "bg-success" : "bg-muted-fg"}`} />
			{connected ? "Connected" : "Not connected"}
		</span>
	)
}

function DisconnectedState({
	integration,
	isConnecting,
	onConnect,
}: {
	integration: Integration
	isConnecting: boolean
	onConnect: () => void
}) {
	return (
		<div className="flex flex-col items-center gap-4 py-4 text-center">
			<div className="flex size-14 items-center justify-center rounded-xl bg-bg-muted">
				<svg
					className="size-6 text-muted-fg"
					fill="none"
					viewBox="0 0 24 24"
					stroke="currentColor"
					strokeWidth={1.5}
				>
					<path
						strokeLinecap="round"
						strokeLinejoin="round"
						d="M13.19 8.688a4.5 4.5 0 011.242 7.244l-4.5 4.5a4.5 4.5 0 01-6.364-6.364l1.757-1.757m13.35-.622l1.757-1.757a4.5 4.5 0 00-6.364-6.364l-4.5 4.5a4.5 4.5 0 001.242 7.244"
					/>
				</svg>
			</div>
			<div className="flex flex-col gap-1">
				<p className="font-medium text-fg text-sm">Connect your {integration.name} account</p>
				<p className="text-muted-fg text-sm">
					You'll be redirected to {integration.name} to authorize the connection.
				</p>
			</div>
			<Button
				intent="primary"
				size="md"
				className="mt-2"
				onPress={onConnect}
				isDisabled={isConnecting}
				style={{ backgroundColor: integration.brandColor }}
			>
				{isConnecting ? (
					<>
						<svg className="size-4 animate-spin" fill="none" viewBox="0 0 24 24">
							<circle
								className="opacity-25"
								cx="12"
								cy="12"
								r="10"
								stroke="currentColor"
								strokeWidth="4"
							/>
							<path
								className="opacity-75"
								fill="currentColor"
								d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
							/>
						</svg>
						Connecting...
					</>
				) : (
					<>
						<img
							src={getBrandfetchIcon(integration.logoDomain, {
								theme: "light",
								type: integration.logoType,
							})}
							alt=""
							className="size-4 rounded object-contain"
						/>
						Connect with {integration.name}
					</>
				)}
			</Button>
		</div>
	)
}

function VerifyingState({ integration }: { integration: Integration }) {
	return (
		<div className="flex flex-col items-center gap-4 py-4 text-center">
			<div className="flex size-14 items-center justify-center rounded-xl bg-bg-muted">
				<svg className="size-6 animate-spin text-muted-fg" fill="none" viewBox="0 0 24 24">
					<circle
						className="opacity-25"
						cx="12"
						cy="12"
						r="10"
						stroke="currentColor"
						strokeWidth="4"
					/>
					<path
						className="opacity-75"
						fill="currentColor"
						d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
					/>
				</svg>
			</div>
			<div className="flex flex-col gap-1">
				<p className="font-medium text-fg text-sm">Verifying connection...</p>
				<p className="text-muted-fg text-sm">
					Please wait while we verify your {integration.name} connection.
				</p>
			</div>
		</div>
	)
}

function ConnectedState({
	integration,
	connection,
	externalAccountName,
	isDisconnecting,
	onDisconnect,
	onConfigure,
	isConfiguring,
}: {
	integration: Integration
	connection: IntegrationConnection.Type | null
	externalAccountName: string | null
	isDisconnecting: boolean
	onDisconnect: () => void
	onConfigure?: () => void
	isConfiguring?: boolean
}) {
	const showConfigureButton =
		integration.id === "github" && connection?.metadata?.installationId && onConfigure

	return (
		<div className="flex items-center justify-between gap-4">
			<div className="flex items-center gap-3">
				<div className="flex size-10 items-center justify-center rounded-xl bg-success-subtle">
					<svg
						className="size-5 text-success-subtle-fg"
						fill="none"
						viewBox="0 0 24 24"
						stroke="currentColor"
						strokeWidth={2}
					>
						<path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
					</svg>
				</div>
				<div className="flex flex-col gap-0.5">
					<p className="font-medium text-fg text-sm">Connected to {integration.name}</p>
					{externalAccountName && <p className="text-muted-fg text-xs">{externalAccountName}</p>}
				</div>
			</div>
			{showConfigureButton ? (
				<Button intent="secondary" size="sm" onPress={onConfigure} isDisabled={isConfiguring}>
					{isConfiguring ? (
						<>
							<svg className="size-4 animate-spin" fill="none" viewBox="0 0 24 24">
								<circle
									className="opacity-25"
									cx="12"
									cy="12"
									r="10"
									stroke="currentColor"
									strokeWidth="4"
								/>
								<path
									className="opacity-75"
									fill="currentColor"
									d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
								/>
							</svg>
							Redirecting...
						</>
					) : (
						<>
							<svg
								className="size-4"
								fill="none"
								viewBox="0 0 24 24"
								stroke="currentColor"
								strokeWidth={2}
							>
								<path
									strokeLinecap="round"
									strokeLinejoin="round"
									d="M10.5 6h9.75M10.5 6a1.5 1.5 0 1 1-3 0m3 0a1.5 1.5 0 1 0-3 0M3.75 6H7.5m3 12h9.75m-9.75 0a1.5 1.5 0 0 1-3 0m3 0a1.5 1.5 0 0 0-3 0m-3.75 0H7.5m9-6h3.75m-3.75 0a1.5 1.5 0 0 1-3 0m3 0a1.5 1.5 0 0 0-3 0m-9.75 0h9.75"
								/>
							</svg>
							Configure on GitHub
						</>
					)}
				</Button>
			) : (
				<Button intent="danger" size="sm" onPress={onDisconnect} isDisabled={isDisconnecting}>
					{isDisconnecting ? "Disconnecting..." : "Disconnect"}
				</Button>
			)}
		</div>
	)
}

function ApiKeyConnectionForm({
	integration,
	isConnecting,
	onConnect,
}: {
	integration: Integration
	isConnecting: boolean
	onConnect: (token: string, baseUrl: string) => void
}) {
	const [token, setToken] = useState("")
	const [baseUrl, setBaseUrl] = useState("")

	const handleSubmit = (e: React.FormEvent) => {
		e.preventDefault()
		if (token.trim() && baseUrl.trim()) {
			onConnect(token.trim(), baseUrl.trim())
		}
	}

	return (
		<form onSubmit={handleSubmit} className="flex flex-col gap-5 py-2">
			<div className="flex flex-col gap-1.5">
				<label htmlFor="api-token" className="font-medium text-fg text-sm">
					Bearer Token
				</label>
				<InputGroup>
					<Input
						id="api-token"
						type="password"
						placeholder="Enter your API token"
						value={token}
						onChange={(e: React.ChangeEvent<HTMLInputElement>) => setToken(e.target.value)}
						className="text-sm"
						autoComplete="off"
					/>
				</InputGroup>
				<p className="text-muted-fg text-xs">
					You can find this in your {integration.name} API settings.
				</p>
			</div>
			<div className="flex flex-col gap-1.5">
				<label htmlFor="api-base-url" className="font-medium text-fg text-sm">
					Base URL
				</label>
				<InputGroup>
					<Input
						id="api-base-url"
						type="url"
						placeholder="https://connect.craft.do/links/{linkId}/api/v1"
						value={baseUrl}
						onChange={(e: React.ChangeEvent<HTMLInputElement>) => setBaseUrl(e.target.value)}
						className="text-sm"
						autoComplete="off"
					/>
				</InputGroup>
				<p className="text-muted-fg text-xs">The API endpoint URL for your space.</p>
			</div>
			<Button
				type="submit"
				intent="primary"
				size="md"
				className="self-start"
				isDisabled={isConnecting || !token.trim() || !baseUrl.trim()}
				style={{ backgroundColor: integration.brandColor }}
			>
				{isConnecting ? (
					<>
						<svg className="size-4 animate-spin" fill="none" viewBox="0 0 24 24">
							<circle
								className="opacity-25"
								cx="12"
								cy="12"
								r="10"
								stroke="currentColor"
								strokeWidth="4"
							/>
							<path
								className="opacity-75"
								fill="currentColor"
								d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
							/>
						</svg>
						Connecting...
					</>
				) : (
					<>
						<img
							src={getBrandfetchIcon(integration.logoDomain, {
								theme: "light",
								type: integration.logoType,
							})}
							alt=""
							className="size-4 rounded object-contain"
						/>
						Connect
					</>
				)}
			</Button>
		</form>
	)
}

function ConfigOptionRow({ option }: { option: ConfigOption }) {
	const [enabled, setEnabled] = useState(false)

	return (
		<div className="flex items-center justify-between gap-4 px-5 py-4">
			<SectionLabel.Root size="sm" title={option.label} description={option.description} />
			{option.type === "toggle" ? (
				<SwitchLabel>
					<Switch isSelected={enabled} onChange={setEnabled} />
				</SwitchLabel>
			) : (
				<InputGroup className="w-48">
					<Input placeholder={option.placeholder} className="text-sm" disabled />
				</InputGroup>
			)}
		</div>
	)
}

/**
 * GitHub Repository Access Section
 * Displays all repositories the GitHub App has access to.
 */
function GitHubRepositoryAccessSection({ organizationId }: { organizationId: OrganizationId }) {
	const [page, setPage] = useState(1)
	const perPage = 30

	const repositoriesResult = useAtomValue(
		HazelApiClient.query("integration-resources", "getGitHubRepositories", {
			params: { orgId: organizationId },
			query: { page, perPage },
		}),
	)

	// Loading state
	if (AsyncResult.isInitial(repositoriesResult)) {
		return (
			<div className="overflow-hidden rounded-xl border border-border bg-bg">
				<div className="border-border border-b bg-bg-muted/30 px-5 py-3">
					<h3 className="font-semibold text-fg text-sm">Repository Access</h3>
				</div>
				<div className="flex items-center justify-center p-8">
					<div className="flex items-center gap-3 text-muted-fg">
						<svg className="size-5 animate-spin" fill="none" viewBox="0 0 24 24">
							<circle
								className="opacity-25"
								cx="12"
								cy="12"
								r="10"
								stroke="currentColor"
								strokeWidth="4"
							/>
							<path
								className="opacity-75"
								fill="currentColor"
								d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
							/>
						</svg>
						<span className="text-sm">Loading repositories...</span>
					</div>
				</div>
			</div>
		)
	}

	// Error state
	if (AsyncResult.isFailure(repositoriesResult)) {
		return (
			<div className="overflow-hidden rounded-xl border border-border bg-bg">
				<div className="border-border border-b bg-bg-muted/30 px-5 py-3">
					<h3 className="font-semibold text-fg text-sm">Repository Access</h3>
				</div>
				<div className="flex flex-col items-center justify-center px-5 py-8 text-center">
					<p className="text-muted-fg text-sm">Unable to load repositories</p>
				</div>
			</div>
		)
	}

	const data = AsyncResult.value(repositoriesResult)
	if (Option.isNone(data)) {
		return null
	}

	const { totalCount, repositories, hasNextPage } = data.value

	return (
		<div className="overflow-hidden rounded-xl border border-border bg-bg">
			<div className="flex items-center justify-between border-border border-b bg-bg-muted/30 px-5 py-3">
				<div className="flex items-center gap-2">
					<h3 className="font-semibold text-fg text-sm">Repository Access</h3>
					<span className="rounded-sm bg-secondary px-2 py-0.5 text-muted-fg text-xs">
						{totalCount}
					</span>
				</div>
				<a
					href="https://github.com/apps/hazelchat/installations/select_target"
					target="_blank"
					rel="noopener noreferrer"
					className="text-muted-fg text-xs transition-colors hover:text-fg"
				>
					Manage access
				</a>
			</div>

			{repositories.length === 0 ? (
				<div className="flex flex-col items-center justify-center px-5 py-12 text-center">
					<div className="mb-4 flex size-12 items-center justify-center rounded-xl bg-bg-muted">
						<svg
							className="size-6 text-muted-fg"
							fill="none"
							viewBox="0 0 24 24"
							stroke="currentColor"
							strokeWidth={1.5}
						>
							<path
								strokeLinecap="round"
								strokeLinejoin="round"
								d="M2.25 12.75V12A2.25 2.25 0 014.5 9.75h15A2.25 2.25 0 0121.75 12v.75m-8.69-6.44l-2.12-2.12a1.5 1.5 0 00-1.061-.44H4.5A2.25 2.25 0 002.25 6v12a2.25 2.25 0 002.25 2.25h15A2.25 2.25 0 0021.75 18V9a2.25 2.25 0 00-2.25-2.25h-5.379a1.5 1.5 0 01-1.06-.44z"
							/>
						</svg>
					</div>
					<p className="mb-1 font-medium text-fg text-sm">No repositories accessible</p>
					<p className="mb-4 text-muted-fg text-sm">
						Configure which repositories the app can access.
					</p>
					<a
						href="https://github.com/apps/hazelchat/installations/select_target"
						target="_blank"
						rel="noopener noreferrer"
						className={buttonStyles({ intent: "secondary", size: "sm" })}
					>
						Configure on GitHub
					</a>
				</div>
			) : (
				<>
					<div className="divide-y divide-border">
						{repositories.map((repo) => (
							<div key={repo.id} className="flex items-center justify-between gap-4 px-5 py-3">
								<div className="flex min-w-0 items-center gap-3">
									<div className="flex size-8 shrink-0 items-center justify-center rounded bg-bg-muted">
										<svg
											className="size-4 text-muted-fg"
											fill="currentColor"
											viewBox="0 0 16 16"
										>
											<path d="M2 2.5A2.5 2.5 0 0 1 4.5 0h8.75a.75.75 0 0 1 .75.75v12.5a.75.75 0 0 1-.75.75h-2.5a.75.75 0 0 1 0-1.5h1.75v-2h-8a1 1 0 0 0-.714 1.7.75.75 0 1 1-1.072 1.05A2.495 2.495 0 0 1 2 11.5Zm10.5-1h-8a1 1 0 0 0-1 1v6.708A2.486 2.486 0 0 1 4.5 9h8ZM5 12.25v3.25a.25.25 0 0 0 .4.2l1.45-1.087a.25.25 0 0 1 .3 0L8.6 15.7a.25.25 0 0 0 .4-.2v-3.25a.25.25 0 0 0-.25-.25h-3.5a.25.25 0 0 0-.25.25Z" />
										</svg>
									</div>
									<div className="min-w-0">
										<p className="truncate font-medium text-fg text-sm">
											{repo.fullName}
										</p>
									</div>
								</div>
								<div className="flex shrink-0 items-center gap-3">
									<span
										className={`inline-flex items-center gap-1.5 rounded-sm px-2 py-0.5 text-xs ${
											repo.private
												? "bg-warning-subtle text-warning-subtle-fg"
												: "bg-success-subtle text-success-subtle-fg"
										}`}
									>
										{repo.private ? (
											<svg className="size-3" fill="currentColor" viewBox="0 0 16 16">
												<path d="M4 4a4 4 0 0 1 8 0v2h.25c.966 0 1.75.784 1.75 1.75v5.5A1.75 1.75 0 0 1 12.25 15h-8.5A1.75 1.75 0 0 1 2 13.25v-5.5C2 6.784 2.784 6 3.75 6H4Zm8.25 3.5h-8.5a.25.25 0 0 0-.25.25v5.5c0 .138.112.25.25.25h8.5a.25.25 0 0 0 .25-.25v-5.5a.25.25 0 0 0-.25-.25ZM10.5 6V4a2.5 2.5 0 1 0-5 0v2Z" />
											</svg>
										) : (
											<svg className="size-3" fill="currentColor" viewBox="0 0 16 16">
												<path d="M2 2.5A2.5 2.5 0 0 1 4.5 0h8.75a.75.75 0 0 1 .75.75v12.5a.75.75 0 0 1-.75.75h-2.5a.75.75 0 0 1 0-1.5h1.75v-2h-8a1 1 0 0 0-.714 1.7.75.75 0 1 1-1.072 1.05A2.495 2.495 0 0 1 2 11.5Zm10.5-1h-8a1 1 0 0 0-1 1v6.708A2.486 2.486 0 0 1 4.5 9h8ZM5 12.25v3.25a.25.25 0 0 0 .4.2l1.45-1.087a.25.25 0 0 1 .3 0L8.6 15.7a.25.25 0 0 0 .4-.2v-3.25a.25.25 0 0 0-.25-.25h-3.5a.25.25 0 0 0-.25.25Z" />
											</svg>
										)}
										{repo.private ? "Private" : "Public"}
									</span>
									<a
										href={repo.htmlUrl}
										target="_blank"
										rel="noopener noreferrer"
										className="text-muted-fg transition-colors hover:text-fg"
										title="View on GitHub"
									>
										<svg
											className="size-4"
											fill="none"
											viewBox="0 0 24 24"
											stroke="currentColor"
											strokeWidth={1.5}
										>
											<path
												strokeLinecap="round"
												strokeLinejoin="round"
												d="M13.5 6H5.25A2.25 2.25 0 0 0 3 8.25v10.5A2.25 2.25 0 0 0 5.25 21h10.5A2.25 2.25 0 0 0 18 18.75V10.5m-10.5 6L21 3m0 0h-5.25M21 3v5.25"
											/>
										</svg>
									</a>
								</div>
							</div>
						))}
					</div>

					{/* Pagination */}
					{(page > 1 || hasNextPage) && (
						<div className="flex items-center justify-between border-border border-t px-5 py-3">
							<Button
								intent="secondary"
								size="sm"
								onPress={() => setPage((p) => Math.max(1, p - 1))}
								isDisabled={page === 1}
							>
								Previous
							</Button>
							<span className="text-muted-fg text-xs">Page {page}</span>
							<Button
								intent="secondary"
								size="sm"
								onPress={() => setPage((p) => p + 1)}
								isDisabled={!hasNextPage}
							>
								Next
							</Button>
						</div>
					)}
				</>
			)}
		</div>
	)
}

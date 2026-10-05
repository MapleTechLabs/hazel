import type { ChannelId } from "@hazel/schema"
import { eq, useLiveQuery } from "@tanstack/react-db"
import { createFileRoute, Link, Outlet, useMatchRoute, useNavigate } from "@tanstack/react-router"
import { ChannelIcon } from "~/components/channel-icon"
import { Tab, TabList, Tabs } from "~/components/ui/tabs"
import { channelCollection } from "~/db/collections"

export const Route = createFileRoute("/_app/$orgSlug/channels/$channelId/settings")({
	component: RouteComponent,
})

const tabs = [
	{ id: "overview", label: "Overview", to: "/$orgSlug/channels/$channelId/settings" as const },
	{
		id: "integrations",
		label: "Integrations",
		to: "/$orgSlug/channels/$channelId/settings/integrations" as const,
	},
	{
		id: "connect",
		label: "Connect",
		to: "/$orgSlug/channels/$channelId/settings/connect" as const,
	},
]

function RouteComponent() {
	const { orgSlug, channelId } = Route.useParams()
	const matchRoute = useMatchRoute()
	const navigate = useNavigate()

	// Get channel info
	const { data: channelResult } = useLiveQuery({
		query: (q) =>
			q
				.from({ channel: channelCollection })
				.where(({ channel }) => eq(channel.id, channelId as ChannelId))
				.findOne()
				.select(({ channel }) => ({ channel })),
		queryKey: [channelId],
	})
	const channel = channelResult?.channel

	const selectedTab =
		[...tabs].find((tab) =>
			matchRoute({
				to: tab.to,
				params: { orgSlug, channelId },
			}),
		)?.id ?? "overview"

	return (
		<main className="h-full w-full min-w-0 bg-bg">
			<div className="flex h-full min-h-0 w-full flex-col gap-8 overflow-y-auto pt-8 pb-12">
				<div className="flex flex-col gap-5 px-4 lg:px-8">
					{/* Back button and header */}
					<div className="flex flex-col gap-4">
						<Link
							to="/$orgSlug/chat/$id"
							params={{ orgSlug, id: channelId }}
							className="flex items-center gap-2 text-muted-fg text-sm transition-colors hover:text-fg"
						>
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
									d="M10.5 19.5L3 12m0 0l7.5-7.5M3 12h18"
								/>
							</svg>
							Back to channel
						</Link>

						<div className="flex items-center gap-3">
							<div className="flex size-10 items-center justify-center rounded-lg bg-secondary text-xl">
								<ChannelIcon icon={channel?.icon} className="size-5 text-muted-fg" />
							</div>
							<div className="flex flex-col">
								<h1 className="font-semibold text-fg text-xl">
									{channel?.name ?? "Channel"}
								</h1>
								<span className="text-muted-fg text-sm">Channel settings</span>
							</div>
						</div>
					</div>

					{/* Mobile select dropdown */}
					<div className="md:hidden">
						<select
							value={selectedTab}
							onChange={(event) => {
								const tabId = event.target.value
								const tab = tabs.find((t) => t.id === tabId)
								if (tab) {
									navigate({ to: tab.to, params: { orgSlug, channelId } })
								}
							}}
							className="w-full appearance-none rounded-lg border border-input bg-bg px-[calc(--spacing(3.5)-1px)] py-[calc(--spacing(2.5)-1px)] text-base/6 text-fg outline-hidden focus:border-ring/70 focus:ring-3 focus:ring-ring/20 sm:px-[calc(--spacing(3)-1px)] sm:py-[calc(--spacing(1.5)-1px)] sm:text-sm/6"
						>
							{tabs.map((tab) => (
								<option key={tab.id} value={tab.id}>
									{tab.label}
								</option>
							))}
						</select>
					</div>

					{/* Desktop tabs */}
					<div className="scrollbar-hide -mx-4 -my-1 flex w-full max-w-full overflow-x-auto px-4 py-1 lg:-mx-8 lg:px-8">
						<Tabs
							className="max-md:hidden"
							selectedKey={selectedTab}
							onSelectionChange={(value) => {
								const tabId = value as string
								const tab = tabs.find((t) => t.id === tabId)
								if (tab) {
									navigate({ to: tab.to, params: { orgSlug, channelId } })
								}
							}}
						>
							<TabList>
								{tabs.map((tab) => (
									<Tab key={tab.id} id={tab.id}>
										{tab.label}
									</Tab>
								))}
							</TabList>
						</Tabs>
					</div>
				</div>

				<Outlet />
			</div>
		</main>
	)
}

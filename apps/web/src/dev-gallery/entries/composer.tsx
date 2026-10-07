import type { ChannelId, OrganizationId } from "@hazel/schema"
import { and, eq, useLiveQuery } from "@tanstack/react-db"
import {
	createMemoryHistory,
	createRootRoute,
	createRoute,
	createRouter,
	Outlet,
	RouterProvider,
} from "@tanstack/react-router"
import { useMemo } from "react"
import { SlateMessageComposer } from "~/components/chat/slate-editor/slate-message-composer"
import { channelCollection } from "~/db/collections"
import { useAuth } from "~/lib/auth"
import { ChatProvider } from "~/providers/chat-provider"
import { GallerySection } from "../frame"

export const title = "Composer"

/**
 * The real channel composer (`SlateMessageComposer`) for #general. Mention autocomplete reads
 * the channel from the `/_app/$orgSlug/chat/$id` route params, so it renders inside a memory
 * router whose route ids match the app's.
 */
const composerRouter = (orgId: OrganizationId, channelId: ChannelId) => {
	const root = createRootRoute({ component: Outlet })
	const app = createRoute({ getParentRoute: () => root, id: "_app", component: Outlet })
	const org = createRoute({ getParentRoute: () => app, path: "$orgSlug", component: Outlet })
	const chat = createRoute({ getParentRoute: () => org, path: "chat", component: Outlet })
	const channel = createRoute({
		getParentRoute: () => chat,
		path: "$id",
		component: () => (
			<ChatProvider channelId={channelId} organizationId={orgId}>
				<SlateMessageComposer />
			</ChatProvider>
		),
	})
	return createRouter({
		routeTree: root.addChildren([app.addChildren([org.addChildren([chat.addChildren([channel])])])]),
		history: createMemoryHistory({ initialEntries: [`/gallery/chat/${channelId}`] }),
	})
}

function ComposerForChannel({ orgId, channelId }: { orgId: OrganizationId; channelId: ChannelId }) {
	const router = useMemo(() => composerRouter(orgId, channelId), [orgId, channelId])
	return <RouterProvider router={router} />
}

export function Gallery() {
	const { user } = useAuth()
	const orgId = user?.organizationId ?? ""
	const { data: channel } = useLiveQuery(
		(q) =>
			q
				.from({ channel: channelCollection })
				.where(({ channel }) => and(eq(channel.organizationId, orgId), eq(channel.name, "general")))
				.findOne(),
		[orgId],
	)
	return (
		<GallerySection title="Channel composer">
			<div className="w-[640px] pt-80">
				{user?.organizationId && channel ? (
					<ComposerForChannel orgId={user.organizationId} channelId={channel.id} />
				) : null}
			</div>
		</GallerySection>
	)
}

import { OrganizationId } from "@hazel/schema"
import { and, eq, isNull } from "@tanstack/db"
import { Schema, Stream } from "effect"
import { Subscription } from "foldkit"
import { integrationConnectionCollection } from "~/db/collections"
import { liveQueryStream } from "../../../data/live-query"
import type { PageSubscriptionInput } from "../../contract"
import { Message } from "./message"
import type { Model } from "./model"

export const subscriptions = Subscription.make<PageSubscriptionInput<Model>, Message>()((entry) => ({
	// `resolvedThemeAtom` picks the GitHub logo variant; the page contract does not share the theme.
	systemTheme: Subscription.persistent(
		Subscription.fromMediaQuery({
			query: "(prefers-color-scheme: dark)",
			mapMatches: (isDark) => Message.ChangedSystemTheme({ theme: isDark ? "dark" : "light" }),
		}),
	),
	// `useIntegrationConnection(organizationId, "github")`
	gitHubConnection: entry(
		{ organizationId: Schema.NullOr(OrganizationId) },
		{
			modelToDependencies: ({ shared }) => ({ organizationId: shared.organization?.id ?? null }),
			dependenciesToStream: ({ organizationId }) =>
				organizationId === null
					? Stream.empty
					: liveQueryStream<{ readonly status: string }, Message>(
							(q) =>
								q
									.from({ connection: integrationConnectionCollection })
									.where(({ connection }) =>
										and(
											eq(connection.organizationId, organizationId),
											eq(connection.provider, "github"),
											eq(connection.level, "organization"),
											isNull(connection.userId),
											isNull(connection.deletedAt),
										),
									),
							(rows) =>
								Message.UpdatedGitHubConnection({
									isConnected: rows[0]?.status === "active",
								}),
						),
		},
	),
}))

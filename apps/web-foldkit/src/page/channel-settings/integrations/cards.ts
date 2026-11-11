import * as AsyncData from "foldkit/asyncData"
import type { Html, HtmlBuilder } from "foldkit/html"
import { isRetryableReason } from "~/lib/error-messages"
import { IconPlus } from "../../../icons"
import type { ResolvedTheme } from "../../../theme"
import { badge } from "../../../ui/badge"
import { button } from "../../../ui/button"
import { providerLogoUrl } from "./command"
import { Message } from "./message"
import {
	type ChannelRequestFailure,
	channelRequestMessage,
	type GitHubRepo,
	itemsOf,
	type Model,
	type RowKind,
	rowMenuId,
} from "./model"
import { rowMenu } from "./row-menu"

/** Ports of `github-integration-card.tsx`, and `github-subscription-card.tsx`. */

export const spinner = (h: HtmlBuilder<Message>): Html =>
	h.div(
		[h.Class("flex items-center justify-center py-6")],
		[h.div([h.Class("size-5 animate-spin rounded-full border-2 border-muted-fg/30 border-t-primary")])],
	)

export const emptyList = (h: HtmlBuilder<Message>, title: string, hint: string): Html =>
	h.div(
		[h.Class("rounded-lg border border-border border-dashed py-6 text-center")],
		[
			h.p([h.Class("text-muted-fg text-sm")], [title]),
			h.p([h.Class("mt-1 text-muted-fg/70 text-xs")], [hint]),
		],
	)

/** A failed list load: the failure's copy, with Try again for a transient failure. */
const listFailed = (h: HtmlBuilder<Message>, kind: RowKind, reason: ChannelRequestFailure): Html => {
	const message = channelRequestMessage(reason)
	const isRetryable = reason !== "ChannelNotFound" && isRetryableReason(reason)
	return h.div(
		[
			h.Class("flex flex-col items-center gap-2 rounded-lg border border-border py-6 text-center"),
			h.Role("alert"),
		],
		[
			h.p([h.Class("font-medium text-fg text-sm")], [message.title]),
			...(message.description === undefined
				? []
				: [h.p([h.Class("text-muted-fg text-xs")], [message.description])]),
			...(isRetryable
				? [
						button(
							h,
							{ intent: "outline", size: "sm", onPress: Message.ClickedRetryList({ kind }) },
							["Try again"],
						),
					]
				: []),
		],
	)
}

/**
 * A list's body: the spinner on first load, the failure with a retry, the empty state, or the rows. A reload
 * keeps the rows on screen; a failed reload keeps them too, under the failure.
 */
export const listBody = <A>(
	h: HtmlBuilder<Message>,
	kind: RowKind,
	data: AsyncData.AsyncData<ReadonlyArray<A>, ChannelRequestFailure>,
	parts: Readonly<{
		loading: () => Html
		empty: () => Html
		rows: (items: ReadonlyArray<A>) => Html
	}>,
): Html => {
	const loaded = (items: ReadonlyArray<A>) => (items.length === 0 ? parts.empty() : parts.rows(items))
	return AsyncData.match(data, {
		onIdle: parts.loading,
		onLoading: parts.loading,
		onRefreshing: loaded,
		onFailure: (reason) => listFailed(h, kind, reason),
		onStale: ({ error, data: items }) =>
			h.div([h.Class("flex flex-col gap-3")], [listFailed(h, kind, error), loaded(items)]),
		onSuccess: loaded,
	})
}

export const cardTitle = (
	h: HtmlBuilder<Message>,
	name: string,
	extra: ReadonlyArray<Html>,
	description: string,
): Html =>
	h.div(
		[],
		[
			h.div(
				[h.Class("flex items-center gap-2")],
				[h.span([h.Class("font-medium text-fg")], [name]), ...extra],
			),
			h.p([h.Class("text-muted-fg text-sm")], [description]),
		],
	)

export const menuOf = (model: Model, kind: "rss" | "github", id: string) =>
	model.rowMenus.find((menu) => menu.id === rowMenuId(kind, id))

// GITHUB

/** Dark UI gets the light logo and vice versa. */
const gitHubLogo = (resolved: ResolvedTheme) =>
	providerLogoUrl("github.com", "symbol", resolved === "dark" ? "light" : "dark")

const EVENT_LABELS: Readonly<Record<string, string>> = {
	push: "Push",
	pull_request: "Pull Requests",
	issues: "Issues",
	release: "Releases",
	deployment_status: "Deployments",
	workflow_run: "Workflows",
	star: "Stars",
}

const gitHubItem = (h: HtmlBuilder<Message>, model: Model, repo: GitHubRepo, logo: string): Html => {
	const labels = repo.enabledEvents.map((event) => EVENT_LABELS[event] ?? event)
	const remaining = repo.enabledEvents.length - 3
	return h.keyed("div")(
		repo.id,
		[
			h.Class(
				"group flex items-center gap-3 rounded-lg border border-border bg-bg p-3 transition-all hover:border-border-hover hover:bg-bg-muted/50 hover:shadow-sm",
			),
		],
		[
			h.img([h.Src(logo), h.Alt("GitHub"), h.Class("size-8 rounded-full object-cover")]),
			h.div(
				[h.Class("min-w-0 flex-1")],
				[
					h.div(
						[h.Class("flex items-center gap-2")],
						[
							h.span(
								[h.Class("truncate font-medium text-fg text-sm")],
								[repo.repositoryFullName],
							),
							badge(
								h,
								{ intent: repo.isEnabled ? "success" : "secondary", className: "shrink-0" },
								[repo.isEnabled ? "Active" : "Disabled"],
							),
						],
					),
					h.div(
						[h.Class("flex items-center gap-2 text-muted-fg text-xs")],
						[
							h.span(
								[h.Class("truncate")],
								[
									labels.slice(0, 3).join(", "),
									...(remaining > 0 ? [` +${remaining} more`] : []),
								],
							),
							...(repo.branchFilter
								? [
										h.span([h.Class("text-muted-fg/50")], ["·"]),
										h.span([h.Class("font-mono")], [repo.branchFilter]),
									]
								: []),
						],
					),
				],
			),
			h.div(
				[h.Class("flex shrink-0 items-center gap-1")],
				[
					rowMenu(h, {
						kind: "github",
						id: repo.id,
						menu: menuOf(model, "github", repo.id),
						isEnabled: repo.isEnabled,
						isToggling: model.togglingRowIds.includes(repo.id),
						triggerClassName: "text-muted-fg",
						labels: { enable: "Enable", disable: "Disable", remove: "Remove" },
					}),
				],
			),
		],
	)
}

/** `resolvedThemeAtom` picks the GitHub logo variant (`Shared.theme.resolved`). */
export const gitHubCard = (h: HtmlBuilder<Message>, model: Model, resolved: ResolvedTheme): Html => {
	const logoSrc = gitHubLogo(resolved)
	const logo = h.img([h.Src(logoSrc), h.Alt("GitHub"), h.Class("size-10 rounded-lg")])
	const description = "Receive repository events in this channel"
	if (!model.isGitHubConnected)
		return h.div(
			[h.Class("rounded-xl border border-border bg-bg p-4")],
			[
				h.div(
					[h.Class("flex items-center justify-between")],
					[
						h.div(
							[h.Class("flex items-center gap-3")],
							[logo, cardTitle(h, "GitHub", [], description)],
						),
						button(
							h,
							{ intent: "secondary", size: "sm", onPress: Message.ClickedConnectGitHub() },
							["Connect GitHub"],
						),
					],
				),
			],
		)
	const repos = itemsOf(model.github)
	return h.div(
		[h.Class("rounded-xl border border-border bg-bg")],
		[
			h.div(
				[h.Class("flex items-center justify-between border-border border-b p-4")],
				[
					h.div(
						[h.Class("flex items-center gap-3")],
						[
							logo,
							cardTitle(
								h,
								"GitHub",
								repos.length > 0
									? [badge(h, { intent: "success" }, [`${repos.length}`, " repos"])]
									: [],
								description,
							),
						],
					),
					button(h, { intent: "primary", size: "sm", onPress: Message.ClickedAddRepo() }, [
						IconPlus(h, { className: "size-4" }),
						"Add Repo",
					]),
				],
			),
			h.div(
				[h.Class("p-4")],
				[
					listBody(h, "github", model.github.data, {
						loading: () => spinner(h),
						empty: () =>
							emptyList(
								h,
								"No repositories subscribed",
								"Add a repository to receive events in this channel",
							),
						rows: (items) =>
							h.div(
								[h.Class("flex flex-col gap-2")],
								items.map((repo) => gitHubItem(h, model, repo, logoSrc)),
							),
					}),
				],
			),
		],
	)
}

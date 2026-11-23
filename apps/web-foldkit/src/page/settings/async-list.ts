import * as AsyncData from "foldkit/asyncData"
import type { Html, HtmlBuilder } from "foldkit/html"
import { type CommonReason, commonMessage, isRetryableReason } from "~/lib/error-messages"
import { IconWarning } from "../../icons"
import { button } from "../../ui/button"
import { callout } from "../../ui/callout"
import { emptyState } from "../../ui/empty-state"
import { loadingState } from "../../ui/loader"

/**
 * The body of a settings card that lists fetched records (pending invitations, connect invites):
 * a spinner while the first load runs, the reason when it fails, and once loaded the rows, with a
 * notice above them when a refetch fails.
 */
export const asyncListBody = <A, M>(
	h: HtmlBuilder<M>,
	data: AsyncData.AsyncData<A, CommonReason>,
	options: Readonly<{
		/** `Loading invitations...` */
		loadingLabel: string
		/** `Couldn't load invitations` */
		failedTitle: string
		onRetry: M
		loaded: (data: A) => Html
	}>,
): Html => {
	const retryButton = (reason: CommonReason): ReadonlyArray<Html> =>
		isRetryableReason(reason)
			? [button(h, { intent: "secondary", size: "sm", onPress: options.onRetry }, ["Try again"])]
			: []
	const loading = () => loadingState(h, { label: options.loadingLabel, className: "h-64" })
	return AsyncData.match(data, {
		onIdle: loading,
		onLoading: loading,
		onFailure: (reason) => {
			const message = commonMessage(reason)
			return emptyState(h, {
				icon: (className) => IconWarning(h, { className }),
				title: options.failedTitle,
				description: message.description ?? message.title,
				action: retryButton(reason),
				className: "h-64",
			})
		},
		onRefreshing: options.loaded,
		onStale: ({ error, data: stale }) =>
			h.div(
				[],
				[
					callout(h, { intent: "danger", actions: retryButton(error), className: "m-4" }, [
						`Couldn't refresh: ${commonMessage(error).title}`,
					]),
					options.loaded(stale),
				],
			),
		onSuccess: options.loaded,
	})
}

/**
 * Connecting a Gmail mailbox to Customers (`docs/customers/gmail.md`): Google's OAuth consent, in
 * two browser navigations. Both answer redirects, so the web app navigates to `authorize` (it is
 * not fetched).
 *
 * - `authorize`: the signed-in member asks to connect their mailbox to `organizationId`'s
 *   Customers; answered with a redirect to Google's consent screen (scope `gmail.readonly`).
 * - `callback`: Google sends the browser back here; the mailbox is connected (or reconnected) in
 *   the org's `CustomersObject` and the browser lands on the Gmail data source page with
 *   `?gmail=connected`, or `?gmail=error&reason=<code>`.
 */
import { OrganizationId } from "@hazel/schema"
import { Schema } from "effect"
import { HttpApiEndpoint, HttpApiGroup, HttpApiSchema, OpenApi } from "effect/http-api"
import * as CurrentUser from "../current-user"
import { InternalServerError, UnauthorizedError } from "../errors"
import { RequiredScopes } from "../scopes/required-scopes"

/**
 * Why a connect did not go through (`?gmail=error&reason=`):
 *
 * - `not_configured`: the server has no Google OAuth client (`GOOGLE_GMAIL_CLIENT_ID`/`_SECRET`).
 * - `denied`: the person cancelled on Google's screen.
 * - `scope_missing`: they did not grant read access to their mail.
 * - `invalid_state`: the flow expired (15 minutes) or was started in another browser.
 * - `token_exchange_failed`, `profile_failed`: Google refused or could not be reached.
 * - `forbidden`: the person is not a member of the organization (any longer).
 * - `failed`: storing the connection failed.
 */
export const GmailConnectErrorReason = Schema.Literals([
	"not_configured",
	"denied",
	"scope_missing",
	"invalid_state",
	"token_exchange_failed",
	"profile_failed",
	"forbidden",
	"failed",
])
export type GmailConnectErrorReason = typeof GmailConnectErrorReason.Type

export class CustomersGmailGroup extends HttpApiGroup.make("customersGmail")
	.add(
		HttpApiEndpoint.get("authorize", "/authorize", {
			query: { organizationId: OrganizationId },
			success: Schema.Void.pipe(HttpApiSchema.status(302)),
			error: [UnauthorizedError, InternalServerError],
		})
			.middleware(CurrentUser.Authorization)
			.annotateMerge(
				OpenApi.annotations({
					title: "Connect a Gmail mailbox",
					description:
						"Redirects the signed-in member to Google's consent screen to connect their mailbox to the organization's Customers. Navigate the browser here.",
					summary: "Start Gmail OAuth",
				}),
			)
			.annotate(RequiredScopes, ["customers:write"]),
	)
	.add(
		HttpApiEndpoint.get("callback", "/callback", {
			query: {
				code: Schema.optional(Schema.String),
				state: Schema.optional(Schema.String),
				/** Google's refusal, e.g. `access_denied`. */
				error: Schema.optional(Schema.String),
				scope: Schema.optional(Schema.String),
			},
			success: Schema.Void.pipe(HttpApiSchema.status(302)),
			error: [InternalServerError],
		})
			.annotateMerge(
				OpenApi.annotations({
					title: "Gmail OAuth callback",
					description:
						"Google's redirect after consent; connects the mailbox and redirects to the app.",
					summary: "Gmail OAuth callback",
				}),
			)
			.annotate(RequiredScopes, []),
	)
	.prefix("/customers/gmail") {}

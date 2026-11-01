// @vitest-environment jsdom
import { OrganizationId } from "@hazel/schema"
import { Option, Schema } from "effect"
import { fromString } from "foldkit/url"
import { Command, expectNoOutMessage, expectOutMessage, given, message, model, story } from "foldkit/story"
import { describe, expect, test } from "vitest"
import { makeShared, uuid } from "../../test/pages-fixtures"
import { PageOutMessage } from "../out-message"
import { enterRoute } from "../registry"
import { Message } from "./message"
import type { UserOrganization } from "./model"
import { hrefOf, organizationHref, routeOfPath, urlToAppRoute } from "../../route"
import { init, update } from "./update"

/** `/select-organization`: a single organization redirects once; otherwise the user picks. */

const org = (n: number, slug: string | null): UserOrganization => ({
	id: Schema.decodeSync(OrganizationId)(uuid(n)),
	name: `Org ${n}`,
	slug,
	logoUrl: null,
	role: "member",
})
const hazel = org(1, "hazel")
const unfinished = org(2, null)
const navigation = (href: string) =>
	PageOutMessage.RequestedNavigation({ route: routeOfPath(href), replace: false })

describe("select organization", () => {
	test("a single organization redirects once, even when the live query re-emits", () => {
		story(
			update,
			given(init().model),
			message(Message.UpdatedOrganizations({ organizations: [hazel] })),
			expectOutMessage(navigation("/hazel")),
			model((current) => expect(current.organizations._tag).toBe("Redirected")),
			message(Message.UpdatedOrganizations({ organizations: [hazel] })),
			expectNoOutMessage(),
			Command.expectNone(),
		)
	})

	test("an organization without a slug goes to its setup", () => {
		expect(organizationHref(unfinished)).toBe(`/onboarding/setup-organization?orgId=${unfinished.id}`)
		story(
			update,
			given(init().model),
			message(Message.UpdatedOrganizations({ organizations: [unfinished] })),
			expectOutMessage(navigation(organizationHref(unfinished))),
		)
	})

	test("several organizations wait for a pick; Create a new one opens the workspace form", () => {
		story(
			update,
			given(init().model),
			message(Message.UpdatedOrganizations({ organizations: [hazel, unfinished] })),
			expectNoOutMessage(),
			model((current) =>
				expect(current.organizations).toMatchObject({
					_tag: "Loaded",
					organizations: [hazel, unfinished],
				}),
			),
			message(Message.ClickedOrganization({ organization: hazel })),
			expectOutMessage(navigation("/hazel")),
			message(Message.ClickedCreateNew()),
			expectOutMessage(navigation("/onboarding/setup-organization")),
		)
	})

	// Anyone on the picker is onboarded. `/onboarding` sent them straight back to `/` and into an
	// organization, so "Create a new one" never reached a form.
	test("Create a new one lands on a page that keeps an onboarded user", () => {
		const onboarded = makeShared()
		const picked = update(
			update(init().model, Message.UpdatedOrganizations({ organizations: [hazel, unfinished] })).model,
			Message.ClickedCreateNew(),
		)
		const href = picked.outMessage?._tag === "RequestedNavigation" ? hrefOf(picked.outMessage.route) : ""
		const route = Option.match(fromString(`http://localhost${href}`), {
			onNone: () => expect.unreachable(`unparseable ${href}`),
			onSome: urlToAppRoute,
		})
		expect(route._tag).toBe("OnboardingSetupOrganization")
		const entered = enterRoute(null, route, onboarded)
		expect(entered.slot?._tag).toBe("OnboardingSetupOrganization")
		expect(Option.isNone(entered.outMessage)).toBe(true)
	})
})

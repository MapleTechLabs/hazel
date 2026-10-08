// @vitest-environment jsdom
import { OrganizationId } from "@hazel/schema"
import { Schema } from "effect"
import { Command, expectNoOutMessage, expectOutMessage, given, message, model, story } from "foldkit/story"
import { describe, expect, test } from "vitest"
import { uuid } from "../../test/pages-fixtures"
import { PageOutMessage } from "../out-message"
import { Message } from "./message"
import type { UserOrganization } from "./model"
import { init, organizationHref, update } from "./update"

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
const navigation = (href: string) => PageOutMessage.RequestedNavigation({ href, replace: false })

describe("select organization", () => {
	test("a single organization redirects once, even when the live query re-emits", () => {
		story(
			update,
			given(init().model),
			message(Message.UpdatedOrganizations({ organizations: [hazel] })),
			expectOutMessage(navigation("/hazel")),
			model((current) => expect(current.hasRedirected).toBe(true)),
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

	test("several organizations wait for a pick; Create a new one starts onboarding", () => {
		story(
			update,
			given(init().model),
			message(Message.UpdatedOrganizations({ organizations: [hazel, unfinished] })),
			expectNoOutMessage(),
			model((current) => expect(current.organizations).toHaveLength(2)),
			message(Message.ClickedOrganization({ organization: hazel })),
			expectOutMessage(navigation("/hazel")),
			message(Message.ClickedCreateNew()),
			expectOutMessage(navigation("/onboarding")),
		)
	})
})

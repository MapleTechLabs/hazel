// @vitest-environment jsdom
import { OrganizationId } from "@hazel/schema"
import { Schema } from "effect"
import { given, message, model, story } from "foldkit/story"
import { describe, expect, test } from "vitest"
import { ada, hazelOrg } from "../test/root-fixtures"
import { Message, type Model } from "./model"
import { type Context, informContext, init, update } from "./update"

/** What the Foldkit shell still owns: the user's organizations. */

const context: Context = { organizationId: hazelOrg.id, currentUserId: ada.id }
const run = (model: Model, msg: Message) => update(model, msg)
const ready = informContext(init(), context)

const otherOrgId = Schema.decodeSync(OrganizationId)("00000000-0000-4000-8000-0000000000a2")

describe("organizations", () => {
	test("the user's organizations land in the Model, for the next and previous keys", () => {
		const organizations = [
			{ id: hazelOrg.id, name: "Hazel", slug: "hazel", logoUrl: null },
			{ id: otherOrgId, name: "Acme", slug: "acme", logoUrl: null },
		]
		story(
			run,
			given(ready),
			message(Message.UpdatedUserOrganizations({ organizations })),
			model((m) => expect(m.userOrganizations).toEqual(organizations)),
		)
	})
})

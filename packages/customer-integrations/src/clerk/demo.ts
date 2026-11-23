import type { DemoScope, DirectoryDemo } from "../kit/demo"

const INSTANCES = {
	seed: "apps/app_demo/instances/ins_demo",
	lab: "apps/app_hazel/instances/ins_prod",
	gallery: "apps/app_1/instances/ins_1",
} satisfies Record<DemoScope, string>

const dashboard = (scope: DemoScope) => `https://dashboard.clerk.com/${INSTANCES[scope]}`

export const demo: DirectoryDemo = {
	role: "directory",
	accountId: (sequence) => `org_${sequence}`,
	contactId: (sequence) => `user_${sequence}`,
	adminRole: "org:admin",
	memberRole: "org:member",
	accountUrl: (externalId, scope) => `${dashboard(scope)}/organizations/${externalId}`,
	contactUrl: (externalId) => `${dashboard("seed")}/users/${externalId}`,
	logoUrl: (externalId) => `https://img.clerk.com/demo/${externalId}.png`,
}

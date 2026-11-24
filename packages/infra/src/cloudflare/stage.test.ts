import { describe, expect, it } from "vitest"
import {
	formatHazelStage,
	isProductionStage,
	parseHazelStage,
	resolveDeploymentEnvironment,
	resolveHazelDomains,
	resolveWorkerName,
} from "./stage.ts"

describe("parseHazelStage", () => {
	it("parses each stage kind", () => {
		expect(parseHazelStage("prd")).toEqual({ kind: "prd" })
		expect(parseHazelStage("pr-12")).toEqual({ kind: "pr", prNumber: 12 })
		expect(parseHazelStage("customer-acme")).toEqual({ kind: "customer", name: "acme" })
		expect(parseHazelStage("Customer-Acme-EU")).toEqual({ kind: "customer", name: "acme-eu" })
		expect(parseHazelStage("dev_david")).toEqual({ kind: "dev", name: "dev-david" })
	})

	it("keeps an underscored customer-like name a dev stage", () => {
		// `customer_x` is not the customer form: only `customer-<name>` makes a production install.
		expect(parseHazelStage("customer_x")).toEqual({ kind: "dev", name: "customer-x" })
	})

	it("round-trips through formatHazelStage", () => {
		for (const raw of ["prd", "pr-3", "customer-acme", "dev-david"]) {
			expect(formatHazelStage(parseHazelStage(raw))).toBe(raw)
		}
	})
})

describe("customer stages", () => {
	const stage = parseHazelStage("customer-acme")

	it("are production", () => {
		expect(isProductionStage(stage)).toBe(true)
		expect(isProductionStage({ kind: "prd" })).toBe(true)
		expect(isProductionStage({ kind: "pr", prNumber: 1 })).toBe(false)
		expect(isProductionStage({ kind: "dev", name: "x" })).toBe(false)
	})

	it("hang every host off their zone", () => {
		expect(resolveHazelDomains(stage, "chat.acme.com")).toEqual({
			web: "app.chat.acme.com",
			api: "api.chat.acme.com",
			linkPreview: "link-preview.chat.acme.com",
			botGateway: "bot-gateway.chat.acme.com",
			cdn: "cdn.chat.acme.com",
			mail: "mail.chat.acme.com",
			inboundMail: "inbound.chat.acme.com",
		})
		expect(resolveHazelDomains(stage)).toEqual({})
	})

	it("never take Hazel's own hosts or names", () => {
		const domains = Object.values(resolveHazelDomains(stage, "chat.acme.com"))
		expect(domains.some((domain) => domain?.endsWith("hazel.sh"))).toBe(false)
		expect(resolveWorkerName("web", stage)).toBe("hazel-web-acme")
		expect(resolveWorkerName("web", { kind: "prd" })).toBe("hazel-app")
		expect(resolveDeploymentEnvironment(stage)).toBe("customer-acme")
	})
})

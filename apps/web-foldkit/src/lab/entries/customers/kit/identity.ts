import type { CustomerSource } from "@hazel/domain/customers"
import { defineStaticLab } from "../../../define"
import { labPage, labRow, labSection } from "../../../frame"
import {
	avatarStack,
	companyLogo,
	personAvatar,
	personLabel,
	sourceChip,
	sourceLinkChip,
	sourceMark,
} from "../../../../customers/ui/identity"
import { DANA, JONAS, MAYA, PRIYA } from "../../../fixtures/customers"

// `/lab/customers/kit/identity`: Foundations › Source Chips, Avatars And Company Logos.

const SOURCES: ReadonlyArray<CustomerSource> = ["clerk", "stripe", "autumn", "maple", "hazel"]

export const lab = defineStaticLab("Identity", (h) =>
	labPage(h, { title: "Logos, avatars and sources" }, [
		labSection(h, "User avatar", [
			labRow(h, [
				personAvatar(h, MAYA),
				personAvatar(h, JONAS, { size: "md" }),
				personAvatar(h, null, { size: "md" }),
				avatarStack(h, [MAYA, DANA, JONAS, PRIYA, { name: "Eli Novak" }]),
				personLabel(h, MAYA),
				personLabel(h, null),
			]),
		]),
		labSection(h, "Company logo placeholder", [
			labRow(
				h,
				[
					companyLogo(h, { name: "Northwind Labs", size: "xs" }),
					companyLogo(h, { name: "Northwind Labs", size: "sm" }),
					companyLogo(h, { name: "Northwind Labs", size: "md" }),
					companyLogo(h, { name: "Northwind Labs", size: "lg" }),
				],
				"20 · 28 · 40 · 48",
			),
			labRow(
				h,
				[
					"Northwind Labs",
					"Acme Robotics",
					"Brightfield Analytics",
					"Kestrel Systems",
					"Oakridge Logistics",
					"Pinecone Studio",
				].map((name) => companyLogo(h, { name })),
				"Tint picked by hash of the name",
			),
			labRow(h, [companyLogo(h, { name: "Hazel", logoUrl: "/icon.svg", size: "md" })], "With a logo"),
		]),
		labSection(h, "Source chip", [
			labRow(
				h,
				SOURCES.map((source) => sourceChip(h, source)),
			),
			labRow(
				h,
				[
					sourceLinkChip(h, {
						source: "stripe",
						label: "cus_Q8f2Lk",
						href: "https://dashboard.stripe.com/customers/cus_Q8f2Lk",
					}),
				],
				"Links out to the provider record",
			),
			labRow(
				h,
				SOURCES.map((source) => sourceMark(h, source)),
				"Mark tiles for timelines and cards",
			),
		]),
	]),
)

import { defineCollection } from "astro:content"
import { glob } from "astro/loaders"
import { z } from "astro/zod"

// Changelog types
export const changeTypes = [
	"feature",
	"fix",
	"improvement",
	"breaking",
	"security",
	"deprecated",
	"performance",
] as const

export type ChangeType = (typeof changeTypes)[number]

const changeItemSchema = z.object({
	type: z.enum(changeTypes),
	title: z.string(),
	description: z.string().optional(),
	link: z.string().url().optional(),
	code: z.string().optional(),
})

export type ChangeItem = z.infer<typeof changeItemSchema>

const changelogCollection = defineCollection({
	loader: glob({ pattern: "**/*.md", base: "./src/content/changelog" }),
	schema: z.object({
		week: z.string(),
		date: z.date(),
		title: z.string().optional(),
		summary: z.string(),
		isMajor: z.boolean().default(false),
		changes: z.array(changeItemSchema),
		author: z.string().optional(),
		draft: z.boolean().default(false),
	}),
})

// Integration types
export const integrationCategories = [
	"communication",
	"devops",
	"analytics",
	"productivity",
	"storage",
	"ai",
	"project-management",
	"crm",
	"other",
] as const

export type IntegrationCategory = (typeof integrationCategories)[number]

export const integrationStatuses = ["available", "beta", "coming-soon"] as const

export type IntegrationStatus = (typeof integrationStatuses)[number]

const integrationFeatureSchema = z.object({
	title: z.string(),
	description: z.string(),
	icon: z.string().optional(),
})

export type IntegrationFeature = z.infer<typeof integrationFeatureSchema>

const integrationUseCaseSchema = z.object({
	title: z.string(),
	description: z.string(),
	image: z.string().optional(),
})

export type IntegrationUseCase = z.infer<typeof integrationUseCaseSchema>

const integrationFAQSchema = z.object({
	question: z.string(),
	answer: z.string(),
})

export type IntegrationFAQ = z.infer<typeof integrationFAQSchema>

const ctaButtonSchema = z.object({
	text: z.string(),
	href: z.string(),
})

export type CTAButton = z.infer<typeof ctaButtonSchema>

const integrationCollection = defineCollection({
	loader: glob({ pattern: "**/*.md", base: "./src/content/integrations" }),
	schema: z.object({
		name: z.string(),
		logo: z.string(),
		tagline: z.string(),
		description: z.string(),
		category: z.enum(integrationCategories),
		status: z.enum(integrationStatuses).default("available"),
		featured: z.boolean().default(false),
		features: z.array(integrationFeatureSchema).min(3).max(8),
		useCases: z.array(integrationUseCaseSchema).min(2).max(6),
		faqs: z.array(integrationFAQSchema).min(3).max(10),
		primaryCta: ctaButtonSchema,
		secondaryCta: ctaButtonSchema.optional(),
		metaTitle: z.string().optional(),
		metaDescription: z.string().max(160).optional(),
		draft: z.boolean().default(false),
	}),
})

export const collections = {
	changelog: changelogCollection,
	integrations: integrationCollection,
}

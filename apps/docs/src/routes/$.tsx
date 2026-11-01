import { createFileRoute, notFound } from "@tanstack/react-router"
import { DocsLayout } from "fumadocs-ui/layouts/docs"
import { createServerFn } from "@tanstack/react-start"
import { source, getPageImage } from "@/lib/source"
import browserCollections from "fumadocs-mdx:collections/browser"
import { DocsBody, DocsDescription, DocsPage, DocsTitle } from "fumadocs-ui/layouts/docs/page"
import defaultMdxComponents from "fumadocs-ui/mdx"
import { baseOptions } from "@/lib/layout.shared"
import { useFumadocsLoader } from "fumadocs-core/source/client"
import { Tabs, Tab } from "fumadocs-ui/components/tabs"
import { Step, Steps } from "fumadocs-ui/components/steps"
import { File, Folder, Files } from "fumadocs-ui/components/files"
import { TypeTable } from "fumadocs-ui/components/type-table"
import { Accordion, Accordions } from "fumadocs-ui/components/accordion"
import { ImageZoom } from "fumadocs-ui/components/image-zoom"
import { LLMCopyButton, ViewOptions } from "@/components/page-actions"

type LoaderData = {
	path: string
	url: string
	title: string | undefined
	description: string | undefined
	ogImage: string
	pageTree: object
}

export const Route = createFileRoute("/$")({
	component: Page,
	head: ({ loaderData }) => {
		const data = loaderData as LoaderData | undefined
		return {
			meta: [
				{ title: data?.title ? `${data.title} | Hazel Docs` : "Hazel Docs" },
				{ name: "description", content: data?.description ?? "" },
				{ property: "og:title", content: data?.title ?? "Hazel Docs" },
				{ property: "og:description", content: data?.description ?? "" },
				{ property: "og:image", content: data?.ogImage ?? "" },
				{ property: "og:type", content: "article" },
				{ name: "twitter:card", content: "summary_large_image" },
				{ name: "twitter:title", content: data?.title ?? "Hazel Docs" },
				{ name: "twitter:description", content: data?.description ?? "" },
				{ name: "twitter:image", content: data?.ogImage ?? "" },
			],
		}
	},
	// @ts-expect-error TanStack Router type inference issue with head + loader
	loader: async ({ params }): Promise<LoaderData> => {
		const slugs = params._splat?.split("/") ?? []
		const data = await serverLoader({ data: slugs })
		await clientLoader.preload(data.path)
		return data
	},
})

const serverLoader = createServerFn({
	method: "GET",
})
	.inputValidator((slugs: string[]) => slugs)
	.handler(async ({ data: slugs }) => {
		const page = source.getPage(slugs)
		if (!page) throw notFound()

		return {
			path: page.path,
			url: page.url,
			title: page.data.title,
			description: page.data.description,
			ogImage: getPageImage(page).url,
			pageTree: await source.serializePageTree(source.getPageTree()),
		}
	})

const clientLoader = browserCollections.docs.createClientLoader({
	component({ toc, frontmatter, default: MDX }) {
		const data = Route.useLoaderData() as LoaderData

		return (
			<DocsPage toc={toc}>
				<DocsTitle>{frontmatter.title}</DocsTitle>
				<DocsDescription>{frontmatter.description}</DocsDescription>
				<div className="flex flex-row gap-2 items-center border-b pt-2 pb-6">
					<LLMCopyButton markdownUrl={`${data.url}.mdx`} />
					<ViewOptions
						markdownUrl={`${data.url}.mdx`}
						githubUrl={`https://github.com/MapleTechLabs/hazel/blob/main/apps/docs/content/docs/${data.path}`}
					/>
				</div>
				<DocsBody>
					<MDX
						components={{
							...defaultMdxComponents,
							Tabs,
							Tab,
							Step,
							Steps,
							File,
							Folder,
							Files,
							TypeTable,
							Accordion,
							Accordions,
							img: (props) => <ImageZoom {...props} />,
						}}
					/>
				</DocsBody>
			</DocsPage>
		)
	},
})

function Page() {
	const data = Route.useLoaderData() as LoaderData
	const { pageTree } = useFumadocsLoader(data)
	const Content = clientLoader.getComponent(data.path)

	return (
		<DocsLayout {...baseOptions()} tree={pageTree} githubUrl="https://github.com/MapleTechLabs/hazel">
			<Content />
		</DocsLayout>
	)
}

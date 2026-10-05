import { AsyncResult } from "effect/reactivity"
import { useAtomValue } from "@effect/atom-react"
import type { User } from "@hazel/domain/models"
import { useState } from "react"
import { type EnrichedTweet, enrichTweet } from "react-tweet"
import { LinkPreviewClient } from "~/lib/services/common/link-preview-client"
import { ImageViewerModal, type ViewerImage } from "./chat/image-viewer-modal"
import IconHeart from "./icons/icon-heart"

function truncate(str: string | null, length: number) {
	if (!str || str.length <= length) return str
	return `${str.slice(0, length - 3)}...`
}

function TweetSkeleton() {
	return (
		<div className="mt-2 flex max-w-sm flex-col gap-2 rounded-lg border border-fg/15 bg-muted/40 p-4">
			<div className="flex flex-row gap-2">
				<div className="size-10 shrink-0 animate-pulse rounded-full bg-muted" />
				<div className="h-10 w-full animate-pulse rounded bg-muted" />
			</div>
			<div className="h-20 w-full animate-pulse rounded bg-muted" />
		</div>
	)
}

function TweetNotFound() {
	return (
		<div className="mt-2 flex max-w-sm flex-col items-center justify-center gap-2 rounded-lg border border-fg/15 bg-muted/40 p-4">
			<div className="text-muted-fg text-sm">Tweet not found</div>
		</div>
	)
}

const TwitterIcon = ({ className }: { className?: string }) => (
	<svg
		stroke="currentColor"
		fill="currentColor"
		strokeWidth="0"
		viewBox="0 0 24 24"
		height="1em"
		width="1em"
		xmlns="http://www.w3.org/2000/svg"
		className={className}
	>
		<g>
			<path fill="none" d="M0 0h24v24H0z" />
			<path d="M22.162 5.656a8.384 8.384 0 0 1-2.402.658A4.196 4.196 0 0 0 21.6 4c-.82.488-1.719.83-2.656 1.015a4.182 4.182 0 0 0-7.126 3.814 11.874 11.874 0 0 1-8.62-4.37 4.168 4.168 0 0 0-.566 2.103c0 1.45.738 2.731 1.86 3.481a4.168 4.168 0 0 1-1.894-.523v.052a4.185 4.185 0 0 0 3.355 4.101 4.21 4.21 0 0 1-1.89.072A4.185 4.185 0 0 0 7.97 16.65a8.394 8.394 0 0 1-6.191 1.732 11.83 11.83 0 0 0 6.41 1.88c7.693 0 11.9-6.373 11.9-11.9 0-.18-.005-.362-.013-.54a8.496 8.496 0 0 0 2.087-2.165z" />
		</g>
	</svg>
)

const VerifiedIcon = ({ className }: { className?: string }) => (
	<svg aria-label="Verified Account" viewBox="0 0 24 24" className={className}>
		<g fill="currentColor">
			<path d="M22.5 12.5c0-1.58-.875-2.95-2.148-3.6.154-.435.238-.905.238-1.4 0-2.21-1.71-3.998-3.818-3.998-.47 0-.92.084-1.336.25C14.818 2.415 13.51 1.5 12 1.5s-2.816.917-3.437 2.25c-.415-.165-.866-.25-1.336-.25-2.11 0-3.818 1.79-3.818 4 0 .494.083.964.237 1.4-1.272.65-2.147 2.018-2.147 3.6 0 1.495.782 2.798 1.942 3.486-.02.17-.032.34-.032.514 0 2.21 1.708 4 3.818 4 .47 0 .92-.086 1.335-.25.62 1.334 1.926 2.25 3.437 2.25 1.512 0 2.818-.916 3.437-2.25.415.163.865.248 1.336.248 2.11 0 3.818-1.79 3.818-4 0-.174-.012-.344-.033-.513 1.158-.687 1.943-1.99 1.943-3.484zm-6.616-3.334l-4.334 6.5c-.145.217-.382.334-.625.334-.143 0-.288-.04-.416-.126l-.115-.094-2.415-2.415c-.293-.293-.293-.768 0-1.06s.768-.294 1.06 0l1.77 1.767 3.825-5.74c.23-.345.696-.436 1.04-.207.346.23.44.696.21 1.04z" />
		</g>
	</svg>
)

function TweetHeader({ tweet }: { tweet: EnrichedTweet }) {
	return (
		<div className="flex flex-row justify-between">
			<div className="flex items-center space-x-2">
				<a href={tweet.user.url} target="_blank" rel="noreferrer">
					<img
						alt={tweet.user.screen_name}
						height={48}
						width={48}
						src={tweet.user.profile_image_url_https}
						className="size-10 overflow-hidden rounded-full border border-fg/15"
					/>
				</a>
				<div>
					<a
						href={tweet.user.url}
						target="_blank"
						rel="noreferrer"
						className="flex items-center whitespace-nowrap font-semibold text-sm hover:underline"
					>
						{truncate(tweet.user.name, 20)}
						{(tweet.user.verified || tweet.user.is_blue_verified) && (
							<VerifiedIcon className="ml-1 inline size-4 text-verified" />
						)}
					</a>
					<div className="flex items-center space-x-1">
						<a
							href={tweet.user.url}
							target="_blank"
							rel="noreferrer"
							className="text-fg/70 text-sm hover:underline"
						>
							@{truncate(tweet.user.screen_name, 16)}
						</a>
					</div>
				</div>
			</div>
			<a href={tweet.url} target="_blank" rel="noreferrer">
				<span className="sr-only">Link to tweet</span>
				<TwitterIcon className="size-5 items-start text-[#3BA9EE] transition-all hover:scale-105" />
			</a>
		</div>
	)
}

function TweetBody({ tweet }: { tweet: EnrichedTweet }) {
	return (
		<div className="wrap-break-word leading-normal tracking-tighter">
			{tweet.entities.map((entity, idx) => {
				switch (entity.type) {
					case "url":
					case "symbol":
					case "hashtag":
					case "mention":
						return (
							<a
								key={idx}
								href={entity.href}
								target="_blank"
								rel="noopener noreferrer"
								className="text-primary-subtle-fg text-sm hover:underline"
							>
								<span>{entity.text}</span>
							</a>
						)
					case "text":
						return (
							<span key={idx} className="text-fg text-sm">
								{entity.text}
							</span>
						)
					default:
						return null
				}
			})}
		</div>
	)
}

function TweetMedia({
	tweet,
	onPhotoClick,
}: {
	tweet: EnrichedTweet
	onPhotoClick?: (index: number) => void
}) {
	if (!tweet.video && !tweet.photos) return null

	return (
		<div className="flex flex-1 items-center justify-center">
			{tweet.video?.variants && tweet.video.variants.length > 0 && (
				<video
					poster={tweet.video.poster}
					autoPlay
					loop
					muted
					playsInline
					className="rounded-lg border border-fg/15 shadow-sm"
				>
					<source src={tweet.video.variants[0]!.src} type="video/mp4" />
					Your browser does not support the video tag.
				</video>
			)}
			{tweet.photos && (
				<div className="relative flex transform-gpu snap-x snap-mandatory gap-4 overflow-x-auto">
					<div className="shrink-0 snap-center sm:w-2" />
					{tweet.photos.map((photo, index) => (
						<button
							key={photo.url}
							type="button"
							onClick={() => onPhotoClick?.(index)}
							className="h-64 w-5/6 shrink-0 snap-center snap-always"
						>
							<img
								src={photo.url}
								width={photo.width}
								height={photo.height}
								alt={tweet.text}
								className="size-full rounded-lg border border-fg/15 object-cover shadow-sm transition-opacity hover:opacity-90"
							/>
						</button>
					))}
					<div className="shrink-0 snap-center sm:w-2" />
				</div>
			)}
		</div>
	)
}

type TweetWithMetrics = EnrichedTweet & {
	reply_count?: number
	retweet_count?: number
}

function TweetMetrics({ tweet }: { tweet: EnrichedTweet }) {
	// Access metrics from the tweet object with extended type
	const tweetWithMetrics = tweet as TweetWithMetrics
	const replyCount = tweetWithMetrics.reply_count
	const retweetCount = tweetWithMetrics.retweet_count
	const favoriteCount = tweet.favorite_count

	const hasMetrics = favoriteCount !== undefined || retweetCount !== undefined || replyCount !== undefined

	if (!hasMetrics) return null

	return (
		<div className="flex items-center gap-4 text-fg/70 text-xs">
			{replyCount !== undefined && replyCount > 0 && (
				<div className="flex items-center gap-1">
					<span className="font-semibold">{replyCount.toLocaleString()}</span>
					<span>Replies</span>
				</div>
			)}
			{retweetCount !== undefined && retweetCount > 0 && (
				<div className="flex items-center gap-1">
					<span className="font-semibold">{retweetCount.toLocaleString()}</span>
					<span>Retweets</span>
				</div>
			)}
			{favoriteCount !== undefined && favoriteCount > 0 && (
				<div className="flex items-center gap-1">
					<IconHeart className="size-3 text-primary" />

					<span className="font-semibold">{favoriteCount.toLocaleString()}</span>

					<span>{favoriteCount > 1 ? "Likes" : "Like"}</span>
				</div>
			)}
		</div>
	)
}

interface TweetEmbedProps {
	id: string
	author?: User.Type
	messageCreatedAt?: number
}

export function TweetEmbed({ id, author, messageCreatedAt }: TweetEmbedProps) {
	const tweetResult = useAtomValue(LinkPreviewClient.query("tweet", "get", { payload: { id } }))
	const tweet = AsyncResult.getOrElse(tweetResult, () => null)
	const isLoading = AsyncResult.isInitial(tweetResult)

	const [isModalOpen, setIsModalOpen] = useState(false)
	const [selectedImageIndex, setSelectedImageIndex] = useState(0)

	if (isLoading) return <TweetSkeleton />
	if (!tweet) return <TweetNotFound />

	const enrichedTweet = enrichTweet(tweet)

	// Convert tweet photos to ViewerImage format
	const viewerImages: ViewerImage[] =
		enrichedTweet.photos?.map((photo) => ({
			type: "url" as const,
			url: photo.url,
			alt: enrichedTweet.text || "Tweet image",
		})) || []

	const handlePhotoClick = (index: number) => {
		setSelectedImageIndex(index)
		setIsModalOpen(true)
	}

	return (
		<>
			<div className="mt-2 flex max-w-sm flex-col gap-2 overflow-hidden rounded-lg border border-fg/15 pressed:border-fg/15 bg-muted/40 pressed:bg-muted p-4 hover:border-fg/15 hover:bg-muted">
				<TweetHeader tweet={enrichedTweet} />
				<TweetBody tweet={enrichedTweet} />
				<TweetMedia tweet={enrichedTweet} onPhotoClick={handlePhotoClick} />
				<TweetMetrics tweet={enrichedTweet} />
			</div>

			{/* Image Modal - only show if we have author and messageCreatedAt */}
			{author && messageCreatedAt && viewerImages.length > 0 && (
				<ImageViewerModal
					isOpen={isModalOpen}
					onOpenChange={setIsModalOpen}
					images={viewerImages}
					initialIndex={selectedImageIndex}
					author={author}
					createdAt={messageCreatedAt}
				/>
			)}
		</>
	)
}

import { cn } from "@/lib/utils"

export const Icons = {
	logo: ({ className }: { className?: string }) => (
		<svg
			className={cn(className, "text-secondary")}
			width="266"
			height="219"
			viewBox="0 0 266 219"
			fill="none"
			xmlns="http://www.w3.org/2000/svg"
		>
			<path
				fillRule="evenodd"
				clipRule="evenodd"
				d="M155 124.5C167.167 122 187.955 109.3 194.355 96.5H194.351C186.184 82.1666 159.851 55 119.851 61C117.851 55.8333 111.351 43.4 101.351 35C89.3534 43 36.8548 167.5 93.3539 219C65.3542 210.167 7.65476 178.6 0.854757 123C-7.64524 53.5 48.8583 8.5 98.8548 8.5C113.448 8.5 132.429 10.7577 151.994 13.0847C199.458 18.7303 250.355 24.7841 250.355 0C270.189 29 289 137.5 172.5 183.5C172.846 182.02 173.227 180.493 173.618 178.927C177.936 161.629 183.427 139.631 155 124.5ZM146 88.5C146 93.1944 142.194 97 137.5 97C132.806 97 129 93.1944 129 88.5C129 83.8056 132.806 80 137.5 80C142.194 80 146 83.8056 146 88.5ZM120.788 136.708C92.0055 138.35 87.7744 156.553 89.2567 165.449C89.2567 169.308 95.9604 172.519 102.089 175.454C107.696 178.138 112.822 180.593 111.895 183.104C109.955 188.359 100.576 188.578 96.1295 188.031C99.9025 198.706 111.006 219.399 125.235 216.772C139.464 214.144 150.029 196.516 153.532 188.031C149.49 188.852 137.767 186.388 137.767 181.461C137.767 179.718 140.551 178.54 144.149 177.018C150.718 174.238 160 170.312 160 159.701C159.03 139.993 136.958 135.339 126.044 135.476C128.307 127.593 134.802 124.254 137.767 123.569C136.796 118.971 132.781 117.274 130.894 117C123.456 122.584 121.057 132.465 120.788 136.708Z"
				fill="currentColor"
			/>
		</svg>
	),
	vercel: () => (
		<svg width="52" height="60" viewBox="0 0 52 60" fill="none" xmlns="http://www.w3.org/2000/svg">
			<g filter="url(#filter0_dddd_1_4108)">
				<path
					d="M5 22C5 10.402 14.402 1 26 1C37.598 1 47 10.402 47 22C47 33.598 37.598 43 26 43C14.402 43 5 33.598 5 22Z"
					fill="black"
				/>
				<g clipPath="url(#clip0_1_4108)">
					<path d="M26 8L39.5 31.3829H12.5L26 8Z" fill="white" />
				</g>
			</g>
			<defs>
				<filter
					id="filter0_dddd_1_4108"
					x="0"
					y="0"
					width="52"
					height="60"
					filterUnits="userSpaceOnUse"
					colorInterpolationFilters="sRGB"
				>
					<feFlood floodOpacity="0" result="BackgroundImageFix" />
					<feColorMatrix
						in="SourceAlpha"
						type="matrix"
						values="0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 127 0"
						result="hardAlpha"
					/>
					<feOffset dy="1" />
					<feGaussianBlur stdDeviation="1" />
					<feColorMatrix type="matrix" values="0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0.1 0" />
					<feBlend mode="normal" in2="BackgroundImageFix" result="effect1_dropShadow_1_4108" />
					<feColorMatrix
						in="SourceAlpha"
						type="matrix"
						values="0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 127 0"
						result="hardAlpha"
					/>
					<feOffset dy="3" />
					<feGaussianBlur stdDeviation="1.5" />
					<feColorMatrix type="matrix" values="0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0.09 0" />
					<feBlend
						mode="normal"
						in2="effect1_dropShadow_1_4108"
						result="effect2_dropShadow_1_4108"
					/>
					<feColorMatrix
						in="SourceAlpha"
						type="matrix"
						values="0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 127 0"
						result="hardAlpha"
					/>
					<feOffset dy="7" />
					<feGaussianBlur stdDeviation="2" />
					<feColorMatrix type="matrix" values="0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0.05 0" />
					<feBlend
						mode="normal"
						in2="effect2_dropShadow_1_4108"
						result="effect3_dropShadow_1_4108"
					/>
					<feColorMatrix
						in="SourceAlpha"
						type="matrix"
						values="0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 127 0"
						result="hardAlpha"
					/>
					<feOffset dy="12" />
					<feGaussianBlur stdDeviation="2.5" />
					<feColorMatrix type="matrix" values="0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0.01 0" />
					<feBlend
						mode="normal"
						in2="effect3_dropShadow_1_4108"
						result="effect4_dropShadow_1_4108"
					/>
					<feBlend
						mode="normal"
						in="SourceGraphic"
						in2="effect4_dropShadow_1_4108"
						result="shape"
					/>
				</filter>
				<clipPath id="clip0_1_4108">
					<rect width="27" height="23.4141" fill="white" transform="translate(12.5 8)" />
				</clipPath>
			</defs>
		</svg>
	),
	replit: () => (
		<svg width="52" height="60" viewBox="0 0 52 60" fill="none" xmlns="http://www.w3.org/2000/svg">
			<g filter="url(#filter0_dddd_1_4111)">
				<path
					d="M5 22C5 10.402 14.402 1 26 1C37.598 1 47 10.402 47 22C47 33.598 37.598 43 26 43C14.402 43 5 33.598 5 22Z"
					fill="white"
				/>
				<g clipPath="url(#clip0_1_4111)">
					<path
						d="M15.5 8.875C15.5 7.83947 16.3395 7 17.375 7H26.125C27.1605 7 28 7.83947 28 8.875V17H17.375C16.3395 17 15.5 16.1605 15.5 15.125V8.875Z"
						fill="#F26207"
					/>
					<path
						d="M28 17H38.625C39.6605 17 40.5 17.8395 40.5 18.875V25.125C40.5 26.1605 39.6605 27 38.625 27H28V17Z"
						fill="#F26207"
					/>
					<path
						d="M15.5 28.875C15.5 27.8395 16.3395 27 17.375 27H28V35.125C28 36.1605 27.1605 37 26.125 37H17.375C16.3395 37 15.5 36.1605 15.5 35.125V28.875Z"
						fill="#F26207"
					/>
				</g>
			</g>
			<defs>
				<filter
					id="filter0_dddd_1_4111"
					x="0"
					y="0"
					width="52"
					height="60"
					filterUnits="userSpaceOnUse"
					colorInterpolationFilters="sRGB"
				>
					<feFlood floodOpacity="0" result="BackgroundImageFix" />
					<feColorMatrix
						in="SourceAlpha"
						type="matrix"
						values="0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 127 0"
						result="hardAlpha"
					/>
					<feOffset dy="1" />
					<feGaussianBlur stdDeviation="1" />
					<feColorMatrix type="matrix" values="0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0.1 0" />
					<feBlend mode="normal" in2="BackgroundImageFix" result="effect1_dropShadow_1_4111" />
					<feColorMatrix
						in="SourceAlpha"
						type="matrix"
						values="0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 127 0"
						result="hardAlpha"
					/>
					<feOffset dy="3" />
					<feGaussianBlur stdDeviation="1.5" />
					<feColorMatrix type="matrix" values="0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0.09 0" />
					<feBlend
						mode="normal"
						in2="effect1_dropShadow_1_4111"
						result="effect2_dropShadow_1_4111"
					/>
					<feColorMatrix
						in="SourceAlpha"
						type="matrix"
						values="0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 127 0"
						result="hardAlpha"
					/>
					<feOffset dy="7" />
					<feGaussianBlur stdDeviation="2" />
					<feColorMatrix type="matrix" values="0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0.05 0" />
					<feBlend
						mode="normal"
						in2="effect2_dropShadow_1_4111"
						result="effect3_dropShadow_1_4111"
					/>
					<feColorMatrix
						in="SourceAlpha"
						type="matrix"
						values="0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 127 0"
						result="hardAlpha"
					/>
					<feOffset dy="12" />
					<feGaussianBlur stdDeviation="2.5" />
					<feColorMatrix type="matrix" values="0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0.01 0" />
					<feBlend
						mode="normal"
						in2="effect3_dropShadow_1_4111"
						result="effect4_dropShadow_1_4111"
					/>
					<feBlend
						mode="normal"
						in="SourceGraphic"
						in2="effect4_dropShadow_1_4111"
						result="shape"
					/>
				</filter>
				<clipPath id="clip0_1_4111">
					<rect width="25" height="30" fill="white" transform="translate(15.5 7)" />
				</clipPath>
			</defs>
		</svg>
	),
	posthog: () => (
		<svg width="52" height="60" viewBox="0 0 52 60" fill="none" xmlns="http://www.w3.org/2000/svg">
			<g filter="url(#filter0_dddd_1_4116)">
				<path
					d="M5 22C5 10.402 14.402 1 26 1C37.598 1 47 10.402 47 22C47 33.598 37.598 43 26 43C14.402 43 5 33.598 5 22Z"
					fill="#EEEFE8"
				/>
				<path
					d="M18.2508 23.0069C18.1951 23.118 18.1096 23.2115 18.0038 23.2768C17.898 23.3421 17.7762 23.3767 17.6518 23.3767C17.5275 23.3767 17.4057 23.3421 17.2999 23.2768C17.1941 23.2115 17.1086 23.118 17.0529 23.0069L16.462 21.8257C16.4155 21.7327 16.3913 21.6302 16.3913 21.5262C16.3913 21.4223 16.4155 21.3197 16.462 21.2267L17.0529 20.0456C17.1086 19.9344 17.1941 19.841 17.2999 19.7757C17.4057 19.7104 17.5275 19.6758 17.6518 19.6758C17.7762 19.6758 17.898 19.7104 18.0038 19.7757C18.1096 19.841 18.1951 19.9344 18.2508 20.0456L18.8417 21.2267C18.8882 21.3197 18.9124 21.4223 18.9124 21.5262C18.9124 21.6302 18.8882 21.7327 18.8417 21.8257L18.2508 23.0069ZM18.2508 29.7047C18.1951 29.8158 18.1096 29.9093 18.0038 29.9746C17.898 30.0399 17.7762 30.0745 17.6518 30.0745C17.5275 30.0745 17.4057 30.0399 17.2999 29.9746C17.1941 29.9093 17.1086 29.8158 17.0529 29.7047L16.4613 28.5235C16.4148 28.4305 16.3906 28.328 16.3906 28.224C16.3906 28.1201 16.4148 28.0176 16.4613 27.9246L17.0522 26.7434C17.1079 26.6322 17.1934 26.5388 17.2992 26.4735C17.405 26.4082 17.5269 26.3736 17.6512 26.3736C17.7755 26.3736 17.8974 26.4082 18.0031 26.4735C18.1089 26.5388 18.1944 26.6322 18.2501 26.7434L18.8411 27.9246C18.8875 28.0176 18.9117 28.1201 18.9117 28.224C18.9117 28.328 18.8875 28.4305 18.8411 28.5235L18.2508 29.7047Z"
					fill="#1D4AFF"
				/>
				<path
					d="M10.9531 27.1607C10.9531 26.5644 11.6747 26.2649 12.0968 26.687L15.1673 29.7575C15.5894 30.1796 15.2906 30.9019 14.6936 30.9019H11.6231C11.4454 30.9019 11.275 30.8313 11.1494 30.7056C11.0237 30.58 10.9531 30.4096 10.9531 30.2319V27.1607ZM10.9531 23.926C10.9531 24.0141 10.9704 24.1013 11.004 24.1827C11.0377 24.2641 11.0871 24.3381 11.1494 24.4004L17.4546 30.7049C17.5168 30.7672 17.5906 30.8167 17.6719 30.8505C17.7532 30.8843 17.8403 30.9018 17.9283 30.9019H21.3921C21.9884 30.9019 22.2879 30.1803 21.8658 29.7582L12.0975 19.9899C11.6747 19.5671 10.9531 19.8659 10.9531 20.4622V23.926ZM10.9531 17.2282C10.9532 17.4059 11.0238 17.5762 11.1494 17.7019L24.1518 30.7062C24.2774 30.8319 24.4478 30.9025 24.6255 30.9025H28.0893C28.6856 30.9025 28.985 30.1803 28.563 29.7582L12.0968 13.2914C11.6747 12.8693 10.9531 13.1681 10.9531 13.765V17.2282ZM17.6509 17.2282C17.651 17.4059 17.7216 17.5762 17.8472 17.7019L29.9029 29.7582C30.325 30.1803 31.0466 29.8808 31.0466 29.2839V25.8207C31.0465 25.643 30.9759 25.4727 30.8503 25.347L18.7946 13.2914C18.3725 12.8693 17.6509 13.1681 17.6509 13.765V17.2282ZM25.4924 13.2914C25.0703 12.8693 24.3488 13.1681 24.3488 13.765V17.2289C24.349 17.4063 24.4196 17.5764 24.5451 17.7019L29.9029 23.0604C30.325 23.4825 31.0466 23.183 31.0466 22.586V19.1229C31.0465 18.9452 30.9759 18.7748 30.8503 18.6492L25.4924 13.2914Z"
					fill="#F9BD2B"
				/>
				<path
					d="M39.4424 27.2418L33.1358 20.9359C32.7138 20.5138 31.9922 20.8126 31.9922 21.4096V30.2312C31.9922 30.4089 32.0628 30.5793 32.1884 30.705C32.3141 30.8306 32.4845 30.9012 32.6622 30.9012H42.4305C42.6082 30.9012 42.7786 30.8306 42.9043 30.705C43.0299 30.5793 43.1005 30.4089 43.1005 30.2312V29.4273C43.1005 29.0574 42.7997 28.762 42.4325 28.7144C41.3008 28.567 40.2495 28.0488 39.4424 27.2418ZM35.2074 28.7579C34.9231 28.7579 34.6505 28.645 34.4494 28.444C34.2484 28.2429 34.1355 27.9703 34.1355 27.686C34.1355 27.4017 34.2484 27.129 34.4494 26.928C34.6505 26.7269 34.9231 26.614 35.2074 26.614C35.4917 26.614 35.7644 26.7269 35.9654 26.928C36.1665 27.129 36.2794 27.4017 36.2794 27.686C36.2794 27.9703 36.1665 28.2429 35.9654 28.444C35.7644 28.645 35.4917 28.7579 35.2074 28.7579Z"
					fill="black"
				/>
				<path
					d="M10.9531 30.2319C10.9531 30.4096 11.0237 30.58 11.1494 30.7056C11.275 30.8313 11.4454 30.9019 11.6231 30.9019H14.6936C15.2906 30.9019 15.5894 30.1796 15.1673 29.7575L12.0968 26.687C11.6747 26.2649 10.9531 26.5637 10.9531 27.1607V30.2319ZM17.6509 18.8455L12.0968 13.2914C11.6747 12.8693 10.9531 13.1681 10.9531 13.765V17.2289C10.9533 17.4063 11.0239 17.5764 11.1494 17.7019L17.6509 24.204V18.8455ZM12.0968 19.9892C11.6747 19.5671 10.9531 19.8659 10.9531 20.4629V23.9267C10.9533 24.1041 11.0239 24.2742 11.1494 24.3997L17.6509 30.9019V25.5433L12.0968 19.9892Z"
					fill="#1D4AFF"
				/>
				<path
					d="M24.3463 19.1229C24.3462 18.9452 24.2756 18.7748 24.15 18.6492L18.7921 13.2914C18.37 12.8693 17.6484 13.1681 17.6484 13.765V17.2289C17.6487 17.4063 17.7193 17.5764 17.8447 17.7019L24.3463 24.204V19.1222V19.1229ZM17.6484 30.9012H21.389C21.9859 30.9012 22.2847 30.1796 21.8626 29.7575L17.6484 25.5433V30.9019V30.9012ZM17.6484 18.8455V23.926C17.6484 24.0141 17.6657 24.1013 17.6994 24.1827C17.733 24.2641 17.7824 24.3381 17.8447 24.4004L24.3463 30.9019V25.8207C24.3462 25.643 24.2756 25.4727 24.15 25.347L17.6484 18.8455Z"
					fill="#F54E00"
				/>
			</g>
			<defs>
				<filter
					id="filter0_dddd_1_4116"
					x="0"
					y="0"
					width="52"
					height="60"
					filterUnits="userSpaceOnUse"
					colorInterpolationFilters="sRGB"
				>
					<feFlood floodOpacity="0" result="BackgroundImageFix" />
					<feColorMatrix
						in="SourceAlpha"
						type="matrix"
						values="0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 127 0"
						result="hardAlpha"
					/>
					<feOffset dy="1" />
					<feGaussianBlur stdDeviation="1" />
					<feColorMatrix type="matrix" values="0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0.1 0" />
					<feBlend mode="normal" in2="BackgroundImageFix" result="effect1_dropShadow_1_4116" />
					<feColorMatrix
						in="SourceAlpha"
						type="matrix"
						values="0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 127 0"
						result="hardAlpha"
					/>
					<feOffset dy="3" />
					<feGaussianBlur stdDeviation="1.5" />
					<feColorMatrix type="matrix" values="0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0.09 0" />
					<feBlend
						mode="normal"
						in2="effect1_dropShadow_1_4116"
						result="effect2_dropShadow_1_4116"
					/>
					<feColorMatrix
						in="SourceAlpha"
						type="matrix"
						values="0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 127 0"
						result="hardAlpha"
					/>
					<feOffset dy="7" />
					<feGaussianBlur stdDeviation="2" />
					<feColorMatrix type="matrix" values="0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0.05 0" />
					<feBlend
						mode="normal"
						in2="effect2_dropShadow_1_4116"
						result="effect3_dropShadow_1_4116"
					/>
					<feColorMatrix
						in="SourceAlpha"
						type="matrix"
						values="0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 127 0"
						result="hardAlpha"
					/>
					<feOffset dy="12" />
					<feGaussianBlur stdDeviation="2.5" />
					<feColorMatrix type="matrix" values="0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0.01 0" />
					<feBlend
						mode="normal"
						in2="effect3_dropShadow_1_4116"
						result="effect4_dropShadow_1_4116"
					/>
					<feBlend
						mode="normal"
						in="SourceGraphic"
						in2="effect4_dropShadow_1_4116"
						result="shape"
					/>
				</filter>
			</defs>
		</svg>
	),
	gemini: () => (
		<svg width="52" height="60" viewBox="0 0 52 60" fill="none" xmlns="http://www.w3.org/2000/svg">
			<g filter="url(#filter0_dddd_1_4143)">
				<path
					d="M5 22C5 10.402 14.402 1 26 1C37.598 1 47 10.402 47 22C47 33.598 37.598 43 26 43C14.402 43 5 33.598 5 22Z"
					fill="white"
				/>
				<g clipPath="url(#clip0_1_4143)">
					<path
						d="M26 34C25.5426 30.9809 24.131 28.1874 21.9718 26.0282C19.8126 23.869 17.0191 22.4574 14 22C17.0191 21.5426 19.8126 20.131 21.9718 17.9718C24.131 15.8126 25.5426 13.0191 26 10C26.4575 13.0191 27.8692 15.8125 30.0283 17.9717C32.1875 20.1308 34.9809 21.5425 38 22C34.9809 22.4575 32.1875 23.8692 30.0283 26.0283C27.8692 28.1875 26.4575 30.9809 26 34Z"
						fill="url(#paint0_linear_1_4143)"
					/>
				</g>
			</g>
			<defs>
				<filter
					id="filter0_dddd_1_4143"
					x="0"
					y="0"
					width="52"
					height="60"
					filterUnits="userSpaceOnUse"
					colorInterpolationFilters="sRGB"
				>
					<feFlood floodOpacity="0" result="BackgroundImageFix" />
					<feColorMatrix
						in="SourceAlpha"
						type="matrix"
						values="0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 127 0"
						result="hardAlpha"
					/>
					<feOffset dy="1" />
					<feGaussianBlur stdDeviation="1" />
					<feColorMatrix type="matrix" values="0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0.1 0" />
					<feBlend mode="normal" in2="BackgroundImageFix" result="effect1_dropShadow_1_4143" />
					<feColorMatrix
						in="SourceAlpha"
						type="matrix"
						values="0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 127 0"
						result="hardAlpha"
					/>
					<feOffset dy="3" />
					<feGaussianBlur stdDeviation="1.5" />
					<feColorMatrix type="matrix" values="0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0.09 0" />
					<feBlend
						mode="normal"
						in2="effect1_dropShadow_1_4143"
						result="effect2_dropShadow_1_4143"
					/>
					<feColorMatrix
						in="SourceAlpha"
						type="matrix"
						values="0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 127 0"
						result="hardAlpha"
					/>
					<feOffset dy="7" />
					<feGaussianBlur stdDeviation="2" />
					<feColorMatrix type="matrix" values="0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0.05 0" />
					<feBlend
						mode="normal"
						in2="effect2_dropShadow_1_4143"
						result="effect3_dropShadow_1_4143"
					/>
					<feColorMatrix
						in="SourceAlpha"
						type="matrix"
						values="0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 127 0"
						result="hardAlpha"
					/>
					<feOffset dy="12" />
					<feGaussianBlur stdDeviation="2.5" />
					<feColorMatrix type="matrix" values="0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0.01 0" />
					<feBlend
						mode="normal"
						in2="effect3_dropShadow_1_4143"
						result="effect4_dropShadow_1_4143"
					/>
					<feBlend
						mode="normal"
						in="SourceGraphic"
						in2="effect4_dropShadow_1_4143"
						result="shape"
					/>
				</filter>
				<linearGradient
					id="paint0_linear_1_4143"
					x1="13.9999"
					y1="2410"
					x2="1663.52"
					y2="739.48"
					gradientUnits="userSpaceOnUse"
				>
					<stop stopColor="#1C7DFF" />
					<stop offset="0.52021" stopColor="#1C69FF" />
					<stop offset="1" stopColor="#F0DCD6" />
				</linearGradient>
				<clipPath id="clip0_1_4143">
					<rect width="24" height="24" fill="white" transform="translate(14 10)" />
				</clipPath>
			</defs>
		</svg>
	),
	supabase: () => (
		<svg width="52" height="60" viewBox="0 0 52 60" fill="none" xmlns="http://www.w3.org/2000/svg">
			<g filter="url(#filter0_dddd_1_4134)">
				<path
					d="M5 22C5 10.402 14.402 1 26 1C37.598 1 47 10.402 47 22C47 33.598 37.598 43 26 43C14.402 43 5 33.598 5 22Z"
					fill="#121212"
				/>
				<g clipPath="url(#clip0_1_4134)">
					<path
						d="M28.5219 36.7564C27.7374 37.7443 26.1469 37.2031 26.128 35.9417L25.8516 17.4922H38.257C40.5039 17.4922 41.7571 20.0874 40.3599 21.8472L28.5219 36.7564Z"
						fill="url(#paint0_linear_1_4134)"
					/>
					<path
						d="M28.5219 36.7564C27.7374 37.7443 26.1469 37.2031 26.128 35.9417L25.8516 17.4922H38.257C40.5039 17.4922 41.7571 20.0874 40.3599 21.8472L28.5219 36.7564Z"
						fill="url(#paint1_linear_1_4134)"
						fillOpacity="0.2"
					/>
					<path
						d="M23.48 7.06882C24.2645 6.08082 25.8551 6.62217 25.874 7.88359L25.9951 26.333H13.745C11.4979 26.333 10.2447 23.7378 11.642 21.978L23.48 7.06882Z"
						fill="#3ECF8E"
					/>
				</g>
			</g>
			<defs>
				<filter
					id="filter0_dddd_1_4134"
					x="0"
					y="0"
					width="52"
					height="60"
					filterUnits="userSpaceOnUse"
					colorInterpolationFilters="sRGB"
				>
					<feFlood floodOpacity="0" result="BackgroundImageFix" />
					<feColorMatrix
						in="SourceAlpha"
						type="matrix"
						values="0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 127 0"
						result="hardAlpha"
					/>
					<feOffset dy="1" />
					<feGaussianBlur stdDeviation="1" />
					<feColorMatrix type="matrix" values="0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0.1 0" />
					<feBlend mode="normal" in2="BackgroundImageFix" result="effect1_dropShadow_1_4134" />
					<feColorMatrix
						in="SourceAlpha"
						type="matrix"
						values="0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 127 0"
						result="hardAlpha"
					/>
					<feOffset dy="3" />
					<feGaussianBlur stdDeviation="1.5" />
					<feColorMatrix type="matrix" values="0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0.09 0" />
					<feBlend
						mode="normal"
						in2="effect1_dropShadow_1_4134"
						result="effect2_dropShadow_1_4134"
					/>
					<feColorMatrix
						in="SourceAlpha"
						type="matrix"
						values="0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 127 0"
						result="hardAlpha"
					/>
					<feOffset dy="7" />
					<feGaussianBlur stdDeviation="2" />
					<feColorMatrix type="matrix" values="0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0.05 0" />
					<feBlend
						mode="normal"
						in2="effect2_dropShadow_1_4134"
						result="effect3_dropShadow_1_4134"
					/>
					<feColorMatrix
						in="SourceAlpha"
						type="matrix"
						values="0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 127 0"
						result="hardAlpha"
					/>
					<feOffset dy="12" />
					<feGaussianBlur stdDeviation="2.5" />
					<feColorMatrix type="matrix" values="0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0.01 0" />
					<feBlend
						mode="normal"
						in2="effect3_dropShadow_1_4134"
						result="effect4_dropShadow_1_4134"
					/>
					<feBlend
						mode="normal"
						in="SourceGraphic"
						in2="effect4_dropShadow_1_4134"
						result="shape"
					/>
				</filter>
				<linearGradient
					id="paint0_linear_1_4134"
					x1="25.8516"
					y1="21.5829"
					x2="36.8771"
					y2="26.207"
					gradientUnits="userSpaceOnUse"
				>
					<stop stopColor="#249361" />
					<stop offset="1" stopColor="#3ECF8E" />
				</linearGradient>
				<linearGradient
					id="paint1_linear_1_4134"
					x1="20.9634"
					y1="14.8902"
					x2="25.9916"
					y2="24.3555"
					gradientUnits="userSpaceOnUse"
				>
					<stop />
					<stop offset="1" stopOpacity="0" />
				</linearGradient>
				<clipPath id="clip0_1_4134">
					<rect width="29.9027" height="31" fill="white" transform="translate(11.0469 6.5)" />
				</clipPath>
			</defs>
		</svg>
	),
	figma: () => (
		<svg width="52" height="60" viewBox="0 0 52 60" fill="none" xmlns="http://www.w3.org/2000/svg">
			<g filter="url(#filter0_dddd_1_4123)">
				<path
					d="M5 22C5 10.402 14.402 1 26 1C37.598 1 47 10.402 47 22C47 33.598 37.598 43 26 43C14.402 43 5 33.598 5 22Z"
					fill="white"
				/>
				<g clipPath="url(#clip0_1_4123)">
					<mask id="mask0_1_4123" maskUnits="userSpaceOnUse" x="15" y="7" width="21" height="30">
						<path d="M35.875 7H15.875V37H35.875V7Z" fill="white" />
					</mask>
					<g mask="url(#mask0_1_4123)">
						<path
							d="M20.875 37.0001C23.635 37.0001 25.875 34.7601 25.875 32.0001V27.0001H20.875C18.115 27.0001 15.875 29.2401 15.875 32.0001C15.875 34.7601 18.115 37.0001 20.875 37.0001Z"
							fill="#0ACF83"
						/>
						<path
							d="M15.875 21.9999C15.875 19.2399 18.115 16.9999 20.875 16.9999H25.875V26.9999H20.875C18.115 26.9999 15.875 24.7599 15.875 21.9999Z"
							fill="#A259FF"
						/>
						<path
							d="M15.875 12C15.875 9.24 18.115 7 20.875 7H25.875V17H20.875C18.115 17 15.875 14.76 15.875 12Z"
							fill="#F24E1E"
						/>
						<path
							d="M25.875 7H30.875C33.635 7 35.875 9.24 35.875 12C35.875 14.76 33.635 17 30.875 17H25.875V7Z"
							fill="#FF7262"
						/>
						<path
							d="M35.875 21.9999C35.875 24.7599 33.635 26.9999 30.875 26.9999C28.115 26.9999 25.875 24.7599 25.875 21.9999C25.875 19.2399 28.115 16.9999 30.875 16.9999C33.635 16.9999 35.875 19.2399 35.875 21.9999Z"
							fill="#1ABCFE"
						/>
					</g>
				</g>
			</g>
			<defs>
				<filter
					id="filter0_dddd_1_4123"
					x="0"
					y="0"
					width="52"
					height="60"
					filterUnits="userSpaceOnUse"
					colorInterpolationFilters="sRGB"
				>
					<feFlood floodOpacity="0" result="BackgroundImageFix" />
					<feColorMatrix
						in="SourceAlpha"
						type="matrix"
						values="0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 127 0"
						result="hardAlpha"
					/>
					<feOffset dy="1" />
					<feGaussianBlur stdDeviation="1" />
					<feColorMatrix type="matrix" values="0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0.1 0" />
					<feBlend mode="normal" in2="BackgroundImageFix" result="effect1_dropShadow_1_4123" />
					<feColorMatrix
						in="SourceAlpha"
						type="matrix"
						values="0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 127 0"
						result="hardAlpha"
					/>
					<feOffset dy="3" />
					<feGaussianBlur stdDeviation="1.5" />
					<feColorMatrix type="matrix" values="0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0.09 0" />
					<feBlend
						mode="normal"
						in2="effect1_dropShadow_1_4123"
						result="effect2_dropShadow_1_4123"
					/>
					<feColorMatrix
						in="SourceAlpha"
						type="matrix"
						values="0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 127 0"
						result="hardAlpha"
					/>
					<feOffset dy="7" />
					<feGaussianBlur stdDeviation="2" />
					<feColorMatrix type="matrix" values="0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0.05 0" />
					<feBlend
						mode="normal"
						in2="effect2_dropShadow_1_4123"
						result="effect3_dropShadow_1_4123"
					/>
					<feColorMatrix
						in="SourceAlpha"
						type="matrix"
						values="0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 127 0"
						result="hardAlpha"
					/>
					<feOffset dy="12" />
					<feGaussianBlur stdDeviation="2.5" />
					<feColorMatrix type="matrix" values="0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0.01 0" />
					<feBlend
						mode="normal"
						in2="effect3_dropShadow_1_4123"
						result="effect4_dropShadow_1_4123"
					/>
					<feBlend
						mode="normal"
						in="SourceGraphic"
						in2="effect4_dropShadow_1_4123"
						result="shape"
					/>
				</filter>
				<clipPath id="clip0_1_4123">
					<rect width="20.25" height="30" fill="white" transform="translate(15.875 7)" />
				</clipPath>
			</defs>
		</svg>
	),
	netlify: () => (
		<svg width="52" height="60" viewBox="0 0 52 60" fill="none" xmlns="http://www.w3.org/2000/svg">
			<g filter="url(#filter0_dddd_netlify)">
				<path
					d="M5 22C5 10.402 14.402 1 26 1C37.598 1 47 10.402 47 22C47 33.598 37.598 43 26 43C14.402 43 5 33.598 5 22Z"
					fill="#05BDBA"
				/>
				<g clipPath="url(#clip0_netlify)">
					<path
						d="M31.5 25.8L28.6 24.3C28.3 24.2 28 24.1 27.7 24L27.5 23.8C27.5 23.5 27.5 23.2 27.5 22.9L31.5 25.8ZM36.5 29.8C36.2 29.9 35.9 30 35.5 30L34.8 30.3C34.6 30.3 34.4 30.2 34.2 30.2L30.5 28.1L36.5 29.8ZM38.1 28.5L33.8 26.1L32.9 25.5C32.9 25.2 32.9 24.9 33 24.6L38.1 28.5ZM39.2 27.6L33.3 24C33.3 23.7 33.3 23.4 33.3 23.2L39.3 27.4C39.3 27.5 39.2 27.5 39.2 27.6ZM40.4 25.1L33.6 21.4C33.7 21.1 33.8 20.9 34 20.7L40.5 24.8C40.5 24.9 40.4 25 40.4 25.1ZM40.6 24.6C40.6 24.5 40.7 24.4 40.7 24.2L35.3 21C35.6 20.8 35.9 20.7 36.2 20.6L40.6 24.6ZM37.5 20.3L40.8 23.5C40.8 23.7 40.7 23.9 40.7 24.1L37.5 20.3ZM38.9 20.1L40.6 22.6C40.5 23 40.4 23.3 40.3 23.6L38.9 20.1ZM39.9 20.4L40 21.7C39.8 22.1 39.6 22.5 39.3 22.9L39.9 20.4ZM40.4 20.8L39.3 21.8C39.1 22 38.8 22.2 38.6 22.3L40.4 20.8Z"
						fill="white"
					/>
					<path
						d="M40.7 22.5L39.1 21.2L39.7 21.4L40.5 22.2C40.6 22.3 40.6 22.4 40.7 22.5ZM40.1 21.4L39.4 21.2L39.9 21.5C40 21.5 40 21.4 40.1 21.4ZM42.5 22.9C42.6 22.6 42.6 22.4 42.6 22.1L40.7 20.6C40.8 20.3 40.8 20 40.8 19.7L42.6 21.5C42.6 21.9 42.6 22.4 42.5 22.9ZM42.7 21.1L40.6 19.2C40.5 18.9 40.4 18.6 40.3 18.3L42.5 20.4C42.6 20.6 42.6 20.9 42.7 21.1ZM42.2 19.7L39.7 17.5C39.6 17.2 39.4 17 39.3 16.8L42 19.3C42.1 19.5 42.1 19.6 42.2 19.7ZM41.4 18.6L38.5 16.2C38.3 16 38 15.8 37.8 15.6L41 18.1C41.2 18.3 41.3 18.4 41.4 18.6ZM40.4 17.4L35.9 14.6C35.6 14.4 35.3 14.3 35 14.1L39.8 16.8C40 17 40.2 17.2 40.4 17.4ZM39 16.4L34.1 13.9C33.8 13.8 33.5 13.7 33.2 13.6L38.3 15.9C38.5 16.1 38.8 16.2 39 16.4ZM37.1 15.2L32.2 13C31.9 12.9 31.6 12.9 31.3 12.9L36.2 14.6C36.5 14.8 36.8 15 37.1 15.2ZM34.6 14.1L29.7 12.6C29.4 12.6 29.1 12.6 28.8 12.7L33.4 13.6C34.1 13.7 34.4 13.9 34.6 14.1ZM31.4 13.3L26.3 12.8C26 12.9 25.7 12.9 25.4 13L30 12.6C30.5 12.8 31 12.9 31.4 13.3ZM27.8 13L23.9 14.1C23.7 14.2 23.5 14.3 23.3 14.5L26.6 12.8C27 12.8 27.4 12.9 27.8 13ZM24.2 13.8L21.4 16.1C21.2 16.3 21 16.5 20.8 16.7L23.3 14C23.6 13.8 23.9 13.8 24.2 13.8ZM21.7 15L19.4 18.6C19.3 18.9 19.2 19.1 19.1 19.4L20.7 16.4C20.9 16.1 21.3 15.5 21.7 15ZM19.8 17.4L18.5 21.2C18.4 21.5 18.4 21.8 18.4 22.1L19 18.5C19.2 18.1 19.5 17.7 19.8 17.4ZM18.8 19.8L18.7 23.5C18.7 23.8 18.7 24.1 18.8 24.4L18.6 21.1C18.6 20.6 18.7 20.2 18.8 19.8ZM18.6 22.5L19.4 26.1C19.5 26.4 19.6 26.6 19.7 26.9L18.5 23.6C18.5 23.2 18.5 22.8 18.6 22.5ZM19.3 25L20.8 28.1C20.9 28.3 21.1 28.5 21.2 28.8L19.6 26.3C19.4 25.9 19.3 25.5 19.3 25ZM20.8 27.5L23 29.6C23.2 29.8 23.5 29.9 23.7 30L21.4 28.3C21.1 28.1 20.9 27.8 20.8 27.5ZM22.5 29.2L25.9 30.6C26.2 30.6 26.5 30.7 26.8 30.7L24.1 30.2C23.5 30.1 22.9 29.7 22.5 29.2ZM25.3 30.6L29.5 30.3C29.8 30.2 30.1 30.1 30.3 29.9L27.5 30.8C26.8 30.8 26.1 30.8 25.3 30.6ZM28.5 30.6L32.2 29.3C32.5 29.1 32.7 28.9 33 28.7L30 30.2C29.5 30.4 28.9 30.5 28.5 30.6Z"
						fill="white"
					/>
				</g>
			</g>
			<defs>
				<filter
					id="filter0_dddd_netlify"
					x="0"
					y="0"
					width="52"
					height="60"
					filterUnits="userSpaceOnUse"
					colorInterpolationFilters="sRGB"
				>
					<feFlood floodOpacity="0" result="BackgroundImageFix" />
					<feColorMatrix
						in="SourceAlpha"
						type="matrix"
						values="0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 127 0"
						result="hardAlpha"
					/>
					<feOffset dy="1" />
					<feGaussianBlur stdDeviation="1" />
					<feColorMatrix type="matrix" values="0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0.1 0" />
					<feBlend mode="normal" in2="BackgroundImageFix" result="effect1_dropShadow_netlify" />
					<feColorMatrix
						in="SourceAlpha"
						type="matrix"
						values="0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 127 0"
						result="hardAlpha"
					/>
					<feOffset dy="3" />
					<feGaussianBlur stdDeviation="1.5" />
					<feColorMatrix type="matrix" values="0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0.09 0" />
					<feBlend
						mode="normal"
						in2="effect1_dropShadow_netlify"
						result="effect2_dropShadow_netlify"
					/>
					<feColorMatrix
						in="SourceAlpha"
						type="matrix"
						values="0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 127 0"
						result="hardAlpha"
					/>
					<feOffset dy="7" />
					<feGaussianBlur stdDeviation="2" />
					<feColorMatrix type="matrix" values="0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0.05 0" />
					<feBlend
						mode="normal"
						in2="effect2_dropShadow_netlify"
						result="effect3_dropShadow_netlify"
					/>
					<feColorMatrix
						in="SourceAlpha"
						type="matrix"
						values="0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 127 0"
						result="hardAlpha"
					/>
					<feOffset dy="12" />
					<feGaussianBlur stdDeviation="2.5" />
					<feColorMatrix type="matrix" values="0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0.01 0" />
					<feBlend
						mode="normal"
						in2="effect3_dropShadow_netlify"
						result="effect4_dropShadow_netlify"
					/>
					<feBlend
						mode="normal"
						in="SourceGraphic"
						in2="effect4_dropShadow_netlify"
						result="shape"
					/>
				</filter>
				<clipPath id="clip0_netlify">
					<rect width="24" height="18" fill="white" transform="translate(18.5 12.5)" />
				</clipPath>
			</defs>
		</svg>
	),
	stripe: () => (
		<svg width="52" height="60" viewBox="0 0 52 60" fill="none" xmlns="http://www.w3.org/2000/svg">
			<g filter="url(#filter0_dddd_stripe)">
				<path
					d="M5 22C5 10.402 14.402 1 26 1C37.598 1 47 10.402 47 22C47 33.598 37.598 43 26 43C14.402 43 5 33.598 5 22Z"
					fill="#635BFF"
				/>
				<g clipPath="url(#clip0_stripe)">
					<path
						fillRule="evenodd"
						clipRule="evenodd"
						d="M24.2 17.7C24.2 16.4 25.3 15.8 27 15.8C29.4 15.8 32.5 16.6 34.9 18.1V12.1C32.2 11 29.5 10.5 27 10.5C21.4 10.5 17.6 13.4 17.6 18C17.6 25.1 27.2 23.9 27.2 27C27.2 28.4 25.9 29 24.1 29C21.5 29 18.1 27.9 15.4 26.2V32.4C18.4 33.6 21.4 34.2 24.1 34.2C29.8 34.2 33.8 31.4 33.8 26.8C33.8 19.2 24.2 20.6 24.2 17.7Z"
						fill="white"
					/>
				</g>
			</g>
			<defs>
				<filter
					id="filter0_dddd_stripe"
					x="0"
					y="0"
					width="52"
					height="60"
					filterUnits="userSpaceOnUse"
					colorInterpolationFilters="sRGB"
				>
					<feFlood floodOpacity="0" result="BackgroundImageFix" />
					<feColorMatrix
						in="SourceAlpha"
						type="matrix"
						values="0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 127 0"
						result="hardAlpha"
					/>
					<feOffset dy="1" />
					<feGaussianBlur stdDeviation="1" />
					<feColorMatrix type="matrix" values="0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0.1 0" />
					<feBlend mode="normal" in2="BackgroundImageFix" result="effect1_dropShadow_stripe" />
					<feColorMatrix
						in="SourceAlpha"
						type="matrix"
						values="0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 127 0"
						result="hardAlpha"
					/>
					<feOffset dy="3" />
					<feGaussianBlur stdDeviation="1.5" />
					<feColorMatrix type="matrix" values="0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0.09 0" />
					<feBlend
						mode="normal"
						in2="effect1_dropShadow_stripe"
						result="effect2_dropShadow_stripe"
					/>
					<feColorMatrix
						in="SourceAlpha"
						type="matrix"
						values="0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 127 0"
						result="hardAlpha"
					/>
					<feOffset dy="7" />
					<feGaussianBlur stdDeviation="2" />
					<feColorMatrix type="matrix" values="0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0.05 0" />
					<feBlend
						mode="normal"
						in2="effect2_dropShadow_stripe"
						result="effect3_dropShadow_stripe"
					/>
					<feColorMatrix
						in="SourceAlpha"
						type="matrix"
						values="0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 127 0"
						result="hardAlpha"
					/>
					<feOffset dy="12" />
					<feGaussianBlur stdDeviation="2.5" />
					<feColorMatrix type="matrix" values="0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0.01 0" />
					<feBlend
						mode="normal"
						in2="effect3_dropShadow_stripe"
						result="effect4_dropShadow_stripe"
					/>
					<feBlend
						mode="normal"
						in="SourceGraphic"
						in2="effect4_dropShadow_stripe"
						result="shape"
					/>
				</filter>
				<clipPath id="clip0_stripe">
					<rect width="20" height="24" fill="white" transform="translate(15 10)" />
				</clipPath>
			</defs>
		</svg>
	),
	github: ({ className }: { className?: string }) => (
		<svg
			xmlns="http://www.w3.org/2000/svg"
			width="16"
			height="16"
			viewBox="0 0 24 24"
			fill="none"
			stroke="currentColor"
			strokeWidth="2"
			strokeLinecap="round"
			strokeLinejoin="round"
			className={cn("size-4", className)}
		>
			<path d="M15 22v-4a4.8 4.8 0 0 0-1-3.5c3 0 6-2 6-5.5.08-1.25-.27-2.48-1-3.5.28-1.15.28-2.35 0-3.5 0 0-1 0-3 1.5-2.64-.5-5.36-.5-8 0C6 2 5 2 5 2c-.3 1.15-.3 2.35 0 3.5A5.403 5.403 0 0 0 4 9c0 3.5 3 5.5 6 5.5-.39.49-.68 1.05-.85 1.65-.17.6-.22 1.23-.15 1.85v4" />
			<path d="M9 18c-4.51 2-5-2-7-2" />
		</svg>
	),
	star: ({ className }: { className?: string }) => (
		<svg
			xmlns="http://www.w3.org/2000/svg"
			width="16"
			height="16"
			viewBox="0 0 24 24"
			fill="currentColor"
			className={cn("size-4", className)}
		>
			<path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z" />
		</svg>
	),
}

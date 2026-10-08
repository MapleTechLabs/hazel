/**
 * React Aria's `scrollIntoView` (@react-aria/utils, Apache-2.0) with `block` and `inline` at
 * `nearest`: scrolls `scrollView` so `element` is visible, honoring scroll padding and margins,
 * without touching ancestors above `scrollView`.
 */
export const scrollIntoView = (scrollView: HTMLElement, element: HTMLElement): void => {
	if (scrollView === element) return
	let y = scrollView.scrollTop
	let x = scrollView.scrollLeft
	const target = element.getBoundingClientRect()
	const view = scrollView.getBoundingClientRect()
	const itemStyle = window.getComputedStyle(element)
	const viewStyle = window.getComputedStyle(scrollView)
	const root = document.scrollingElement ?? document.documentElement
	const isRoot = scrollView === root
	const px = (value: string) => Number.parseInt(value, 10) || 0

	const viewTop = isRoot ? 0 : view.top
	const viewBottom = isRoot ? scrollView.clientHeight : view.bottom
	const viewLeft = isRoot ? 0 : view.left
	const viewRight = isRoot ? scrollView.clientWidth : view.right
	const borderTop = px(viewStyle.borderTopWidth)
	const borderBottom = px(viewStyle.borderBottomWidth)
	const borderLeft = px(viewStyle.borderLeftWidth)
	const borderRight = px(viewStyle.borderRightWidth)

	const areaTop = target.top - px(itemStyle.scrollMarginTop)
	const areaBottom = target.bottom + px(itemStyle.scrollMarginBottom)
	const areaLeft = target.left - px(itemStyle.scrollMarginLeft)
	const areaRight = target.right + px(itemStyle.scrollMarginRight)

	const scrollBarWidth =
		scrollView.offsetWidth - scrollView.clientWidth - (isRoot ? 0 : borderLeft + borderRight)
	const scrollBarHeight =
		scrollView.offsetHeight - scrollView.clientHeight - (isRoot ? 0 : borderTop + borderBottom)
	const portTop = viewTop + borderTop + px(viewStyle.scrollPaddingTop)
	const portBottom = viewBottom - borderBottom - px(viewStyle.scrollPaddingBottom) - scrollBarHeight
	const portLeft = viewLeft + borderLeft + px(viewStyle.scrollPaddingLeft)
	const portRight =
		viewRight -
		borderRight -
		px(viewStyle.scrollPaddingRight) -
		(viewStyle.direction === "rtl" ? 0 : scrollBarWidth)

	if (areaTop < portTop || areaBottom > portBottom) {
		const start = areaTop - portTop
		const end = areaBottom - portBottom
		y += Math.abs(start) <= Math.abs(end) ? start : end
	}
	if (areaLeft < portLeft || areaRight > portRight) {
		const start = areaLeft - portLeft
		const end = areaRight - portRight
		x += Math.abs(start) <= Math.abs(end) ? start : end
	}
	scrollView.scrollTo({ left: x, top: y })
}

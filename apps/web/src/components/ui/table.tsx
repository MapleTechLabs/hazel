"use client"

import { IconChevronDown } from "~/components/icons/icon-chevron-down"
import { createContext, use } from "react"
import type {
	CellProps,
	ColumnProps,
	ColumnResizerProps,
	TableHeaderProps as HeaderProps,
	RowProps,
	TableBodyProps,
	TableProps as TablePrimitiveProps,
} from "react-aria-components"
import {
	Button,
	Cell,
	Collection,
	Column,
	ColumnResizer as ColumnResizerPrimitive,
	composeRenderProps,
	ResizableTableContainer,
	Row,
	TableBody as TableBodyPrimitive,
	TableHeader as TableHeaderPrimitive,
	Table as TablePrimitive,
	useTableOptions,
} from "react-aria-components"
import { twJoin, twMerge } from "tailwind-merge"
import { cx } from "~/lib/primitive"
import { Checkbox } from "./checkbox"
import { tableStyles } from "./table.styles"

interface TableProps extends Omit<TablePrimitiveProps, "className"> {
	allowResize?: boolean
	className?: string
	bleed?: boolean
	grid?: boolean
	striped?: boolean
	ref?: React.Ref<HTMLTableElement>
}

const TableContext = createContext<TableProps>({
	allowResize: false,
})

const useTableContext = () => use(TableContext)

const Root = (props: TableProps) => {
	return <TablePrimitive className={tableStyles.root} {...props} />
}

const Table = ({
	allowResize,
	className,
	bleed = false,
	grid = false,
	striped = false,
	ref,
	...props
}: TableProps) => {
	return (
		<TableContext.Provider value={{ allowResize, bleed, grid, striped }}>
			<div className="flow-root">
				<div className={twMerge(tableStyles.scroller, className)}>
					<div className={twJoin(...tableStyles.inner(bleed))}>
						{allowResize ? (
							<ResizableTableContainer data-slot="table-resizable-container">
								<Root ref={ref} {...props} />
							</ResizableTableContainer>
						) : (
							<Root {...props} ref={ref} />
						)}
					</div>
				</div>
			</div>
		</TableContext.Provider>
	)
}

const ColumnResizer = ({ className, ...props }: ColumnResizerProps) => (
	<ColumnResizerPrimitive {...props} className={cx(tableStyles.columnResizer, className)}>
		<div className={tableStyles.columnResizerLine} />
	</ColumnResizerPrimitive>
)

const TableBody = <T extends object>(props: TableBodyProps<T>) => (
	<TableBodyPrimitive data-slot="table-body" {...props} />
)

interface TableColumnProps extends ColumnProps {
	isResizable?: boolean
}

const TableColumn = ({ isResizable = false, className, ...props }: TableColumnProps) => {
	const { bleed, grid } = useTableContext()
	return (
		<Column
			data-slot="table-column"
			{...props}
			className={cx(tableStyles.column({ bleed, grid, isResizable }), className)}
		>
			{(values) => (
				<div className={twJoin(tableStyles.columnContent)}>
					{typeof props.children === "function" ? props.children(values) : props.children}
					{values.allowsSorting && (
						<span className={twJoin(...tableStyles.sortIndicator(values.isHovered))}>
							<IconChevronDown className={tableStyles.sortIcon(values.sortDirection)} />
						</span>
					)}
					{isResizable && <ColumnResizer />}
				</div>
			)}
		</Column>
	)
}

interface TableHeaderProps<T extends object> extends HeaderProps<T> {
	ref?: React.Ref<HTMLTableSectionElement>
}

const TableHeader = <T extends object>({
	children,
	ref,
	columns,
	className,
	...props
}: TableHeaderProps<T>) => {
	const { bleed } = useTableContext()
	const { selectionBehavior, selectionMode, allowsDragging } = useTableOptions()
	return (
		<TableHeaderPrimitive
			data-slot="table-header"
			className={cx(tableStyles.header, className)}
			ref={ref}
			{...props}
		>
			{allowsDragging && (
				<Column data-slot="table-column" className={twMerge(...tableStyles.utilityColumn(bleed))} />
			)}
			{selectionBehavior === "toggle" && (
				<Column data-slot="table-column" className={twMerge(...tableStyles.utilityColumn(bleed))}>
					{selectionMode === "multiple" && <Checkbox slot="selection" />}
				</Column>
			)}
			<Collection items={columns}>{children}</Collection>
		</TableHeaderPrimitive>
	)
}

interface TableRowProps<T extends object> extends RowProps<T> {
	ref?: React.Ref<HTMLTableRowElement>
}

const TableRow = <T extends object>({
	children,
	className,
	columns,
	id,
	ref,
	...props
}: TableRowProps<T>) => {
	const { selectionBehavior, allowsDragging } = useTableOptions()
	const { striped } = useTableContext()
	return (
		<Row
			ref={ref}
			data-slot="table-row"
			id={id}
			{...props}
			className={composeRenderProps(
				className,
				(
					className,
					{
						isSelected,
						selectionMode,
						isFocusVisibleWithin,
						isDragging,
						isDisabled,
						isFocusVisible,
					},
				) =>
					twMerge(
						...tableStyles.row({
							isSelected,
							isFocusVisible,
							isFocusVisibleWithin,
							isDragging: isDragging ?? false,
							isDisabled,
							isActionable: Boolean(
								props.href || props.onAction || selectionMode === "multiple",
							),
							striped,
						}),
						className,
					),
			)}
		>
			{allowsDragging && (
				<TableCell className={tableStyles.dragCell}>
					<Button slot="drag" className={tableStyles.dragButton}>
						<svg
							aria-hidden
							data-slot="icon"
							xmlns="http://www.w3.org/2000/svg"
							width={16}
							height={16}
							viewBox="0 0 24 24"
							fill="none"
							stroke="currentColor"
							strokeWidth={2}
							strokeLinecap="round"
							strokeLinejoin="round"
							className="lucide lucide-grip-vertical-icon lucide-grip-vertical"
						>
							<circle cx={9} cy={12} r={1} />
							<circle cx={9} cy={5} r={1} />
							<circle cx={9} cy={19} r={1} />
							<circle cx={15} cy={12} r={1} />
							<circle cx={15} cy={5} r={1} />
							<circle cx={15} cy={19} r={1} />
						</svg>
					</Button>
				</TableCell>
			)}
			{selectionBehavior === "toggle" && (
				<TableCell className={tableStyles.dragCell}>
					<Checkbox slot="selection" />
				</TableCell>
			)}
			<Collection items={columns}>{children}</Collection>
		</Row>
	)
}

interface TableCellProps extends CellProps {
	ref?: React.Ref<HTMLTableCellElement>
}
const TableCell = ({ className, ref, ...props }: TableCellProps) => {
	const { allowResize, bleed, grid, striped } = useTableContext()
	return (
		<Cell
			ref={ref}
			data-slot="table-cell"
			{...props}
			className={cx(twJoin(...tableStyles.cell({ allowResize, bleed, grid, striped })), className)}
		/>
	)
}

export type { TableProps, TableColumnProps, TableRowProps }
export { Table, TableBody, TableCell, TableColumn, TableHeader, TableRow }

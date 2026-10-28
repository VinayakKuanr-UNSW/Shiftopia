import * as React from "react"

import { cn } from '@/modules/core/lib/utils'

/**
 * The one list-table anatomy. Root font is 75%, so every size is in px:
 * header 40px / 11px caps, body rows ≥44px / 13px. Tables that need raw
 * <th>/<td> (sticky columns, colSpan bands) use `tableTokens` directly —
 * never restate these classes. Matrix grids (roster modes, availability,
 * leave ledger) are not list tables and do not use this.
 */
export const tableTokens = {
  scroll: "relative w-full overflow-auto",
  table: "w-full border-collapse text-left text-[13px] text-foreground",
  header: "bg-card [&_tr]:border-b [&_tr]:border-border [&_tr]:bg-muted/40 [&_tr:hover]:bg-muted/40",
  stickyHeader: "sticky top-0 z-20",
  body: "[&_tr:last-child]:border-0",
  row: "group/row border-b border-border/60 transition-colors hover:bg-muted/40 data-[state=selected]:bg-primary/5",
  head: "h-[40px] px-4 text-left align-middle text-[11px] font-semibold uppercase tracking-wider text-muted-foreground whitespace-nowrap [&:has([role=checkbox])]:pr-0",
  cell: "h-[44px] px-4 py-2 align-middle [&:has([role=checkbox])]:pr-0",
  /** Sticky (left/right) columns must be opaque, so they paint the header / row-hover tint over the card themselves. */
  stickyCell: "bg-card group-hover/row:bg-[linear-gradient(hsl(var(--muted)/0.4),hsl(var(--muted)/0.4))]",
  stickyHeadCell: "bg-card bg-[linear-gradient(hsl(var(--muted)/0.4),hsl(var(--muted)/0.4))]",
  /** Group / section band row inside a body (e.g. "Today", a department). */
  band: "bg-muted/30 px-4 py-1.5 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground",
} as const

const Table = React.forwardRef<
  HTMLTableElement,
  React.HTMLAttributes<HTMLTableElement> & { containerClassName?: string }
>(({ className, containerClassName, ...props }, ref) => (
  <div className={cn(tableTokens.scroll, containerClassName)}>
    <table
      ref={ref}
      className={cn(tableTokens.table, className)}
      {...props}
    />
  </div>
))
Table.displayName = "Table"

const TableHeader = React.forwardRef<
  HTMLTableSectionElement,
  React.HTMLAttributes<HTMLTableSectionElement> & { sticky?: boolean }
>(({ className, sticky, ...props }, ref) => (
  <thead
    ref={ref}
    className={cn(tableTokens.header, sticky && tableTokens.stickyHeader, className)}
    {...props}
  />
))
TableHeader.displayName = "TableHeader"

const TableBody = React.forwardRef<
  HTMLTableSectionElement,
  React.HTMLAttributes<HTMLTableSectionElement>
>(({ className, ...props }, ref) => (
  <tbody ref={ref} className={cn(tableTokens.body, className)} {...props} />
))
TableBody.displayName = "TableBody"

const TableFooter = React.forwardRef<
  HTMLTableSectionElement,
  React.HTMLAttributes<HTMLTableSectionElement>
>(({ className, ...props }, ref) => (
  <tfoot
    ref={ref}
    className={cn(
      "border-t border-border bg-muted/40 font-semibold [&>tr]:last:border-b-0",
      className
    )}
    {...props}
  />
))
TableFooter.displayName = "TableFooter"

const TableRow = React.forwardRef<
  HTMLTableRowElement,
  React.HTMLAttributes<HTMLTableRowElement>
>(({ className, ...props }, ref) => (
  <tr ref={ref} className={cn(tableTokens.row, className)} {...props} />
))
TableRow.displayName = "TableRow"

const TableHead = React.forwardRef<
  HTMLTableCellElement,
  React.ThHTMLAttributes<HTMLTableCellElement>
>(({ className, scope = "col", ...props }, ref) => (
  <th ref={ref} scope={scope} className={cn(tableTokens.head, className)} {...props} />
))
TableHead.displayName = "TableHead"

const TableCell = React.forwardRef<
  HTMLTableCellElement,
  React.TdHTMLAttributes<HTMLTableCellElement>
>(({ className, ...props }, ref) => (
  <td ref={ref} className={cn(tableTokens.cell, className)} {...props} />
))
TableCell.displayName = "TableCell"

/** A full-width row holding a loading / empty / error state. */
const TableStateRow = ({ colSpan, children }: { colSpan: number; children: React.ReactNode }) => (
  <tr>
    <td colSpan={colSpan} className="p-0">{children}</td>
  </tr>
)

const TableCaption = React.forwardRef<
  HTMLTableCaptionElement,
  React.HTMLAttributes<HTMLTableCaptionElement>
>(({ className, ...props }, ref) => (
  <caption
    ref={ref}
    className={cn("mt-4 text-[13px] text-muted-foreground", className)}
    {...props}
  />
))
TableCaption.displayName = "TableCaption"

export {
  Table,
  TableHeader,
  TableBody,
  TableHead,
  TableRow,
  TableCell,
  TableStateRow,
}

import * as React from "react"

import { cn } from '@/modules/core/lib/utils'

/**
 * The one card anatomy. Root font is 75%, so every size is in px:
 * 16px radius, 16px padding, one elevation step (shadow-sm), title 15px,
 * meta 13px, actions 44px. Cards never blur (blur traps position:fixed
 * children and is decoration, not meaning) and never scale on hover/press —
 * interactive cards lift their border/shadow and tint on press instead.
 * Domain colour (roster group, leave type) goes in `accent`, a 4px left edge,
 * so the surface itself stays readable in both themes.
 */
export const cardTokens = {
  shell: "rounded-2xl border border-border/60 bg-card text-card-foreground shadow-sm",
  interactive:
    "cursor-pointer transition-[box-shadow,border-color,background-color] duration-150 hover:border-border hover:shadow-md active:bg-muted/30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring motion-reduce:transition-none",
  selected: "border-primary ring-1 ring-primary",
  accent: "border-l-4",
  pad: "p-4",
  header: "flex items-start justify-between gap-3",
  title: "text-[15px] font-semibold leading-tight text-foreground",
  meta: "text-[13px] text-muted-foreground",
  /** Small caps label above a value (e.g. "Start", "Paid"). */
  label: "text-[11px] font-semibold uppercase tracking-wider text-muted-foreground",
  footer: "mt-3 flex flex-wrap items-center gap-2 border-t border-border/60 pt-3",
  action: "h-[44px] min-w-[44px]",
} as const

const Card = React.forwardRef<
  HTMLDivElement,
  React.HTMLAttributes<HTMLDivElement> & { interactive?: boolean; selected?: boolean }
>(({ className, interactive, selected, ...props }, ref) => (
  <div
    ref={ref}
    className={cn(
      cardTokens.shell,
      interactive && cardTokens.interactive,
      selected && cardTokens.selected,
      className
    )}
    {...props}
  />
))
Card.displayName = "Card"

const CardHeader = React.forwardRef<
  HTMLDivElement,
  React.HTMLAttributes<HTMLDivElement>
>(({ className, ...props }, ref) => (
  <div
    ref={ref}
    className={cn("flex flex-col gap-1 p-4 pb-2", className)}
    {...props}
  />
))
CardHeader.displayName = "CardHeader"

const CardTitle = React.forwardRef<
  HTMLParagraphElement,
  React.HTMLAttributes<HTMLHeadingElement>
>(({ className, ...props }, ref) => (
  <h3 ref={ref} className={cn(cardTokens.title, className)} {...props} />
))
CardTitle.displayName = "CardTitle"

const CardDescription = React.forwardRef<
  HTMLParagraphElement,
  React.HTMLAttributes<HTMLParagraphElement>
>(({ className, ...props }, ref) => (
  <p ref={ref} className={cn(cardTokens.meta, "leading-relaxed", className)} {...props} />
))
CardDescription.displayName = "CardDescription"

const CardContent = React.forwardRef<
  HTMLDivElement,
  React.HTMLAttributes<HTMLDivElement>
>(({ className, ...props }, ref) => (
  <div ref={ref} className={cn("px-4 pb-4 pt-0", className)} {...props} />
))
CardContent.displayName = "CardContent"

const CardFooter = React.forwardRef<
  HTMLDivElement,
  React.HTMLAttributes<HTMLDivElement>
>(({ className, ...props }, ref) => (
  <div
    ref={ref}
    className={cn("flex flex-wrap items-center gap-2 border-t border-border/60 px-4 py-3", className)}
    {...props}
  />
))
CardFooter.displayName = "CardFooter"

export { Card, CardHeader, CardFooter, CardTitle, CardDescription, CardContent }

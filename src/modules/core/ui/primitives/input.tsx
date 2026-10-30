import * as React from "react"

import { cn } from '@/modules/core/lib/utils'

const Input = React.forwardRef<HTMLInputElement, React.ComponentProps<"input">>(
  ({ className, type, ...props }, ref) => {
    return (
      <input
        type={type}
        className={cn(
          // 16px on phones or iOS zooms the page on focus; 44px / 36px targets.
          "flex h-[44px] md:h-[36px] w-full rounded-lg border border-input bg-background px-3 py-2 text-[16px] md:text-[13px] text-foreground ring-offset-background file:border-0 file:bg-transparent file:text-[13px] file:font-medium file:text-foreground placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50 focus-visible:border-primary/50 disabled:cursor-not-allowed disabled:opacity-50 transition-colors hover:border-ring/50",
          className
        )}
        ref={ref}
        {...props}
      />
    )
  }
)
Input.displayName = "Input"

export { Input }

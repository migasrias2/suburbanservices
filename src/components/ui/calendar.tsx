import * as React from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { DayPicker } from "react-day-picker";

import { cn } from "@/lib/utils";
import { buttonVariants } from "@/components/ui/button";

export type CalendarProps = React.ComponentProps<typeof DayPicker>;

function Calendar({
  className,
  classNames,
  showOutsideDays = true,
  style,
  ...props
}: CalendarProps) {
  const weekdayInitials = React.useMemo(() => ["S", "M", "T", "W", "T", "F", "S"], []);

  return (
    <DayPicker
      showOutsideDays={showOutsideDays}
      className={cn(
        "rounded-3xl border border-[#00339B]/25 bg-gradient-to-br from-slate-50 via-white to-slate-100 p-6 shadow-xl",
        "backdrop-blur-md",
        className,
      )}
      classNames={{
        months: "flex flex-col sm:flex-row gap-6",
        month: "space-y-4",
        caption: "flex justify-center pt-1 relative items-center",
        caption_label: "text-sm font-semibold text-slate-600",
        nav: "space-x-2 flex items-center",
        nav_button: cn(
          buttonVariants({ variant: "outline" }),
          "h-8 w-8 rounded-full border border-transparent bg-primary/10 p-0 text-primary hover:bg-primary/20 hover:text-primary",
          "shadow-sm backdrop-blur",
        ),
        nav_button_previous: "absolute left-1",
        nav_button_next: "absolute right-1",
        table: "w-full border-separate space-y-1",
        head_row: "flex w-full gap-1",
        head_cell:
          "flex h-9 w-9 items-center justify-center text-sm font-semibold uppercase text-muted-foreground",
        row: "flex w-full mt-2 gap-1",
        cell:
          "relative h-9 w-9 p-0 text-center text-sm transition-colors duration-150 first:[&:has([aria-selected])]:rounded-l-full last:[&:has([aria-selected])]:rounded-r-full",
        day: cn(
          buttonVariants({ variant: "ghost" }),
          "h-9 w-9 rounded-full p-0 font-medium text-slate-600 hover:bg-primary/15 hover:text-primary",
          "aria-selected:bg-primary aria-selected:text-white aria-selected:shadow-lg",
        ),
        day_range_end: "day-range-end",
        day_selected:
          "bg-primary text-primary-foreground hover:bg-primary/90 hover:text-primary-foreground focus:bg-primary/90 focus:text-primary-foreground",
        day_today:
          "relative text-primary before:absolute before:inset-0 before:rounded-full before:border before:border-primary/40 before:content-['']",
        day_outside:
          "day-outside text-muted-foreground/60 opacity-70 aria-selected:bg-primary/10 aria-selected:text-muted-foreground aria-selected:opacity-40",
        day_disabled: "text-muted-foreground opacity-40",
        day_range_middle:
          "aria-selected:bg-primary/15 aria-selected:text-primary",
        day_hidden: "invisible",
        ...classNames,
      }}
      style={{
        "--rdp-accent-color": "#00339B",
        "--rdp-accent-color-dark": "#00339B",
        "--rdp-background-color": "rgba(0, 51, 155, 0.12)",
        "--rdp-outline": "2px solid rgba(0, 51, 155, 0.35)",
        "--rdp-outline-selected": "3px solid rgba(0, 51, 155, 0.45)",
        "--rdp-selected-color": "#ffffff",
        ...(style ?? {}),
      } as React.CSSProperties}
      formatters={{
        formatWeekdayName: (weekday) => weekdayInitials[weekday.getDay()],
      }}
      components={{
        IconLeft: ({ ..._props }) => <ChevronLeft className="h-4 w-4" />,
        IconRight: ({ ..._props }) => <ChevronRight className="h-4 w-4" />,
      }}
      {...props}
    />
  );
}
Calendar.displayName = "Calendar";

export { Calendar };

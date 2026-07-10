import * as React from "react";
import { cn } from "@/lib/utils";

export function Label({ className, ...props }: React.LabelHTMLAttributes<HTMLLabelElement>) {
  return (
    <label
      className={cn("label mb-0.5 mt-1 inline-flex text-[11.5px] font-semibold text-app-text-secondary", className)}
      {...props}
    />
  );
}

import type { ButtonHTMLAttributes } from "react";

import { cn } from "@/lib/utils";

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "default" | "outline" | "ghost" | "destructive";
  size?: "default" | "sm" | "lg";
};

export function Button({ className, variant = "default", size = "default", ...props }: ButtonProps) {
  return (
    <button
      className={cn(
        "inline-flex items-center justify-center gap-2 rounded-lg font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 disabled:pointer-events-none disabled:opacity-50",
        {
          "bg-blue-700 text-white hover:bg-blue-800": variant === "default",
          "border border-slate-300 bg-white text-slate-800 hover:bg-slate-50": variant === "outline",
          "text-slate-600 hover:bg-slate-100": variant === "ghost",
          "bg-red-600 text-white hover:bg-red-700": variant === "destructive",
          "h-9 px-3 text-sm": size === "sm",
          "h-10 px-4": size === "default",
          "h-11 px-5": size === "lg",
        },
        className,
      )}
      {...props}
    />
  );
}

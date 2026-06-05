"use client";

/**
 * Lean Opus2-styled UI primitives.
 *
 * Hand-built (no Radix/MUI) to keep the test-harness dependency footprint and
 * Docker build unchanged while still matching the Figma prototype's visual
 * language: teal primary, sharp-ish cards, Lato type. Tokens come from
 * globals.css via the Tailwind semantic colors in tailwind.config.ts.
 */

import { forwardRef } from "react";
import { cn } from "@/lib/cn";

/* ───────────────────────────── Button ───────────────────────────── */

type ButtonVariant = "primary" | "secondary" | "outline" | "ghost" | "destructive";
type ButtonSize = "sm" | "md" | "lg";

const BUTTON_BASE =
  "inline-flex items-center justify-center gap-2 rounded-button font-bold transition-colors " +
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50 " +
  "disabled:opacity-50 disabled:cursor-not-allowed select-none";

const BUTTON_VARIANTS: Record<ButtonVariant, string> = {
  primary: "bg-primary text-primary-foreground hover:opacity-90",
  secondary: "bg-secondary text-secondary-foreground hover:opacity-90",
  outline: "border border-border bg-card text-foreground hover:bg-muted",
  ghost: "text-foreground hover:bg-muted",
  destructive: "bg-destructive text-destructive-foreground hover:opacity-90",
};

const BUTTON_SIZES: Record<ButtonSize, string> = {
  sm: "h-8 px-3 text-xs",
  md: "h-10 px-4 text-sm",
  lg: "h-11 px-6 text-sm",
};

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { className, variant = "primary", size = "md", type = "button", ...props },
  ref,
) {
  return (
    <button
      ref={ref}
      type={type}
      className={cn(BUTTON_BASE, BUTTON_VARIANTS[variant], BUTTON_SIZES[size], className)}
      {...props}
    />
  );
});

/* ───────────────────────────── Card ───────────────────────────── */

export function Card({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn(
        "rounded-card border border-border bg-card text-card-foreground shadow-elevation",
        className,
      )}
      {...props}
    />
  );
}

export function CardHeader({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("border-b border-border px-5 py-4", className)} {...props} />;
}

export function CardTitle({ className, ...props }: React.HTMLAttributes<HTMLHeadingElement>) {
  return <h3 className={cn("text-base font-bold", className)} {...props} />;
}

export function CardBody({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("p-5", className)} {...props} />;
}

/* ───────────────────────────── Badge ───────────────────────────── */

type BadgeTone = "neutral" | "primary" | "success" | "warn" | "danger" | "info";

const BADGE_TONES: Record<BadgeTone, string> = {
  neutral: "bg-muted text-muted-foreground border-border",
  primary: "bg-primary/10 text-primary border-primary/30",
  success: "bg-emerald-50 text-emerald-700 border-emerald-200",
  warn: "bg-amber-50 text-amber-700 border-amber-200",
  danger: "bg-red-50 text-red-700 border-red-200",
  info: "bg-sky-50 text-sky-700 border-sky-200",
};

export function Badge({
  tone = "neutral",
  className,
  ...props
}: { tone?: BadgeTone } & React.HTMLAttributes<HTMLSpanElement>) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-pill border px-2.5 py-0.5 text-xs font-bold",
        BADGE_TONES[tone],
        className,
      )}
      {...props}
    />
  );
}

/* ───────────────────────────── Input / Textarea ───────────────────────────── */

const FIELD_BASE =
  "w-full rounded-button border border-border bg-input px-3 py-2 text-sm text-foreground " +
  "placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 " +
  "focus-visible:ring-ring/40 disabled:opacity-50";

export const Input = forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement>>(
  function Input({ className, ...props }, ref) {
    return <input ref={ref} className={cn(FIELD_BASE, className)} {...props} />;
  },
);

export const Textarea = forwardRef<
  HTMLTextAreaElement,
  React.TextareaHTMLAttributes<HTMLTextAreaElement>
>(function Textarea({ className, ...props }, ref) {
  return <textarea ref={ref} className={cn(FIELD_BASE, "min-h-[80px]", className)} {...props} />;
});

export const Select = forwardRef<HTMLSelectElement, React.SelectHTMLAttributes<HTMLSelectElement>>(
  function Select({ className, ...props }, ref) {
    return <select ref={ref} className={cn(FIELD_BASE, "pr-8", className)} {...props} />;
  },
);

/* ───────────────────────────── Field label ───────────────────────────── */

export function FieldLabel({ className, ...props }: React.LabelHTMLAttributes<HTMLLabelElement>) {
  return (
    <label
      className={cn("mb-1 block text-xs font-bold uppercase tracking-wide text-muted-foreground", className)}
      {...props}
    />
  );
}

/* ───────────────────────────── Checkbox ───────────────────────────── */

export function Checkbox({ className, ...props }: React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      type="checkbox"
      className={cn("h-4 w-4 rounded border-border text-primary accent-[var(--primary)]", className)}
      {...props}
    />
  );
}

/* ───────────────────────────── MockStub banner ───────────────────────────── */

/**
 * Marks a panel/section whose backend does not exist in this repo (OCR,
 * submission type, metadata extraction, shared/private bundles). Renders a
 * clearly-labelled "preview only" notice so nothing reads as functional when
 * it isn't. Used by the mock wizard steps and Admin extras.
 */
export function MockStub({
  label = "Preview only",
  detail,
  className,
}: {
  label?: string;
  detail?: string;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "inline-flex items-start gap-2 rounded-button border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-800",
        className,
      )}
    >
      <span className="mt-px font-bold uppercase tracking-wide">{label}</span>
      {detail ? <span className="font-normal">— {detail}</span> : null}
    </div>
  );
}

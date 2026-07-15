import type { ButtonHTMLAttributes, ReactNode } from "react";

type Variant = "primary" | "secondary" | "ghost" | "danger" | "live";
type Size = "md" | "lg" | "xl";

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
  children: ReactNode;
}

const base =
  "inline-flex items-center justify-center gap-2 rounded-lg font-semibold transition-colors disabled:opacity-50 disabled:cursor-not-allowed select-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-pine)] focus-visible:ring-offset-2";

const variants: Record<Variant, string> = {
  // Touch floor: 48px everywhere (h-12). Referee actions use size="xl" (64px).
  primary: "bg-[var(--color-pine)] text-white hover:bg-[var(--color-pine-deep)]",
  secondary:
    "bg-white text-[var(--color-ink)] border border-[var(--color-line)] hover:border-[var(--color-pine)]",
  ghost: "bg-transparent text-[var(--color-pine)] hover:bg-black/5",
  danger: "bg-[var(--color-loss)] text-white hover:brightness-90",
  live: "bg-[var(--color-live)] text-white hover:brightness-95",
};

const sizes: Record<Size, string> = {
  md: "h-12 px-4 text-[15px]",
  lg: "h-14 px-5 text-base",
  xl: "min-h-16 px-6 text-lg", // ≥64px for pitchside referee actions
};

/**
 * Shared button styling, so link-shaped actions (React Router `<Link>`) can carry
 * the exact same affordance as `<Button>` without being real buttons.
 */
export function buttonClass(variant: Variant = "primary", size: Size = "md", className = ""): string {
  return `${base} ${variants[variant]} ${sizes[size]} ${className}`;
}

export function Button({
  variant = "primary",
  size = "md",
  className = "",
  children,
  ...rest
}: ButtonProps) {
  return (
    <button className={buttonClass(variant, size, className)} {...rest}>
      {children}
    </button>
  );
}

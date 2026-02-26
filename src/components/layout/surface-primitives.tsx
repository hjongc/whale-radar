import { type ReactNode } from "react";

type SectionHeaderProps = {
  title: string;
  subtitle: string;
  compact?: boolean;
};

type PanelProps = {
  children: ReactNode;
  className?: string;
};

type StatCardProps = {
  label: string;
  headline: string;
  supporting: string;
  tone: "cyan" | "mint" | "sunset";
};

const toneClass: Record<StatCardProps["tone"], string> = {
  cyan: "wi-card--cyan",
  mint: "wi-card--mint",
  sunset: "wi-card--sunset"
};

export function SectionHeader({ title, subtitle, compact = false }: SectionHeaderProps) {
  return (
    <header className={compact ? "wi-header wi-header--compact" : "wi-header"}>
      <h2 className="wi-section-title">{title}</h2>
      <p className="wi-section-subtitle">{subtitle}</p>
    </header>
  );
}

export function Panel({ children, className = "" }: PanelProps) {
  return <section className={`wi-panel ${className}`.trim()}>{children}</section>;
}

export function StatCard({ label, headline, supporting, tone }: StatCardProps) {
  return (
    <article className={`wi-card ${toneClass[tone]}`}>
      <p className="wi-kicker">{label}</p>
      <p className="wi-card-headline">{headline}</p>
      <p className="wi-card-supporting">{supporting}</p>
    </article>
  );
}

import React from "react";
import { tokens } from "@/design/tokens";
import { cn } from "@/utils/cn";
import { ForgeCard } from "./components/ForgeCard";
import { EyebrowLabel } from "./components/EyebrowLabel";
import { StatusChip, type ChipTone } from "./components/StatusChip";

/**
 * Dev-only living style guide — reachable via `?styleguide=true` (mirrors the
 * `?v1=true` legacy-shell pattern in src/main.tsx). Renders the *real*
 * tokens.ts values and the *real* extracted V2 components, not a mockup, so
 * it can't silently drift from what ships.
 */

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="mb-10">
      <EyebrowLabel size="lg" className="text-forge-text-secondary block mb-3">
        {title}
      </EyebrowLabel>
      {children}
    </div>
  );
}

function Swatch({ name, value }: { name: string; value: string }) {
  return (
    <div className="flex items-center gap-3">
      <div
        className="w-10 h-10 rounded-forge-sm border border-forge-border-default shrink-0"
        style={{ background: value }}
      />
      <div className="min-w-0">
        <p className="text-xs font-semibold text-forge-text-primary truncate">{name}</p>
        <p className="text-[10px] text-forge-text-muted truncate">{value}</p>
      </div>
    </div>
  );
}

function flattenColorGroup(group: Record<string, unknown>): { name: string; value: string }[] {
  return Object.entries(group).flatMap(([key, val]) => {
    if (typeof val === "string") return [{ name: key, value: val }];
    if (val && typeof val === "object") {
      return Object.entries(val as Record<string, string>).map(([sub, v]) => ({
        name: sub === "DEFAULT" ? key : `${key}.${sub}`,
        value: v,
      }));
    }
    return [];
  });
}

const CHIP_TONES: ChipTone[] = [
  "primary",
  "success",
  "warning",
  "danger",
  "insight",
  "neutral",
  "grade-best",
  "grade-inaccuracy",
  "grade-mistake",
  "grade-blunder",
  "drill-blunder",
  "drill-deviation",
  "drill-review",
  "drill-punish",
];

export const StyleGuideScreen: React.FC = () => {
  return (
    <div className="h-[100dvh] overflow-y-auto bg-forge-base text-forge-text-primary font-outfit p-5">
      <h1 className="text-2xl font-black mb-1">Chess Forge Design System</h1>
      <p className="text-sm text-forge-text-secondary mb-8">
        Dark theme only. Every swatch and component below reads live from{" "}
        <code className="text-forge-primary-hover">src/design/tokens.ts</code> and{" "}
        <code className="text-forge-primary-hover">src/v2/components/</code>.
      </p>

      <Section title="Backgrounds">
        <div className="grid grid-cols-2 gap-3">
          {flattenColorGroup(tokens.bg).map((s) => (
            <Swatch key={s.name} name={`bg.${s.name}`} value={s.value} />
          ))}
        </div>
      </Section>

      <Section title="Accents">
        <div className="grid grid-cols-2 gap-3">
          {flattenColorGroup(tokens.accent).map((s) => (
            <Swatch key={s.name} name={`accent.${s.name}`} value={s.value} />
          ))}
        </div>
      </Section>

      <Section title="Chess-semantic: grade">
        <div className="grid grid-cols-2 gap-3">
          {flattenColorGroup(tokens.grade).map((s) => (
            <Swatch key={s.name} name={`grade.${s.name}`} value={s.value} />
          ))}
        </div>
      </Section>

      <Section title="Chess-semantic: drill source">
        <div className="grid grid-cols-2 gap-3">
          {flattenColorGroup(tokens.drillSource).map((s) => (
            <Swatch key={s.name} name={`drillSource.${s.name}`} value={s.value} />
          ))}
        </div>
      </Section>

      <Section title="Text">
        <div className="grid grid-cols-2 gap-3">
          {flattenColorGroup(tokens.text).map((s) => (
            <Swatch key={s.name} name={`text.${s.name}`} value={s.value} />
          ))}
        </div>
      </Section>

      <Section title="Typography — label roles">
        <div className="flex flex-col gap-2">
          <span className="text-forge-label-sm font-black uppercase text-forge-text-secondary">
            label sm (8px) — dense inline tags
          </span>
          <span className="text-forge-label font-black uppercase text-forge-text-secondary">
            label default (10px) — the dominant eyebrow size
          </span>
          <span className="text-forge-label-lg font-black uppercase text-forge-text-secondary">
            label lg (11px) — section headers
          </span>
        </div>
      </Section>

      <Section title="Radius">
        <div className="flex items-end gap-4 flex-wrap">
          {Object.entries(tokens.radius).map(([name, value]) => (
            <div key={name} className="flex flex-col items-center gap-1.5">
              <div
                className="w-14 h-14 bg-forge-elevated border border-forge-border-default"
                style={{ borderRadius: value }}
              />
              <span className="text-[10px] text-forge-text-muted">{name}</span>
            </div>
          ))}
        </div>
      </Section>

      <Section title="Motion">
        <div className="flex flex-col gap-3">
          {(["fast", "base"] as const).map((speed) => (
            <button
              key={speed}
              className={cn(
                "w-40 px-4 py-2 rounded-forge-sm bg-forge-elevated border border-forge-border-subtle",
                "hover:bg-forge-primary hover:border-forge-primary-border",
                "transition-colors",
                speed === "fast" ? "duration-forge-fast" : "duration-forge-base",
              )}
            >
              motion.{speed} ({tokens.motion[speed]}) — hover me
            </button>
          ))}
        </div>
      </Section>

      <Section title="Component: ForgeCard">
        <ForgeCard className="p-4">
          <p className="text-sm text-forge-text-primary">
            The card wrapper repeated across every V2 screen, now a component:{" "}
            <code className="text-forge-primary-hover">bg-forge-card border border-forge-border-subtle rounded-forge-xl</code>.
          </p>
        </ForgeCard>
      </Section>

      <Section title="Component: StatusChip">
        <div className="flex flex-wrap gap-2">
          {CHIP_TONES.map((tone) => (
            <StatusChip key={tone} tone={tone}>
              {tone}
            </StatusChip>
          ))}
        </div>
      </Section>
    </div>
  );
};

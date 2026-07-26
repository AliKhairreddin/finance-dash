import { Info } from "lucide-react";
import { type ReactNode, useEffect, useId, useMemo, useState } from "react";

const completedNumberAnimations = new Set<string>();

type NumberParts = {
  decimals: number;
  prefix: string;
  suffix: string;
  target: number;
  useGrouping: boolean;
};

function parseNumber(value: string): NumberParts | null {
  const match = value.match(/^(.*?)(-?\d[\d,]*(?:\.\d+)?)(.*)$/);
  if (!match) return null;

  const numericToken = match[2];
  const target = Number(numericToken.replaceAll(",", ""));
  if (!Number.isFinite(target)) return null;

  return {
    decimals: numericToken.includes(".") ? numericToken.split(".")[1].length : 0,
    prefix: match[1],
    suffix: match[3],
    target,
    useGrouping: numericToken.includes(",")
  };
}

function formatAnimatedValue(parts: NumberParts, value: number): string {
  const number = new Intl.NumberFormat("en-US", {
    minimumFractionDigits: parts.decimals,
    maximumFractionDigits: parts.decimals,
    useGrouping: parts.useGrouping
  }).format(value);

  return `${parts.prefix}${number}${parts.suffix}`;
}

export function AnimatedNumber({
  animationKey,
  className,
  value
}: {
  animationKey: string;
  className?: string;
  value: string;
}) {
  const parts = useMemo(() => parseNumber(value), [value]);
  const reducedMotion =
    typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const shouldAnimate = Boolean(parts) && !reducedMotion && !completedNumberAnimations.has(animationKey);
  const [displayValue, setDisplayValue] = useState(() =>
    shouldAnimate && parts ? formatAnimatedValue(parts, 0) : value
  );

  useEffect(() => {
    if (!parts || reducedMotion || completedNumberAnimations.has(animationKey)) {
      setDisplayValue(value);
      return;
    }

    const animationParts = parts;
    let frame = 0;
    const duration = 640;
    const startedAt = window.performance.now();

    function tick(now: number) {
      const progress = Math.min(1, (now - startedAt) / duration);
      const easedProgress = 1 - Math.pow(1 - progress, 3);
      setDisplayValue(formatAnimatedValue(animationParts, animationParts.target * easedProgress));

      if (progress < 1) {
        frame = window.requestAnimationFrame(tick);
      } else {
        completedNumberAnimations.add(animationKey);
        setDisplayValue(value);
      }
    }

    frame = window.requestAnimationFrame(tick);
    return () => window.cancelAnimationFrame(frame);
  }, [animationKey, parts, reducedMotion, value]);

  return (
    <span aria-label={value} className={className} data-animated-number>
      {displayValue}
    </span>
  );
}

export function InfoPopover({
  children,
  label
}: {
  children: ReactNode;
  label: string;
}) {
  const popoverId = useId();

  return (
    <span className="note-popover">
      <button
        aria-describedby={popoverId}
        aria-label={`About ${label}`}
        className="note-popover-trigger"
        type="button"
      >
        <Info aria-hidden="true" size={13} />
      </button>
      <span className="note-popover-panel" id={popoverId} role="tooltip">
        {children}
      </span>
    </span>
  );
}

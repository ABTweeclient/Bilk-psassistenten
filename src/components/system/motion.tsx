import { useEffect, useState, type CSSProperties, type ElementType, type ReactNode } from "react";
import { severityLabels, stampTexts, type RiskLevel } from "@/lib/report";

export type { RiskLevel };

const reducedMotionQuery = "(prefers-reduced-motion: reduce)";

function prefersReducedMotion() {
  return typeof window !== "undefined" && window.matchMedia(reducedMotionQuery).matches;
}

type RevealProps = {
  children: ReactNode;
  as?: ElementType;
  className?: string;
  /** Stagger offset in ms. Keep within 80–120 ms between siblings. */
  delay?: number;
  /** id of the heading that names this element; forwarded as aria-labelledby. */
  labelledBy?: string;
  /** Anchor target, so the report's table of contents can link to a section. */
  id?: string;
};

/** Fades and lifts its children into view once, using IntersectionObserver. */
export function Reveal({ children, as: Tag = "div", className = "", delay = 0, labelledBy, id }: RevealProps) {
  const [element, setElement] = useState<HTMLElement | null>(null);
  /* Reduced motion starts revealed, so nothing has to be flipped on mount. */
  const [visible, setVisible] = useState(() => prefersReducedMotion());

  useEffect(() => {
    if (!element || visible) return;
    const observer = new IntersectionObserver(([entry]) => {
      if (!entry.isIntersecting) return;
      setVisible(true);
      observer.disconnect();
    }, { threshold: 0.05, rootMargin: "0px 0px -40px 0px" });
    observer.observe(element);
    return () => observer.disconnect();
  }, [element, visible]);

  return (
    <Tag
      ref={setElement}
      id={id}
      className={`reveal ${visible ? "is-visible" : ""} ${className}`.trim()}
      style={{ "--reveal-delay": `${delay}ms` } as CSSProperties}
      aria-labelledby={labelledBy}
    >
      {children}
    </Tag>
  );
}

/** Ramps a number into view. Tabular figures keep the width from jumping. */
export function CountUp({ value, duration = 420, suffix = "" }: { value: number; duration?: number; suffix?: string }) {
  const [display, setDisplay] = useState(0);
  const [element, setElement] = useState<HTMLSpanElement | null>(null);

  useEffect(() => {
    if (!element) return;
    let frame = 0;
    let start = 0;
    const observer = new IntersectionObserver(([entry]) => {
      if (!entry.isIntersecting) return;
      observer.disconnect();
      if (prefersReducedMotion()) {
        setDisplay(value);
        return;
      }
      const step = (now: number) => {
        if (!start) start = now;
        const progress = Math.min((now - start) / duration, 1);
        setDisplay(Math.round(value * progress));
        if (progress < 1) frame = window.requestAnimationFrame(step);
      };
      frame = window.requestAnimationFrame(step);
    }, { threshold: 0.3 });
    observer.observe(element);
    return () => {
      observer.disconnect();
      window.cancelAnimationFrame(frame);
    };
  }, [element, value, duration]);

  useEffect(() => {
    const printValue = () => setDisplay(value);
    window.addEventListener("beforeprint", printValue);
    return () => window.removeEventListener("beforeprint", printValue);
  }, [value]);

  return <span ref={setElement} className="ds-count">{formatNumber(display)}{suffix}</span>;
}

const numberFormat = new Intl.NumberFormat("sv-SE");
function formatNumber(value: number) {
  return numberFormat.format(value);
}

/**
 * Meter that fills from 0 to its value; the level label and stamp land once it
 * has settled. Stämpeltexten kommer från rapportens etiketter, så att den alltid
 * säger "VÅR BEDÖMNING: …" och aldrig liknar ett godkännande.
 */
export function RiskMeter({ score, level, label = "BEDÖMD RISKNIVÅ" }: { score: number; level: RiskLevel; label?: string }) {
  const [progress, setProgress] = useState(0);
  const [settled, setSettled] = useState(false);
  const [element, setElement] = useState<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!element) return;
    let timer = 0;
    const observer = new IntersectionObserver(([entry]) => {
      if (!entry.isIntersecting) return;
      observer.disconnect();
      setProgress(score);
      if (prefersReducedMotion()) setSettled(true);
      else timer = window.setTimeout(() => setSettled(true), 520);
    }, { threshold: 0.25 });
    observer.observe(element);
    const printReport = () => {
      setProgress(score);
      setSettled(true);
    };
    window.addEventListener("beforeprint", printReport);
    return () => {
      observer.disconnect();
      window.clearTimeout(timer);
      window.removeEventListener("beforeprint", printReport);
    };
  }, [element, score]);

  return (
    <div ref={setElement} className={`ds-meter ds-meter--${level}`}>
      <div className="ds-meter__head">
        <span className="ds-meter__label">{label}</span>
        <span className="ds-meter__value"><CountUp value={score} /> / 100</span>
      </div>
      <div className="ds-meter__track" role="meter" aria-label={`${label}: ${severityLabels[level]}`} aria-valuemin={0} aria-valuemax={100} aria-valuenow={score}>
        <span className="ds-meter__fill" style={{ transform: `scaleX(${progress / 100})` }} />
      </div>
      {settled
        ? <span className={`ds-stamp ds-stamp--${level} is-landed`}>{stampTexts[level]}</span>
        : <span className="ds-stamp" aria-hidden="true" />}
    </div>
  );
}

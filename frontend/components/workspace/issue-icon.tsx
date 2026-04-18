import * as React from "react";
import type { IssueType } from "@/lib/types";

/**
 * Issue-type glyphs from the Loupe brand pack.
 * All icons are 24×24, 2px stroke, stroke=currentColor — so they recolor
 * naturally via CSS `color:` on the parent (we use severity colors).
 */

const baseProps = {
  xmlns: "http://www.w3.org/2000/svg",
  viewBox: "0 0 24 24",
  width: 24,
  height: 24,
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 2,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
};

const ICONS: Record<IssueType, React.ReactNode> = {
  arithmetic: (
    <>
      <rect x={3} y={3} width={18} height={18} rx={2.5} />
      <line x1={3} y1={12} x2={21} y2={12} />
      <line x1={12} y1={3} x2={12} y2={21} />
      <line x1={7.5} y1={6} x2={7.5} y2={9} />
      <line x1={6} y1={7.5} x2={9} y2={7.5} />
      <line x1={15} y1={7.5} x2={18} y2={7.5} />
      <line x1={6} y1={15} x2={9} y2={18} />
      <line x1={9} y1={15} x2={6} y2={18} />
      <line x1={15} y1={16} x2={18} y2={16} />
      <line x1={15} y1={19} x2={18} y2={19} />
    </>
  ),
  logic: (
    <>
      <circle cx={5} cy={12} r={2.5} />
      <circle cx={19} cy={12} r={2.5} />
      <line x1={7.5} y1={12} x2={10.5} y2={12} />
      <line x1={13.5} y1={12} x2={16.5} y2={12} />
      <line x1={11.5} y1={10} x2={12.5} y2={14} />
    </>
  ),
  unstated_assumption: (
    <>
      <path d="M5 9 Q5 6 8 6 L8 8 Q6.5 8 6.5 10 L6.5 13 L5 13 Z" />
      <path d="M10 9 Q10 6 13 6 L13 8 Q11.5 8 11.5 10 L11.5 13 L10 13 Z" />
      <line x1={17} y1={14} x2={17} y2={20} />
      <line x1={14.5} y1={15.5} x2={19.5} y2={18.5} />
      <line x1={19.5} y1={15.5} x2={14.5} y2={18.5} />
    </>
  ),
  wrong_constant: (
    <>
      <line x1={6} y1={8} x2={18} y2={8} />
      <line x1={9} y1={8} x2={9} y2={17} />
      <line x1={15} y1={8} x2={15} y2={16} />
      <path d="M15 16 Q16.5 17.5 18 16.5" />
      <line x1={5} y1={19} x2={19} y2={5} />
    </>
  ),
  quantifier_scope: (
    <>
      <line x1={3} y1={13} x2={21} y2={13} strokeDasharray="2 2" />
      <path d="M9 13 L12 5 L15 13 Z" />
      <path d="M7 13 L12 21 L17 13" strokeDasharray="2.5 2" />
    </>
  ),
  citation_required: (
    <>
      <path d="M4 5 L8 15 L12 5" />
      <line x1={5.5} y1={11} x2={10.5} y2={11} />
      <line x1={15} y1={5} x2={20} y2={5} />
      <line x1={15} y1={10} x2={19} y2={10} />
      <line x1={15} y1={15} x2={20} y2={15} />
      <line x1={15} y1={5} x2={15} y2={15} />
      <path d="M4 19 L4 21 L20 21 L20 19" />
    </>
  ),
  definition_mismatch: (
    <>
      <rect x={2.5} y={7} width={7} height={10} rx={1.5} />
      <rect x={14.5} y={7} width={7} height={10} rx={1.5} />
      <line x1={5} y1={11} x2={7} y2={11} />
      <line x1={17} y1={13} x2={19} y2={13} />
      <line x1={10} y1={10.5} x2={14} y2={10.5} />
      <line x1={10} y1={13.5} x2={14} y2={13.5} />
      <line x1={13} y1={9} x2={11} y2={15} />
    </>
  ),
  missing_step: (
    <>
      <path d="M3 20 L7 20 L7 16 L10 16 L10 12" />
      <path d="M14 12 L14 8 L17 8 L17 4 L21 4" />
      <path d="M10 12 L14 12" strokeDasharray="2 2" />
    </>
  ),
  other: (
    <>
      <rect x={3} y={8} width={18} height={8} rx={4} />
      <circle cx={8} cy={12} r={0.6} fill="currentColor" />
      <circle cx={12} cy={12} r={0.6} fill="currentColor" />
      <circle cx={16} cy={12} r={0.6} fill="currentColor" />
    </>
  ),
};

export function IssueIcon({
  type,
  size = 16,
  className,
}: {
  type: IssueType;
  size?: number;
  className?: string;
}) {
  return (
    <svg
      {...baseProps}
      width={size}
      height={size}
      className={className}
      aria-hidden="true"
    >
      {ICONS[type]}
    </svg>
  );
}

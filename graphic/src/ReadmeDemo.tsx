import React from "react";
import {
  AbsoluteFill,
  interpolate,
  spring,
  useCurrentFrame,
  useVideoConfig,
} from "remotion";

import { theme } from "./theme";

/**
 * The README animation. It shows one backfill command, then the number that
 * makes this dataset different from every "insider buying" feed: of 9.9M legs,
 * only 894,244 are open-market purchases. Everything shown is measured output,
 * not a mock-up of a feature that does not exist.
 */
const COMMAND = "npx sec-backfill --dataset form345 --from 2006q1 --to 2026q1 --run";

function reveal(text: string, frame: number, start: number, framesPerCharacter = 0.8): string {
  const characters = Math.max(0, Math.floor((frame - start) / framesPerCharacter));
  return text.slice(0, characters);
}

const Line: React.FC<{
  children: React.ReactNode;
  visible: number;
  color?: string;
  size?: number;
}> = ({ children, visible, color = theme.text, size = 21 }) => (
  <div
    style={{
      color,
      fontSize: size,
      opacity: visible,
      transform: `translateY(${interpolate(visible, [0, 1], [8, 0])}px)`,
      lineHeight: 1.6,
      whiteSpace: "pre",
    }}
  >
    {children}
  </div>
);

export const ReadmeDemo: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const command = reveal(COMMAND, frame, 12);

  const at = (start: number, damping = 200) =>
    spring({ frame: frame - start, fps, config: { damping } });

  const quarters = at(92);
  const receipts = at(112);
  const rows = at(132);
  const audit = at(158);
  const payoff = at(196, 180);
  const pit = at(232, 180);

  // The counter runs up rather than appearing, so the scale registers — but it
  // lands on the exact measured total. A spring approaches its target
  // asymptotically and stopped three short (9,923,752), and a hero number that
  // does not match the dataset is worse than no animation.
  const TOTAL_LEGS = 9_923_755;
  const counted = Math.round(
    interpolate(frame, [196, 238], [0, TOTAL_LEGS], {
      extrapolateLeft: "clamp",
      extrapolateRight: "clamp",
    })
  );

  return (
    <AbsoluteFill style={{ backgroundColor: theme.bg, fontFamily: theme.mono, padding: 46 }}>
      <div
        style={{
          backgroundColor: theme.panel,
          border: `1px solid ${theme.border}`,
          borderRadius: 12,
          height: "100%",
          padding: "26px 32px",
          display: "flex",
          flexDirection: "column",
          gap: 4,
        }}
      >
        <div style={{ display: "flex", gap: 8, marginBottom: 18 }}>
          {[theme.bad, theme.warn, theme.ok].map((color) => (
            <div key={color} style={{ width: 12, height: 12, borderRadius: 6, backgroundColor: color }} />
          ))}
          <div style={{ color: theme.muted, fontSize: 15, marginLeft: 12 }}>
            sec-ownership-disclosures
          </div>
        </div>

        <Line visible={1}>
          <span style={{ color: theme.ok }}>$ </span>
          {command}
          {frame < 90 && frame % 16 < 8 ? <span style={{ color: theme.accent }}>▊</span> : ""}
        </Line>

        <div style={{ height: 14 }} />

        <Line visible={quarters} color={theme.muted}>
          {"  81 quarterly data sets · 2006q1 → 2026q1 · resumable, content-addressed"}
        </Line>
        <Line visible={receipts} color={theme.muted}>
          {"  receipts written per quarter — a restarted machine processes nothing twice"}
        </Line>
        <Line visible={rows}>
          <span style={{ color: theme.ok }}>{"  ✓ "}</span>
          {"4,772,838 filings · 9,923,755 transactions"}
        </Line>
        <Line visible={audit}>
          <span style={{ color: theme.ok }}>{"  ✓ "}</span>
          {"integrity: re-parsed every archive · grain unique · 0 orphan joins"}
        </Line>

        <div style={{ height: 22 }} />

        <div
          style={{
            opacity: payoff,
            transform: `translateY(${interpolate(payoff, [0, 1], [14, 0])}px)`,
            borderLeft: `3px solid ${theme.accent}`,
            paddingLeft: 18,
          }}
        >
          <div style={{ color: theme.muted, fontSize: 17, fontFamily: theme.sans }}>
            Insider transaction legs
          </div>
          <div style={{ color: theme.text, fontSize: 40, letterSpacing: -1 }}>
            {counted.toLocaleString("en-US")}
          </div>
          <div style={{ color: theme.muted, fontSize: 18, marginTop: 8, fontFamily: theme.sans }}>
            of which{" "}
            <span style={{ color: theme.ok }}>894,244 are open-market purchases</span> — the rest
            are grants, exercises and sales
          </div>
        </div>

        <div style={{ height: 18 }} />

        <div
          style={{
            opacity: pit,
            color: theme.muted,
            fontFamily: theme.sans,
            fontSize: 18,
          }}
        >
          Every row carries{" "}
          <span style={{ color: theme.accent, fontFamily: theme.mono }}>availableAt</span> — when
          the filing could first be known, never the transaction date.
        </div>

        <div style={{ flex: 1 }} />

        <div
          style={{
            opacity: at(252),
            borderTop: `1px solid ${theme.border}`,
            paddingTop: 16,
            display: "flex",
            justifyContent: "space-between",
            color: theme.muted,
            fontSize: 17,
          }}
        >
          <span>npm install sec-ownership-disclosures</span>
          <span style={{ fontFamily: theme.sans }}>MIT · Form 3/4/5 and 13F · official EDGAR</span>
        </div>
      </div>
    </AbsoluteFill>
  );
};

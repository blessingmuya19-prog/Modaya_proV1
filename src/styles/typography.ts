/**
 * Modaya Typography System
 * Primary: Inter Tight — used for ALL UI text
 * Secondary: Inter — only for long-form body copy / dense descriptions
 *
 * Design intent: modern, compact, premium, AI-native.
 * Feels like Lovable / Suno / OpusClip — not Premiere Pro.
 */

export const FONT = {
  tight:  "'Inter Tight', sans-serif",
  body:   "'Inter', sans-serif",
} as const;

export const SIZE = {
  /* Marketing */
  heroXL:   'clamp(40px, 6.5vw, 76px)',
  heroLG:   'clamp(28px, 4vw, 48px)',
  heroMD:   'clamp(22px, 3.5vw, 36px)',
  sectionH: 'clamp(28px, 4vw, 52px)',
  stat:     'clamp(22px, 3.5vw, 32px)',

  /* App headings */
  h1:  28,
  h2:  20,
  h3:  16,
  h4:  14,

  /* UI */
  ui14:  14,
  ui13:  13,
  ui12:  12,
  ui11:  11,
  ui10:  10,

  /* Editor-specific */
  projectTitle: 15,
  toolbarCtrl:  13,
  sidebarLabel: 13,
  timelineClip: 11,
  timelineMeta: 10,
  inspectorLabel: 12,
  inspectorVal:   13,
  aiHeader:       12,
  aiAction:       13,
  aiDesc:         12,
  aiPrompt:       14,
  videoMeta:      11,
  tooltip:        12,
  badge:          10,
  overline:       10,
} as const;

export const WEIGHT = {
  regular:   400,
  medium:    500,
  semibold:  600,
  bold:      700,
} as const;

export const TRACKING = {
  tightest:  '-0.045em',  // large marketing headings
  tight:     '-0.025em',  // section headings
  ui:        '-0.01em',   // general UI text
  neutral:   '0em',
  timeline:  '-0.005em',  // timeline text
  overline:  '0.07em',    // uppercase labels
} as const;

export const LINE = {
  heading:  1.0,
  compact:  1.2,
  ui:       1.3,
  body:     1.5,
  timeline: 1.1,
} as const;

export const TEXT = {
  primary:   '#F5F7FA',
  secondary: '#A5ADBA',
  muted:     '#737D8D',
  dim:       '#4D5664',
  active:    '#FFFFFF',
  accent:    '#8B5CF6',
  placeholder: '#737D8D',
} as const;

/* ── Convenience style objects ── */

export const T = {
  /* Marketing */
  heroXL: {
    fontFamily: FONT.tight, fontSize: SIZE.heroXL,
    fontWeight: WEIGHT.bold, letterSpacing: TRACKING.tightest,
    lineHeight: LINE.heading, color: TEXT.active,
  },
  sectionH: {
    fontFamily: FONT.tight, fontSize: SIZE.sectionH,
    fontWeight: WEIGHT.bold, letterSpacing: TRACKING.tight,
    lineHeight: LINE.heading, color: TEXT.active,
  },
  stat: {
    fontFamily: FONT.tight, fontSize: SIZE.stat,
    fontWeight: WEIGHT.bold, letterSpacing: TRACKING.tight,
    lineHeight: LINE.heading, color: TEXT.active,
  },

  /* App headings */
  h1: {
    fontFamily: FONT.tight, fontSize: SIZE.h1,
    fontWeight: WEIGHT.bold, letterSpacing: TRACKING.tight,
    lineHeight: LINE.compact, color: TEXT.active,
  },
  h2: {
    fontFamily: FONT.tight, fontSize: SIZE.h2,
    fontWeight: WEIGHT.semibold, letterSpacing: TRACKING.ui,
    lineHeight: LINE.compact, color: TEXT.active,
  },
  h3: {
    fontFamily: FONT.tight, fontSize: SIZE.h3,
    fontWeight: WEIGHT.semibold, letterSpacing: TRACKING.ui,
    lineHeight: LINE.compact, color: TEXT.active,
  },

  /* Editor UI */
  projectTitle: {
    fontFamily: FONT.tight, fontSize: SIZE.projectTitle,
    fontWeight: WEIGHT.semibold, letterSpacing: TRACKING.ui,
    lineHeight: LINE.compact, color: TEXT.primary,
  },
  toolbarCtrl: {
    fontFamily: FONT.tight, fontSize: SIZE.toolbarCtrl,
    fontWeight: WEIGHT.medium, letterSpacing: TRACKING.ui,
    lineHeight: LINE.compact, color: TEXT.secondary,
  },
  sidebarLabel: {
    fontFamily: FONT.tight, fontSize: SIZE.sidebarLabel,
    fontWeight: WEIGHT.medium, letterSpacing: TRACKING.ui,
    lineHeight: LINE.compact, color: TEXT.secondary,
  },
  inspectorLabel: {
    fontFamily: FONT.tight, fontSize: SIZE.inspectorLabel,
    fontWeight: WEIGHT.medium, letterSpacing: TRACKING.ui,
    lineHeight: LINE.compact, color: TEXT.muted,
  },
  inspectorVal: {
    fontFamily: FONT.tight, fontSize: SIZE.inspectorVal,
    fontWeight: WEIGHT.medium, letterSpacing: TRACKING.ui,
    lineHeight: LINE.compact, color: TEXT.primary,
  },
  timelineClip: {
    fontFamily: FONT.tight, fontSize: SIZE.timelineClip,
    fontWeight: WEIGHT.medium, letterSpacing: TRACKING.timeline,
    lineHeight: LINE.timeline, color: TEXT.primary,
  },
  timelineMeta: {
    fontFamily: FONT.tight, fontSize: SIZE.timelineMeta,
    fontWeight: WEIGHT.medium, letterSpacing: TRACKING.timeline,
    lineHeight: LINE.timeline, color: TEXT.muted,
  },
  aiHeader: {
    fontFamily: FONT.tight, fontSize: SIZE.aiHeader,
    fontWeight: WEIGHT.semibold, letterSpacing: TRACKING.overline,
    textTransform: 'uppercase' as const, color: TEXT.muted,
  },
  aiAction: {
    fontFamily: FONT.tight, fontSize: SIZE.aiAction,
    fontWeight: WEIGHT.medium, letterSpacing: TRACKING.ui,
    lineHeight: LINE.compact, color: TEXT.primary,
  },
  aiDesc: {
    fontFamily: FONT.tight, fontSize: SIZE.aiDesc,
    fontWeight: WEIGHT.regular, letterSpacing: TRACKING.ui,
    lineHeight: LINE.ui, color: TEXT.muted,
  },
  aiPrompt: {
    fontFamily: FONT.tight, fontSize: SIZE.aiPrompt,
    fontWeight: WEIGHT.regular, letterSpacing: TRACKING.ui,
    lineHeight: LINE.body, color: TEXT.primary,
  },
  videoMeta: {
    fontFamily: FONT.tight, fontSize: SIZE.videoMeta,
    fontWeight: WEIGHT.medium, letterSpacing: TRACKING.timeline,
    lineHeight: LINE.timeline, color: TEXT.secondary,
    fontVariantNumeric: 'tabular-nums' as const,
  },
  badge: {
    fontFamily: FONT.tight, fontSize: SIZE.badge,
    fontWeight: WEIGHT.semibold, letterSpacing: TRACKING.overline,
    textTransform: 'uppercase' as const,
  },
  overline: {
    fontFamily: FONT.tight, fontSize: SIZE.overline,
    fontWeight: WEIGHT.semibold, letterSpacing: TRACKING.overline,
    textTransform: 'uppercase' as const, color: TEXT.muted,
  },
  tooltip: {
    fontFamily: FONT.tight, fontSize: SIZE.tooltip,
    fontWeight: WEIGHT.medium, letterSpacing: TRACKING.ui,
    lineHeight: LINE.compact, color: TEXT.primary,
  },

  /* Body copy */
  body: {
    fontFamily: FONT.body, fontSize: 14,
    fontWeight: WEIGHT.regular, letterSpacing: TRACKING.ui,
    lineHeight: LINE.body, color: TEXT.secondary,
  },
  bodySmall: {
    fontFamily: FONT.body, fontSize: 13,
    fontWeight: WEIGHT.regular, letterSpacing: TRACKING.ui,
    lineHeight: LINE.body, color: TEXT.muted,
  },
} as const;

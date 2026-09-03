/**
 * Kinetic Word-by-Word Subtitle Karaoke Animation & Viral Caption Styles.
 *
 * Implements modern short-form subtitle styles (MrBeast, Hormozi, Neon Glow, etc.)
 * with word-level timing, active-word bounce scaling, glow shadows, background pill boxes,
 * and high-contrast outline rendering.
 */

export type CaptionAnimation =
  | 'none'
  | 'karaoke_pop'
  | 'karaoke_glow'
  | 'karaoke_box'
  | 'typewriter';

export interface TimedWord {
  word: string;
  startS: number;
  endS: number;
}

export interface CaptionStylePreset {
  id: string;
  name: string;
  description: string;
  font: 'sans' | 'display' | 'mono' | 'serif' | 'handwritten';
  size: 'small' | 'medium' | 'large';
  colour: string;
  highlightColour: string;
  outlineColour?: string;
  outlineWidth?: number;
  background: 'box' | 'shadow' | 'none';
  boxColour?: string;
  bold: boolean;
  uppercase: boolean;
  animation: CaptionAnimation;
  glowRadius?: number;
  glowColour?: string;
}

export const CAPTION_PRESETS: Record<string, CaptionStylePreset> = {
  mrbeast: {
    id: 'mrbeast',
    name: 'MrBeast Viral',
    description: 'High-impact display font with bright yellow active-word pop and bold outline',
    font: 'display',
    size: 'large',
    colour: '#FFFFFF',
    highlightColour: '#FACC15', // Vibrant Yellow
    outlineColour: '#000000',
    outlineWidth: 4,
    background: 'none',
    bold: true,
    uppercase: true,
    animation: 'karaoke_pop',
  },
  hormozi: {
    id: 'hormozi',
    name: 'Hormozi Green',
    description: 'Clean uppercase sans with electric green highlight and high-contrast badge',
    font: 'sans',
    size: 'medium',
    colour: '#FFFFFF',
    highlightColour: '#22C55E', // Electric Green
    outlineColour: '#000000',
    outlineWidth: 3,
    background: 'box',
    boxColour: 'rgba(0,0,0,0.85)',
    bold: true,
    uppercase: true,
    animation: 'karaoke_box',
  },
  neonglow: {
    id: 'neonglow',
    name: 'Cyber Neon Glow',
    description: 'Radiant cyan glow with pop animation on spoken words',
    font: 'sans',
    size: 'medium',
    colour: '#E0F2FE',
    highlightColour: '#38BDF8', // Cyan Glow
    outlineColour: '#0369A1',
    outlineWidth: 2,
    background: 'shadow',
    bold: true,
    uppercase: true,
    animation: 'karaoke_glow',
    glowRadius: 18,
    glowColour: 'rgba(56, 189, 248, 0.85)',
  },
  crimson: {
    id: 'crimson',
    name: 'Crimson Punch',
    description: 'Bold red accent on important words with solid backdrop',
    font: 'display',
    size: 'medium',
    colour: '#FFFFFF',
    highlightColour: '#EF4444', // Hot Red
    outlineColour: '#000000',
    outlineWidth: 3,
    background: 'box',
    boxColour: 'rgba(20, 10, 10, 0.88)',
    bold: true,
    uppercase: true,
    animation: 'karaoke_pop',
  },
  clean: {
    id: 'clean',
    name: 'Clean Minimal',
    description: 'Elegant white typography with soft drop shadow',
    font: 'sans',
    size: 'medium',
    colour: '#FFFFFF',
    highlightColour: '#FFFFFF',
    outlineColour: 'rgba(0,0,0,0.5)',
    outlineWidth: 1.5,
    background: 'shadow',
    bold: true,
    uppercase: false,
    animation: 'none',
  },
};

/**
 * Splits a full phrase into timed words. If exact word timings are provided,
 * uses them; otherwise interpolates linear start/end times across clip duration.
 */
export function extractTimedWords(
  text: string,
  startS: number,
  endS: number,
  providedWords?: TimedWord[],
): TimedWord[] {
  if (providedWords && providedWords.length > 0) {
    return providedWords;
  }

  const rawWords = text.trim().split(/\s+/).filter(Boolean);
  if (rawWords.length === 0) return [];

  const duration = Math.max(0.1, endS - startS);
  const wordDur = duration / rawWords.length;

  return rawWords.map((word, idx) => ({
    word,
    startS: startS + idx * wordDur,
    endS: startS + (idx + 1) * wordDur,
  }));
}

/**
 * Calculates current word animation scale & active state at timestamp `timeS`.
 */
export function getWordAnimationState(
  word: TimedWord,
  timeS: number,
  anim: CaptionAnimation,
): { isActive: boolean; isPast: boolean; scale: number; opacity: number } {
  const isPast = timeS >= word.endS;
  const isActive = timeS >= word.startS && timeS < word.endS;

  let scale = 1.0;
  let opacity = 1.0;

  if (anim === 'typewriter') {
    opacity = timeS >= word.startS ? 1.0 : 0.0;
    return { isActive, isPast, scale: 1.0, opacity };
  }

  if (isActive && anim === 'karaoke_pop') {
    const wordProgress = (timeS - word.startS) / Math.max(0.01, word.endS - word.startS);
    // Spring pop: quick scale up to 1.18 then settles to 1.08
    if (wordProgress < 0.3) {
      scale = 1.0 + Math.sin((wordProgress / 0.3) * Math.PI) * 0.18;
    } else {
      scale = 1.08;
    }
  } else if (isActive && (anim === 'karaoke_glow' || anim === 'karaoke_box')) {
    scale = 1.05;
  }

  return { isActive, isPast, scale, opacity };
}

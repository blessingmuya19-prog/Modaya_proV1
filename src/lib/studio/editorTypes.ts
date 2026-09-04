/**
 * Timeline clip shape shared by Studio's editor timeline.
 *
 * Kept out of the component tree so Studio shares one clip vocabulary
 * with the AI timeline.
 */
import type { TextStyle } from '@/lib/ai/operations';
import type { MotionTrackConfig } from '@/lib/ai/motionTracker';

export interface EditorClip {
  id: string; trackId: string; label: string;
  startS: number; endS: number; type: 'video'|'audio'|'text'|'subtitle';
  /** Text clips: where in the frame the words sit, and how they look. */
  textPosition?: 'top'|'centre'|'lower';
  textAlign?: 'left'|'centre'|'right';
  textStyle?: TextStyle;
  motionTrack?: MotionTrackConfig;
}

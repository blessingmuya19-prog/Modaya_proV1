/**
 * Asset understanding — the AI context layer's knowledge of the user's kit.
 *
 * Every agency has a kit: cutaway footage, graphics, fonts, transition SFX.
 * The composer can only use what it KNOWS. This module classifies an asset
 * from its name, MIME type and duration — deterministic and cheap — and
 * renders the kit as a context block the LLM reads, so "use a dramatic
 * transition there" can refer to the actual swoosh called "whoosh-07.mp3"
 * instead of the model guessing.
 *
 * Frame/audio-level tagging of the asset itself is a later upgrade; name +
 * type is the honest floor that never invents content.
 */

export interface AssetInfo {
  name:      string;
  mimeType?: string;
  /** Probed duration; 0 until known. */
  durationS?: number;
}

export type AssetTag =
  | 'cutaway'          // b-roll footage
  | 'graphic'          // PNG/JPG/SVG/GIF — logos, labels, warning cards
  | 'font'             // TTF/OTF/WOFF
  | 'transition sfx'   // swooshes, whooshes, impacts, stingers
  | 'voice'            // voiceover / narration
  | 'music'            // beds / loops
  | 'unknown';

function fmtDur(a: AssetInfo): string {
  return typeof a.durationS === 'number' && a.durationS > 0
    ? ` (${a.durationS.toFixed(1)}s)` : '';
}

/** Classify one asset from what is knowable without decoding it. */
export function tagAsset(a: AssetInfo): { tags: AssetTag[]; note: string } {
  const name = (a.name ?? '').toLowerCase();
  const mime = (a.mimeType ?? '').toLowerCase();
  const kind: (t: string) => boolean = (t) => name.includes(t);

  const isAudio = mime.startsWith('audio/') ||
    /\.(mp3|wav|m4a|aac|ogg|opus|flac|aiff?)$/.test(name);
  const isImage = mime.startsWith('image/') ||
    /\.(png|jpe?g|gif|webp|svg|tiff?|bmp|ai|psd)$/.test(name);
  const isFont = /\.(ttf|otf|woff2?|eot)$/.test(name) ||
    mime.includes('font') || mime.includes('opentype');

  const tags: AssetTag[] = [];

  if (isFont) {
    tags.push('font');
    return { tags, note: `typeface "${a.name}"` };
  }

  if (isImage) {
    tags.push('graphic');
    return { tags, note: `graphic "${a.name}"${fmtDur(a)}` };
  }

  if (isAudio) {
    /* SFX names are a language of their own — read them before generic audio. */
    if (/(swoosh|whoosh|transition|impact|stinger|boom|whoop|riser|swish|hit|pop|click|whip)/.test(name)) {
      tags.push('transition sfx');
      const dur = typeof a.durationS === 'number' && a.durationS > 0 ? ` (${a.durationS.toFixed(2)}s)` : '';
      return { tags, note: `transition sfx "${a.name}"${dur}` };
    }
    if (/(voice|vo|narration|speech|voiceover|voice-?over)/.test(name)) {
      tags.push('voice');
      return { tags, note: `voiceover "${a.name}"` };
    }
    tags.push('music');
    return { tags, note: `audio bed "${a.name}"${fmtDur(a)}` };
  }

  if (mime.startsWith('video/') || /\.(mp4|mov|webm|m4v)$/.test(name)) {
    tags.push('cutaway');
    return { tags, note: `cutaway "${a.name}"${fmtDur(a)}` };
  }

  return { tags: ['unknown'], note: `"${a.name}" (unclassified — check the file type)` };
}

/** The prompt block describing the whole kit. Nothing is claimed that wasn't
 *  measured — an unclassified asset says so out loud. */
export function describeAssets(assets: AssetInfo[]): string {
  if (!assets.length) return 'ASSET KIT:\n(no asset library uploaded — cutaways will come from the footage itself)';
  const lines = assets.slice(0, 60).map(a => {
    const { tags, note } = tagAsset(a);
    return `- [${tags.join(', ')}] ${note}`;
  });
  return `ASSET KIT (${assets.length} assets):\n${lines.join('\n')}`;
}

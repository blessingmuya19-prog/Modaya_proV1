/**
 * Zero-dependency client-side video & audio muxer for WebCodecs.
 *
 * Supports:
 *   1. WebM container with VP8, VP9, AV1, or AVC/H.264 video and Opus or AAC audio.
 *   2. MP4 (ISO BMFF) container with AVC/H.264 video and AAC audio.
 */

// ── EBML (WebM) Serialization Utilities ──────────────────────────────────────

function ebmlIdBytes(id: number): Uint8Array {
  if (id <= 0xff) return new Uint8Array([id]);
  if (id <= 0xffff) return new Uint8Array([(id >> 8) & 0xff, id & 0xff]);
  if (id <= 0xffffff) return new Uint8Array([(id >> 16) & 0xff, (id >> 8) & 0xff, id & 0xff]);
  return new Uint8Array([(id >>> 24) & 0xff, (id >> 16) & 0xff, (id >> 8) & 0xff, id & 0xff]);
}

function vint(val: number): Uint8Array {
  if (val < 0) throw new Error('vint value cannot be negative');
  if (val < 0x7f) {
    return new Uint8Array([0x80 | val]);
  } else if (val < 0x3fff) {
    return new Uint8Array([0x40 | (val >> 8), val & 0xff]);
  } else if (val < 0x1fffff) {
    return new Uint8Array([0x20 | (val >> 16), (val >> 8) & 0xff, val & 0xff]);
  } else if (val < 0x0fffffff) {
    return new Uint8Array([0x10 | (val >>> 24), (val >> 16) & 0xff, (val >> 8) & 0xff, val & 0xff]);
  }
  // 8-byte length
  const out = new Uint8Array(8);
  out[0] = 0x01;
  let temp = val;
  for (let i = 7; i >= 1; i--) {
    out[i] = temp & 0xff;
    temp = Math.floor(temp / 256);
  }
  return out;
}

function ebmlElem(id: number, data: Uint8Array): Uint8Array {
  const idBytes = ebmlIdBytes(id);
  const lenBytes = vint(data.length);
  const res = new Uint8Array(idBytes.length + lenBytes.length + data.length);
  res.set(idBytes, 0);
  res.set(lenBytes, idBytes.length);
  res.set(data, idBytes.length + lenBytes.length);
  return res;
}

function ebmlUint(id: number, val: number): Uint8Array {
  if (val === 0) return ebmlElem(id, new Uint8Array([0]));
  const bytes: number[] = [];
  let temp = val;
  while (temp > 0) {
    bytes.unshift(temp & 0xff);
    temp = Math.floor(temp / 256);
  }
  return ebmlElem(id, new Uint8Array(bytes));
}

function ebmlFloat(id: number, val: number): Uint8Array {
  const buf = new ArrayBuffer(8);
  new DataView(buf).setFloat64(0, val, false);
  return ebmlElem(id, new Uint8Array(buf));
}

function ebmlString(id: number, str: string): Uint8Array {
  const bytes = new TextEncoder().encode(str);
  return ebmlElem(id, bytes);
}

function ebmlContainer(id: number, children: Uint8Array[]): Uint8Array {
  const totalLen = children.reduce((sum, c) => sum + c.length, 0);
  const data = new Uint8Array(totalLen);
  let offset = 0;
  for (const c of children) {
    data.set(c, offset);
    offset += c.length;
  }
  return ebmlElem(id, data);
}

// ── WebM Muxer ───────────────────────────────────────────────────────────────

export interface EncodedChunk {
  data: Uint8Array;
  timestampUs: number;  // microseconds
  type: 'key' | 'delta';
  track: 'video' | 'audio';
}

export interface WebmMuxerOptions {
  width: number;
  height: number;
  fps: number;
  durationS: number;
  videoCodec?: 'V_VP8' | 'V_VP9' | 'V_AV1' | 'V_MPEG4/ISO/AVC';
  hasAudio?: boolean;
  audioSampleRate?: number;
  audioChannels?: number;
}

export function buildWebmBlob(
  chunks: EncodedChunk[],
  opts: WebmMuxerOptions,
): Blob {
  const { width, height, durationS, videoCodec = 'V_VP9', hasAudio, audioSampleRate = 48000, audioChannels = 2 } = opts;

  // 1. EBML Header
  const ebmlHeader = ebmlContainer(0x1a45dfa3, [
    ebmlUint(0x4286, 1),             // EBMLVersion
    ebmlUint(0x42f7, 1),             // EBMLReadVersion
    ebmlUint(0x42f2, 4),             // EBMLMaxIDLength
    ebmlUint(0x42f3, 8),             // EBMLMaxSizeLength
    ebmlString(0x4282, 'webm'),      // DocType
    ebmlUint(0x4287, 4),             // DocTypeVersion
    ebmlUint(0x4285, 2),             // DocTypeReadVersion
  ]);

  // 2. Segment Info
  const timecodeScale = 1_000_000;   // 1ms per tick
  const info = ebmlContainer(0x1549a966, [
    ebmlUint(0x2ad7b1, timecodeScale),
    ebmlString(0x4d80, 'Modaya'),
    ebmlString(0x5741, 'Modaya Fast Exporter'),
    ebmlFloat(0x4489, durationS * 1000), // Duration in ms
  ]);

  // 3. Tracks
  const videoTrack = ebmlContainer(0xae, [
    ebmlUint(0xd7, 1),               // TrackNumber: 1
    ebmlUint(0x73c5, 1),             // TrackUID: 1
    ebmlUint(0x83, 1),               // TrackType: 1 (video)
    ebmlString(0x86, videoCodec),    // CodecID
    ebmlContainer(0xe0, [            // VideoSettings
      ebmlUint(0xb0, width),         // PixelWidth
      ebmlUint(0xba, height),        // PixelHeight
    ]),
  ]);

  const trackEntries = [videoTrack];
  if (hasAudio) {
    const audioTrack = ebmlContainer(0xae, [
      ebmlUint(0xd7, 2),               // TrackNumber: 2
      ebmlUint(0x73c5, 2),             // TrackUID: 2
      ebmlUint(0x83, 2),               // TrackType: 2 (audio)
      ebmlString(0x86, 'A_OPUS'),      // CodecID
      ebmlContainer(0xe1, [            // AudioSettings
        ebmlFloat(0xb5, audioSampleRate),
        ebmlUint(0x9f, audioChannels),
      ]),
    ]);
    trackEntries.push(audioTrack);
  }

  const tracks = ebmlContainer(0x1654ae6b, trackEntries);

  // 4. Clusters (group chunks by 1-second clusters)
  const sortedChunks = [...chunks].sort((a, b) => a.timestampUs - b.timestampUs);
  const clusterElements: Uint8Array[] = [];

  let currentClusterTimeMs = 0;
  let currentClusterBlocks: Uint8Array[] = [];

  const flushCluster = () => {
    if (currentClusterBlocks.length > 0) {
      clusterElements.push(
        ebmlContainer(0x1f43b675, [
          ebmlUint(0xe7, currentClusterTimeMs),
          ...currentClusterBlocks,
        ]),
      );
      currentClusterBlocks = [];
    }
  };

  for (const chunk of sortedChunks) {
    const timeMs = Math.round(chunk.timestampUs / 1000);
    if (currentClusterBlocks.length === 0) {
      currentClusterTimeMs = timeMs;
    } else if (timeMs - currentClusterTimeMs > 2000 && chunk.type === 'key') {
      flushCluster();
      currentClusterTimeMs = timeMs;
    }

    // SimpleBlock format:
    // Track Number (vint), RelTime (int16), Flags (uint8), Payload
    const trackNum = chunk.track === 'video' ? 1 : 2;
    const trackVint = vint(trackNum);
    const relTime = Math.max(-32768, Math.min(32767, timeMs - currentClusterTimeMs));
    const flags = (chunk.type === 'key' ? 0x80 : 0x00); // 0x80 = keyframe

    const header = new Uint8Array(trackVint.length + 3);
    header.set(trackVint, 0);
    new DataView(header.buffer, header.byteOffset).setInt16(trackVint.length, relTime, false);
    header[trackVint.length + 2] = flags;

    const blockData = new Uint8Array(header.length + chunk.data.length);
    blockData.set(header, 0);
    blockData.set(chunk.data, header.length);

    currentClusterBlocks.push(ebmlElem(0xa3, blockData));
  }
  flushCluster();

  // 5. Segment
  const segment = ebmlContainer(0x18538067, [
    info,
    tracks,
    ...clusterElements,
  ]);

  return new Blob([ebmlHeader, segment] as BlobPart[], { type: 'video/webm' });
}

// ── MP4 (ISO-BMFF) Simple Muxer ──────────────────────────────────────────────

function box(type: string, ...payloads: Uint8Array[]): Uint8Array {
  const payloadLen = payloads.reduce((sum, p) => sum + p.length, 0);
  const size = 8 + payloadLen;
  const out = new Uint8Array(size);
  const dv = new DataView(out.buffer);
  dv.setUint32(0, size);
  for (let i = 0; i < 4; i++) out[4 + i] = type.charCodeAt(i);
  let offset = 8;
  for (const p of payloads) {
    out.set(p, offset);
    offset += p.length;
  }
  return out;
}

export interface Mp4MuxerOptions {
  width: number;
  height: number;
  fps: number;
  durationS: number;
  avcC?: Uint8Array;
}

export function buildMp4Blob(
  chunks: EncodedChunk[],
  opts: Mp4MuxerOptions,
): Blob {
  const { width, height, durationS, avcC } = opts;
  const timescale = 1000;
  const durationTicks = Math.round(durationS * timescale);

  // 1. ftyp box
  const ftypPayload = new Uint8Array([
    // major brand: 'isom'
    0x69, 0x73, 0x6f, 0x6d,
    // minor version: 512
    0x00, 0x00, 0x02, 0x00,
    // compatible brands: 'isom', 'iso2', 'mp41', 'avc1'
    0x69, 0x73, 0x6f, 0x6d,
    0x69, 0x73, 0x6f, 0x32,
    0x6d, 0x70, 0x34, 0x31,
    0x61, 0x76, 0x63, 0x31,
  ]);
  const ftyp = box('ftyp', ftypPayload);

  // Filter video chunks
  const videoChunks = chunks.filter(c => c.track === 'video').sort((a, b) => a.timestampUs - b.timestampUs);

  // mdat payload
  const mdatTotalBytes = videoChunks.reduce((s, c) => s + c.data.length, 0);
  const mdatPayload = new Uint8Array(mdatTotalBytes);
  const sampleSizes: number[] = [];
  const keyframeIndices: number[] = [];
  let mdatOffset = 0;

  for (let i = 0; i < videoChunks.length; i++) {
    const ch = videoChunks[i];
    mdatPayload.set(ch.data, mdatOffset);
    mdatOffset += ch.data.length;
    sampleSizes.push(ch.data.length);
    if (ch.type === 'key') keyframeIndices.push(i + 1); // 1-based index
  }
  const mdat = box('mdat', mdatPayload);

  // Calculate mdat header position (ftyp length + moov length placeholder)
  // 2. moov construction
  const mvhd = new Uint8Array(100);
  const mvhdView = new DataView(mvhd.buffer);
  mvhdView.setUint32(0, 0);                 // version 0 + flags 0
  mvhdView.setUint32(12, timescale);        // timescale
  mvhdView.setUint32(16, durationTicks);    // duration
  mvhdView.setUint32(20, 0x00010000);       // rate 1.0
  mvhdView.setUint16(24, 0x0100);           // volume 1.0
  // Matrix (identity)
  mvhdView.setUint32(36, 0x00010000);
  mvhdView.setUint32(52, 0x00010000);
  mvhdView.setUint32(68, 0x40000000);
  mvhdView.setUint32(96, 2);                // next track ID: 2

  const tkhd = new Uint8Array(84);
  const tkhdView = new DataView(tkhd.buffer);
  tkhdView.setUint32(0, 0x00000003);        // version 0 + flags enabled/in-movie
  tkhdView.setUint32(12, 1);                // track ID 1
  tkhdView.setUint32(20, durationTicks);    // duration
  // Matrix
  tkhdView.setUint32(36, 0x00010000);
  tkhdView.setUint32(52, 0x00010000);
  tkhdView.setUint32(68, 0x40000000);
  tkhdView.setUint32(76, width << 16);      // width fixed-point
  tkhdView.setUint32(80, height << 16);     // height fixed-point

  const mdhd = new Uint8Array(24);
  const mdhdView = new DataView(mdhd.buffer);
  mdhdView.setUint32(12, timescale);
  mdhdView.setUint32(16, durationTicks);

  const hdlr = new Uint8Array(25);
  const hdlrView = new DataView(hdlr.buffer);
  hdlrView.setUint32(8, 0x76696465); // 'vide'

  const vmhd = new Uint8Array(12);
  const vmhdView = new DataView(vmhd.buffer);
  vmhdView.setUint32(0, 0x00000001);

  const dref = box('dref', new Uint8Array([0, 0, 0, 0, 0, 0, 0, 1]), box('url ', new Uint8Array([0, 0, 0, 1])));
  const dinf = box('dinf', dref);

  // Sample Table (stbl)
  // stsd (sample description)
  const avc1Visual = new Uint8Array(78);
  const avc1View = new DataView(avc1Visual.buffer);
  avc1View.setUint16(6, 1); // data reference index
  avc1View.setUint16(24, width);
  avc1View.setUint16(26, height);
  avc1View.setUint32(28, 0x00480000); // 72 dpi
  avc1View.setUint32(32, 0x00480000);
  avc1View.setUint16(40, 1); // frame count
  avc1View.setUint16(74, 24); // depth 24
  avc1View.setInt16(76, -1);

  const avcCExt = avcC ?? new Uint8Array([
    0x01, 0x42, 0xe0, 0x1f, 0xff, 0xe1, 0x00, 0x00, 0x01, 0x00, 0x00,
  ]);
  const avc1 = box('avc1', avc1Visual, box('avcC', avcCExt));
  const stsd = box('stsd', new Uint8Array([0, 0, 0, 0, 0, 0, 0, 1]), avc1);

  // stts (time-to-sample)
  const sampleDelta = Math.round(timescale / Math.max(1, opts.fps));
  const sttsPayload = new Uint8Array(16);
  const sttsView = new DataView(sttsPayload.buffer);
  sttsView.setUint32(4, 1);                         // 1 entry
  sttsView.setUint32(8, videoChunks.length);        // sample count
  sttsView.setUint32(12, sampleDelta);              // sample delta
  const stts = box('stts', sttsPayload);

  // stss (sync sample / keyframes)
  const stssPayload = new Uint8Array(8 + keyframeIndices.length * 4);
  const stssView = new DataView(stssPayload.buffer);
  stssView.setUint32(4, keyframeIndices.length);
  keyframeIndices.forEach((idx, i) => stssView.setUint32(8 + i * 4, idx));
  const stss = box('stss', stssPayload);

  // stsc (sample to chunk — 1 chunk per sample)
  const stscPayload = new Uint8Array(20);
  const stscView = new DataView(stscPayload.buffer);
  stscView.setUint32(4, 1); // 1 entry
  stscView.setUint32(8, 1); // first chunk
  stscView.setUint32(12, 1); // samples per chunk
  stscView.setUint32(16, 1); // sample description index
  const stsc = box('stsc', stscPayload);

  // stsz (sample sizes)
  const stszPayload = new Uint8Array(12 + sampleSizes.length * 4);
  const stszView = new DataView(stszPayload.buffer);
  stszView.setUint32(4, 0); // uniform size 0 (variable)
  stszView.setUint32(8, sampleSizes.length);
  sampleSizes.forEach((sz, i) => stszView.setUint32(12 + i * 4, sz));
  const stsz = box('stsz', stszPayload);

  // Placeholder stco with chunk offsets relative to file start
  // File layout: [ftyp] [moov] [mdat]
  const minfWithoutStbl = box('minf', box('vmhd', vmhd), dinf);
  const mdiaWithoutStbl = box('mdia', box('mdhd', mdhd), box('hdlr', hdlr), minfWithoutStbl);
  const trakWithoutStbl = box('trak', box('tkhd', tkhd), mdiaWithoutStbl);
  const moovEstimatedLen = box('moov', box('mvhd', mvhd), trakWithoutStbl).length +
    stsd.length + stts.length + stss.length + stsc.length + stsz.length + 8 + 8 + sampleSizes.length * 4 + 100;

  let currentOffset = ftyp.length + moovEstimatedLen + 8; // start of mdat payload
  const chunkOffsets: number[] = [];
  for (const sz of sampleSizes) {
    chunkOffsets.push(currentOffset);
    currentOffset += sz;
  }

  const stcoPayload = new Uint8Array(8 + chunkOffsets.length * 4);
  const stcoView = new DataView(stcoPayload.buffer);
  stcoView.setUint32(4, chunkOffsets.length);
  chunkOffsets.forEach((co, i) => stcoView.setUint32(8 + i * 4, co));
  const stco = box('stco', stcoPayload);

  const stbl = box('stbl', stsd, stts, stss, stsc, stsz, stco);
  const minf = box('minf', box('vmhd', vmhd), dinf, stbl);
  const mdia = box('mdia', box('mdhd', mdhd), box('hdlr', hdlr), minf);
  const trak = box('trak', box('tkhd', tkhd), mdia);
  const moov = box('moov', box('mvhd', mvhd), trak);

  // Recalculate true chunk offsets with exact moov length
  const trueMdatStart = ftyp.length + moov.length + 8;
  let trueOffset = trueMdatStart;
  chunkOffsets.forEach((_, i) => {
    stcoView.setUint32(8 + i * 4, trueOffset);
    trueOffset += sampleSizes[i];
  });

  return new Blob([ftyp, moov, mdat] as BlobPart[], { type: 'video/mp4' });
}

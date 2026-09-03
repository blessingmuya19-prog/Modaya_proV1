/**
 * Tests for the zero-dependency WebM & MP4 container muxers.
 */
import { describe, it, expect } from 'vitest';
import {
  buildWebmBlob,
  buildMp4Blob,
  type EncodedChunk,
} from '@/lib/render/muxer';

async function blobToBytes(blob: Blob): Promise<Uint8Array> {
  if (typeof blob.arrayBuffer === 'function') {
    const buf = await blob.arrayBuffer();
    return new Uint8Array(buf);
  }
  // jsdom fallback
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(new Uint8Array(reader.result as ArrayBuffer));
    reader.onerror = () => reject(reader.error);
    reader.readAsArrayBuffer(blob);
  });
}
describe('buildWebmBlob', () => {
  it('builds a valid WebM container with video chunks', async () => {
    const chunks: EncodedChunk[] = [
      { data: new Uint8Array([0x01, 0x02, 0x03]), timestampUs: 0, type: 'key', track: 'video' },
      { data: new Uint8Array([0x04, 0x05]), timestampUs: 33333, type: 'delta', track: 'video' },
      { data: new Uint8Array([0x06, 0x07, 0x08]), timestampUs: 66666, type: 'delta', track: 'video' },
    ];

    const blob = buildWebmBlob(chunks, {
      width: 1920,
      height: 1080,
      fps: 30,
      durationS: 2.5,
      videoCodec: 'V_VP9',
    });

    expect(blob).toBeTruthy();
    expect(blob.type).toBe('video/webm');
    expect(blob.size).toBeGreaterThan(50);

    const bytes = await blobToBytes(blob);

    // EBML header starts with 0x1A, 0x45, 0xDF, 0xA3
    expect(bytes[0]).toBe(0x1a);
    expect(bytes[1]).toBe(0x45);
    expect(bytes[2]).toBe(0xdf);
    expect(bytes[3]).toBe(0xa3);

    // Contains 'webm' doctype string
    const text = new TextDecoder().decode(bytes);
    expect(text).toContain('webm');
    expect(text).toContain('Modaya');
  });

  it('supports audio and video interleaved tracks', async () => {
    const chunks: EncodedChunk[] = [
      { data: new Uint8Array([0x10, 0x20]), timestampUs: 0, type: 'key', track: 'video' },
      { data: new Uint8Array([0xaa, 0xbb]), timestampUs: 0, type: 'key', track: 'audio' },
      { data: new Uint8Array([0x11, 0x21]), timestampUs: 33000, type: 'delta', track: 'video' },
      { data: new Uint8Array([0xcc, 0xdd]), timestampUs: 20000, type: 'key', track: 'audio' },
    ];

    const blob = buildWebmBlob(chunks, {
      width: 1080,
      height: 1920,
      fps: 30,
      durationS: 1.0,
      hasAudio: true,
      audioSampleRate: 48000,
    });

    expect(blob.size).toBeGreaterThan(60);
    const bytes = await blobToBytes(blob);
    const text = new TextDecoder().decode(bytes);
    expect(text).toContain('A_OPUS');
  });
});

describe('buildMp4Blob', () => {
  it('builds an ISO-BMFF MP4 structure (ftyp, moov, mdat)', async () => {
    const chunks: EncodedChunk[] = [
      { data: new Uint8Array([0x00, 0x00, 0x00, 0x01, 0x65, 0x88]), timestampUs: 0, type: 'key', track: 'video' },
      { data: new Uint8Array([0x00, 0x00, 0x00, 0x01, 0x41, 0x99]), timestampUs: 33333, type: 'delta', track: 'video' },
    ];

    const blob = buildMp4Blob(chunks, {
      width: 1280,
      height: 720,
      fps: 30,
      durationS: 1.0,
    });

    expect(blob.type).toBe('video/mp4');
    expect(blob.size).toBeGreaterThan(100);

    const bytes = await blobToBytes(blob);

    // ftyp box at start
    const ftypTag = String.fromCharCode(bytes[4], bytes[5], bytes[6], bytes[7]);
    expect(ftypTag).toBe('ftyp');

    // Contains 'moov' and 'mdat'
    const text = new TextDecoder().decode(bytes);
    expect(text).toContain('moov');
    expect(text).toContain('mdat');
    expect(text).toContain('avc1');
  });
});

// Browser-only: decode any audio/video file the browser can play into mono samples.
import { decimate } from "./acoustics";

export interface Decoded { samples: Float32Array; sr: number; durationSec: number; pitchSamples: Float32Array; pitchSr: number; }

export async function decodeFile(file: Blob): Promise<Decoded> {
  const bytes = await file.arrayBuffer();
  const Ctx: typeof AudioContext = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
  const ctx = new Ctx();
  let buf: AudioBuffer;
  try {
    buf = await ctx.decodeAudioData(bytes);
  } catch {
    throw new Error("This browser can't read the audio in that file. Try exporting it as .m4a or .mp3.");
  } finally {
    void ctx.close();
  }
  const sr = 16000;
  const off = new OfflineAudioContext(1, Math.max(1, Math.ceil(buf.duration * sr)), sr);
  const src = off.createBufferSource();
  src.buffer = buf;
  src.connect(off.destination); // channels are mixed down to mono by the 1-channel destination
  src.start();
  const rendered = await off.startRendering();
  const samples = rendered.getChannelData(0);
  return { samples, sr, durationSec: buf.duration, pitchSamples: decimate(samples, 2), pitchSr: sr / 2 };
}

/** Let the page repaint between heavy steps. */
export const tick = () => new Promise((r) => setTimeout(r, 0));

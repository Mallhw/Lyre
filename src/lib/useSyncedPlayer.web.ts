// Browser version of the synced player. Metro picks this file over
// useSyncedPlayer.ts for web builds because of the .web.ts suffix.
//
// It uses the Web Audio API instead of an <audio> element: Web Audio lets us
// say "start this buffer at exactly this moment on the audio clock", which is
// accurate to a single audio sample. An <audio> element can only be nudged
// after the fact, so phones keep hunting around the right position.

import { useEffect, useRef, useState } from "react";
import { serverNow } from "./clock";

type Playback = {
  playing: boolean;
  startAt: number; // server ms at which track position 0 occurs
  pausedAt: number; // seconds
  muted: boolean;
  volume: number; // 0 to 1
  bands: { low: boolean; mid: boolean; high: boolean };
  nudgeMs: number;
};

const CHECK_MS = 200;
const RESCHEDULE_S = 0.012; // re-align when further off than this
const LEAD_S = 0.1; // how far ahead a mid-song start is scheduled
const BASS_HZ = 220; // below this is the Bass band
const HIGHS_HZ = 2500; // above this is the Highs band

type Mixer = {
  inputs: AudioNode[]; // the song connects to all three band chains
  low: GainNode;
  mid: GainNode;
  high: GainNode;
};

/**
 * A three-band DJ mixer: the song is split into bass, mids and highs by
 * filters, each band has its own on/off gain, and the three are added back
 * together. Two filters in a row per edge give a steeper, cleaner cut.
 */
function buildMixer(ctx: AudioContext, out: AudioNode): Mixer {
  const filter = (type: BiquadFilterType, hz: number) => {
    const f = ctx.createBiquadFilter();
    f.type = type;
    f.frequency.value = hz;
    f.Q.value = 0.7;
    return f;
  };
  const chain = (filters: BiquadFilterNode[]) => {
    const gain = ctx.createGain();
    for (let i = 0; i < filters.length - 1; i++) filters[i].connect(filters[i + 1]);
    filters[filters.length - 1].connect(gain);
    gain.connect(out);
    return { head: filters[0], gain };
  };
  const low = chain([filter("lowpass", BASS_HZ), filter("lowpass", BASS_HZ)]);
  const mid = chain([
    filter("highpass", BASS_HZ),
    filter("highpass", BASS_HZ),
    filter("lowpass", HIGHS_HZ),
    filter("lowpass", HIGHS_HZ),
  ]);
  const high = chain([filter("highpass", HIGHS_HZ), filter("highpass", HIGHS_HZ)]);
  return { inputs: [low.head, mid.head, high.head], low: low.gain, mid: mid.gain, high: high.gain };
}

type Running = {
  node: AudioBufferSourceNode;
  ctxStart: number; // audio-clock time the node starts
  offset: number; // track position it starts from
};

export function useSyncedPlayer(source: number | string | null, playback: Playback | null) {
  const latest = useRef(playback);
  latest.current = playback;
  const ctxRef = useRef<AudioContext | null>(null);
  const gainRef = useRef<GainNode | null>(null);
  const mixerRef = useRef<Mixer | null>(null);
  const bufferRef = useRef<AudioBuffer | null>(null);
  const bytesRef = useRef<ArrayBuffer | null>(null);
  const running = useRef<Running | null>(null);
  const [driftMs, setDriftMs] = useState<number | null>(null);
  const [ready, setReady] = useState(false);

  // Download the track's bytes as soon as we know where it is.
  useEffect(() => {
    if (typeof source !== "string") return;
    let alive = true;
    // A new song: drop the old one so nothing plays until this one is loaded.
    stop();
    bufferRef.current = null;
    bytesRef.current = null;
    setReady(false);
    fetch(source)
      .then((res) => res.arrayBuffer())
      .then((bytes) => {
        if (!alive) return;
        bytesRef.current = bytes;
        decodeIfReady();
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [source]);

  function decodeIfReady() {
    const ctx = ctxRef.current;
    const bytes = bytesRef.current;
    if (!ctx || !bytes || bufferRef.current) return;
    // slice(0) copies the bytes, because decoding empties the buffer it is given.
    ctx.decodeAudioData(bytes.slice(0)).then((buf) => {
      // Ignore a decode that finished after the DJ already switched songs.
      if (bytesRef.current !== bytes) return;
      bufferRef.current = buf;
      setReady(true);
    });
  }

  function stop() {
    const r = running.current;
    if (!r) return;
    try {
      r.node.stop();
    } catch {}
    r.node.disconnect();
    running.current = null;
  }

  useEffect(() => {
    const timer = setInterval(() => {
      const p = latest.current;
      const ctx = ctxRef.current;
      const gain = gainRef.current;
      const buffer = bufferRef.current;
      const mixer = mixerRef.current;
      if (!p || !ctx || !gain || !buffer || !mixer) return;

      // Squared so each step sounds like an even change in loudness.
      gain.gain.value = p.muted ? 0 : p.volume * p.volume;
      // A short ramp instead of a hard switch, so cutting a band doesn't click.
      const t = ctx.currentTime;
      mixer.low.gain.setTargetAtTime(p.bands.low ? 1 : 0, t, 0.015);
      mixer.mid.gain.setTargetAtTime(p.bands.mid ? 1 : 0, t, 0.015);
      mixer.high.gain.setTargetAtTime(p.bands.high ? 1 : 0, t, 0.015);

      if (!p.playing) {
        stop();
        setDriftMs(null);
        return;
      }

      // Sound scheduled at audio-clock time t reaches the speaker `latency`
      // seconds later, so everything is scheduled that much early.
      const latency = ctx.outputLatency || ctx.baseLatency || 0;
      const ctxNow = ctx.currentTime;
      const expected = (serverNow() - p.startAt + p.nudgeMs) / 1000; // track position audible now
      const duration = buffer.duration;

      const r = running.current;
      if (r) {
        const audible = r.offset + (ctxNow - r.ctxStart) - latency;
        // Compare modulo the track length, since the track loops.
        let error = (audible - expected) % duration;
        if (error > duration / 2) error -= duration;
        if (error < -duration / 2) error += duration;
        setDriftMs(Math.round(error * 1000));
        if (Math.abs(error) < RESCHEDULE_S) return;
        stop();
      }

      const node = ctx.createBufferSource();
      node.buffer = buffer;
      node.loop = true;
      for (const input of mixer.inputs) node.connect(input);

      let ctxStart: number;
      let offset: number;
      if (expected + latency < 0) {
        // The shared start moment is still ahead: schedule the very first sample for it.
        ctxStart = ctxNow - expected - latency;
        offset = 0;
      } else {
        // Already mid-song: start slightly in the future at the matching position.
        ctxStart = ctxNow + LEAD_S;
        offset = (((expected + LEAD_S + latency) % duration) + duration) % duration;
      }
      node.start(ctxStart, offset);
      running.current = { node, ctxStart, offset };
    }, CHECK_MS);
    return () => {
      clearInterval(timer);
      stop();
    };
  }, []);

  // Browsers only allow sound after a tap, so the audio engine is created here.
  const unlock = () => {
    if (ctxRef.current) {
      ctxRef.current.resume();
      return;
    }
    // On iPhones this makes web audio ignore the silent switch, like a music app.
    const session = (navigator as { audioSession?: { type: string } }).audioSession;
    if (session) session.type = "playback";

    const Ctor: typeof AudioContext =
      window.AudioContext ??
      (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    const ctx = new Ctor({ latencyHint: "interactive" });
    const gain = ctx.createGain();
    gain.connect(ctx.destination);
    ctxRef.current = ctx;
    gainRef.current = gain;
    mixerRef.current = buildMixer(ctx, gain);
    ctx.resume();
    decodeIfReady();
  };

  return { driftMs, unlock, ready };
}

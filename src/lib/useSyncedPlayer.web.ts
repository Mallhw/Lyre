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
  nudgeMs: number;
};

const CHECK_MS = 200;
const RESCHEDULE_S = 0.012; // re-align when further off than this
const LEAD_S = 0.1; // how far ahead a mid-song start is scheduled

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
      if (!p || !ctx || !gain || !buffer) return;

      gain.gain.value = p.muted ? 0 : 1;

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
      node.connect(gain);

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
    ctx.resume();
    decodeIfReady();
  };

  return { driftMs, unlock, ready };
}

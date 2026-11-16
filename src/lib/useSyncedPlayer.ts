import { setAudioModeAsync, useAudioPlayer } from "expo-audio";
import { useEffect, useRef, useState } from "react";
import { serverNow } from "./clock";

type Playback = {
  playing: boolean;
  startAt: number; // server ms at which track position 0 occurs
  pausedAt: number; // seconds
  muted: boolean;
  nudgeMs: number;
};

const CHECK_MS = 250;
const HARD_SEEK_S = 0.2; // further off than this: jump
const SOFT_FIX_S = 0.008; // closer than this: leave it alone
const SEEK_LAND_S = 0.06; // a seek takes roughly this long to take effect

/**
 * Plays `source` so that its position always matches the shared clock.
 * Big errors are fixed with a seek; small ones by running slightly fast or
 * slow, which is inaudible and avoids the click a seek would cause.
 */
export function useSyncedPlayer(source: number, playback: Playback | null) {
  const player = useAudioPlayer(source);
  const latest = useRef(playback);
  latest.current = playback;
  const [driftMs, setDriftMs] = useState<number | null>(null);

  useEffect(() => {
    // Without this an iPhone with the ringer switch off plays nothing.
    setAudioModeAsync({ playsInSilentMode: true }).catch(() => {});
  }, []);

  useEffect(() => {
    let seekingUntil = 0;
    const timer = setInterval(() => {
      const p = latest.current;
      if (!p) return;
      player.volume = p.muted ? 0 : 1;

      if (!p.playing) {
        if (player.playing) player.pause();
        setDriftMs(null);
        return;
      }

      const expected = (serverNow() - p.startAt + p.nudgeMs) / 1000;
      if (expected < 0) {
        // The shared start moment is still ahead: sit ready at the beginning.
        if (player.playing) player.pause();
        if (player.currentTime > 0.05) player.seekTo(0).catch(() => {});
        setDriftMs(null);
        if (expected > -CHECK_MS / 1000) {
          setTimeout(() => player.play(), -expected * 1000);
        }
        return;
      }

      if (!player.playing) player.play();
      if (performance.now() < seekingUntil) return;

      const error = player.currentTime - expected; // + means this phone is ahead
      setDriftMs(Math.round(error * 1000));

      if (Math.abs(error) > HARD_SEEK_S) {
        player.setPlaybackRate(1);
        player.seekTo(expected + SEEK_LAND_S, 0, 0).catch(() => {});
        seekingUntil = performance.now() + 600;
      } else if (Math.abs(error) > SOFT_FIX_S) {
        // Up to 4% fast or slow, proportional to how far off we are.
        const rate = 1 - Math.max(-0.04, Math.min(0.04, error * 0.6));
        player.setPlaybackRate(rate);
      } else {
        player.setPlaybackRate(1);
      }
    }, CHECK_MS);
    return () => clearInterval(timer);
  }, [player]);

  return { driftMs };
}

import { useEffect, useState } from "react";
import { StyleSheet, View } from "react-native";
import PEAKS from "./peaks.json";

const PER_SECOND = 10; // peaks per second of audio, set by the script that made peaks.json
const BARS = 70; // bars on screen: 3.5 seconds either side of the playhead
const HEIGHT = 64;

type Props = {
  trackId: string;
  /** Returns the deck's current position in seconds. Called on every redraw. */
  getPosition: () => number;
  color: string;
};

/**
 * A scrolling waveform with a fixed playhead in the middle, like a DJ deck.
 * The loudness values are precomputed per song, so this only draws bars.
 * It redraws on its own timer so the rest of the screen doesn't have to.
 */
export function Waveform({ trackId, getPosition, color }: Props) {
  const [, setFrame] = useState(0);
  useEffect(() => {
    const timer = setInterval(() => setFrame((n) => n + 1), 100);
    return () => clearInterval(timer);
  }, []);

  const data = (PEAKS as Record<string, string>)[trackId] ?? "";
  const total = data.length / 2; // each peak is two digits
  const centre = Math.floor(getPosition() * PER_SECOND);
  const bars = [];
  for (let i = 0; i < BARS; i++) {
    let index = centre - BARS / 2 + i;
    // Songs loop, so the waveform wraps around too.
    if (total > 0) index = ((index % total) + total) % total;
    const peak = total > 0 ? Number(data.slice(index * 2, index * 2 + 2)) / 99 : 0;
    const played = i < BARS / 2;
    bars.push(
      <View
        key={i}
        style={{
          flex: 1,
          marginHorizontal: 0.5,
          height: Math.max(2, peak * HEIGHT),
          borderRadius: 1,
          backgroundColor: color,
          opacity: played ? 0.35 : 1,
        }}
      />,
    );
  }

  return (
    <View style={styles.box}>
      {bars}
      <View style={styles.playhead} />
    </View>
  );
}

const styles = StyleSheet.create({
  box: {
    height: HEIGHT + 12,
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#14141b",
    borderRadius: 12,
    paddingHorizontal: 6,
    marginBottom: 12,
    overflow: "hidden",
  },
  playhead: {
    position: "absolute",
    left: "50%",
    top: 4,
    bottom: 4,
    width: 2,
    backgroundColor: "#fff",
  },
});

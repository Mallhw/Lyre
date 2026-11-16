import { Asset } from "expo-asset";
import { useEffect, useState } from "react";
import { Platform } from "react-native";

/**
 * Returns something the audio player can play for a bundled track.
 * On phones that is the bundled file itself. In a browser the whole file is
 * downloaded into memory first, because iPhone Safari refuses to stream audio
 * from hosts that can't serve it in pieces, and a fully downloaded file also
 * seeks instantly, which keeps sync tight.
 */
export function useTrackSource(track: number): number | string | null {
  const [url, setUrl] = useState<string | null>(null);

  useEffect(() => {
    if (Platform.OS !== "web") return;
    let alive = true;
    let made: string | null = null;
    fetch(Asset.fromModule(track).uri)
      .then((res) => res.blob())
      .then((blob) => {
        made = URL.createObjectURL(blob);
        if (alive) setUrl(made);
      })
      .catch(() => {});
    return () => {
      alive = false;
      if (made) URL.revokeObjectURL(made);
    };
  }, [track]);

  return Platform.OS === "web" ? url : track;
}

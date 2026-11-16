import { Asset } from "expo-asset";
import { Platform } from "react-native";

// Song files are not in this repo. They are served next to the web app from
// /songs/<file>, so a fresh clone still builds and just has the click track.
const SONG_HOST = "https://lyre-dj.expo.app";
const CLICK = require("../../assets/audio/click.m4a");

export type Track = { id: string; title: string; artist: string };

export const TRACKS: Track[] = [
  { id: "click", title: "Click", artist: "Calibration track" },
  { id: "summer", title: "Summer", artist: "Calvin Harris" },
  { id: "gotta-feeling", title: "I Gotta Feeling", artist: "The Black Eyed Peas" },
  { id: "party-rock", title: "Party Rock Anthem", artist: "LMFAO" },
  { id: "we-found-love", title: "We Found Love", artist: "Rihanna" },
  { id: "clarity", title: "Clarity", artist: "Zedd" },
  { id: "titi", title: "Tití Me Preguntó", artist: "Bad Bunny" },
];

export function trackById(id: string | undefined): Track {
  return TRACKS.find((t) => t.id === id) ?? TRACKS[0];
}

/** Something the audio player can load: a bundled file on phones, a URL otherwise. */
export function trackSource(id: string | undefined): number | string {
  const track = trackById(id);
  if (track.id === "click") {
    return Platform.OS === "web" ? Asset.fromModule(CLICK).uri : CLICK;
  }
  // On the web a relative URL works from any address the app is served at.
  const base = Platform.OS === "web" ? "" : SONG_HOST;
  return `${base}/songs/${track.id}.m4a`;
}

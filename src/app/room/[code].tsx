import { useConvex, useMutation, useQuery } from "convex/react";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useEffect, useRef, useState } from "react";
import { Platform, Pressable, ScrollView, StyleSheet, Switch, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { api } from "../../../convex/_generated/api";
import { DEVICE_ID, clockInfo, serverNow, syncClock } from "../../lib/clock";
import { useSyncedPlayer } from "../../lib/useSyncedPlayer";
import { TRACKS, trackById, trackSource } from "../../lib/tracks";
import { Waveform } from "../../lib/Waveform";

const ONLINE_MS = 20000;
const ALL_BANDS = { low: true, mid: true, high: true };
const BAND_LABELS = [
  ["low", "Bass"],
  ["mid", "Mids"],
  ["high", "Highs"],
] as const;

// Saved transitions. `at` is the moment in each song (seconds) that should
// land together, taken from cue points lined up in DJ software. Both songs in
// a preset must share a tempo, because Lyre does not change song speed.
const PRESETS = [
  {
    name: "I Gotta Feeling → Feel So Close",
    detail: "128 BPM · blends at 3:54 into 0:31",
    a: { track: "gotta-feeling", at: 234.0 },
    b: { track: "feel-so-close", at: 31.02 },
  },
];
type Preset = (typeof PRESETS)[number];
const SAVED_KEY = "lyre-transitions";

/** Transitions this phone saved earlier. They live in the browser's storage. */
function loadSaved(): Preset[] {
  try {
    if (typeof localStorage === "undefined") return [];
    return JSON.parse(localStorage.getItem(SAVED_KEY) ?? "[]") as Preset[];
  } catch {
    return [];
  }
}

const PRESET_LEAD_S = 20; // how long deck A plays before the blend point
const FADE_S = 16; // length of an automatic crossfade (32 beats at 128 BPM)

/** Seconds as m:ss, for the deck time displays. */
function clockTime(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

export default function Room() {
  const { code } = useLocalSearchParams<{ code: string }>();
  const router = useRouter();
  const data = useQuery(api.rooms.get, { code: code ?? "" });
  const play = useMutation(api.rooms.play);
  const pause = useMutation(api.rooms.pause);
  const restart = useMutation(api.rooms.restart);
  const setMuted = useMutation(api.rooms.setMuted);
  const setNudge = useMutation(api.rooms.setNudge);
  const heartbeat = useMutation(api.rooms.heartbeat);
  const setTrack = useMutation(api.rooms.setTrack);
  const setVolume = useMutation(api.rooms.setVolume);
  const setBands = useMutation(api.rooms.setBands);
  const deckB = useMutation(api.rooms.deckB);
  const setDeck = useMutation(api.rooms.setDeck);
  const setFade = useMutation(api.rooms.setFade);
  const seek = useMutation(api.rooms.seek);
  const setBandAll = useMutation(api.rooms.setBandAll);
  const convex = useConvex();
  const fadeTimer = useRef<ReturnType<typeof setInterval> | null>(null);
  const presetTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const fadeNow = useRef(0.5);
  const [presetStatus, setPresetStatus] = useState("");
  const [saved, setSaved] = useState<Preset[]>(loadSaved);
  const join = useMutation(api.rooms.join);

  const [clock, setClock] = useState(clockInfo());
  const [now, setNow] = useState(Date.now());
  // Redraw twice a second so the deck time displays keep moving.
  const [, setTick] = useState(0);
  useEffect(() => {
    const timer = setInterval(() => setTick((n) => n + 1), 500);
    return () => clearInterval(timer);
  }, []);
  // Only the browser needs a tap before it will play sound.
  const [soundOn, setSoundOn] = useState(Platform.OS !== "web");

  const me = data?.devices.find((d) => d.deviceId === DEVICE_ID) ?? null;
  const room = data?.room ?? null;
  const isHost = room?.hostDeviceId === DEVICE_ID;

  // Opening a shared /room/CODE link joins the room without typing the code.
  const needsJoin = !!room && !me;
  useEffect(() => {
    if (!needsJoin || !code) return;
    join({ code, deviceId: DEVICE_ID, name: "Phone " + DEVICE_ID.slice(0, 3).toUpperCase() }).catch(() => {});
  }, [needsJoin, code, join]);

  // Measure the clock offset on entry, then keep refreshing it.
  useEffect(() => {
    let alive = true;
    const run = () => syncClock().then((c) => alive && setClock(c));
    run();
    const timer = setInterval(run, 20000);
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, []);

  // Tell the room this phone is still here.
  const myId = me?._id;
  useEffect(() => {
    if (!myId) return;
    const timer = setInterval(() => {
      heartbeat({ id: myId }).catch(() => {});
      setNow(Date.now());
    }, 7000);
    return () => clearInterval(timer);
  }, [myId, heartbeat]);

  // This phone follows the song and timeline of whichever deck it is on.
  const myDeck = me?.deck === "B" ? "B" : "A";
  const stateB = room?.deckB ?? { trackId: "click", playing: false, startAt: 0, pausedAt: 0 };
  const mine =
    myDeck === "B"
      ? stateB
      : {
          trackId: room?.trackId,
          playing: room?.playing ?? false,
          startAt: room?.startAt ?? 0,
          pausedAt: room?.pausedAt ?? 0,
        };
  // Crossfader: at the centre both decks are full; past it one side fades out.
  const fade = room?.fade ?? 0.5;
  const fadeGain = myDeck === "A" ? (fade <= 0.5 ? 1 : 2 * (1 - fade)) : fade >= 0.5 ? 1 : 2 * fade;
  const track = trackById(mine.trackId);
  const source = trackSource(mine.trackId);
  const { driftMs, unlock, ready } = useSyncedPlayer(
    source,
    room && me && clock
      ? {
          playing: mine.playing,
          startAt: mine.startAt,
          pausedAt: mine.pausedAt,
          muted: me.muted,
          volume: (me.volume ?? 1) * fadeGain,
          bands: me.bands ?? ALL_BANDS,
          nudgeMs: me.nudgeMs,
        }
      : null,
  );

  if (data === undefined) {
    return (
      <SafeAreaView style={styles.container}>
        <Text style={styles.dim}>Connecting…</Text>
      </SafeAreaView>
    );
  }
  if (room && !me) {
    return (
      <SafeAreaView style={styles.container}>
        <Text style={styles.dim}>Joining room {room.code}…</Text>
      </SafeAreaView>
    );
  }
  if (!room || !me) {
    return (
      <SafeAreaView style={styles.container}>
        <Text style={styles.dim}>There's no room {code}.</Text>
        <Pressable style={styles.button} onPress={() => router.replace("/")}>
          <Text style={styles.buttonText}>Back</Text>
        </Pressable>
      </SafeAreaView>
    );
  }

  const devices = data?.devices ?? [];
  fadeNow.current = fade;

  // Slide the crossfader to `target` over `seconds`, in small steps.
  const autoFade = (target: number, seconds: number) => {
    if (fadeTimer.current) clearInterval(fadeTimer.current);
    const from = fadeNow.current;
    const steps = Math.max(1, Math.round(seconds * 4));
    let step = 0;
    fadeTimer.current = setInterval(() => {
      step++;
      setFade({ roomId: room._id, fade: from + ((target - from) * step) / steps });
      if (step >= steps && fadeTimer.current) clearInterval(fadeTimer.current);
    }, 250);
  };

  // Load both songs, line up their blend points exactly, and schedule the fade.
  const runPreset = async (preset: Preset) => {
    if (fadeTimer.current) clearInterval(fadeTimer.current);
    if (presetTimer.current) clearTimeout(presetTimer.current);
    setPresetStatus("Loading…");
    try {
      await setFade({ roomId: room._id, fade: 0 });
      await setTrack({ roomId: room._id, trackId: preset.a.track });
      await deckB({ roomId: room._id, action: "setTrack", trackId: preset.b.track });
      await restart({ roomId: room._id });
      await deckB({ roomId: room._id, action: "restart" });
      // Read back the exact start times the server chose, then shift each
      // deck so the two blend points fall on the same instant.
      const fresh = await convex.query(api.rooms.get, { code: room.code });
      const startA = fresh?.room.startAt ?? 0;
      const startB = fresh?.room.deckB?.startAt ?? 0;
      const deltaA = preset.a.at - PRESET_LEAD_S;
      await seek({ roomId: room._id, deck: "A", deltaS: deltaA });
      const newStartA = startA - deltaA * 1000;
      const deltaB = (startB - newStartA - preset.a.at * 1000 + preset.b.at * 1000) / 1000;
      await seek({ roomId: room._id, deck: "B", deltaS: deltaB });
      setPresetStatus(`Deck A playing. Blend starts in about ${PRESET_LEAD_S - FADE_S / 2 + 2} s.`);
      // Centre the fade on the blend point: half before it, half after.
      presetTimer.current = setTimeout(
        () => {
          setPresetStatus("Blending into deck B…");
          autoFade(1, FADE_S);
          presetTimer.current = setTimeout(() => setPresetStatus(""), FADE_S * 1000 + 500);
        },
        (PRESET_LEAD_S + 2.5 - FADE_S / 2) * 1000,
      );
    } catch {
      setPresetStatus("Couldn't load the transition. Try again.");
    }
  };

  // Remember where both decks are right now as a reusable transition.
  const saveBlend = () => {
    const a = trackById(room.trackId);
    const b = trackById(stateB.trackId);
    const atA = room.playing ? (serverNow() - room.startAt) / 1000 : room.pausedAt;
    const atB = stateB.playing ? (serverNow() - stateB.startAt) / 1000 : stateB.pausedAt;
    const blend: Preset = {
      name: `${a.title} → ${b.title}`,
      detail: `Saved · blends at ${clockTime(atA)} into ${clockTime(atB)}`,
      a: { track: a.id, at: Math.max(PRESET_LEAD_S, atA) },
      b: { track: b.id, at: Math.max(0, atB) },
    };
    const next = [...saved, blend];
    setSaved(next);
    try {
      localStorage.setItem(SAVED_KEY, JSON.stringify(next));
      setPresetStatus("Saved to this phone.");
    } catch {
      setPresetStatus("Saved for now, but this browser won't keep it after a reload.");
    }
  };

  const posA = room.playing ? (serverNow() - room.startAt) / 1000 : room.pausedAt;
  const posB = stateB.playing ? (serverNow() - stateB.startAt) / 1000 : stateB.pausedAt;
  const syncLabel = !clock
    ? "Syncing clock…"
    : driftMs === null
      ? `Clock synced (±${Math.round(clock.rtt / 2)} ms)`
      : `In sync: ${driftMs > 0 ? "+" : ""}${driftMs} ms`;

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView contentContainerStyle={{ paddingBottom: 40 }}>
        <Text style={styles.label}>ROOM</Text>
        <Text style={styles.code}>{room.code}</Text>
        <Text style={styles.dim}>
          {isHost ? "You're the DJ" : "Speaker"} · {me.name}
        </Text>
        <Text style={[styles.sync, driftMs !== null && Math.abs(driftMs) > 30 && styles.warn]}>
          {syncLabel}
        </Text>

        {!soundOn ? (
          <Pressable
            style={[styles.button, styles.enable]}
            onPress={() => {
              unlock();
              setSoundOn(true);
            }}
          >
            <Text style={styles.primaryText}>
              Tap to turn on sound
            </Text>
          </Pressable>
        ) : null}

        <Text style={styles.label}>DECK {myDeck} · NOW PLAYING ON THIS PHONE</Text>
        <Text style={styles.trackTitle}>{track.title}</Text>
        <Text style={styles.dim}>
          {track.artist}
          {soundOn && !ready ? "  ·  loading…" : ""}
        </Text>

        {isHost ? (
          <Text style={styles.label}>DECK A · {trackById(room.trackId).title.toUpperCase()}</Text>
        ) : null}
        {isHost ? (
          <Waveform
            trackId={trackById(room.trackId).id}
            color="#7c5cff"
            getPosition={() =>
              room.playing ? (serverNow() - room.startAt) / 1000 : room.pausedAt
            }
          />
        ) : null}
        {isHost ? (
          <View style={styles.rowTight}>
            <Pressable
              style={[styles.button, styles.primary, { flex: 1 }]}
              onPress={() => (room.playing ? pause({ roomId: room._id }) : play({ roomId: room._id }))}
            >
              <Text style={styles.primaryText}>{room.playing ? "Pause" : "Play"}</Text>
            </Pressable>
            <Pressable style={[styles.button, { flex: 1 }]} onPress={() => restart({ roomId: room._id })}>
              <Text style={styles.buttonText}>Restart</Text>
            </Pressable>
          </View>
        ) : (
          <Text style={styles.state}>
            {me.muted ? "Muted by the DJ" : mine.playing ? "Playing" : "Waiting for the DJ"}
          </Text>
        )}

        {isHost ? (
          <>
            <View style={styles.rowTight}>
              <Pressable
                style={[styles.button, styles.small]}
                onPress={() => {
                  seek({ roomId: room._id, deck: "A", deltaS: -15 });
                }}
              >
                <Text style={styles.buttonText}>−15s</Text>
              </Pressable>
              <Text style={styles.time}>{clockTime(posA)}</Text>
              <Pressable
                style={[styles.button, styles.small]}
                onPress={() => {
                  seek({ roomId: room._id, deck: "A", deltaS: 15 });
                }}
              >
                <Text style={styles.buttonText}>+15s</Text>
              </Pressable>
            </View>
            <Text style={styles.label}>DECK A SONGS</Text>
            <View style={styles.chips}>
              {TRACKS.map((t) => (
                <Pressable
                  key={t.id}
                  style={[styles.chip, t.id === track.id && styles.chipOn]}
                  onPress={() => {
                    setTrack({ roomId: room._id, trackId: t.id });
                  }}
                >
                  <Text style={styles.chipText}>{t.title}</Text>
                </Pressable>
              ))}
            </View>
          </>
        ) : null}

        {isHost ? (
          <>
            <Text style={styles.label}>DECK B · {trackById(stateB.trackId).title.toUpperCase()}</Text>
            <Waveform
              trackId={trackById(stateB.trackId).id}
              color="#e0692f"
              getPosition={() =>
                stateB.playing ? (serverNow() - stateB.startAt) / 1000 : stateB.pausedAt
              }
            />
            <View style={styles.rowTight}>
              <Pressable
                style={[styles.button, styles.deckB, { flex: 1 }]}
                onPress={() => {
                  deckB({ roomId: room._id, action: stateB.playing ? "pause" : "play" });
                }}
              >
                <Text style={styles.primaryText}>{stateB.playing ? "Pause B" : "Play B"}</Text>
              </Pressable>
              <Pressable
                style={[styles.button, { flex: 1 }]}
                onPress={() => {
                  deckB({ roomId: room._id, action: "restart" });
                }}
              >
                <Text style={styles.buttonText}>Restart B</Text>
              </Pressable>
            </View>
            <View style={styles.rowTight}>
              <Pressable
                style={[styles.button, styles.small]}
                onPress={() => {
                  seek({ roomId: room._id, deck: "B", deltaS: -15 });
                }}
              >
                <Text style={styles.buttonText}>−15s</Text>
              </Pressable>
              <Text style={styles.time}>{clockTime(posB)}</Text>
              <Pressable
                style={[styles.button, styles.small]}
                onPress={() => {
                  seek({ roomId: room._id, deck: "B", deltaS: 15 });
                }}
              >
                <Text style={styles.buttonText}>+15s</Text>
              </Pressable>
            </View>
            <Text style={styles.label}>DECK B SONGS</Text>
            <View style={styles.chips}>
              {TRACKS.map((t) => (
                <Pressable
                  key={t.id}
                  style={[styles.chip, t.id === stateB.trackId && styles.chipB]}
                  onPress={() => {
                    deckB({ roomId: room._id, action: "setTrack", trackId: t.id });
                  }}
                >
                  <Text style={styles.chipText}>{t.title}</Text>
                </Pressable>
              ))}
            </View>

            <Text style={styles.label}>
              CROSSFADER · A {Math.round((fade <= 0.5 ? 1 : 2 * (1 - fade)) * 100)}% · B{" "}
              {Math.round((fade >= 0.5 ? 1 : 2 * fade) * 100)}%
            </Text>
            <View style={styles.rowTight}>
              <Pressable
                style={[styles.button, styles.primary, { flex: 1 }]}
                onPress={() => {
                  setFade({ roomId: room._id, fade: fade - 0.1 });
                }}
              >
                <Text style={styles.primaryText}>◀ A</Text>
              </Pressable>
              <Pressable
                style={[styles.button, { flex: 1 }]}
                onPress={() => {
                  setFade({ roomId: room._id, fade: 0.5 });
                }}
              >
                <Text style={styles.buttonText}>Both</Text>
              </Pressable>
              <Pressable
                style={[styles.button, styles.deckB, { flex: 1 }]}
                onPress={() => {
                  setFade({ roomId: room._id, fade: fade + 0.1 });
                }}
              >
                <Text style={styles.primaryText}>B ▶</Text>
              </Pressable>
            </View>
          </>
        ) : null}

        <Text style={styles.label}>TIMING NUDGE (THIS PHONE)</Text>
        <View style={styles.row}>
          <Pressable style={[styles.button, { flex: 1 }]} onPress={() => setNudge({ id: me._id, nudgeMs: me.nudgeMs - 10 })}>
            <Text style={styles.buttonText}>Earlier</Text>
          </Pressable>
          <Text style={styles.nudge}>{me.nudgeMs > 0 ? "+" : ""}{me.nudgeMs} ms</Text>
          <Pressable style={[styles.button, { flex: 1 }]} onPress={() => setNudge({ id: me._id, nudgeMs: me.nudgeMs + 10 })}>
            <Text style={styles.buttonText}>Later</Text>
          </Pressable>
        </View>

        {isHost ? (
          <>
            <Text style={styles.label}>TRANSITIONS</Text>
            {[...PRESETS, ...saved].map((preset, i) => (
              <Pressable
                key={preset.name + i}
                style={[styles.button, styles.preset]}
                onPress={() => {
                  runPreset(preset);
                }}
              >
                <Text style={styles.primaryText}>{preset.name}</Text>
                <Text style={styles.presetDetail}>{preset.detail}</Text>
              </Pressable>
            ))}
            {presetStatus ? <Text style={styles.sync}>{presetStatus}</Text> : null}
            <Pressable style={[styles.button, { marginTop: 10 }]} onPress={saveBlend}>
              <Text style={styles.buttonText}>Save this blend (both decks, right now)</Text>
            </Pressable>
            <View style={[styles.rowTight, { marginTop: 10 }]}>
              <Pressable
                style={[styles.button, styles.primary, { flex: 1 }]}
                onPress={() => autoFade(0, FADE_S)}
              >
                <Text style={styles.buttonText}>Auto fade to A</Text>
              </Pressable>
              <Pressable
                style={[styles.button, styles.deckB, { flex: 1 }]}
                onPress={() => autoFade(1, FADE_S)}
              >
                <Text style={styles.buttonText}>Auto fade to B</Text>
              </Pressable>
            </View>

            <Text style={styles.label}>WHOLE ROOM</Text>
            <View style={styles.rowTight}>
              {BAND_LABELS.map(([key, label]) => {
                const allOn = devices.every((d) => (d.bands ?? ALL_BANDS)[key]);
                return (
                  <Pressable
                    key={key}
                    style={[styles.band, allOn && styles.bandOn, { paddingVertical: 16 }]}
                    onPress={() => {
                      setBandAll({ roomId: room._id, band: key, on: !allOn });
                    }}
                  >
                    <Text style={styles.bandText}>{allOn ? label : `${label} cut`}</Text>
                  </Pressable>
                );
              })}
            </View>
          </>
        ) : null}

        <Text style={styles.label}>PHONES ({devices.length})</Text>
        {devices.map((d) => {
          const online = now - d.lastSeen < ONLINE_MS;
          const vol = d.volume ?? 1;
          const bands = d.bands ?? ALL_BANDS;
          return (
            <View key={d._id} style={styles.device}>
             <View style={styles.deviceTop}>
              <View style={{ flex: 1 }}>
                <Text style={styles.deviceName}>
                  {d.name}
                  {d.deviceId === room.hostDeviceId ? "  (DJ)" : ""}
                  {d.deviceId === DEVICE_ID ? "  (this phone)" : ""}
                </Text>
                <Text style={styles.dim}>
                  {online ? (d.muted ? "Off" : `On · ${Math.round(vol * 100)}%`) : "Offline"}
                </Text>
              </View>
              {isHost ? (
                <View style={styles.volume}>
                  <Pressable
                    style={styles.volButton}
                    onPress={() => {
                      setVolume({ id: d._id, volume: vol - 0.1 });
                    }}
                  >
                    <Text style={styles.volText}>−</Text>
                  </Pressable>
                  <Pressable
                    style={styles.volButton}
                    onPress={() => {
                      setVolume({ id: d._id, volume: vol + 0.1 });
                    }}
                  >
                    <Text style={styles.volText}>+</Text>
                  </Pressable>
                </View>
              ) : null}
              {isHost ? (
                <Switch
                  value={!d.muted}
                  onValueChange={(on) => {
                    setMuted({ id: d._id, muted: !on });
                  }}
                  trackColor={{ true: "#7c5cff", false: "#33333f" }}
                />
              ) : null}
             </View>
              {isHost ? (
                <View style={styles.bands}>
                  {BAND_LABELS.map(([key, label]) => (
                    <Pressable
                      key={key}
                      style={[styles.band, bands[key] && styles.bandOn]}
                      onPress={() => {
                        setBands({ id: d._id, bands: { ...bands, [key]: !bands[key] } });
                      }}
                    >
                      <Text style={styles.bandText}>{label}</Text>
                    </Pressable>
                  ))}
                  <Pressable
                    style={[styles.band, d.deck === "B" ? styles.deckB : styles.deckA, { opacity: 1 }]}
                    onPress={() => {
                      setDeck({ id: d._id, deck: d.deck === "B" ? "A" : "B" });
                    }}
                  >
                    <Text style={styles.bandText}>Deck {d.deck === "B" ? "B" : "A"}</Text>
                  </Pressable>
                </View>
              ) : null}
            </View>
          );
        })}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#0b0b0f", paddingHorizontal: 24 },
  label: { color: "#6b6b78", fontSize: 12, letterSpacing: 2, marginTop: 28, marginBottom: 8 },
  code: { color: "#fff", fontSize: 64, fontWeight: "800", letterSpacing: 8 },
  dim: { color: "#9a9aa8", fontSize: 15 },
  sync: { color: "#5fe3a1", fontSize: 16, marginTop: 10, fontVariant: ["tabular-nums"] },
  warn: { color: "#ffb347" },
  state: { color: "#fff", fontSize: 22, fontWeight: "700", marginTop: 24 },
  row: { flexDirection: "row", gap: 12, alignItems: "center", marginTop: 20 },
  button: { backgroundColor: "#23232e", borderRadius: 14, paddingVertical: 16, alignItems: "center" },
  primary: { backgroundColor: "#7c5cff" },
  trackTitle: { color: "#fff", fontSize: 26, fontWeight: "700" },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  chip: { backgroundColor: "#23232e", borderRadius: 999, paddingVertical: 10, paddingHorizontal: 16 },
  chipOn: { backgroundColor: "#7c5cff" },
  chipB: { backgroundColor: "#e0692f" },
  preset: {
    backgroundColor: "#2a2440",
    borderWidth: 1,
    borderColor: "#7c5cff",
    paddingHorizontal: 12,
    marginBottom: 8,
  },
  presetDetail: { color: "#b9b0e6", fontSize: 13, marginTop: 4 },
  small: { paddingHorizontal: 18, paddingVertical: 12, marginTop: 10 },
  time: {
    flex: 1,
    color: "#fff",
    fontSize: 22,
    fontWeight: "700",
    textAlign: "center",
    marginTop: 10,
    fontVariant: ["tabular-nums"],
  },
  deckA: { backgroundColor: "#7c5cff" },
  deckB: { backgroundColor: "#e0692f" },
  rowTight: { flexDirection: "row", gap: 12, alignItems: "center" },
  volume: { flexDirection: "row", gap: 6, marginRight: 12 },
  volButton: {
    backgroundColor: "#2c2c39",
    borderRadius: 10,
    width: 40,
    height: 40,
    alignItems: "center",
    justifyContent: "center",
  },
  volText: { color: "#fff", fontSize: 22, fontWeight: "700" },
  chipText: { color: "#fff", fontSize: 15, fontWeight: "600" },
  enable: { backgroundColor: "#1f9d63", marginTop: 20 },
  primaryText: { color: "#fff", fontSize: 18, fontWeight: "700" },
  buttonText: { color: "#fff", fontSize: 16, fontWeight: "600" },
  nudge: { color: "#fff", fontSize: 17, width: 80, textAlign: "center", fontVariant: ["tabular-nums"] },
  deviceTop: { flexDirection: "row", alignItems: "center" },
  bands: { flexDirection: "row", gap: 8, marginTop: 12 },
  band: {
    flex: 1,
    backgroundColor: "#23232e",
    borderRadius: 10,
    paddingVertical: 10,
    alignItems: "center",
    opacity: 0.55,
  },
  bandOn: { backgroundColor: "#1f9d63", opacity: 1 },
  bandText: { color: "#fff", fontSize: 14, fontWeight: "700" },
  device: {
    backgroundColor: "#17171f",
    borderRadius: 14,
    padding: 16,
    marginBottom: 10,
  },
  deviceName: { color: "#fff", fontSize: 17, fontWeight: "600" },
});

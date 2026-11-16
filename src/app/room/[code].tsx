import { useMutation, useQuery } from "convex/react";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useEffect, useState } from "react";
import { Platform, Pressable, ScrollView, StyleSheet, Switch, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { api } from "../../../convex/_generated/api";
import { DEVICE_ID, clockInfo, syncClock } from "../../lib/clock";
import { useSyncedPlayer } from "../../lib/useSyncedPlayer";
import { TRACKS, trackById, trackSource } from "../../lib/tracks";

const ONLINE_MS = 20000;

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
  const join = useMutation(api.rooms.join);

  const [clock, setClock] = useState(clockInfo());
  const [now, setNow] = useState(Date.now());
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

  const track = trackById(room?.trackId);
  const source = trackSource(room?.trackId);
  const { driftMs, unlock, ready } = useSyncedPlayer(
    source,
    room && me && clock
      ? {
          playing: room.playing,
          startAt: room.startAt,
          pausedAt: room.pausedAt,
          muted: me.muted,
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

        <Text style={styles.label}>NOW PLAYING</Text>
        <Text style={styles.trackTitle}>{track.title}</Text>
        <Text style={styles.dim}>
          {track.artist}
          {soundOn && !ready ? "  ·  loading…" : ""}
        </Text>

        {isHost ? (
          <View style={styles.row}>
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
            {me.muted ? "Muted by the DJ" : room.playing ? "Playing" : "Waiting for the DJ"}
          </Text>
        )}

        {isHost ? (
          <>
            <Text style={styles.label}>SONGS</Text>
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

        <Text style={styles.label}>PHONES ({devices.length})</Text>
        {devices.map((d) => {
          const online = now - d.lastSeen < ONLINE_MS;
          return (
            <View key={d._id} style={styles.device}>
              <View style={{ flex: 1 }}>
                <Text style={styles.deviceName}>
                  {d.name}
                  {d.deviceId === room.hostDeviceId ? "  (DJ)" : ""}
                  {d.deviceId === DEVICE_ID ? "  (this phone)" : ""}
                </Text>
                <Text style={styles.dim}>
                  {online ? (d.muted ? "Off" : "On") : "Offline"}
                </Text>
              </View>
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
  chipText: { color: "#fff", fontSize: 15, fontWeight: "600" },
  enable: { backgroundColor: "#1f9d63", marginTop: 20 },
  primaryText: { color: "#fff", fontSize: 18, fontWeight: "700" },
  buttonText: { color: "#fff", fontSize: 16, fontWeight: "600" },
  nudge: { color: "#fff", fontSize: 17, width: 80, textAlign: "center", fontVariant: ["tabular-nums"] },
  device: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#17171f",
    borderRadius: 14,
    padding: 16,
    marginBottom: 10,
  },
  deviceName: { color: "#fff", fontSize: 17, fontWeight: "600" },
});

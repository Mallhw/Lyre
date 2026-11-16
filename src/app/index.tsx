import { useMutation } from "convex/react";
import { useRouter } from "expo-router";
import { useState } from "react";
import {
  KeyboardAvoidingView,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { api } from "../../convex/_generated/api";
import { DEVICE_ID } from "../lib/clock";

export default function Home() {
  const router = useRouter();
  const createRoom = useMutation(api.rooms.create);
  const joinRoom = useMutation(api.rooms.join);
  const [name, setName] = useState("");
  const [code, setCode] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const phoneName = name.trim() || "Phone " + DEVICE_ID.slice(0, 3).toUpperCase();

  async function host() {
    setBusy(true);
    try {
      const newCode = await createRoom({ deviceId: DEVICE_ID, name: phoneName });
      router.push(`/room/${newCode}`);
    } catch {
      setError("Couldn't start a room. Check your connection.");
    } finally {
      setBusy(false);
    }
  }

  async function join() {
    setBusy(true);
    try {
      const found = await joinRoom({ code: code.trim(), deviceId: DEVICE_ID, name: phoneName });
      if (found) router.push(`/room/${found}`);
      else setError(`No room with code ${code.trim().toUpperCase()}.`);
    } catch {
      setError("Couldn't join. Check your connection.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === "ios" ? "padding" : undefined}
      style={styles.container}
    >
      <Text style={styles.title}>Lyre</Text>
      <Text style={styles.subtitle}>Every phone is a speaker. One phone runs the set.</Text>

      <TextInput
        style={styles.input}
        placeholder="Name this phone (optional)"
        placeholderTextColor="#6b6b78"
        value={name}
        onChangeText={setName}
        maxLength={16}
      />

      <Pressable style={[styles.button, styles.primary]} onPress={host} disabled={busy}>
        <Text style={styles.primaryText}>Start a room</Text>
      </Pressable>

      <Text style={styles.or}>or join one</Text>

      <TextInput
        style={[styles.input, styles.code]}
        placeholder="CODE"
        placeholderTextColor="#6b6b78"
        value={code}
        onChangeText={(t) => {
          setCode(t.toUpperCase());
          setError("");
        }}
        autoCapitalize="characters"
        autoCorrect={false}
        maxLength={4}
      />
      <Pressable
        style={[styles.button, code.trim().length !== 4 && styles.disabled]}
        onPress={join}
        disabled={busy || code.trim().length !== 4}
      >
        <Text style={styles.buttonText}>Join room</Text>
      </Pressable>

      {error ? <Text style={styles.error}>{error}</Text> : null}
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, justifyContent: "center", padding: 28, backgroundColor: "#0b0b0f" },
  title: { color: "#fff", fontSize: 44, fontWeight: "800" },
  subtitle: { color: "#9a9aa8", fontSize: 16, marginTop: 6, marginBottom: 36 },
  input: {
    backgroundColor: "#17171f",
    color: "#fff",
    borderRadius: 14,
    paddingHorizontal: 16,
    paddingVertical: 14,
    fontSize: 17,
    marginBottom: 12,
  },
  code: { fontSize: 28, letterSpacing: 10, textAlign: "center", fontWeight: "700" },
  button: {
    backgroundColor: "#23232e",
    borderRadius: 14,
    paddingVertical: 16,
    alignItems: "center",
  },
  primary: { backgroundColor: "#7c5cff" },
  disabled: { opacity: 0.4 },
  primaryText: { color: "#fff", fontSize: 18, fontWeight: "700" },
  buttonText: { color: "#fff", fontSize: 17, fontWeight: "600" },
  or: { color: "#6b6b78", textAlign: "center", marginVertical: 22, fontSize: 14 },
  error: { color: "#ff6b6b", marginTop: 14, textAlign: "center" },
});

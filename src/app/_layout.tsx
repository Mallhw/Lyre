import { ConvexProvider, ConvexReactClient } from "convex/react";
import { Stack } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { Platform, Text, View } from "react-native";
import { CONVEX_URL } from "../lib/clock";

// In the browser, load Space Grotesk and apply it to all text. React Native
// text doesn't inherit fonts, so one CSS rule is simpler than styling every Text.
if (Platform.OS === "web" && typeof document !== "undefined") {
  const link = document.createElement("link");
  link.rel = "stylesheet";
  link.href =
    "https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@400;500;600;700&display=swap";
  document.head.appendChild(link);
  const style = document.createElement("style");
  style.textContent =
    "* { font-family: 'Space Grotesk', -apple-system, system-ui, sans-serif !important; }";
  document.head.appendChild(style);
}

// Created once at module level so navigation never opens a second connection.
const convex = CONVEX_URL
  ? new ConvexReactClient(CONVEX_URL, { unsavedChangesWarning: false })
  : null;

export default function RootLayout() {
  if (!convex) {
    return (
      <View style={{ flex: 1, justifyContent: "center", padding: 32, backgroundColor: "#0b0b0f" }}>
        <Text style={{ color: "#fff", fontSize: 18 }}>
          Backend not connected. Set EXPO_PUBLIC_CONVEX_URL and restart.
        </Text>
      </View>
    );
  }
  return (
    <ConvexProvider client={convex}>
      <StatusBar style="light" />
      <Stack
        screenOptions={{ headerShown: false, contentStyle: { backgroundColor: "#0b0b0f" } }}
      />
    </ConvexProvider>
  );
}

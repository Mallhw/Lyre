import { ConvexProvider, ConvexReactClient } from "convex/react";
import { Stack } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { Text, View } from "react-native";
import { CONVEX_URL } from "../lib/clock";

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

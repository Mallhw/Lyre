import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

export default defineSchema({
  // One DJ session. Playback is described by a single fact, "position 0 of the
  // track happened at server time startAt", so every phone can compute where
  // the song should be right now instead of trusting when a message arrived.
  rooms: defineTable({
    code: v.string(),
    hostDeviceId: v.string(),
    playing: v.boolean(),
    startAt: v.number(), // server ms at which track position 0 occurs (while playing)
    pausedAt: v.number(), // track position in seconds (while paused)
    trackId: v.optional(v.string()), // which song; missing means the click track
    // A second deck with its own song and timeline, for phones assigned to it.
    deckB: v.optional(
      v.object({
        trackId: v.string(),
        playing: v.boolean(),
        startAt: v.number(),
        pausedAt: v.number(),
      }),
    ),
    // Crossfader: 0 is only deck A, 1 is only deck B, 0.5 is both at full.
    fade: v.optional(v.number()),
  }).index("by_code", ["code"]),

  // One phone in a room.
  devices: defineTable({
    roomId: v.id("rooms"),
    deviceId: v.string(),
    name: v.string(),
    muted: v.boolean(),
    volume: v.optional(v.number()), // 0 to 1; missing means full volume
    deck: v.optional(v.string()), // "A" or "B"; missing means A
    // Which frequency bands this phone plays; missing means all three.
    bands: v.optional(
      v.object({ low: v.boolean(), mid: v.boolean(), high: v.boolean() }),
    ),
    nudgeMs: v.number(), // manual per-phone timing correction
    lastSeen: v.number(),
  })
    .index("by_room", ["roomId"])
    .index("by_room_device", ["roomId", "deviceId"]),
});

import { mutation, query } from "./_generated/server";
import { v } from "convex/values";

// Delay between pressing play and the first beat, so every phone has time to
// receive the update and get ready before the shared start moment.
const START_LEAD_MS = 2500;

const LETTERS = "ABCDEFGHJKLMNPQRSTUVWXYZ"; // no I or O, they read as 1 and 0

export const create = mutation({
  args: { deviceId: v.string(), name: v.string() },
  handler: async (ctx, args) => {
    let code = "";
    for (let attempt = 0; attempt < 20; attempt++) {
      code = Array.from(
        { length: 4 },
        () => LETTERS[Math.floor(Math.random() * LETTERS.length)],
      ).join("");
      const clash = await ctx.db
        .query("rooms")
        .withIndex("by_code", (q) => q.eq("code", code))
        .unique();
      if (!clash) break;
    }
    const roomId = await ctx.db.insert("rooms", {
      code,
      hostDeviceId: args.deviceId,
      playing: false,
      startAt: 0,
      pausedAt: 0,
    });
    await ctx.db.insert("devices", {
      roomId,
      deviceId: args.deviceId,
      name: args.name,
      muted: false,
      nudgeMs: 0,
      lastSeen: Date.now(),
    });
    return code;
  },
});

export const join = mutation({
  args: { code: v.string(), deviceId: v.string(), name: v.string() },
  handler: async (ctx, args) => {
    const room = await ctx.db
      .query("rooms")
      .withIndex("by_code", (q) => q.eq("code", args.code.toUpperCase()))
      .unique();
    if (!room) return null;
    const existing = await ctx.db
      .query("devices")
      .withIndex("by_room_device", (q) =>
        q.eq("roomId", room._id).eq("deviceId", args.deviceId),
      )
      .unique();
    if (existing) {
      await ctx.db.patch(existing._id, { name: args.name, lastSeen: Date.now() });
    } else {
      await ctx.db.insert("devices", {
        roomId: room._id,
        deviceId: args.deviceId,
        name: args.name,
        muted: false,
        nudgeMs: 0,
        lastSeen: Date.now(),
      });
    }
    return room.code;
  },
});

export const get = query({
  args: { code: v.string() },
  handler: async (ctx, args) => {
    const room = await ctx.db
      .query("rooms")
      .withIndex("by_code", (q) => q.eq("code", args.code.toUpperCase()))
      .unique();
    if (!room) return null;
    const devices = await ctx.db
      .query("devices")
      .withIndex("by_room", (q) => q.eq("roomId", room._id))
      .take(50);
    return { room, devices };
  },
});

export const play = mutation({
  args: { roomId: v.id("rooms") },
  handler: async (ctx, args) => {
    const room = await ctx.db.get(args.roomId);
    if (!room || room.playing) return null;
    await ctx.db.patch(args.roomId, {
      playing: true,
      startAt: Date.now() + START_LEAD_MS - room.pausedAt * 1000,
    });
    return null;
  },
});

export const pause = mutation({
  args: { roomId: v.id("rooms") },
  handler: async (ctx, args) => {
    const room = await ctx.db.get(args.roomId);
    if (!room || !room.playing) return null;
    await ctx.db.patch(args.roomId, {
      playing: false,
      pausedAt: Math.max(0, (Date.now() - room.startAt) / 1000),
    });
    return null;
  },
});

export const restart = mutation({
  args: { roomId: v.id("rooms") },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.roomId, {
      playing: true,
      startAt: Date.now() + START_LEAD_MS,
      pausedAt: 0,
    });
    return null;
  },
});

export const setTrack = mutation({
  args: { roomId: v.id("rooms"), trackId: v.string() },
  handler: async (ctx, args) => {
    // Changing song stops playback, so phones can load it before the next start.
    await ctx.db.patch(args.roomId, {
      trackId: args.trackId,
      playing: false,
      pausedAt: 0,
    });
    return null;
  },
});

// Deck B has the same controls as deck A, kept in one function so the
// original deck A functions stay exactly as they were.
export const deckB = mutation({
  args: {
    roomId: v.id("rooms"),
    action: v.union(
      v.literal("play"),
      v.literal("pause"),
      v.literal("restart"),
      v.literal("setTrack"),
    ),
    trackId: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const room = await ctx.db.get(args.roomId);
    if (!room) return null;
    const deck = room.deckB ?? { trackId: "click", playing: false, startAt: 0, pausedAt: 0 };
    const now = Date.now();
    if (args.action === "play" && !deck.playing) {
      deck.playing = true;
      deck.startAt = now + START_LEAD_MS - deck.pausedAt * 1000;
    } else if (args.action === "pause" && deck.playing) {
      deck.playing = false;
      deck.pausedAt = Math.max(0, (now - deck.startAt) / 1000);
    } else if (args.action === "restart") {
      deck.playing = true;
      deck.startAt = now + START_LEAD_MS;
      deck.pausedAt = 0;
    } else if (args.action === "setTrack" && args.trackId) {
      deck.trackId = args.trackId;
      deck.playing = false;
      deck.pausedAt = 0;
    }
    await ctx.db.patch(args.roomId, { deckB: deck });
    return null;
  },
});

// Jump a deck forward or back. Moving startAt moves the whole timeline, so
// every phone on that deck follows without any extra message.
export const seek = mutation({
  args: {
    roomId: v.id("rooms"),
    deck: v.union(v.literal("A"), v.literal("B")),
    deltaS: v.number(),
  },
  handler: async (ctx, args) => {
    const room = await ctx.db.get(args.roomId);
    if (!room) return null;
    const now = Date.now();
    const shift = (d: { playing: boolean; startAt: number; pausedAt: number }) => {
      if (d.playing) {
        const position = Math.max(0, (now - d.startAt) / 1000 + args.deltaS);
        return { startAt: now - position * 1000, pausedAt: d.pausedAt };
      }
      return { startAt: d.startAt, pausedAt: Math.max(0, d.pausedAt + args.deltaS) };
    };
    if (args.deck === "A") {
      await ctx.db.patch(args.roomId, shift(room));
    } else if (room.deckB) {
      await ctx.db.patch(args.roomId, { deckB: { ...room.deckB, ...shift(room.deckB) } });
    }
    return null;
  },
});

// Switch one band on or off for every phone in the room at once.
export const setBandAll = mutation({
  args: {
    roomId: v.id("rooms"),
    band: v.union(v.literal("low"), v.literal("mid"), v.literal("high")),
    on: v.boolean(),
  },
  handler: async (ctx, args) => {
    const devices = await ctx.db
      .query("devices")
      .withIndex("by_room", (q) => q.eq("roomId", args.roomId))
      .take(50);
    for (const d of devices) {
      const bands = d.bands ?? { low: true, mid: true, high: true };
      await ctx.db.patch(d._id, { bands: { ...bands, [args.band]: args.on } });
    }
    return null;
  },
});

export const setDeck = mutation({
  args: { id: v.id("devices"), deck: v.union(v.literal("A"), v.literal("B")) },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.id, { deck: args.deck });
    return null;
  },
});

export const setFade = mutation({
  args: { roomId: v.id("rooms"), fade: v.number() },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.roomId, { fade: Math.max(0, Math.min(1, args.fade)) });
    return null;
  },
});

export const setMuted = mutation({
  args: { id: v.id("devices"), muted: v.boolean() },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.id, { muted: args.muted });
    return null;
  },
});

export const setVolume = mutation({
  args: { id: v.id("devices"), volume: v.number() },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.id, { volume: Math.max(0, Math.min(1, args.volume)) });
    return null;
  },
});

export const setBands = mutation({
  args: {
    id: v.id("devices"),
    bands: v.object({ low: v.boolean(), mid: v.boolean(), high: v.boolean() }),
  },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.id, { bands: args.bands });
    return null;
  },
});

export const setNudge = mutation({
  args: { id: v.id("devices"), nudgeMs: v.number() },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.id, {
      nudgeMs: Math.max(-300, Math.min(300, args.nudgeMs)),
    });
    return null;
  },
});

export const heartbeat = mutation({
  args: { id: v.id("devices") },
  handler: async (ctx, args) => {
    const device = await ctx.db.get(args.id);
    if (device) await ctx.db.patch(args.id, { lastSeen: Date.now() });
    return null;
  },
});

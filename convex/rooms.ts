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

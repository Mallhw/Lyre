# Lyre

Turn every phone in the room into one sound system, and one phone into the DJ booth.

Built in a day at the Consumer Mobile Hackathon (YC, November 15, 2026).

**Try it:** https://lyre-dj.expo.app (open it on two or more phones)

## What it does

- **Synced playback.** Every phone in a room plays the same song at the same moment, each through its own speaker.
- **One DJ phone.** The phone that starts the room picks the song and controls play, pause and restart.
- **Per-phone control.** The DJ can switch each phone on or off and set its volume.
- **Three-band mixer.** Bass, Mids and Highs can be switched per phone, so you can cut the bass for a drop or make one phone the bass speaker and another the highs.
- **Join with a code or a link.** No install needed for the phones that join.

## How the sync works

1. **A shared clock.** Each phone pings a Convex HTTP endpoint several times and keeps the fastest round trip to estimate how far its clock is from the server's.
2. **One fact per room.** The room stores the server time at which the song's position 0 occurs. Every phone computes where the song should be right now, so late joiners land in sync too.
3. **Sample-accurate starts.** In the browser, audio is scheduled on the Web Audio clock, compensating for the device's output latency. A phone only re-aligns if it drifts more than 12 ms.
4. **A manual nudge.** Different phone models have different speaker delays, so each phone has Earlier/Later buttons in 10 ms steps.

## Built with

- **Capy** scaffolded the app, deploys the Convex backend and runs the cloud phone builds.
- **Convex** holds the room state and pushes every change to all phones in real time. It also serves the clock endpoint.
- **Revyl** builds the iOS app and runs it on a cloud iPhone.
- **Expo** (Expo Router, TypeScript, expo-audio) for the app, with a web build for phones that join by link.

## Run it

```
npm install
npx convex dev          # creates .env.local with EXPO_PUBLIC_CONVEX_URL
npx expo start
```

Song files are not in this repo. A fresh clone plays the built-in click track; add your own files under `public/songs/` and list them in `src/lib/tracks.ts`.

## Layout

- `convex/` backend: schema, room functions, clock endpoint
- `src/lib/clock.ts` clock sync
- `src/lib/useSyncedPlayer.web.ts` browser audio engine and mixer
- `src/lib/useSyncedPlayer.ts` native audio engine
- `src/app/` screens

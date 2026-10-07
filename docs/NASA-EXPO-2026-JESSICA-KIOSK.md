# Jessica booth kiosk

TV page for Accel Analysis. Jessica qualifies a visitor by voice, then points them at the intake form. The TV does not collect name, email, or phone, and the voice path does not write to Attio. The screen is not event-branded. An event query on the URL is not shown.

- Kiosk: `/kiosk/jessica`
- Always-on presentation: `/kiosk/jessica?mode=ambient` (alias `?display=solo`)
- Review frames: `/kiosk/jessica/frames` (idle, happy, speaking)
- Previous TV address: `/expo/nasa-2026/kiosk` redirects here and keeps the query
- Intake form: `/intake` (NASA Expo iPads can stay on `/expo/nasa-2026`, which adds the event and redirects)

Presentation mode is the TV loop. Jessica is already idle and animating. There is no tap-to-wake screen, no wordmark, and no iPad card. The background is Midnight with a soft Ice and Cyan glow and a little grain. Hold anywhere, or hold the space bar, to talk. Press **B** to return to the booth controls. The booth page also has a **Presentation** button, which sets `mode=ambient` and asks the browser to go fullscreen.

Jessica is a flat magenta circle with two white eyes. There is no drawn mouth, brow, shine, or drop shadow. Expression comes from the eye shape and position, and from the circle squashing and stretching like a balloon. The picture is drawn on a `requestAnimationFrame` loop locked to the display refresh and eased with an exponential lerp, so a 60 Hz panel gets a new frame every refresh. The voice level drives that squash while she speaks, and the same status picks the eye pose for listening, idle, and emotion. Poses follow the kiosk status and the line she is speaking: idle, wake, listen, thinking, speaking, happy, curious, concerned, engaged, celebrate, unavailable, and push-to-talk press.
- Voice: xAI Speech-to-Speech, `grok-voice-latest`
- Default listen mode: push-to-talk

The Next app is a static export, so the browser cannot hold `XAI_API_KEY`. A separate Cloud Function mints a client secret that lasts 5 minutes. The kiosk connects with `wss://api.x.ai/v1/realtime?model=grok-voice-latest` and the subprotocol `xai-client-secret.<token>`.

## Environment

Set the key as a Functions secret. Do not put it in `apps/web/.env`, the hosting build, or the booth Mac.

```bash
firebase functions:secrets:set XAI_API_KEY --project hi-coworking-plat
```

For a local emulator only, put the same key in `firebase/booth-kiosk-functions/.secret.local` (gitignored):

```bash
XAI_API_KEY=your-key
```

Optional:

- `NEXT_PUBLIC_BOOTH_TOKEN_URL` — override the mint URL at **web build** time. Leave it unset in production. The page already calls `https://us-central1-hi-coworking-plat.cloudfunctions.net/booth_mintVoiceClientSecret`.
- `BOOTH_ALLOWED_ORIGINS` — comma-separated extra browser origins on the function, if a rehearsal host is not already allowed (`hi-coworking.com`, `www`, `hi-coworking-plat.web.app`, `hi-coworking-plat.firebaseapp.com`, localhost:3000).

## Deploy the token function

This codebase is `firebase.booth-kiosk.json` on purpose. A normal booking or events deploy does not publish it.

```bash
npm run deploy:booth-kiosk
```

Smoke test from the Mac. The response is a live token. Do not paste it into Slack or a ticket. It expires in five minutes.

```bash
curl -s -X POST \
  -H "Origin: https://hi-coworking.com" \
  -H "Content-Type: application/json" \
  https://us-central1-hi-coworking-plat.cloudfunctions.net/booth_mintVoiceClientSecret
```

After the expo, delete or disable `booth_mintVoiceClientSecret` so the public URL cannot keep minting tokens. Rotate `XAI_API_KEY` if the URL was shared widely.

## Open the kiosk on the extended display

Use the Mac's speakers and built-in microphone. System Settings → Sound → Output: MacBook speakers (not HDMI). Input: MacBook microphone. The TV is often muted or has no speaker. Chrome and Edge on Apple Silicon are the native builds in `/Applications`.

Reliable path for show day:

1. Open Chrome or Edge to `https://hi-coworking.com/kiosk/jessica` (or the `web.app` host). `/expo/nasa-2026/kiosk` still redirects there.
2. Allow the microphone for that site.
3. Drag the window onto the TV.
4. Tap **Fullscreen on the TV**. Fullscreen stays on the display that holds the window. The Mac screen stays free.

The page hides the pointer. Press **C** when you need it for setup.

Unattended Chrome, after the mic permission is saved in this profile. Replace the window position with the TV's top-left corner from System Settings → Displays → Arrangement (the display with the menu bar is the Mac). If the TV is to the right of a 1512-wide Mac, X is `1512`. If it is above, Y is negative.

```bash
"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" \
  --user-data-dir="$HOME/Library/Application Support/AccelJessicaKiosk" \
  --autoplay-policy=no-user-gesture-required \
  --kiosk \
  --window-position=1512,0 \
  --window-size=1920,1080 \
  "https://hi-coworking.com/kiosk/jessica?mode=ambient"
```

Edge is the same flags with:

```bash
"/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge"
```

Do the first launch **without** `--kiosk`, allow the microphone, quit, then relaunch with `--kiosk`. Kiosk mode can hide the permission bubble. Grant the mic in the dedicated `--user-data-dir` profile, not a personal profile.

Keep the display awake: System Settings → Energy, or run `caffeinate -d` in a terminal while the booth is open.

## Push to talk

Tap **Tap to start**. Jessica greets, then asks what problem they are solving this quarter, who else is involved, and the timeline. She restates the need in their words and says: "Please enter your details on the iPad so our team can follow up the way you prefer."

Hold the gold button, or hold the space bar, while the visitor speaks. Release to send. A tap that is too short is ignored.

**Auto-listen** (server VAD) is off. Turn it on only in a quiet rehearsal room. On the show floor, leave it off.

If speech recognition fails twice in a row, Jessica apologizes and tells them a greeter and the iPad will help. She does not guess what they said. **Next visitor** closes the voice session. The page also resets itself about eight seconds after the handoff or the apology, so the next person does not inherit the previous conversation.

Say a fake email during rehearsal. Jessica should not repeat it, and it should not remain on the TV caption. Nothing from this page is written to Attio.

## Rehearsal — October 17

- [ ] `XAI_API_KEY` is set in Functions secrets, not on the Mac and not in the web build.
- [ ] `npm run deploy:booth-kiosk` succeeded, and the curl smoke test returns a token.
- [ ] Greeting plays from the Mac speakers.
- [ ] Hold-to-talk gets through problem, who else is involved, and timeline.
- [ ] The iPad sentence is spoken, and **Next visitor** returns to the wake screen.
- [ ] Two empty holds produce the apology, then the greeter line. No invented summary.
- [ ] A volunteered email or phone is not repeated and not shown on the TV.
- [ ] Attio has no new record from the voice session.
- [ ] The iPad still opens `/expo/nasa-2026` or `/intake?event=nasa-expo-2026-10-20`.

## Dress rehearsal — October 19

- [ ] Window is on the TV only. The Mac display is still usable.
- [ ] Output is the Mac speakers. Input is the built-in mic. Volume is audible from the aisle.
- [ ] Pointer is hidden. Auto-listen is off.
- [ ] Push-to-talk still works with booth noise.
- [ ] Greeter knows the two-miss line and where the iPad form is.
- [ ] Display does not sleep (`caffeinate -d` or Energy settings).
- [ ] Mint URL still returns a token.
- [ ] Quit and reopen from the kiosk profile once, so Oct 20 is the same launch.

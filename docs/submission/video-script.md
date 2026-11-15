# MARS-X — 30-second demo video (one take)

Rules this script follows (Space Apps project submission guide):
- 30 s or less: projects that exceed it are not eligible for global judging.
- English.
- Publicly accessible link with no login.
- No people under 18.
- No NASA or JPL logos.
- No AI-generated media (if any were added, they would need a visible watermark).

Format: one person, one continuous take, screen capture plus voice. No editing is needed. The English subtitles go
in as a separate `.srt` file uploaded to YouTube (below), so nothing has to be burned in.

## Setup (before pressing record)

1. Use **Chrome or Edge** in a 1920×1080 window (or 1440×900), browser zoom at 100 %, dark theme (default).
   Close other tabs and silence notifications.
2. Open the URL once to warm the cache, then keep the tab:
   `https://preview.mars-x-7k9.pages.dev/?tour=1` → replace it with **[FINAL URL]/?tour=1** once production is live.
3. Rehearse twice. The guided tour opens by itself with `?tour=1` once the scene is ready. Each step has a **Next**
   button at the bottom of the tour card.
4. Recorder:
   - **OBS:** Display Capture or Window Capture, 1080p, 30 fps, MP4; microphone at -12 dB; start and stop with a
     hotkey.
   - **Xbox Game Bar:** Win + Alt + R to start and stop; it records the browser window with the microphone on.
5. Have the browser address bar focused with the `?tour=1` URL typed but not entered.

## Shot list and voice-over

| Time | What is on screen (exact action) | Voice-over = subtitle |
|---|---|---|
| 0:00–0:03 | Press **Enter** on the `?tour=1` URL. The loading screen and title fly-in over Jezero appear | "We're [TEAM NAME], from Bolivia." |
| 0:03–0:06 | Fly-in continues; tour card **"Real Jezero terrain"** (step 1 of 6) appears with the Data panel | "Our challenge: Interplanetary Survival Guide — Martian Map." |
| 0:06–0:10 | Keep step 1: point the cursor at "r = 0.99999" in the tour card | "MARS-X: test your Mars navigation AI on real Jezero terrain." |
| 0:10–0:13 | Click **Next**. Step 2 **"Mars conditions"**: click the action **Dust storm sol 315** in the card | "1-metre NASA HiRISE terrain, real Perseverance weather sols, Mars24 sun." |
| 0:13–0:18 | Click **Next**. Step 3 **"Marswalk"**: the astronaut route to the Mg-carbonate stop draws; click **Walk budget** | "Plan a safe Marswalk: slope limits, EVA budget, a shelter rule." |
| 0:18–0:21 | Click **Next**. Step 4 **"Rover: one plan per sol"** | "Rovers get one plan per sol — so they need autonomy." |
| 0:21–0:26 | Click **Next**. Step 5 **"Bring your own AI"**: click **Open scorecard** and let the scorecard show | "Drop in your own AI. Nothing is uploaded. Even the oracle planner fails level 2." |
| 0:26–0:30 | Close the scorecard, click **Next**. Step 6 **"Graduate to a full simulator"** with the "necessary, not sufficient" note visible. Stop recording at 0:30 | "A first filter: necessary, not sufficient, before Gazebo, Isaac Sim — or Mars." |

If step 5 shows **"Example run not published"** instead of a scorecard, keep the card on screen (the line "Even
the oracle planner fails L2" is in it) and say the same sentence. Do not edit numbers into the video.

Timing check: about 80 spoken words in 30 s (≈ 160 words per minute), which is brisk. If a rehearsal runs long,
drop these phrases from both the voice and the `.srt`, in this order:
1. "so they need autonomy";
2. "from Bolivia";
3. "Nothing is uploaded".

## Subtitles file (`mars-x-demo.en.srt`)

```
1
00:00:00,000 --> 00:00:03,000
We're [TEAM NAME], from Bolivia.

2
00:00:03,000 --> 00:00:06,000
Our challenge: Interplanetary Survival Guide — Martian Map.

3
00:00:06,000 --> 00:00:10,000
MARS-X: test your Mars navigation AI on real Jezero terrain.

4
00:00:10,000 --> 00:00:13,000
1-metre NASA HiRISE terrain, real Perseverance weather sols, Mars24 sun.

5
00:00:13,000 --> 00:00:18,000
Plan a safe Marswalk: slope limits, EVA budget, a shelter rule.

6
00:00:18,000 --> 00:00:21,000
Rovers get one plan per sol — so they need autonomy.

7
00:00:21,000 --> 00:00:26,000
Drop in your own AI. Nothing is uploaded. Even the oracle planner fails level 2.

8
00:00:26,000 --> 00:00:30,000
A first filter: necessary, not sufficient, before Gazebo, Isaac Sim — or Mars.
```

## Upload

YouTube, Unlisted or Public, with no login needed to view.
- **Title:** "MARS-X — NASA Space Apps 2026 (Martian Map)".
- **Subtitles:** add the `.srt` as English subtitles.
- **Description:**
  - Data: NASA/USGS HiRISE (doi:10.5066/P9REJ9JN, doi:10.5066/P9QJDP48), NASA/JPL-Caltech Mars 2020 MMGIS, NASA PDS
    MEDA.
  - "Not affiliated with or endorsed by NASA, JPL or Caltech."
  - "Code written with AI assistance (Claude Code) under the team's direction; no AI-generated images, video or
    audio."
- **Final check:** test the link in a private window. Confirm the duration is ≤ 0:30 before pasting it into the form.

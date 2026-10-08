# GI Controller: design

General Intuition (GI) builds action models: a camera stream goes in, gamepad-style controls come out, the way a
person plays a game from what they see. The GI Controller lets one of those models drive a dimOS robot, with a person
always one keypress away from taking over. It is a fork of dim-controller (the 3D view, cameras, recording and manual
driving are unchanged); this page is about what the fork adds.

## How someone would use a GI model on a robot

1. **"Say where to go, let it drive."** Hold the mic button and say "go explore the hallway". The words become the
   model's instruction, the Autodrive button turns on, and the robot moves on its own. The person watches the cameras.
2. **"Grab it mid-run."** The robot heads for a table leg. The person presses W (or touches a stick, or moves a real
   gamepad's stick) and is driving that instant. The model's output is ignored from that tick on, and the HUD says
   "You're driving".
3. **"Hand it back."** The person lets go. After two seconds of no input the model resumes from what the camera sees
   now. Someone who prefers explicit hand-back turns auto-resume off, and then the model waits for the Autodrive button.
4. **"See what it's about to do."** While it drives, the HUD draws the model's two sticks live, shows its status
   (thinking / driving / paused for you / done / stuck), how long each step took, and the model's short "thought" if it
   gives one. A wrong turn is visible before it happens, and a slow model shows as rising step latency.
5. **"Change your mind without stopping."** Say (or type) a new instruction while it drives: the next step uses it.
6. **"It knows when it's done."** The model can answer `done` ("reached the door") or `stuck`. Either one ends
   autodrive, stops the robot, and leaves the reason on screen.
7. **"Try it with no GI account."** The built-in mock policy obeys simple instructions (forward, back, turn left,
   turn right, spin, explore, stop). It makes the whole loop demoable on a sim with no key and no network.

## The GI API (imagined)

No GI spec exists yet, so this is a guess at the smallest API that serves the scenarios above. It is easy to change
in one place (`frontend/src/core/gi/policy.ts` and `server/src/gi.rs`).

`POST <endpoint>` with `Authorization: Bearer <key>`:

```json
{
    "session": "a stable id per autodrive run (lets the model keep memory across steps)",
    "model": "gi-action-1",
    "instruction": "explore the hallway",
    "frame": { "mimeType": "image/jpeg", "data": "<base64>", "width": 640, "height": 360 },
    "audio": { "mimeType": "audio/webm", "data": "<base64>" },
    "t": 12.4
}
```

`audio` is optional (the raw push-to-talk clip, for a model that listens itself; this app doesn't send it yet, since
speech recognition and a recorder fight over the mic in some browsers), and `t` is seconds since the run
started. The answer:

```json
{
    "action": { "leftStick": [0, 0.8], "rightStick": [-0.2, 0], "buttons": { "a": false } },
    "status": "running",
    "thought": "corridor ahead, keeping right of the cart"
}
```

- Sticks follow the browser Gamepad API: x right, y up, each -1..1. On a robot, left stick y is forward, left x
  strafes, right x turns and right y climbs (for a drone). Same mapping as a real gamepad in this app.
- `status` is one of `running`, `done` or `stuck`. Anything other than `running` ends autodrive.
- `thought` is optional free text, shown as is.

The page never holds the key. It posts the step to its own backend (`POST api/gi/step`), which adds the key and
forwards it to the endpoint. The key is set from Settings → GI (`PUT api/gi/key`) and stored in the app's data dir,
apart from the settings file, so `GET api/settings` and the agent never see it.

## Controller features, by scenario

| scenario | feature |
| --- | --- |
| 1 say where to go | mic button (push-to-talk; hold T on a desktop): browser speech recognition, interim words shown live; a text field for typing; Autodrive button (G, or a gamepad's A) |
| 2 grab it | takeover inside the drive loop: any human source (keys, on-screen sticks, a physical gamepad) with a non-zero axis drops the policy's share in the same recompute that applies the human input |
| 3 hand it back | resume after an idle (default 2 s) with auto-resume on; with it off, the Autodrive button resumes |
| 4 see what it does | GI HUD: status, instruction, step latency, thought, the policy's two sticks drawn live |
| 5 change your mind | the instruction is read at every step |
| 6 it knows | `done` / `stuck` end autodrive, stop the robot, say why; so do a step error, STOP (button or Space), a lost link and hiding the page |
| 7 no account | `MockGi`, the default policy until an endpoint is set |

Safety: autodrive's output is scaled by **max autodrive speed** (a fraction of the drive speeds, default 50%), runs
through the same 20 Hz drive loop and gateway deadman as manual driving, and the policy is only stepped while a fresh
camera frame exists (no frame → status "waiting for camera", nothing driven).

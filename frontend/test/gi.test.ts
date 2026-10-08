// GI: takeover inside the drive loop, the mock policy, a gamepad's sticks, the autodrive loop's run / pause / end
// rules, the HTTP policy's answer checking, and push-to-talk.
import { assert, assertAlmostEquals, assertEquals, assertRejects, assertThrows } from "jsr:@std/assert@1"
import { Drive } from "../src/core/drive.ts"
import go2 from "../src/profile/dog.ts"
import drone from "../src/profile/drone.ts"
import type { Connection } from "../src/core/transport.ts"
import { applyDeadzone, gamepadAxes, sticksToAxes } from "../src/core/gamepad.ts"
import { HttpGi, mockStep, parseStepResult } from "../src/core/gi/policy.ts"
import type { GiFrame, GiPolicy, GiStepRequest, GiStepResult } from "../src/core/gi/policy.ts"
import { Autodrive, type AutodriveSettings, DEFAULT_AUTODRIVE } from "../src/core/gi/autodrive.ts"
import { Speech, speechUnavailable } from "../src/core/gi/speech.ts"
import { Store } from "../src/core/store.ts"
import { statusText } from "../src/ui/GiHud.tsx"

function fakeConnection(): Connection {
    const client = {
        state: "connected",
        publisher: () => ({ state: "open", put() {}, setDeadman: () => Promise.resolve(), clearDeadman: () => Promise.resolve(), close() {} }),
    }
    return { client } as unknown as Connection
}

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

async function until(check: () => boolean, ms = 2000) {
    const end = Date.now() + ms
    while (!check()) {
        if (Date.now() > end) {
            throw new Error("timed out waiting")
        }
        await wait(5)
    }
}

const FRAME: GiFrame = { mimeType: "image/jpeg", data: "AAAA", width: 2, height: 2 }

/** A policy that answers what `next` says and counts its steps. */
function scriptedPolicy(next: (request: GiStepRequest, count: number) => GiStepResult | Promise<GiStepResult>) {
    const requests: GiStepRequest[] = []
    const policy: GiPolicy = {
        name: "Scripted",
        step(request) {
            requests.push(request)
            return Promise.resolve(next(request, requests.length))
        },
    }
    return { policy, requests }
}

const forward: GiStepResult = { action: { leftStick: [0, 1], rightStick: [0, 0] }, status: "running", thought: "ahead" }

function setup(policy: GiPolicy, overrides: Partial<AutodriveSettings> = {}, frame: () => GiFrame | null = () => FRAME) {
    localStorage.clear()
    const drive = new Drive(fakeConnection(), go2)
    const settings = new Store<AutodriveSettings>({ ...DEFAULT_AUTODRIVE, rateHz: 50, resumeMs: 120, ...overrides })
    const autodrive = new Autodrive(drive, { grab: () => Promise.resolve(frame()) }, settings, () => policy)
    const dispose = () => {
        autodrive.dispose()
        drive.dispose()
    }
    return { drive, settings, autodrive, dispose }
}

Deno.test("takeover: a person's input drops the autopilot's share in the same call, and it stays dropped after they let go", () => {
    localStorage.clear()
    const drive = new Drive(fakeConnection(), go2)
    drive.setAxes("gi", { forward: 1 })
    assertEquals(drive.state.get().axes.forward, 1)
    assertEquals(drive.state.get().takeover, false)
    drive.setAxes("keys", { turn: 1 })
    assertEquals(drive.state.get().takeover, true)
    assertEquals(drive.state.get().axes.forward, 0, "gi's forward is gone the moment the key is down")
    assertEquals(drive.state.get().axes.turn, 1)
    // while the person drives, the autopilot can't add to it
    drive.setAxes("gi", { forward: 1 })
    assertEquals(drive.state.get().axes.forward, 0)
    drive.setAxes("keys", {})
    assertEquals(drive.state.get().takeover, false)
    assertEquals(drive.state.get().axes.forward, 0, "the old gi share doesn't come back on release")
    // a zero stick (a resting thumb) is not a takeover
    drive.setAxes("left-stick", { forward: 0, strafe: 0 })
    drive.setAxes("gi", { forward: 0.5 })
    assertEquals(drive.state.get().takeover, false)
    assertEquals(drive.state.get().axes.forward, 0.5)
    drive.setAxes("gamepad", { turn: -0.3 })
    assertEquals(drive.state.get().takeover, true)
    assertEquals(drive.state.get().axes.forward, 0)
    drive.dispose()
})

Deno.test("the mock policy obeys plain instructions", () => {
    assertEquals(mockStep("go forward", 0).action, { leftStick: [0, 0.8], rightStick: [0, 0] })
    assertEquals(mockStep("turn left", 0).action.rightStick, [-0.7, 0])
    assertEquals(sticksToAxes([0, 0], mockStep("turn left", 0).action.rightStick).turn, 0.7, "left is a positive turn")
    assertEquals(mockStep("turn right", 0).action.rightStick, [0.7, 0])
    assertEquals(mockStep("go forward and left", 0).action.leftStick, [0, 0.5])
    assertEquals(mockStep("Spin!", 0).action.rightStick, [-1, 0])
    assertEquals(mockStep("back up", 0).action.leftStick, [0, -0.6])
    assertEquals(mockStep("stop", 0).status, "done")
    assertEquals(mockStep("", 0), { action: { leftStick: [0, 0], rightStick: [0, 0] }, status: "running", thought: "waiting for an instruction" })
    assertEquals(mockStep("forward for 2 seconds", 1.9).status, "running")
    assertEquals(mockStep("forward for 2 seconds", 2).status, "done")
    assertEquals(mockStep("spin for 1.5s", 1.6).status, "done")
    const early = mockStep("explore", 0)
    const later = mockStep("explore", 1)
    assertEquals(early.action.leftStick, [0, 0.6])
    assert(early.action.rightStick[0] !== later.action.rightStick[0], "explore weaves")
    assertEquals(mockStep("explore", 1), mockStep("explore", 1), "deterministic")
})

Deno.test("a gamepad's sticks: deadzone, rescaling, y down is forward-negative", () => {
    assertEquals(applyDeadzone(0.1, 0.15), 0)
    assertEquals(applyDeadzone(-0.15, 0.15), 0)
    assertAlmostEquals(applyDeadzone(0.575, 0.15), 0.5)
    assertEquals(applyDeadzone(1, 0.15), 1)
    assertEquals(applyDeadzone(Number.NaN, 0.15), 0)
    // left stick pushed up (y = -1), a drifting right stick
    assertEquals(gamepadAxes([0.05, -1, 0.1, 0.12]), { forward: 1, strafe: -0, turn: -0, vertical: -0 })
    const axes = gamepadAxes([1, 0, -1, 1])
    assertEquals([axes.forward, axes.strafe, axes.turn, axes.vertical], [-0, -1, 1, -1])
    assertEquals(sticksToAxes([2, Number.NaN], [0, 0]), { forward: 0, strafe: -1, turn: -0, vertical: 0 })
})

Deno.test("autodrive drives with the policy's sticks, scaled by the max speed, and shows what it's doing", async () => {
    const { policy, requests } = scriptedPolicy(() => forward)
    const { drive, autodrive, dispose } = setup(policy, { maxSpeed: 0.5 })
    autodrive.setInstruction("  explore ")
    autodrive.start()
    await until(() => autodrive.state.get().status === "driving")
    assertEquals(drive.state.get().axes.forward, 0.5)
    const state = autodrive.state.get()
    assertEquals([state.on, state.thought, state.instruction], [true, "ahead", "explore"])
    assert(state.latencyMs !== null && state.steps >= 1)
    assertEquals(requests[0].instruction, "explore")
    assertEquals(requests[0].frame, FRAME)
    assertEquals(statusText(state, false), "Scripted driving")
    // a new instruction is used from the next step
    autodrive.setInstruction("left")
    await until(() => requests.at(-1)!.instruction === "left")
    assertEquals(new Set(requests.map((request) => request.session)).size, 1, "one session per run")
    // the button turns it off: the gi share is cleared
    autodrive.toggle()
    assertEquals(autodrive.state.get().on, false)
    assertEquals(drive.state.get().axes.forward, 0)
    const count = requests.length
    await wait(80)
    assertEquals(requests.length, count, "no steps after it's off")
    dispose()
})

for (const [label, status, thought] of [["done", "done", "at the door"], ["stuck", "stuck", "blocked"]] as const) {
    Deno.test(`autodrive ends when the policy says ${label}, stops driving and keeps why`, async () => {
        const { policy } = scriptedPolicy((_, count) => (count < 3 ? forward : { action: { leftStick: [0, 1], rightStick: [0, 0] }, status, thought }))
        const { drive, autodrive, dispose } = setup(policy)
        autodrive.start()
        await until(() => !autodrive.state.get().on)
        assertEquals(autodrive.state.get().status, status)
        assertEquals(autodrive.state.get().reason, thought)
        assertEquals(drive.state.get().axes.forward, 0, "the last (non-running) action is never driven")
        dispose()
    })
}

Deno.test("autodrive ends on a policy error, on STOP, and on a halted link", async () => {
    {
        const { autodrive, dispose } = setup({ name: "Broken", step: () => Promise.reject(new Error("401 bad key")) })
        autodrive.start()
        await until(() => !autodrive.state.get().on)
        assertEquals(autodrive.state.get().status, "error")
        assertEquals(autodrive.state.get().reason, "GI: 401 bad key")
        dispose()
    }
    {
        const { policy } = scriptedPolicy(() => forward)
        const { drive, autodrive, dispose } = setup(policy)
        autodrive.start()
        await until(() => autodrive.state.get().status === "driving")
        drive.stop()
        assertEquals(autodrive.state.get().on, false)
        assertEquals(autodrive.state.get().status, "off")
        assertEquals(drive.state.get().axes.forward, 0)
        dispose()
    }
    {
        const { policy } = scriptedPolicy(() => forward)
        const { drive, autodrive, dispose } = setup(policy)
        autodrive.start()
        await until(() => autodrive.state.get().status === "driving")
        drive.halt({ reason: "lost", latencyMs: null, maxMs: 500 })
        assertEquals(autodrive.state.get().on, false)
        assertEquals(autodrive.state.get().status, "error")
        dispose()
    }
})

Deno.test("switching the robot type ends autodrive", async () => {
    const { policy } = scriptedPolicy(() => forward)
    const { drive, autodrive, dispose } = setup(policy)
    autodrive.start()
    await until(() => autodrive.state.get().status === "driving")
    drive.setProfile(drone)
    assertEquals(autodrive.state.get().on, false)
    assertEquals(drive.state.get().axes.forward, 0)
    dispose()
})

Deno.test("takeover pauses autodrive (no steps while the person drives) and it hands back after the idle", async () => {
    const { policy, requests } = scriptedPolicy(() => forward)
    const { drive, autodrive, dispose } = setup(policy, { resumeMs: 150 })
    autodrive.start()
    await until(() => autodrive.state.get().status === "driving")
    drive.setAxes("keys", { turn: 1 })
    assertEquals(autodrive.state.get().status, "paused")
    assertEquals(statusText(autodrive.state.get(), drive.state.get().takeover), "You're driving")
    assertEquals(drive.state.get().axes.forward, 0)
    await wait(40)
    const during = requests.length
    await wait(120)
    assertEquals(requests.length, during, "GI isn't asked while the person drives")
    drive.setAxes("keys", {})
    assertEquals(autodrive.state.get().status, "paused")
    assertEquals(autodrive.state.get().on, true)
    await wait(60)
    assertEquals(requests.length, during, "still waiting out the idle")
    assertEquals(drive.state.get().axes.forward, 0)
    await until(() => autodrive.state.get().status === "driving")
    assert(requests.length > during)
    assertEquals(drive.state.get().axes.forward, 0.5)
    dispose()
})

Deno.test("with auto-resume off, a takeover waits for the button", async () => {
    const { policy, requests } = scriptedPolicy(() => forward)
    const { drive, autodrive, dispose } = setup(policy, { autoResume: false, resumeMs: 50 })
    autodrive.start()
    await until(() => autodrive.state.get().status === "driving")
    drive.setAxes("stick", { forward: -1 })
    drive.setAxes("stick", {})
    const count = requests.length
    await wait(200)
    assertEquals(autodrive.state.get().status, "paused")
    assertEquals(autodrive.state.get().reason, "press Autodrive to hand back")
    assertEquals(requests.length, count)
    assertEquals(drive.state.get().axes.forward, 0)
    // the button hands back (it doesn't turn autodrive off)
    autodrive.toggle()
    await until(() => autodrive.state.get().status === "driving")
    assertEquals(autodrive.state.get().on, true)
    dispose()
})

Deno.test("a step GI was still thinking about when the person took over is thrown away", async () => {
    let release: (result: GiStepResult) => void = () => {}
    const { policy, requests } = scriptedPolicy((_, count) => (count === 1 ? new Promise<GiStepResult>((resolve) => (release = resolve)) : { action: { leftStick: [0, 0], rightStick: [0, 0] }, status: "running" }))
    const { drive, autodrive, dispose } = setup(policy, { resumeMs: 30 })
    autodrive.start()
    await until(() => requests.length === 1)
    drive.setAxes("keys", { turn: 1 })
    drive.setAxes("keys", {})
    release({ action: { leftStick: [0, 1], rightStick: [0, 0] }, status: "running" })
    await wait(10)
    assertEquals(drive.state.get().axes.forward, 0, "the stale full-forward is never applied")
    await until(() => requests.length >= 2)
    assertEquals(autodrive.state.get().on, true, "a thrown-away step isn't an error")
    dispose()
})

Deno.test("no camera frame: autodrive waits and drives nothing", async () => {
    const { policy, requests } = scriptedPolicy(() => forward)
    const { drive, autodrive, dispose } = setup(policy, {}, () => null)
    autodrive.start()
    await until(() => autodrive.state.get().status === "waiting")
    assertEquals(requests.length, 0)
    assertEquals(drive.state.get().axes.forward, 0)
    assertEquals(statusText(autodrive.state.get(), false), "Waiting for camera")
    dispose()
})

Deno.test("GI's answers are checked: anything malformed is an error, never a drive", async () => {
    assertEquals(parseStepResult({ action: { leftStick: [0, 2], rightStick: [-0.5, 0] }, status: "running", thought: 3 }), { action: { leftStick: [0, 1], rightStick: [-0.5, 0], buttons: undefined }, status: "running", thought: undefined })
    assertThrows(() => parseStepResult({ status: "running" }), Error, "no action")
    assertThrows(() => parseStepResult({ action: { leftStick: [0], rightStick: [0, 0] }, status: "running" }), Error, "malformed stick")
    assertThrows(() => parseStepResult({ action: { leftStick: [0, "1"], rightStick: [0, 0] }, status: "running" }), Error, "malformed stick")
    assertThrows(() => parseStepResult({ action: { leftStick: [0, 0], rightStick: [0, 0] }, status: "flying" }), Error, "unknown status")

    const sent: { url: string; body: unknown }[] = []
    const ok = new HttpGi("gi-action-1", (url, init) => {
        sent.push({ url: String(url), body: JSON.parse(String(init?.body)) })
        return Promise.resolve(new Response(JSON.stringify({ action: { leftStick: [0, 0.5], rightStick: [0, 0] }, status: "done", thought: "there" })))
    }, () => "http://app/api/gi/step")
    const request: GiStepRequest = { session: "s", instruction: "go", frame: FRAME, t: 1 }
    assertEquals((await ok.step(request)).status, "done")
    assertEquals(sent[0], { url: "http://app/api/gi/step", body: { ...request, model: "gi-action-1" } })
    const refused = new HttpGi("m", () => Promise.resolve(new Response(JSON.stringify({ error: "GI answered 401: bad key" }), { status: 502 })), () => "http://app/api/gi/step")
    await assertRejects(() => refused.step(request), Error, "GI answered 401: bad key")
})

Deno.test("push-to-talk: interim words while holding, the whole utterance on release; no recognition says why", () => {
    assertEquals(speechUnavailable({}), "this browser has no speech recognition (use Chrome, Edge or Safari), type instead")
    assertEquals(speechUnavailable({ webkitSpeechRecognition: class {}, isSecureContext: false }), "the mic needs a secure page (https or localhost)")

    // deno-lint-ignore no-explicit-any
    let instance: any = null
    class FakeRecognition {
        // deno-lint-ignore no-explicit-any
        onresult: any
        // deno-lint-ignore no-explicit-any
        onend: any
        constructor() {
            instance = this
        }
        start() {}
        stop() {
            this.onend()
        }
    }
    const speech = new Speech({ webkitSpeechRecognition: FakeRecognition, isSecureContext: true })
    assertEquals(speech.state.get().unavailable, null)
    const heard: string[] = []
    speech.start((text) => heard.push(text))
    assertEquals(speech.state.get().listening, true)
    const result = (transcript: string, isFinal: boolean) => Object.assign([{ transcript }], { isFinal })
    instance.onresult({ resultIndex: 0, results: [result("go to the ", false)] })
    assertEquals(speech.state.get().interim, "go to the")
    instance.onresult({ resultIndex: 0, results: [result("go to the kitchen", true)] })
    speech.stop()
    assertEquals(heard, ["go to the kitchen"])
    assertEquals(speech.state.get().listening, false)

    const none = new Speech({})
    none.start(() => heard.push("never"))
    assertEquals(none.state.get().listening, false)
})

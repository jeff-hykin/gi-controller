// A GI action model as this app sees it (docs/gi.md, "The GI API"): a camera frame and an instruction go in, a
// gamepad-style action and a status come out. MockGi answers locally (no key, no network); HttpGi goes through this
// app's backend (POST api/gi/step), which adds the key and forwards to the endpoint set in Settings → GI.
import type { Stick } from "../gamepad.ts"

export interface GiFrame {
    mimeType: string
    /** base64, no data: prefix */
    data: string
    width: number
    height: number
}

export interface GiStepRequest {
    /** one per autodrive run, so the model can keep memory across steps */
    session: string
    instruction: string
    frame: GiFrame
    /** the push-to-talk clip, for a model that listens itself */
    audio?: { mimeType: string; data: string }
    /** seconds since the run started */
    t: number
}

export interface GiAction {
    leftStick: Stick
    rightStick: Stick
    buttons?: Record<string, boolean>
}

export type GiStepStatus = "running" | "done" | "stuck"

export interface GiStepResult {
    action: GiAction
    status: GiStepStatus
    thought?: string
}

export interface GiPolicy {
    readonly name: string
    step(request: GiStepRequest, signal?: AbortSignal): Promise<GiStepResult>
}

export const IDLE_ACTION: GiAction = { leftStick: [0, 0], rightStick: [0, 0] }

/**
 * Stand-in for a GI model: obeys a few plain instructions, never looks at the frame. Deterministic in (instruction,
 * t). "for N seconds" ends the run (done) after N s.
 */
export class MockGi implements GiPolicy {
    readonly name = "Mock GI"

    step(request: GiStepRequest): Promise<GiStepResult> {
        return Promise.resolve(mockStep(request.instruction, request.t))
    }
}

export function mockStep(instruction: string, t: number): GiStepResult {
    const text = instruction.toLowerCase()
    const seconds = Number(text.match(/for (\d+(?:\.\d+)?) ?s(?:ec(?:ond)?s?)?\b/)?.[1])
    if (Number.isFinite(seconds) && t >= seconds) {
        return { action: IDLE_ACTION, status: "done", thought: `did that for ${seconds} s` }
    }
    const has = (...words: string[]) => words.some((word) => new RegExp(`\\b${word}\\b`).test(text))
    if (!text.trim()) {
        return { action: IDLE_ACTION, status: "running", thought: "waiting for an instruction" }
    }
    if (has("stop", "halt", "stay", "wait")) {
        return { action: IDLE_ACTION, status: "done", thought: "stopping, as asked" }
    }
    if (has("spin")) {
        return { action: { leftStick: [0, 0], rightStick: [-1, 0] }, status: "running", thought: "spinning in place" }
    }
    if (has("left")) {
        return { action: { leftStick: [0, has("forward", "ahead", "go") ? 0.5 : 0], rightStick: [-0.7, 0] }, status: "running", thought: "turning left" }
    }
    if (has("right")) {
        return { action: { leftStick: [0, has("forward", "ahead", "go") ? 0.5 : 0], rightStick: [0.7, 0] }, status: "running", thought: "turning right" }
    }
    if (has("back", "backward", "backwards", "reverse")) {
        return { action: { leftStick: [0, -0.6], rightStick: [0, 0] }, status: "running", thought: "backing up" }
    }
    if (has("forward", "ahead", "straight")) {
        return { action: { leftStick: [0, 0.8], rightStick: [0, 0] }, status: "running", thought: "going straight ahead" }
    }
    if (has("up", "climb", "rise")) {
        return { action: { leftStick: [0, 0], rightStick: [0, 0.6] }, status: "running", thought: "climbing" }
    }
    if (has("down", "descend", "land")) {
        return { action: { leftStick: [0, 0], rightStick: [0, -0.6] }, status: "running", thought: "descending" }
    }
    // explore (and anything it doesn't know): forward, weaving gently left and right
    const weave = Math.round(Math.sin(t * 0.8) * 50) / 100
    return { action: { leftStick: [0, 0.6], rightStick: [weave, 0] }, status: "running", thought: `exploring, weaving ${weave < 0 ? "left" : "right"}` }
}

/** The real model, through this app's backend: it holds the key and the endpoint (Settings → GI). */
export class HttpGi implements GiPolicy {
    readonly name = "GI"
    constructor(readonly model: string, readonly fetcher: typeof fetch = fetch, readonly url = () => new URL("api/gi/step", location.href).href) {}

    async step(request: GiStepRequest, signal?: AbortSignal): Promise<GiStepResult> {
        const response = await this.fetcher(this.url(), {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ ...request, model: this.model }),
            signal,
        })
        const body = await response.json().catch(() => null)
        if (!response.ok) {
            throw new Error(body?.error ?? `GI answered ${response.status}`)
        }
        return parseStepResult(body)
    }
}

/** A GI answer, checked: anything malformed is an error, never a drive. */
export function parseStepResult(body: unknown): GiStepResult {
    // deno-lint-ignore no-explicit-any
    const value = body as any
    const stick = (input: unknown): Stick => {
        if (!Array.isArray(input) || input.length !== 2 || !input.every((each) => typeof each === "number" && Number.isFinite(each))) {
            throw new Error(`GI's answer has a malformed stick: ${JSON.stringify(input)}`)
        }
        return [Math.max(-1, Math.min(1, input[0])), Math.max(-1, Math.min(1, input[1]))]
    }
    if (!value || typeof value !== "object" || !value.action) {
        throw new Error("GI's answer has no action")
    }
    if (!["running", "done", "stuck"].includes(value.status)) {
        throw new Error(`GI's answer has an unknown status: ${JSON.stringify(value.status)}`)
    }
    return {
        action: { leftStick: stick(value.action.leftStick), rightStick: stick(value.action.rightStick), buttons: value.action.buttons ?? undefined },
        status: value.status,
        thought: typeof value.thought === "string" ? value.thought : undefined,
    }
}

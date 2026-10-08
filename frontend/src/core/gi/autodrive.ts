// Autodrive: GI drives. Each step grabs the latest robot camera frame, asks the policy for an action and drives with it
// as the "gi" source (core/drive.ts), scaled by the max autodrive speed. A person always wins: the Drive drops the gi
// share the moment a human source moves (takeover), the loop pauses, and it resumes resumeMs after the person lets go
// (or waits for the button with autoResume off). done / stuck / an error / STOP / a halted link end the run.
import { Store } from "../store.ts"
import { sticksToAxes } from "../gamepad.ts"
import type { Axes } from "../../profile/types.ts"
import { type GiAction, type GiFrame, type GiPolicy, HttpGi, MockGi } from "./policy.ts"

export type AutodriveStatus = "off" | "waiting" | "thinking" | "driving" | "paused" | "done" | "stuck" | "error"

export interface AutodriveSettings {
    /** policy steps per second */
    rateHz: number
    /** the policy's sticks are scaled by this (0..1) before they become drive axes */
    maxSpeed: number
    /** after a takeover, hand back to GI by itself once the person has let go for resumeMs */
    autoResume: boolean
    resumeMs: number
    /** "" = the built-in mock; else the GI endpoint the backend forwards to (it holds the key) */
    endpoint: string
    model: string
}

export const DEFAULT_AUTODRIVE: AutodriveSettings = { rateHz: 5, maxSpeed: 0.5, autoResume: true, resumeMs: 2000, endpoint: "", model: "gi-action-1" }

export interface AutodriveState {
    on: boolean
    status: AutodriveStatus
    /** why it is paused or ended, for the HUD */
    reason: string | null
    instruction: string
    thought: string | null
    /** the last step's round trip */
    latencyMs: number | null
    /** the last action applied (null when nothing is) */
    action: GiAction | null
    steps: number
    policy: string
}

/** What autodrive needs from the Drive (core/drive.ts), so tests can hand it a fake. */
export interface DriveLike {
    state: Store<{ takeover: boolean; halt: unknown }>
    setAxes(source: string, axes: Partial<Axes>): void
    onStop(listener: () => void): () => void
}

export interface FrameSource {
    /** the latest camera frame, or null when there is none (yet) */
    grab(): Promise<GiFrame | null>
}

export const policyFor = (settings: AutodriveSettings): GiPolicy => (settings.endpoint.trim() ? new HttpGi(settings.model) : new MockGi())

const NO_FRAME_RETRY_MS = 500

export class Autodrive {
    readonly state: Store<AutodriveState>
    #run = 0
    #looping = false
    #paused = false
    #resumeTimer: ReturnType<typeof setTimeout> | undefined
    #abort: AbortController | null = null
    #session = ""
    #startedAt = 0
    #unsubscribe: (() => void)[] = []
    /** the loop's wait between steps: end() cuts it short, so nothing lingers after a run */
    #nap: { timer: ReturnType<typeof setTimeout>; wake: () => void } | null = null

    constructor(readonly drive: DriveLike, readonly frames: FrameSource, readonly settings: Store<AutodriveSettings>, readonly makePolicy: (settings: AutodriveSettings) => GiPolicy = policyFor) {
        this.state = new Store<AutodriveState>({ on: false, status: "off", reason: null, instruction: "", thought: null, latencyMs: null, action: null, steps: 0, policy: makePolicy(settings.get()).name })
        let takeover = drive.state.get().takeover
        this.#unsubscribe.push(drive.state.subscribe(() => {
            const { takeover: now, halt } = drive.state.get()
            if (halt && this.state.get().on) {
                this.end("error", "driving stopped: the link is lost or too slow")
                return
            }
            if (now !== takeover) {
                takeover = now
                if (now) {
                    this.#takeover()
                } else {
                    this.#released()
                }
            }
        }))
        this.#unsubscribe.push(drive.onStop(() => {
            if (this.state.get().on) {
                this.end("off", "stopped")
            }
        }))
        this.#unsubscribe.push(settings.subscribe(() => {
            const policy = makePolicy(settings.get()).name
            if (policy !== this.state.get().policy) {
                this.state.update({ policy })
            }
        }))
    }

    /** The instruction every following step uses (a run in progress picks it up at its next step). */
    setInstruction(instruction: string) {
        this.state.update({ instruction: instruction.trim() })
    }

    /** Off → a new run. Paused (after a takeover, auto-resume off, or waiting out the idle) → GI drives again now. */
    start() {
        const state = this.state.get()
        if (state.on) {
            if (this.#paused && !this.drive.state.get().takeover) {
                this.#resume()
            }
            return
        }
        this.#run++
        this.#session = typeof crypto !== "undefined" && crypto.randomUUID ? crypto.randomUUID() : `run-${Date.now()}-${this.#run}`
        this.#startedAt = performance.now()
        this.#paused = this.drive.state.get().takeover
        this.state.update({ on: true, status: this.#paused ? "paused" : "thinking", reason: this.#paused ? "you're driving" : null, thought: null, latencyMs: null, action: null, steps: 0 })
        this.#kick()
    }

    /** The Autodrive button: on (and driving or waiting) → off; off or paused → start(). */
    toggle() {
        const state = this.state.get()
        if (state.on && !(this.#paused && !this.drive.state.get().takeover)) {
            this.end("off", "turned off")
        } else {
            this.start()
        }
    }

    /** Ends the run: nothing more is driven (the gi share is cleared), and the HUD keeps why. */
    end(status: "off" | "done" | "stuck" | "error", reason: string | null) {
        this.#run++
        this.#paused = false
        clearTimeout(this.#resumeTimer)
        this.#abort?.abort()
        this.#abort = null
        this.#wake()
        this.drive.setAxes("gi", {})
        this.state.update({ on: false, status, reason, action: null })
    }

    #takeover() {
        if (!this.state.get().on) {
            return
        }
        this.#paused = true
        clearTimeout(this.#resumeTimer)
        this.#abort?.abort()
        this.#wake()
        this.state.update({ status: "paused", reason: "you're driving", action: null })
    }

    #released() {
        if (!this.state.get().on) {
            return
        }
        const { autoResume, resumeMs } = this.settings.get()
        if (!autoResume) {
            this.state.update({ status: "paused", reason: "press Autodrive to hand back" })
            return
        }
        this.state.update({ status: "paused", reason: `handing back in ${(resumeMs / 1000).toFixed(1)} s` })
        clearTimeout(this.#resumeTimer)
        this.#resumeTimer = setTimeout(() => this.#resume(), resumeMs)
    }

    #resume() {
        clearTimeout(this.#resumeTimer)
        if (!this.state.get().on || this.drive.state.get().takeover) {
            return
        }
        this.#paused = false
        this.state.update({ status: "thinking", reason: null })
        this.#kick()
    }

    #kick() {
        if (!this.#looping && !this.#paused && this.state.get().on) {
            this.#loop(this.#run)
        }
    }

    async #loop(run: number) {
        this.#looping = true
        try {
            while (run === this.#run && !this.#paused) {
                const started = performance.now()
                const frame = await this.frames.grab()
                if (run !== this.#run || this.#paused) {
                    break
                }
                if (!frame) {
                    this.drive.setAxes("gi", {})
                    this.state.update({ status: "waiting", reason: "waiting for a camera frame", action: null })
                    await this.#sleep(NO_FRAME_RETRY_MS)
                    continue
                }
                const settings = this.settings.get()
                const policy = this.makePolicy(settings)
                const abort = new AbortController()
                this.#abort = abort
                const asked = performance.now()
                let result
                try {
                    result = await policy.step({ session: this.#session, instruction: this.state.get().instruction, frame, t: (asked - this.#startedAt) / 1000 }, abort.signal)
                } catch (error) {
                    if (run === this.#run && !this.#paused && !abort.signal.aborted) {
                        this.end("error", `GI: ${error instanceof Error ? error.message : error}`)
                    }
                    break
                }
                if (run !== this.#run || this.#paused || abort.signal.aborted) {
                    // stale: a takeover or an end came while GI was thinking (even if it has handed back since)
                    break
                }
                const latencyMs = Math.round(performance.now() - asked)
                if (result.status !== "running") {
                    this.state.update({ thought: result.thought ?? null, latencyMs, steps: this.state.get().steps + 1 })
                    this.end(result.status, result.thought ?? (result.status === "done" ? "GI says it's done" : "GI says it's stuck"))
                    break
                }
                this.drive.setAxes("gi", scaled(sticksToAxes(result.action.leftStick, result.action.rightStick), settings.maxSpeed))
                this.state.update({ status: "driving", reason: null, action: result.action, thought: result.thought ?? null, latencyMs, steps: this.state.get().steps + 1, policy: policy.name })
                await this.#sleep(Math.max(0, 1000 / Math.max(0.1, settings.rateHz) - (performance.now() - started)))
            }
        } finally {
            this.#looping = false
            this.#abort = null
        }
        // resumed (or started again) while this loop was finishing its last await
        this.#kick()
    }

    #sleep(ms: number): Promise<void> {
        return new Promise((resolve) => {
            const wake = () => {
                clearTimeout(timer)
                this.#nap = null
                resolve()
            }
            const timer = setTimeout(wake, ms)
            this.#nap = { timer, wake }
        })
    }

    #wake() {
        this.#nap?.wake()
    }

    dispose() {
        this.end("off", null)
        this.#unsubscribe.forEach((unsubscribe) => unsubscribe())
    }
}

const scaled = (axes: Axes, factor: number): Axes => {
    const k = Math.max(0, Math.min(1, factor))
    return { forward: axes.forward * k, strafe: axes.strafe * k, turn: axes.turn * k, vertical: axes.vertical * k }
}

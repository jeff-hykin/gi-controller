// Two sticks → drive axes, shared by a physical gamepad (browser Gamepad API) and GI's actions, so both mean the same
// thing: left stick y forward / back, left x strafe, right x turn, right y up / down. Sticks here are x right, y up.
import type { Axes } from "../profile/types.ts"
import type { Drive } from "./drive.ts"

export type Stick = [number, number]

const clamp = (value: number) => (Number.isFinite(value) ? Math.max(-1, Math.min(1, value)) : 0)

export function sticksToAxes(left: Stick, right: Stick): Axes {
    return { forward: clamp(left[1]), strafe: -clamp(left[0]), turn: -clamp(right[0]), vertical: clamp(right[1]) }
}

/** Inside the deadzone a stick reads 0; outside it rescales so the edge of the deadzone is 0 and full tilt is 1. */
export function applyDeadzone(value: number, deadzone: number): number {
    const magnitude = Math.abs(value)
    if (!Number.isFinite(value) || magnitude <= deadzone) {
        return 0
    }
    return Math.sign(value) * Math.min(1, (magnitude - deadzone) / (1 - deadzone))
}

/** A standard-mapping gamepad's axes (0,1 left x/y; 2,3 right x/y; y down) → drive axes, with a deadzone. */
export function gamepadAxes(axes: readonly number[], deadzone = 0.15): Axes {
    const at = (index: number) => applyDeadzone(axes[index] ?? 0, deadzone)
    return sticksToAxes([at(0), -at(1)], [at(2), -at(3)])
}

/** Standard-mapping buttons this app uses. */
export const GAMEPAD_BUTTONS = { a: 0, b: 1, start: 9 } as const

/**
 * Polls connected gamepads every animation frame and drives with the first one that has a stick out of its deadzone
 * (source "gamepad", a person: it takes over from autodrive). B stops; A toggles autodrive (onToggle). Returns a stop
 * function.
 */
export function watchGamepads(drive: Drive, onToggle: () => void, deadzone = 0.15): () => void {
    if (typeof navigator === "undefined" || !navigator.getGamepads) {
        return () => {}
    }
    let frame = 0
    let wasMoving = false
    const pressed = new Set<string>()
    const poll = () => {
        frame = requestAnimationFrame(poll)
        const pads = [...navigator.getGamepads()].filter((pad): pad is Gamepad => !!pad && pad.connected)
        let axes: Axes | null = null
        for (const pad of pads) {
            const candidate = gamepadAxes(pad.axes, deadzone)
            if (Object.values(candidate).some((value) => value !== 0)) {
                axes = candidate
                break
            }
        }
        if (axes) {
            drive.setAxes("gamepad", axes)
            wasMoving = true
        } else if (wasMoving) {
            drive.setAxes("gamepad", {})
            wasMoving = false
        }
        for (const pad of pads) {
            for (const [name, index] of Object.entries(GAMEPAD_BUTTONS)) {
                const id = `${pad.index}:${name}`
                const down = !!pad.buttons[index]?.pressed
                if (down && !pressed.has(id)) {
                    pressed.add(id)
                    if (name === "b") {
                        drive.stop()
                    } else if (name === "a") {
                        onToggle()
                    }
                } else if (!down) {
                    pressed.delete(id)
                }
            }
        }
    }
    frame = requestAnimationFrame(poll)
    return () => {
        cancelAnimationFrame(frame)
        if (wasMoving) {
            drive.setAxes("gamepad", {})
        }
    }
}

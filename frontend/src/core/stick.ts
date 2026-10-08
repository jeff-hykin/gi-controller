// On-screen stick math, kept out of the component so it's tested: a thumb's offset → a shaped -1..1 value
// (dead zone, then an expo curve for fine control near the center), and the smoothing that eases a value toward
// where the thumb is. A release never goes through smoothing: it is zero at once (ui/Joystick.tsx).

/** below this share of the radius a resting thumb sends nothing */
export const DEAD_ZONE = 0.12
/** >1 flattens the middle: small moves are finer, the edge is still full speed */
export const EXPO = 1.6
/** how quickly a held stick's output follows the thumb (time constant, ms) */
export const SMOOTH_MS = 70

/** a two-axis stick within this many degrees of straight forward or back drives exactly straight; past it the angle is
 * squeezed (not cut), so every direction is still reachable and there's no jump at the edge */
export const STRAIGHT_DEG = 8

/** Which directions a stick drives: both, or only one (its other axis is ignored, with its own dead zone). */
export type StickAxes = "xy" | "x" | "y"

/**
 * The thumb's offset from the stick's center (px, screen y down) → x and y in -1..1 (up = +y).
 * Two-axis sticks use a radial dead zone and pull toward straight forward/back (straighten); one-axis sticks look at
 * that axis alone.
 */
export function shapeStick(dx: number, dy: number, radius: number, axes: StickAxes = "xy"): { x: number; y: number } {
    if (!(radius > 0)) {
        return { x: 0, y: 0 }
    }
    let x = dx / radius
    let y = -dy / radius
    if (axes === "x") {
        return { x: shape1(x), y: 0 }
    }
    if (axes === "y") {
        return { x: 0, y: shape1(y) }
    }
    const length = Math.hypot(x, y)
    if (length <= DEAD_ZONE) {
        return { x: 0, y: 0 }
    }
    const clamped = Math.min(1, length)
    const scaled = Math.pow((clamped - DEAD_ZONE) / (1 - DEAD_ZONE), EXPO)
    const angle = straighten(Math.atan2(x, y))
    return { x: clean(Math.sin(angle) * scaled), y: clean(Math.cos(angle) * scaled) }
}

/**
 * An angle from straight forward (radians, ±π is straight back) → the same with the STRAIGHT_DEG either side of forward
 * and back mapped to exactly straight, and the rest of each quadrant stretched to fill it (sideways stays sideways).
 */
export function straighten(angle: number, straightDeg = STRAIGHT_DEG): number {
    const snap = (straightDeg * Math.PI) / 180
    const quarter = Math.PI / 2
    const sign = angle < 0 ? -1 : 1
    const fromForward = Math.abs(angle)
    const backHalf = fromForward > quarter
    const off = backHalf ? Math.PI - fromForward : fromForward
    const squeezed = off <= snap ? 0 : ((off - snap) * quarter) / (quarter - snap)
    return sign * (backHalf ? Math.PI - squeezed : squeezed)
}

function shape1(value: number): number {
    const size = Math.min(1, Math.abs(value))
    if (size <= DEAD_ZONE) {
        return 0
    }
    return clean(Math.sign(value) * Math.pow((size - DEAD_ZONE) / (1 - DEAD_ZONE), EXPO))
}

/** rounds away float dust (and -0) so a twist reads exactly 0 or a tidy number */
const clean = (value: number) => Math.round(value * 1000) / 1000 || 0

/**
 * One smoothing step: `current` eased toward `target` over `dtMs` (exponential, time constant SMOOTH_MS). Snaps when
 * close, and a target of exactly zero is returned as zero (releasing is never smoothed).
 */
export function smoothToward(current: number, target: number, dtMs: number, tauMs = SMOOTH_MS): number {
    if (target === 0) {
        return 0
    }
    const next = current + (target - current) * (1 - Math.exp(-Math.max(0, dtMs) / tauMs))
    return Math.abs(next - target) < 0.005 ? target : clean(next)
}

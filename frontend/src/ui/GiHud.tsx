// GI on screen: the Autodrive button, the instruction (typed, or spoken with the hold-to-talk mic), and what GI is doing
// (status, step latency, its thought, its two sticks drawn live). Desktop: a bar at the bottom center. Phone: a bar
// above the thumb sticks. Hold T to talk and G to toggle autodrive on a desktop (ui/useGiKeys.ts).
import { useEffect, useState } from "react"
import type { ViewerApp } from "../core/app.ts"
import { useStore } from "../core/store.ts"
import type { AutodriveState } from "../core/gi/autodrive.ts"
import type { Stick } from "../core/gamepad.ts"

/** What the status chip says; takeover reads "You're driving" whatever the reason text. */
export function statusText(state: AutodriveState, takeover: boolean): string {
    if (state.on && takeover) {
        return "You're driving"
    }
    switch (state.status) {
        case "off":
            return state.reason ? `Off · ${state.reason}` : "Autodrive off"
        case "waiting":
            return "Waiting for camera"
        case "thinking":
            return "Thinking…"
        case "driving":
            return `${state.policy} driving`
        case "paused":
            return `Paused · ${state.reason ?? ""}`
        case "done":
            return `Done · ${state.reason ?? ""}`
        case "stuck":
            return `Stuck · ${state.reason ?? ""}`
        case "error":
            return state.reason ?? "Error"
    }
}

/** One of GI's sticks: a ring with a dot where the stick is (y up). */
function StickView({ stick, label }: { stick: Stick | null; label: string }) {
    const [x, y] = stick ?? [0, 0]
    return (
        <svg className="gi-stick" viewBox="-1.2 -1.2 2.4 2.4" role="img" aria-label={`GI ${label} stick ${x.toFixed(2)}, ${y.toFixed(2)}`}>
            <circle r="1" className="ring" />
            <line x1="0" y1="0" x2={x} y2={-y} className="arm" />
            <circle cx={x} cy={-y} r="0.28" className={`dot ${stick && (x || y) ? "live" : ""}`} />
        </svg>
    )
}

export function GiHud({ app, mobile }: { app: ViewerApp; mobile: boolean }) {
    const { autodrive, speech } = app.gi
    const state = useStore(autodrive.state)
    const talk = useStore(speech.state)
    const { takeover } = useStore(app.drive.state)
    const [draft, setDraft] = useState(state.instruction)
    const [note, setNote] = useState<string | null>(null)
    useEffect(() => setDraft(state.instruction), [state.instruction])
    useEffect(() => {
        if (!note) {
            return
        }
        const timer = setTimeout(() => setNote(null), 4000)
        return () => clearTimeout(timer)
    }, [note])

    const commit = (text: string, go: boolean) => {
        autodrive.setInstruction(text)
        if (go && text.trim()) {
            autodrive.start()
        }
    }
    const talkStart = () => {
        if (talk.unavailable) {
            setNote(`Mic: ${talk.unavailable}`)
            return
        }
        speech.start((text) => commit(text, true))
    }
    const talking = talk.listening
    const status = statusText(state, takeover)
    const tone = state.on && takeover ? "you" : state.status
    const buttonLabel = state.on ? (state.status === "paused" && !takeover ? "Hand back" : "Autodrive on") : "Autodrive"

    return (
        <div className={`gi-hud ${mobile ? "mobile" : "dim-panel glass"} tone-${tone}`} data-testid="gi-hud">
            <div className="gi-row">
                <button
                    type="button"
                    className={`dim-btn gi-autodrive ${state.on ? "on" : ""}`}
                    data-testid="autodrive-button"
                    aria-pressed={state.on}
                    title={mobile ? undefined : "Autodrive (G): GI drives from the camera; any key, stick or gamepad takes over"}
                    onClick={() => autodrive.toggle()}
                >
                    <span className="gi-led" aria-hidden="true" />
                    {buttonLabel}
                </button>
                <button
                    type="button"
                    className={`dim-btn gi-mic ${talking ? "on" : ""} ${talk.unavailable ? "unavailable" : ""}`}
                    data-testid="mic-button"
                    aria-disabled={!!talk.unavailable}
                    aria-pressed={talking}
                    aria-label={talk.unavailable ? `Mic unavailable: ${talk.unavailable}` : "Hold to talk"}
                    title={talk.unavailable ? `Mic unavailable: ${talk.unavailable}` : mobile ? undefined : "Hold to talk (or hold T)"}
                    onPointerDown={(event) => {
                        event.preventDefault()
                        event.currentTarget.setPointerCapture?.(event.pointerId)
                        talkStart()
                    }}
                    onPointerUp={() => speech.stop()}
                    onPointerCancel={() => speech.stop()}
                    onContextMenu={(event) => event.preventDefault()}
                >
                    <MicIcon off={!!talk.unavailable} />
                </button>
                <input
                    className="dim-input gi-instruction"
                    data-testid="gi-instruction"
                    placeholder={mobile ? "Tell GI what to do" : "Tell GI what to do (Enter starts)"}
                    enterKeyHint="go"
                    value={talking ? talk.interim || "listening…" : draft}
                    readOnly={talking}
                    onChange={(event) => setDraft(event.target.value)}
                    onBlur={() => commit(draft, false)}
                    onKeyDown={(event) => {
                        if (event.key === "Enter") {
                            commit(draft, true)
                            event.currentTarget.blur()
                        } else if (event.key === "Escape") {
                            setDraft(state.instruction)
                            event.currentTarget.blur()
                        }
                    }}
                />
            </div>
            <div className="gi-row gi-status-row">
                <span className={`gi-status`} data-testid="gi-status" role="status">{note ?? talk.error ?? status}</span>
                {state.on && state.latencyMs !== null && <span className="gi-latency dim" data-testid="gi-latency">{state.latencyMs < 1 ? "<1" : state.latencyMs} ms</span>}
                <span className="gi-sticks" aria-label="GI's sticks">
                    <StickView stick={state.on && !takeover ? state.action?.leftStick ?? null : null} label="left" />
                    <StickView stick={state.on && !takeover ? state.action?.rightStick ?? null : null} label="right" />
                </span>
            </div>
            {state.thought && state.on && !takeover && <div className="gi-thought dim" data-testid="gi-thought">“{state.thought}”</div>}
        </div>
    )
}

function MicIcon({ off }: { off: boolean }) {
    return (
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <rect x="9" y="3" width="6" height="11" rx="3" />
            <path d="M5 11a7 7 0 0 0 14 0" />
            <path d="M12 18v3" />
            {off && <path d="M4 4l16 16" />}
        </svg>
    )
}

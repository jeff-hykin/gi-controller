// GI on screen: the Autodrive button, the instruction (typed, or spoken with the hold-to-talk mic), and what GI is doing
// (status, step latency, its thought, its two sticks drawn live). Desktop: a bar at the bottom center. Phone: a bar
// above the thumb sticks. Hold T to talk and G to toggle autodrive on a desktop (ui/useGiKeys.ts).
import { useEffect, useRef, useState } from "react"
import { Button, Card, StickIndicator, Text, TextInput } from "dimos-react"
import type { ViewerApp } from "../core/app.ts"
import { useStore } from "../core/store.ts"
import type { AutodriveState } from "../core/gi/autodrive.ts"
import type { Stick } from "../core/gamepad.ts"
import { releaseAllThumbSticks } from "dimos-react"

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

    // the click that follows a takeover's touch lands on the Autodrive button now in its place: ignore it
    const tookControlAt = useRef(0)
    const takeControl = () => {
        if (!autodrive.state.get().on) {
            return
        }
        tookControlAt.current = performance.now()
        releaseAllThumbSticks()
        app.drive.stop()
        autodrive.end("off", "you took control")
    }
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

    // phone: one button naming what a press does (Autodrive, or Take control while GI drives); it picks what's on
    // screen, the sticks (ui/DriveHud.tsx) or the prompt and mic
    const auto = state.on
    const ended = state.status === "done" || state.status === "stuck" || state.status === "error"
    const Shell = mobile ? "div" : Card
    return (
        <Shell {...(mobile ? {} : { glass: true, padded: false })} className={`gi-hud ${mobile ? `mobile ${auto ? "auto" : "manual"}` : ""} tone-${tone}`} data-testid="gi-hud">
            {mobile && (auto
                // while GI drives this is also STOP: on touch (as ui/DriveHud.tsx's STOP), it halts everything and hands over
                ? <Button size="lg" block className="gi-mode gi-mode-manual" data-testid="take-control-button" onPointerDown={takeControl} onClick={takeControl}>Take control</Button>
                : <Button variant="primary" size="lg" block className="gi-mode gi-mode-auto" data-testid="autodrive-button" onClick={() => performance.now() - tookControlAt.current > 600 && autodrive.start()}>Autodrive</Button>)}
            {(!mobile || auto) && <div className="gi-row">
                {!mobile && <Button
                    variant={state.on ? "primary" : "default"}
                    className="gi-autodrive"
                    data-testid="autodrive-button"
                    pressed={state.on}
                    title="Autodrive (G): GI drives from the camera; any key, stick or gamepad takes over"
                    onClick={() => autodrive.toggle()}
                >
                    {buttonLabel}
                </Button>}
                <Button
                    variant={talking ? "danger" : "default"}
                    className="dr-btn--icon gi-mic"
                    icon={talk.unavailable ? "mic-off" : "mic"}
                    data-testid="mic-button"
                    aria-disabled={!!talk.unavailable}
                    pressed={talking}
                    aria-label={talk.unavailable ? `Mic unavailable: ${talk.unavailable}` : "Hold to talk"}
                    title={talk.unavailable ? `Mic unavailable: ${talk.unavailable}` : mobile ? undefined : "Hold to talk (or hold T)"}
                    onPointerDown={(event: React.PointerEvent<HTMLButtonElement>) => {
                        event.preventDefault()
                        event.currentTarget.setPointerCapture?.(event.pointerId)
                        talkStart()
                    }}
                    onPointerUp={() => speech.stop()}
                    onPointerCancel={() => speech.stop()}
                    onContextMenu={(event: React.MouseEvent) => event.preventDefault()}
                />
                <TextInput
                    className="gi-instruction"
                    data-testid="gi-instruction"
                    placeholder={mobile ? "Tell GI what to do" : "Tell GI what to do (Enter starts)"}
                    enterKeyHint="go"
                    value={talking ? talk.interim || "listening…" : draft}
                    readOnly={talking}
                    onChange={setDraft}
                    onBlur={() => commit(draft, false)}
                    onKeyDown={(event: React.KeyboardEvent<HTMLInputElement>) => {
                        if (event.key === "Enter") {
                            commit(draft, true)
                            event.currentTarget.blur()
                        } else if (event.key === "Escape") {
                            setDraft(state.instruction)
                            event.currentTarget.blur()
                        }
                    }}
                />
            </div>}
            {(!mobile || auto || ended) && <div className="gi-row gi-status-row">
                <Text mono small className="gi-status" data-testid="gi-status" role="status">{note ?? talk.error ?? status}</Text>
                {state.on && state.latencyMs !== null && <Text mono small muted data-testid="gi-latency">{state.latencyMs < 1 ? "<1" : state.latencyMs} ms</Text>}
                <span className="gi-sticks" aria-label="GI's sticks">
                    <StickIndicator value={stickOf(state.on && !takeover ? state.action?.leftStick ?? null : null)} label="GI left stick" />
                    <StickIndicator value={stickOf(state.on && !takeover ? state.action?.rightStick ?? null : null)} label="GI right stick" />
                </span>
            </div>}
            {state.thought && state.on && !takeover && <Text as="div" small muted className="gi-thought" data-testid="gi-thought">“{state.thought}”</Text>}
        </Shell>
    )
}

/** GI's stick as StickIndicator's value (null: not driving) */
const stickOf = (stick: Stick | null) => stick ? { x: stick[0], y: stick[1] } : null

// Settings → GI: which policy (the built-in mock, or a GI endpoint and its key), how often it steps, how fast it may
// drive, and how control comes back after a takeover. The key goes to the backend (PUT api/gi/key) and never comes back.
import { useEffect, useState } from "react"
import type { ViewerApp } from "../core/app.ts"
import { useStore } from "../core/store.ts"
import { Field, Slider, Toggle } from "./controls.tsx"

export function GiSettings({ app }: { app: ViewerApp }) {
    const settings = useStore(app.gi.settings)
    const autodrive = useStore(app.gi.autodrive.state)
    const [hasKey, setHasKey] = useState<boolean | null>(null)
    const [key, setKey] = useState("")
    const [problem, setProblem] = useState<string | null>(null)
    const update = app.gi.settings.update.bind(app.gi.settings)

    useEffect(() => {
        fetch(new URL("api/gi", location.href)).then((response) => response.json()).then((config) => setHasKey(!!config.hasKey)).catch(() => setHasKey(null))
    }, [])

    const saveKey = async (value: string) => {
        try {
            const response = await fetch(new URL("api/gi/key", location.href), { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ key: value }) })
            const body = await response.json()
            if (!response.ok) {
                throw new Error(body.error ?? response.statusText)
            }
            setHasKey(!!body.hasKey)
            setKey("")
            setProblem(null)
        } catch (error) {
            setProblem(`couldn't save the key: ${error instanceof Error ? error.message : error}`)
        }
    }

    return (
        <div className="gi-settings" data-testid="gi-settings">
            <Field label="Policy" hint="Empty endpoint: the built-in mock (obeys forward, back, turn left / right, spin, explore, stop, &quot;for N seconds&quot;). With an endpoint, each step goes through this app's backend, which adds the key.">
                <input
                    className="dim-input"
                    data-testid="gi-endpoint"
                    placeholder="mock (no endpoint)"
                    defaultValue={settings.endpoint}
                    onBlur={(event) => update({ endpoint: event.target.value.trim() })}
                />
            </Field>
            <p className="hint">Using: {autodrive.policy}</p>
            {settings.endpoint && (
                <>
                    <Field label="Model"><input className="dim-input" defaultValue={settings.model} onBlur={(event) => update({ model: event.target.value.trim() || "gi-action-1" })} /></Field>
                    <Field label="API key" hint="Kept by the backend in its own file; never shown again, never in the settings.">
                        <span className="gi-key-row">
                            <input className="dim-input" type="password" autoComplete="off" placeholder={hasKey ? "set (type to replace)" : "not set"} value={key} onChange={(event) => setKey(event.target.value)} />
                            <button type="button" className="dim-btn sm" disabled={!key} onClick={() => saveKey(key)}>Save</button>
                            {hasKey && <button type="button" className="dim-btn sm" onClick={() => saveKey("")}>Clear</button>}
                        </span>
                    </Field>
                </>
            )}
            {problem && <p className="problem">{problem}</p>}
            <Field label="Steps per second" hint="How often GI is asked for an action (each one sends a camera frame)."><Slider min={1} max={20} step={1} value={settings.rateHz} format={(rate) => `${rate} Hz`} onChange={(rateHz) => update({ rateHz })} /></Field>
            <Field label="Max autodrive speed" hint="GI's sticks are scaled by this, a share of the drive speeds below."><Slider min={0.1} max={1} step={0.05} value={settings.maxSpeed} format={(share) => `${Math.round(share * 100)}%`} onChange={(maxSpeed) => update({ maxSpeed })} /></Field>
            <Field label="Auto-resume" hint="After you take over (any key, stick or gamepad), hand back to GI once you've let go. Off: press Autodrive to hand back."><Toggle value={settings.autoResume} onChange={(autoResume) => update({ autoResume })} /></Field>
            {settings.autoResume && <Field label="Resume after"><Slider min={0.5} max={10} step={0.5} value={settings.resumeMs / 1000} format={(seconds) => `${seconds.toFixed(1)} s`} onChange={(seconds) => update({ resumeMs: Math.round(seconds * 1000) })} /></Field>}
            <p className="hint">G: autodrive on / off · hold T: talk · a gamepad's A: autodrive, B: stop · Space: stop everything</p>
        </div>
    )
}

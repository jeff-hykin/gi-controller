// Settings → GI: which policy (the built-in mock, or a GI endpoint and its key), how often it steps, how fast it may
// drive, and how control comes back after a takeover. The key goes to the backend (PUT api/gi/key) and never comes back.
import { useEffect, useState } from "react"
import type { ViewerApp } from "../core/app.ts"
import { useStore } from "../core/store.ts"
import { Button, Field, Row, Slider, Text, TextInput, Toggle } from "dimos-react"

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
            <Field inline label="Policy" title="Empty endpoint: the built-in mock (obeys forward, back, turn left / right, spin, explore, stop, &quot;for N seconds&quot;). With an endpoint, each step goes through this app's backend, which adds the key.">
                <CommitInput data-testid="gi-endpoint" placeholder="mock (no endpoint)" value={settings.endpoint} onCommit={(endpoint) => update({ endpoint })} />
            </Field>
            <Text as="p" muted small>Using: {autodrive.policy}</Text>
            {settings.endpoint && (
                <>
                    <Field inline label="Model"><CommitInput value={settings.model} onCommit={(model) => update({ model: model || "gi-action-1" })} /></Field>
                    <Field inline label="API key" title="Kept by the backend in its own file; never shown again, never in the settings.">
                        <Row gap={4} className="gi-key-row">
                            <TextInput type="password" autoComplete="off" placeholder={hasKey ? "set (type to replace)" : "not set"} value={key} onChange={setKey} />
                            <Button size="sm" disabled={!key} onClick={() => saveKey(key)}>Save</Button>
                            {hasKey && <Button size="sm" onClick={() => saveKey("")}>Clear</Button>}
                        </Row>
                    </Field>
                </>
            )}
            {problem && <Text as="p" small tone="danger">{problem}</Text>}
            <Field inline label="Steps per second" title="How often GI is asked for an action (each one sends a camera frame)."><Slider min={1} max={20} step={1} value={settings.rateHz} format={(rate: number) => `${rate} Hz`} onChange={(rateHz: number) => update({ rateHz })} /></Field>
            <Field inline label="Max autodrive speed" title="GI's sticks are scaled by this, a share of the drive speeds below."><Slider min={0.1} max={1} step={0.05} value={settings.maxSpeed} format={(share: number) => `${Math.round(share * 100)}%`} onChange={(maxSpeed: number) => update({ maxSpeed })} /></Field>
            <Field inline label="Auto-resume" title="After you take over (any key, stick or gamepad), hand back to GI once you've let go. Off: press Autodrive to hand back."><Toggle value={settings.autoResume} onChange={(autoResume: boolean) => update({ autoResume })} /></Field>
            {settings.autoResume && <Field inline label="Resume after"><Slider min={0.5} max={10} step={0.5} value={settings.resumeMs / 1000} format={(seconds: number) => `${seconds.toFixed(1)} s`} onChange={(seconds: number) => update({ resumeMs: Math.round(seconds * 1000) })} /></Field>}
            <Text as="p" muted small>G: autodrive on / off · hold T: talk · a gamepad's A: autodrive, B: stop · Space: stop everything</Text>
        </div>
    )
}

/** A text box that saves (trimmed) when it loses focus or on Enter */
function CommitInput({ value, onCommit, ...rest }: { value: string; onCommit: (value: string) => void; placeholder?: string; "data-testid"?: string }) {
    const [text, setText] = useState(value)
    useEffect(() => setText(value), [value])
    return <TextInput {...rest} value={text} onChange={setText} onBlur={() => onCommit(text.trim())} onEnter={() => onCommit(text.trim())} />
}

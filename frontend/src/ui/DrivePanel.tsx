// Drive settings: which Twist topics (auto or a list), speeds, and the profile's extra controls.
import type { ViewerApp } from "../core/app.ts"
import { useStore } from "../core/store.ts"
import { Button, Checkbox, Field, Heading, Slider, Text, TextArea } from "dimos-react"
import { useEffect, useState } from "react"

export function DrivePanel({ app }: { app: ViewerApp }) {
    const drive = app.drive
    const state = useStore(drive.state)
    const settings = useStore(drive.settings)
    const values = useStore(drive.controlValues)
    useStore(app.connection.status)
    const candidates = drive.candidates()
    const usesVertical = Object.values(app.profile.drive.keys).some((action) => "axis" in action && action.axis === "vertical")
    const keyNames = Object.entries(app.profile.drive.keys)
        .filter(([code]) => !code.startsWith("Arrow"))
        .map(([code, action]) => `${code.replace(/^Key/, "")} ${"axis" in action ? `${action.axis} ${action.value > 0 ? "+" : "−"}` : `${action.control} ${(action.step ?? 0) > 0 ? "+" : "−"}`}`)
    return (
        <div className="drive-panel">
            <Field
                label="Topics"
                title="Auto: each running blueprint's cmd_vel entry point (one per module that takes velocity commands, never a mux's own output), else /cmd_vel and /tele_cmd_vel. One topic per line; add TwistStamped after a name for a stamped one."
            >
                <Checkbox
                    label="auto"
                    value={!(settings.topics?.length)}
                    onChange={(auto: boolean) => drive.settings.update({ topics: auto ? [] : drive.autoTopics().map((topic) => topic.topic) })}
                />
                {settings.topics?.length ? <TopicsEditor topics={settings.topics} onChange={(topics) => drive.settings.update({ topics })} /> : null}
                <Text as="div" muted small data-testid="drive-topics-resolved">→ {state.topic || "nothing"}</Text>
            </Field>
            {candidates.length > 0 && settings.topics?.length
                ? <Text as="p" muted small>Seen: {candidates.join(", ")}</Text>
                : null}
            <Field inline label="Linear"><Slider min={0.05} max={3} step={0.05} value={settings.linear} format={(speed: number) => `${speed.toFixed(2)} m/s`} onChange={(linear: number) => drive.settings.update({ linear })} /></Field>
            <Field inline label="Angular"><Slider min={0.05} max={3} step={0.05} value={settings.angular} format={(speed: number) => `${speed.toFixed(2)} rad/s`} onChange={(angular: number) => drive.settings.update({ angular })} /></Field>
            {usesVertical && <Field inline label="Vertical"><Slider min={0.05} max={2} step={0.05} value={settings.vertical} format={(speed: number) => `${speed.toFixed(2)} m/s`} onChange={(vertical: number) => drive.settings.update({ vertical })} /></Field>}
            <Text as="p" muted small>
                Shift: ×{app.profile.drive.boost.linear} linear, ×{app.profile.drive.boost.angular} turning · Space: stop · {keyNames.join(" · ")}
            </Text>
            {app.profile.controls.length > 0 && (
                <section className="controls">
                    <Heading level={3}>{app.profile.name}</Heading>
                    {app.profile.controls.map((control) =>
                        control.kind === "slider"
                            ? (
                                <Field inline key={control.id} label={control.label} title={`${control.type} on ${control.topic}`}>
                                    <Slider min={control.min} max={control.max} step={control.step} value={values[control.id] ?? control.initial} format={(value: number) => `${value.toFixed(2)}${control.unit ? ` ${control.unit}` : ""}`} onChange={(value: number) => drive.setControl(control.id, value)} />
                                </Field>
                            )
                            : <Button key={control.id} size="sm" onClick={() => drive.pressButton(control.id)}>{control.label}</Button>
                    )}
                </section>
            )}
            <Text as="div" mono small muted className="twist-readout">
                lin {state.twist.linear.map((value) => value.toFixed(2)).join(" ")} · ang {state.twist.angular.map((value) => value.toFixed(2)).join(" ")} · {state.publishing ? `sending · ${state.sent}` : "idle"}
            </Text>
            {state.error && <Text as="p" small tone="danger">{state.error}</Text>}
        </div>
    )
}

/** The listed topics, one per line; saved when the box loses focus */
function TopicsEditor({ topics, onChange }: { topics: string[]; onChange: (topics: string[]) => void }) {
    const [text, setText] = useState(topics.join("\n"))
    useEffect(() => setText(topics.join("\n")), [topics.join("\n")])
    return (
        <TextArea
            mono
            data-testid="drive-topics"
            rows={Math.max(2, topics.length + 1)}
            value={text}
            onChange={setText}
            onBlur={() => onChange(text.split("\n").map((line) => line.trim()).filter(Boolean))}
        />
    )
}

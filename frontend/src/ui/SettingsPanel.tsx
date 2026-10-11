// Settings: the robot type, then driving (or the arm panel, for an arm; it was its own tab), then the view.
import type { ViewerApp } from "../core/app.ts"
import { useStore } from "../core/store.ts"
import { profiles } from "../profile/index.ts"
import { RobotIcon } from "./RobotIcon.tsx"
import { armShading } from "./armShading.ts"
import { ArmPanel } from "./ArmPanel.tsx"
import { Field, Heading, NumberInput, Segmented, Select, Text, Toggle } from "dimos-react"
import { maxLatencyOf } from "../core/linkWatch.ts"
import { DrivePanel } from "./DrivePanel.tsx"
import { GiSettings } from "./GiSettings.tsx"
import { rendering } from "../core/render/rendering.ts"
import { StylePicker } from "./StylePicker.tsx"
import { followFrameOptions } from "../core/map2d.ts"
import { useEffect, useState } from "react"
import { CUBE_SHADES } from "dimos-react/three"
import type { CubeShade, PointStyle } from "../core/render/rendering.ts"

export function SettingsPanel({ app }: { app: ViewerApp }) {
    const view = useStore(app.settings)
    const render = useStore(rendering)
    const robot = useStore(app.robot)
    const current = profiles.find((profile) => profile.type === robot.type)
    return (
        <div className="settings-panel">
            <Field
                label="Robot"
                className="robot-type"
                data-testid="robot-type"
                hint={
                    <>
                        <Text as="p" muted small data-testid="robot-type-reason">
                            {robot.auto ? `Auto: ${robot.reason}.` : "Picked here; Auto follows what's running."} Sets the keys, speeds, the drive or arm controls and the model in the view.
                        </Text>
                        <Text as="p" muted small data-testid="robot-icon-credits">
                            Icons after Izwar Muis's "Humanoid robot" and "robot dog" and rukanicon's "Robotics" (Noun Project, CC BY 3.0, modified) and Tabler's drone (MIT); see the README's Credits.
                        </Text>
                    </>
                }
            >
                <div className="robot-type-row">
                    <RobotIcon type={robot.type} size={40} />
                    <Select
                        aria-label="Robot type"
                        value={robot.auto ? "" : robot.type}
                        options={[["", `Auto: ${current?.name ?? robot.type}`], ...profiles.map((profile) => [profile.type, profile.name])]}
                        // every open viewer switches with it (app.ts), no reload
                        onChange={(profile: string) => (app.settings.update({ profile }), profile === "arm" && armShading())}
                    />
                </div>
            </Field>
            {robot.type === "arm"
                ? (
                    <section className="settings-section" data-section="arm">
                        <Heading level={3}>Arm</Heading>
                        <ArmPanel app={app} />
                    </section>
                )
                : (
                    <>
                    <section className="settings-section" data-section="gi">
                        <Heading level={3}>GI</Heading>
                        <GiSettings app={app} />
                    </section>
                    <section className="settings-section" data-section="drive">
                        <Heading level={3}>Drive</Heading>
                        <DrivePanel app={app} />
                        <Field inline label="Max latency (ms)" title="Over this, the drive panel stops driving and shows Reconnect (also when the link drops).">
                            <MaxLatencyInput app={app} />
                        </Field>
                    </section>
                    </>
                )}
            <Heading level={3}>Rendering</Heading>
            <Field label="Point style" hint="The default for every point cloud; a layer can pick its own in its settings.">
                <StylePicker value={render.pointStyle} onChange={(pointStyle) => rendering.update({ pointStyle: pointStyle as PointStyle })} />
            </Field>
            <Field inline label="Cube shading" title={CUBE_SHADES[render.cubeShade]?.about}>
                <Segmented
                    size="sm"
                    data-cube-shade
                    items={(Object.keys(CUBE_SHADES) as CubeShade[]).map((shade) => ({ value: shade, label: CUBE_SHADES[shade].label, title: CUBE_SHADES[shade].about }))}
                    value={render.cubeShade}
                    onChange={(cubeShade: CubeShade) => rendering.update({ cubeShade })}
                />
            </Field>
            <Field inline label="Follow robot" title="the 3D camera tracks a TF frame; a pan stops it, the follow button (top right) resumes it"><Toggle value={view.follow} onChange={(follow: boolean) => app.settings.update({ follow })} /></Field>
            <FollowFramePicker app={app} />
            <Field inline label="Robot model" title="a stand-in for the robot type at the robot's pose (an arm is drawn by its TF frames)"><Toggle value={view.robotModel !== false} onChange={(robotModel: boolean) => app.settings.update({ robotModel })} /></Field>
            <Field inline label="Stats"><Toggle value={view.showStats} onChange={(showStats: boolean) => app.settings.update({ showStats })} /></Field>
            <Text as="p" muted small>Drag to orbit · right-drag or two fingers to pan · scroll or pinch to zoom. Follow and top-down are on the view (top right).</Text>
        </div>
    )
}

/** Settings → Max latency: NumberInput commits on Enter or leaving the field, so "1" on the way to "1500" never holds driving */
function MaxLatencyInput({ app }: { app: ViewerApp }) {
    const saved = maxLatencyOf(useStore(app.settings).maxLatencyMs)
    return (
        <NumberInput
            aria-label="Max latency (ms)"
            data-testid="max-latency"
            min={1}
            step={100}
            unit="ms"
            value={saved}
            onChange={(value: number) => app.settings.update({ maxLatencyMs: Math.round(value) })}
        />
    )
}

/** the TF frame the 3D camera follows: the robot's by default, or any frame in the tree (refreshed while shown) */
function FollowFramePicker({ app }: { app: ViewerApp }) {
    const view = useStore(app.settings)
    const [frames, setFrames] = useState<string[]>([])
    useEffect(() => {
        const read = () => {
            const next = app.tf.snapshot().frames
            setFrames((old) => old.length === next.length && old.every((frame, index) => frame === next[index]) ? old : next)
        }
        read()
        const timer = setInterval(read, 1000)
        return () => clearInterval(timer)
    }, [app])
    const base = app.profile.baseFrame
    const others = followFrameOptions(frames, view.followFrame || base).filter(({ frame }) => frame !== base)
    return (
        <Field inline label="Follow frame">
            <Select
                aria-label="Frame to follow"
                value={view.followFrame === app.profile.baseFrame ? "" : view.followFrame}
                options={[["", `robot (${base})${frames.includes(base) ? "" : " (waiting)"}`], ...others.map(({ frame, waiting }) => [frame, `${frame}${waiting ? " (waiting)" : ""}`])]}
                onChange={(followFrame: string) => app.settings.update({ followFrame })}
            />
        </Field>
    )
}

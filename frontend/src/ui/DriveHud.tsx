// Driving on screen (no arming: keys and sticks always drive). Desktop: the profile's keys lighting up as they're held,
// in the bottom-left corner. Phone: two thumbs, a left stick that translates (forward/back, plus strafe for profiles
// that strafe) and a right stick that turns (plus up/down for profiles with a vertical axis), STOP and boost. Both show the agent's commands (POST api/drive), dry runs included.
import type { ViewerApp } from "../core/app.ts"
import { useStore } from "../core/store.ts"
import type { Axis } from "../profile/types.ts"
import { Badge, Button, Card, KeyCap, releaseAllThumbSticks, Text, ThumbStick } from "dimos-react"
import { shapeStick, smoothToward } from "../core/stick.ts"
import type { DriveHalt } from "../core/drive.ts"

/** Driving is held (latency over the max, or the link lost): why, and the Reconnect button. */
function HaltNotice({ app, halt }: { app: ViewerApp; halt: DriveHalt }) {
    const why = halt.reason === "lost" ? "Link lost" : `Latency over ${halt.maxMs} ms${halt.latencyMs !== null ? ` (${halt.latencyMs} ms)` : ""}`
    return (
        <div className="drive-halt" role="alert" data-testid="drive-halt">
            <Text small tone="danger">{why} · driving stopped</Text>
            <Button variant="danger" size="sm" className="reconnect-button" data-testid="reconnect-button" loading={halt.reconnecting} onClick={() => app.reconnect()}>
                {halt.reconnecting ? "Reconnecting…" : "Reconnect"}
            </Button>
        </div>
    )
}

export function DriveHud({ app, mobile }: { app: ViewerApp; mobile: boolean }) {
    const drive = app.drive
    const state = useStore(drive.state)
    const autodrive = useStore(app.gi.autodrive.state)
    const keys = app.profile.drive.keys
    const usesVertical = Object.values(keys).some((action) => "axis" in action && action.axis === "vertical")
    const usesStrafe = Object.values(keys).some((action) => "axis" in action && action.axis === "strafe")
    const keyFor = (axis: Axis, sign: number) => Object.entries(keys).find(([code, action]) => !code.startsWith("Arrow") && "axis" in action && action.axis === axis && Math.sign(action.value) === sign)?.[0].replace(/^Key/, "")
    const command = state.command
    const velocity = (linear: number[], angular: number[]) => `${linear[0].toFixed(2)}${usesStrafe ? ` / ${linear[1].toFixed(2)}` : ""}${usesVertical ? ` / ${linear[2].toFixed(2)}` : ""} m/s · ${angular[2].toFixed(2)} rad/s`
    const lit = (axis: Axis, sign: number) => Math.sign(state.axes[axis]) === sign && state.axes[axis] !== 0

    if (mobile) {
        const moving = state.publishing && [...state.twist.linear, ...state.twist.angular].some((value) => value !== 0)
        // the sticks, STOP and FAST only in Take control; in Autodrive, GI's Take control button is the STOP (ui/GiHud.tsx)
        const auto = autodrive.on
        return (
            <div className={`drive-hud mobile ${moving ? "moving" : ""} ${auto ? "auto" : ""}`} data-testid="drive-hud-mobile">
                {auto ? <span /> : <ThumbStick
                    className="stick-zone"
                    data-testid="stick-left"
                    label={usesStrafe ? "move" : "forward / back"}
                    axes={usesStrafe ? "xy" : "y"}
                    shape={shapeStick}
                    smooth={smoothToward}
                    onMove={(x: number, y: number) => drive.setAxes("left-stick", { forward: y, strafe: usesStrafe ? -x : 0 })}
                />}
                <div className="hud-center">
                    {state.halt && <HaltNotice app={app} halt={state.halt} />}
                    <Badge className="hud-note" data-testid="drive-readout">
                        {command ? `${command.dryRun ? "dry run" : command.source} · ${velocity(command.linear, command.angular)}` : velocity(state.twist.linear, state.twist.angular)}
                    </Badge>
                    {!auto && <Button
                        variant="danger"
                        block
                        className="stop-button"
                        data-testid="stop-button"
                        onPointerDown={() => {
                            // on touch, not on the click after it: no 300 ms, and it works while a thumb holds a stick
                            releaseAllThumbSticks()
                            drive.stop()
                        }}
                        onClick={() => {
                            releaseAllThumbSticks()
                            drive.stop()
                        }}
                    >
                        STOP
                    </Button>}
                    {!auto && <Button block className="boost-button" pressed={state.boost} variant={state.boost ? "primary" : "default"} onClick={() => drive.setBoost(!state.boost)}>{state.boost ? "FAST ON" : "FAST"}</Button>}
                </div>
                {auto ? <span /> : <ThumbStick
                    className="stick-zone"
                    data-testid="stick-right"
                    label={usesVertical ? "turn · up / down" : "turn"}
                    axes={usesVertical ? "xy" : "x"}
                    shape={shapeStick}
                    smooth={smoothToward}
                    onMove={(x: number, y: number) => drive.setAxes("right-stick", { turn: -x, vertical: usesVertical ? y : 0 })}
                />}
            </div>
        )
    }

    const cell = (axis: Axis, sign: number) => {
        const key = keyFor(axis, sign)
        return key ? <KeyCap down={lit(axis, sign)} label={key} /> : <KeyCap empty label="" />
    }
    return (
        <Card glass padded={false} className={`drive-hud corner ${state.publishing ? "moving" : ""} ${state.halt ? "halted" : ""}`} data-testid="drive-hud">
            {state.halt && <HaltNotice app={app} halt={state.halt} />}
            <div className="keys" aria-label="drive keys">
                <div>{usesStrafe ? cell("strafe", 1) : usesVertical ? cell("vertical", -1) : <KeyCap empty label="" />}{cell("forward", 1)}{usesStrafe ? cell("strafe", -1) : usesVertical ? cell("vertical", 1) : <KeyCap empty label="" />}</div>
                <div>{cell("turn", 1)}{cell("forward", -1)}{cell("turn", -1)}</div>
            </div>
            <KeyCap down={state.boost} label="⇧" />
            <Text as="div" mono small className="hud-readout" data-testid="drive-readout">
                {command
                    ? <>{command.dryRun ? "dry run · nothing sent" : `${command.source} driving`}<br /><Text muted>{velocity(command.linear, command.angular)} · {command.seconds} s</Text></>
                    : <>{velocity(state.twist.linear, state.twist.angular)}<br /><Text muted>→ {state.topic || "nothing"}</Text></>}
            </Text>
        </Card>
    )
}

// The 3D view as a panel: fullscreen behind everything, or (while a camera is main) a picture-in-picture with the
// camera's header bar (drag it, double-click or the expand button for fullscreen), a resize corner, a point cloud menu
// (each PointCloud2 on the bus: on/off, this viewer's bandwidth preset, color and size, live points and bytes a second)
// and an off switch: off, every 3D layer stops (nothing subscribed, no bandwidth) and only a small bar to turn it back
// on is left. View-only: nothing here moves the robot.
import { type PointerEvent as ReactPointerEvent, type RefObject, useEffect, useRef } from "react"
import { Button, Card, ColorSwatch, Icon, IconButton, Popover, ResizeHandle, Segmented, Select, Slider, Text, Toggle, Toolbar } from "dimos-react"
import type { ViewerApp } from "../core/app.ts"
import type { LayerEntry } from "../core/layers/manager.ts"
import { type Store, useStore } from "../core/store.ts"
import { CLOUD_PRESETS, cloudQualities, cloudQualityOf, type CloudQuality, type CloudRate, cloudRates, formatBytes, formatCount, scenePanel, setCloudQuality, updateScenePanel } from "../core/cloudQuality.ts"
import { GRADIENTS } from "dimos-react/three"
import type { PointLook } from "../core/render/rendering.ts"
import type { CloudSettings } from "../layers/pointcloud.tsx"
import { clampPanelBox, startPanelDrag } from "./panelDrag.ts"
import { ViewControls } from "./ViewControls.tsx"
import { TfFootnote } from "./TfFootnote.tsx"

const HEAD_PX = 33
const MIN_WIDTH = 220, MIN_HEIGHT = 150 + HEAD_PX

const COLOR_MODES: [PointLook["colorMode"], string][] = [["height", "by height"], ["intensity", "by intensity"], ["range", "by distance"], ["solid", "solid"]]

const isCloud = (entry: LayerEntry) => entry.topic.type === "sensor_msgs.PointCloud2"

/** The sum over the clouds being drawn. */
export function totalRate(rates: Record<string, CloudRate>): CloudRate & { clouds: number } {
    const all = Object.values(rates)
    return {
        clouds: all.length,
        hz: 0,
        pointsPerSecond: all.reduce((sum, rate) => sum + rate.pointsPerSecond, 0),
        bytesPerSecond: all.reduce((sum, rate) => sum + rate.bytesPerSecond, 0),
    }
}

export function ScenePanel({ host, app, mainCamera, mobile, onMain, onTf }: {
    host: RefObject<HTMLDivElement | null>
    app: ViewerApp | null
    /** a camera fills the screen: this is the picture-in-picture */
    mainCamera: boolean
    mobile: boolean
    /** make the 3D view fullscreen again */
    onMain: () => void
    onTf: () => void
}) {
    const state = useStore(scenePanel)
    const off = state.off
    const element = useRef<HTMLDivElement>(null)

    // off is per viewer and survives a reload: the layers stay stopped from the start
    useEffect(() => {
        app?.layers.setPaused(off)
    }, [app, off])

    const floating = mainCamera
    const startDrag = (event: ReactPointerEvent) => {
        if (!floating || mobile || (event.target as HTMLElement).closest("button, select, input, label")) {
            return
        }
        startPanelDrag(event, element.current!, (x, y) => updateScenePanel({ x, y }))
    }

    // the handle on the corner facing into the screen (bottom-left while it sits on the right half: the default)
    const handleLeft = state.x < 0 || state.x + Math.max(state.width, MIN_WIDTH) / 2 > (globalThis.innerWidth || 1280) / 2
    // grows from the handle's corner; the far edges stay put
    const resize = useRef<{ box: DOMRect; width: number; height: number; left: number } | null>(null)
    const startResize = () => {
        const panel = element.current!
        const box = panel.getBoundingClientRect()
        resize.current = { box, width: box.width, height: box.height, left: box.left }
        // from here on it's placed by its top-left corner
        Object.assign(panel.style, { left: `${box.left}px`, top: `${box.top}px`, right: "auto", bottom: "auto" })
    }
    const onResize = ({ dx, dy, done }: { dx: number; dy: number; done: boolean }) => {
        const drag = resize.current
        if (!drag) {
            return
        }
        const { box } = drag
        const grown = handleLeft ? -dx : dx
        drag.width = Math.round(Math.max(MIN_WIDTH, Math.min(handleLeft ? box.right - 8 : innerWidth - box.left - 8, box.width + grown)))
        drag.height = Math.round(Math.max(MIN_HEIGHT, Math.min(innerHeight - box.top - 8, box.height + dy)))
        drag.left = handleLeft ? box.right - drag.width : box.left
        Object.assign(element.current!.style, { width: `${drag.width}px`, height: `${drag.height}px`, left: `${drag.left}px` })
        if (done) {
            updateScenePanel({ width: drag.width, height: drag.height, x: drag.left, y: box.top })
            resize.current = null
        }
    }

    // the remembered box made safe for this window (a smaller screen, a bad saved value); unset = the CSS corner and size
    const box = clampPanelBox({ ...state, width: state.width > 0 ? state.width : undefined, height: state.height > 0 ? state.height : undefined }, { x: -1, y: -1, width: MIN_WIDTH, height: MIN_HEIGHT }, { width: globalThis.innerWidth, height: globalThis.innerHeight }, { width: MIN_WIDTH, height: MIN_HEIGHT })
    const placed: React.CSSProperties = box.x >= 0 ? { left: box.x, top: box.y, right: "auto", bottom: "auto" } : {}
    const sized: React.CSSProperties = state.width > 0 && !off ? { width: box.width, height: box.height } : {}
    const style = floating && !mobile ? { ...placed, ...sized } : {}
    const setOff = (next: boolean) => updateScenePanel({ off: next })

    return (
        <div ref={element} className={`scene-slot ${floating ? "floating" : ""} ${off ? "off" : ""}`} style={style} data-testid="scene-panel">
            {floating && (
                <Toolbar className="camera-head scene-head" onPointerDown={startDrag} onDoubleClick={off ? undefined : onMain}>
                    <Text small className="map-title"><Icon name="cube" size={14} />3D</Text>
                    {app && !off && <SceneRate />}
                    {off && <Text mono small muted className="camera-info">off · nothing subscribed</Text>}
                    {app && !off && <CloudButton app={app} />}
                    {!off && <IconButton size="sm" icon="expand" label="Fullscreen 3D view (the camera becomes a popup)" onClick={onMain} />}
                    <PowerButton off={off} onChange={setOff} />
                </Toolbar>
            )}
            <div ref={host} className="scene" />
            {app && !floating && !off && <ViewControls app={app} />}
            {app && !floating && !off && <TfFootnote app={app} onOpen={onTf} />}
            {app && !floating && !off && (
                <Toolbar floating className="scene-tools">
                    <SceneRate />
                    <CloudButton app={app} />
                    <PowerButton off={off} onChange={setOff} />
                </Toolbar>
            )}
            {!floating && off && (
                <Card glass className="scene-off">
                    <Icon name="cube" size={15} />
                    <Text small muted>3D view off · nothing subscribed</Text>
                    <PowerButton off={off} onChange={setOff} />
                </Card>
            )}
            {floating && !off && !mobile && (
                <ResizeHandle corner={handleLeft ? "bottom-left" : "bottom-right"} label="Resize the 3D view" onStart={startResize} onResize={onResize} />
            )}
        </div>
    )
}

function PowerButton({ off, onChange }: { off: boolean; onChange: (off: boolean) => void }) {
    const title = off ? "Turn the 3D view on (subscribes to its layers again)" : "Turn the 3D view off (unsubscribes every 3D layer: no bandwidth)"
    return <IconButton size="sm" icon="power" pressed={!off} label={title} aria-label={off ? "Turn the 3D view on" : "Turn the 3D view off"} onClick={() => onChange(!off)} />
}

function SceneRate() {
    const total = totalRate(useStore(cloudRates))
    const text = total.clouds ? `${formatCount(total.pointsPerSecond)} pts/s · ${formatBytes(total.bytesPerSecond)}/s` : "no cloud"
    return <Text mono small muted className="camera-info scene-rate" title={`${total.clouds} point cloud${total.clouds === 1 ? "" : "s"} drawn: points and bytes received a second`}>{text}</Text>
}

/** the point cloud button and its menu (each PointCloud2 on the bus) */
function CloudButton({ app }: { app: ViewerApp }) {
    const { list } = useStore(app.layers.entries)
    const clouds = list.filter(isCloud)
    const on = clouds.filter((entry) => entry.enabled).length
    return (
        <Popover
            placement="bottom-end"
            className="cloud-menu"
            trigger={
                <Button variant="ghost" size="sm" icon="layers" className="scene-clouds" aria-haspopup="menu" title={`Point clouds: ${on} of ${clouds.length} shown`} aria-label="Point clouds">
                    {clouds.length > 0 && <Text mono small>{on}/{clouds.length}</Text>}
                </Button>
            }
        >
            <CloudMenu app={app} />
        </Popover>
    )
}

function CloudMenu({ app }: { app: ViewerApp }) {
    const { list } = useStore(app.layers.entries)
    const rates = useStore(cloudRates)
    useStore(cloudQualities)
    const clouds = list.filter(isCloud)
    return (
        <div role="menu" aria-label="Point clouds">
            <Text as="div" small muted className="dr-label">Point clouds</Text>
            {!clouds.length && <Text as="p" small muted>No PointCloud2 on the bus yet.</Text>}
            {clouds.map((entry) => <CloudRow key={entry.topic.key} app={app} entry={entry} rate={rates[entry.topic.key]} />)}
        </div>
    )
}

function CloudRow({ app, entry, rate }: { app: ViewerApp; entry: LayerEntry; rate: CloudRate | undefined }) {
    const settings = entry.settings as Store<CloudSettings>
    const { look } = useStore(settings)
    const quality = cloudQualityOf(entry.topic.key)
    const setLook = (patch: Partial<PointLook>) => settings.update({ look: { ...look, ...patch } })
    const preset = CLOUD_PRESETS.find((other) => other.id === quality)!
    return (
        <div className={`cloud-row ${entry.enabled ? "on" : ""}`} data-key={entry.topic.key}>
            <div className="cloud-line">
                <Toggle size="sm" value={entry.enabled} onChange={(enabled: boolean) => app.layers.setEnabled(entry.topic.key, enabled)} />
                <Text small className="cloud-name" title={entry.topic.key}>{entry.topic.name}</Text>
                <Text mono small muted>{entry.enabled && rate ? `${formatCount(rate.pointsPerSecond)} pts/s · ${formatBytes(rate.bytesPerSecond)}/s` : entry.enabled ? "…" : "off"}</Text>
            </div>
            {entry.enabled && (
                <div className="cloud-controls">
                    <Segmented
                        size="sm"
                        label={`${entry.topic.name} bandwidth`}
                        title={preset.about}
                        items={CLOUD_PRESETS.map((option) => ({ value: option.id, label: option.id === "low" ? "Low" : option.label, title: option.about }))}
                        value={quality}
                        onChange={(id: CloudQuality) => setCloudQuality(entry.topic.key, id)}
                    />
                    <Select size="sm" value={look.colorMode} aria-label={`${entry.topic.name} color by`} options={COLOR_MODES} onChange={(colorMode: PointLook["colorMode"]) => setLook({ colorMode })} />
                    {look.colorMode === "solid"
                        ? <ColorSwatch value={look.solid} label={`${entry.topic.name} solid color`} onChange={(solid: string) => setLook({ solid })} />
                        : <Select size="sm" value={look.gradient} aria-label={`${entry.topic.name} colormap`} options={GRADIENTS} onChange={(gradient: string) => setLook({ gradient })} />}
                    <Slider className="cloud-size" title="point size" min={0.01} max={0.5} step={0.01} value={look.size} aria-label={`${entry.topic.name} point size`} format={(size: number) => `${Math.round(size * 100)} cm`} onChange={(size: number) => setLook({ size })} />
                </div>
            )}
        </div>
    )
}

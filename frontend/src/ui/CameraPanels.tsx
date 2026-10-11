// Camera panels: one by default (the profile's preferred camera), more on demand. Any panel can take over the
// screen, which shrinks the 3D view into a picture-in-picture. Depth is drawn as a colormap; 2D detections can be
// overlaid on any panel.
import { useEffect, useRef, useState } from "react"
import { Button, Card, Icon, IconButton, NumberInput, Popover, Select, Tabs, Text, Toolbar, ResizeHandle } from "dimos-react"
import type { ViewerApp } from "../core/app.ts"
import { type Store, useStore } from "../core/store.ts"
import { parseKey, type Topic } from "../core/transport.ts"
import { isDepthTopic } from "../core/video.ts"
import { cameraTabs, isImage, pickDefault as pickPreferred, retargetPanels } from "../core/cameraChoice.ts"
import { overlayTypeFor } from "../core/layers/registry.ts"
import { decode } from "../core/lcm/lcm.ts"
import { DEFAULT_DEPTH_LOOK, DEPTH_COLORMAPS, DepthCanvas, type DepthLook } from "../core/render/depth.ts"
import { startPanelDrag } from "./panelDrag.ts"
import { presetFor, QUALITY_PRESETS, readLocal, type VideoQuality, writeLocal } from "../core/videoQuality.ts"

export interface PanelState {
    id: number
    /** image topic key ("" until one is picked) */
    key: string
    /** the topic key the viewer picked from the list (core/cameraChoice.ts shows it again whenever it's on the bus) */
    picked?: string
    /** overlay topic key ("" = none) */
    overlay: string
    x: number
    y: number
    width: number
    height: number
    /** the user resized it: keep that size (else it fits the image's aspect) */
    sized?: boolean
    /** got the default size once (panels saved before 2026-10-05 have neither flag: they start over at the default) */
    fitted?: boolean
    /** depth topics: colormap and fixed range (null = auto) */
    depth?: DepthLook
}

export interface CameraLayout {
    panels: PanelState[]
    /** the panel shown fullscreen (the 3D view becomes a picture-in-picture), or null */
    main: number | null
    /** a panel was opened on the first camera once (closing it all stays closed) */
    seeded?: boolean
    /** the camera is main because nothing draws in 3D (no point cloud): a cloud showing up gives the view back */
    auto?: boolean
    /** the panel that was opened for that (closed again with it) */
    autoPanel?: number | null
}

/** a lidar / point cloud: what makes the 3D view worth the screen */
export const isCloudTopic = (topic: Topic) => topic.type === "sensor_msgs.PointCloud2" || /lidar/i.test(topic.name)

/** the user swapped the layout themselves this session: the camera-only default leaves it alone */
let userChoseLayout = false
export function chooseLayout() {
    userChoseLayout = true
}

/** how long the topic list has to stay the same before a camera-only blueprint gets the camera layout (topics arrive one by one) */
const SETTLE_MS = 3000

function pickDefault(app: ViewerApp, topics: Topic[]): Topic | null {
    return pickPreferred(app.profile.cameras.preferred, topics)
}

/** The camera header's height: a panel is this plus the image. */
const HEAD_PX = 33
/** The size before the image's is known (and for panels saved at the old 360×240 default): ~38% of the window, 16:9. */
function defaultSize() {
    const width = Math.round(Math.max(320, Math.min(760, (globalThis.innerWidth || 1280) * 0.38)))
    return { width, height: Math.round(width * 9 / 16) + HEAD_PX }
}

export function CameraPanels({ app, layout, mobile }: { app: ViewerApp; layout: Store<CameraLayout>; mobile: boolean }) {
    const { panels, main, seeded } = useStore(layout)
    const { topics } = useStore(app.connection.status)

    // the first time a camera shows up, open exactly one panel on it
    useEffect(() => {
        if (panels.length || seeded) {
            return
        }
        const first = pickDefault(app, topics)
        if (first) {
            layout.update({ seeded: true, panels: [{ id: 1, key: first.key, overlay: "", x: -1, y: -1, ...defaultSize(), fitted: true }] })
        }
    }, [topics, panels.length, seeded, app, layout])

    // a panel whose topic isn't on the bus (saved from another blueprint, the robot vs its sim) moves to the default camera once the topics settle; the viewer's own pick comes back when it does
    const imageKeys = topics.filter(isImage).map((topic) => topic.key).join("|")
    useEffect(() => {
        if (!imageKeys) {
            return
        }
        const timer = setTimeout(() => {
            const next = retargetPanels(layout.get().panels, app.connection.status.get().topics, app.profile.cameras.preferred)
            if (next) {
                layout.update({ panels: next })
            }
        }, SETTLE_MS)
        return () => clearTimeout(timer)
    }, [imageKeys, app, layout])

    // camera-only (no point cloud, a camera): the camera fills the screen and the 3D view becomes the picture-in-picture
    const topicKeys = topics.map((topic) => topic.key).join("|")
    useEffect(() => {
        const clouds = topics.some(isCloudTopic)
        const current = layout.get()
        if (clouds) {
            if (current.auto) {
                const panels = current.autoPanel ? current.panels.filter((panel) => panel.id !== current.autoPanel) : current.panels
                layout.update({ main: null, auto: false, autoPanel: null, panels })
            }
            return
        }
        if (current.main !== null || userChoseLayout || !topics.some(isImage)) {
            return
        }
        const timer = setTimeout(() => {
            const latest = app.connection.status.get().topics
            const now = layout.get()
            if (latest.some(isCloudTopic) || now.main !== null || userChoseLayout) {
                return
            }
            const camera = now.panels.find((panel) => latest.some((topic) => topic.key === panel.key && isImage(topic)))
            if (camera) {
                layout.update({ main: camera.id, auto: true })
                return
            }
            const first = pickDefault(app, latest)
            if (first) {
                const id = Math.max(0, ...now.panels.map((panel) => panel.id)) + 1
                layout.update({ seeded: true, auto: true, autoPanel: id, main: id, panels: [...now.panels, { id, key: first.key, overlay: "", x: -1, y: -1, ...defaultSize(), fitted: true }] })
            }
        }, SETTLE_MS)
        return () => clearTimeout(timer)
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [topicKeys, app, layout])

    const update = (id: number, patch: Partial<PanelState>) => layout.update({ panels: layout.get().panels.map((panel) => panel.id === id ? { ...panel, ...patch } : panel) })
    const close = (id: number) => {
        const current = layout.get()
        const wasMain = current.main === id
        if (wasMain) {
            chooseLayout()
        }
        layout.update({ panels: current.panels.filter((panel) => panel.id !== id), main: wasMain ? null : current.main, auto: wasMain ? false : current.auto, autoPanel: current.autoPanel === id ? null : current.autoPanel })
    }
    const add = () => {
        const used = new Set(panels.map((panel) => panel.key))
        const next = topics.filter(isImage).find((topic) => !used.has(topic.key)) ?? pickDefault(app, topics)
        const id = Math.max(0, ...panels.map((panel) => panel.id)) + 1
        layout.update({ panels: [...panels, { id, key: next?.key ?? "", overlay: "", x: -1, y: -1, ...defaultSize(), fitted: true }] })
    }

    return (
        <div className="camera-layer">
            {panels.map((panel, index) => (
                <CameraPanel
                    key={panel.id}
                    app={app}
                    panel={panel}
                    index={index}
                    topics={topics}
                    isMain={main === panel.id}
                    shown={panel.id === panels.find((other) => other.id !== main)?.id}
                    mobile={mobile}
                    onChange={(patch) => update(panel.id, patch)}
                    onClose={() => close(panel.id)}
                    onMain={() => {
                        chooseLayout()
                        layout.update({ main: main === panel.id ? null : panel.id, auto: false, autoPanel: null })
                    }}
                />
            ))}
            <Button className="dr-glass add-camera" icon="camera" iconRight="plus" title="Add a camera panel" aria-label="Add a camera panel" onClick={add} />
        </div>
    )
}

function CameraPanel({ app, panel, index, topics, isMain, shown, mobile, onChange, onClose, onMain }: {
    app: ViewerApp
    panel: PanelState
    index: number
    topics: Topic[]
    isMain: boolean
    /** the floating panel a phone shows (it hides the rest) */
    shown: boolean
    mobile: boolean
    onChange: (patch: Partial<PanelState>) => void
    onClose: () => void
    onMain: () => void
}) {
    const element = useRef<HTMLDivElement>(null)
    const video = useRef<HTMLVideoElement>(null)
    const depthHost = useRef<HTMLDivElement>(null)
    const depthRenderer = useRef<DepthCanvas | null>(null)
    const depthLook = panel.depth ?? DEFAULT_DEPTH_LOOK
    const lookRef = useRef(depthLook)
    lookRef.current = depthLook
    const [depthRange, setDepthRange] = useState<[number, number] | null>(null)
    const overlayCanvas = useRef<HTMLCanvasElement>(null)
    const topic = topics.find((other) => other.key === panel.key) ?? null
    // "(gone)" only once this topic was on the bus and then left, not while it's still being discovered
    const everSeen = useRef<string | null>(null)
    if (topic) {
        everSeen.current = panel.key
    } else if (everSeen.current !== panel.key) {
        everSeen.current = null
    }
    const [size, setSize] = useState({ width: 0, height: 0, fps: 0 })
    const depth = topic ? isDepthTopic(topic) : false

    // the stream (shared with a 3D projection of the same topic)
    useEffect(() => {
        if (!topic) {
            return
        }
        const source = app.video.acquire(topic)
        const unsubscribe = depth
            ? source.depth.subscribe(() => {
                const image = source.depth.get().image
                if (image && depthHost.current) {
                    if (!depthRenderer.current) {
                        depthRenderer.current = new DepthCanvas()
                        depthRenderer.current.canvas.className = "camera-media"
                        depthHost.current.prepend(depthRenderer.current.canvas)
                    }
                    const range = depthRenderer.current.draw(image, lookRef.current)
                    setDepthRange((old) => old && Math.abs(old[0] - range[0]) < 0.05 && Math.abs(old[1] - range[1]) < 0.05 ? old : range)
                    setSize((old) => old.width === image.width ? old : { width: image.width, height: image.height, fps: 0 })
                }
            })
            : source.video.subscribe(() => {
                const state = source.video.get()
                if (video.current && state.stream && video.current.srcObject !== state.stream) {
                    video.current.srcObject = state.stream
                    video.current.play().catch(() => {})
                }
                setSize({ width: state.width, height: state.height, fps: state.fps })
            })
        const state = source.video.get()
        if (!depth && video.current && state.stream) {
            video.current.srcObject = state.stream
            video.current.play().catch(() => {})
        }
        return () => {
            unsubscribe()
            app.video.release(topic)
        }
    }, [app, topic?.key])

    // the overlay (latest message, redrawn as it arrives)
    useEffect(() => {
        const overlayTopic = topics.find((other) => other.key === panel.overlay)
        const type = overlayTopic && overlayTypeFor(overlayTopic.type)
        const canvas = overlayCanvas.current
        if (!overlayTopic || !type || !canvas) {
            canvas?.getContext("2d")?.clearRect(0, 0, canvas.width, canvas.height)
            return
        }
        return app.connection.subscribe(overlayTopic.key, { delivery: "latest", maxHz: 30 }, (message) => {
            const context = canvas.getContext("2d")!
            const width = size.width || canvas.width, height = size.height || canvas.height
            if (canvas.width !== width || canvas.height !== height) {
                canvas.width = width
                canvas.height = height
            }
            context.clearRect(0, 0, width, height)
            try {
                type.draw(context, decode(overlayTopic.type, message.bytes), { width, height })
            } catch {
                // a message the overlay can't read: leave it blank
            }
        })
    }, [app, panel.overlay, topics.length, size.width, size.height])

    // drag by the header (desktop, floating only)
    const startDrag = (event: React.PointerEvent) => {
        if (isMain || mobile || (event.target as HTMLElement).closest("button, select")) {
            return
        }
        startPanelDrag(event, element.current!, (x, y) => onChange({ x, y }))
    }

    // size: this viewer's width (dragged with the corner handle, kept in localStorage), the height from the image's
    // aspect, so there are never bars; until the image's size is known, the default 16:9
    const [viewerWidth, setViewerWidth] = useState<number | null>(() => loadPanelWidth(panel.id))
    const aspect = size.width && size.height ? size.height / size.width : 9 / 16
    const width = clampWidth(viewerWidth ?? (panel.fitted ? panel.width : defaultSize().width), aspect)
    const height = Math.round(width * aspect) + HEAD_PX
    // the handle sits on the corner facing into the screen: bottom-left for a panel on the right half (the default)
    const handleLeft = panel.x < 0 || panel.x + width / 2 > (globalThis.innerWidth || 1280) / 2
    const resize = useRef<{ box: DOMRect; latest: number } | null>(null)
    const startResize = () => {
        const box = element.current!.getBoundingClientRect()
        resize.current = { box, latest: box.width }
    }
    const onResize = ({ dx, done }: { dx: number; dy: number; done: boolean }) => {
        const drag = resize.current
        if (!drag) {
            return
        }
        const { box } = drag
        drag.latest = clampWidth(box.width + (handleLeft ? -dx : dx), aspect)
        // the far edge stays put: growing to the left moves the left edge
        element.current!.style.width = `${drag.latest}px`
        element.current!.style.height = `${Math.round(drag.latest * aspect) + HEAD_PX}px`
        if (handleLeft && panel.x >= 0) {
            element.current!.style.left = `${box.right - drag.latest}px`
        }
        if (done) {
            setViewerWidth(drag.latest)
            savePanelWidth(panel.id, drag.latest)
            if (handleLeft && panel.x >= 0) {
                onChange({ x: box.right - drag.latest })
            }
            resize.current = null
        }
    }

    // the shown camera's tab in view (it can be off the end of a long row)
    useEffect(() => {
        const tab = element.current?.querySelector<HTMLElement>(".camera-tabs [aria-selected=\"true\"]")
        const row = element.current?.querySelector<HTMLElement>(".camera-tabs")
        if (tab && row && (tab.offsetLeft < row.scrollLeft || tab.offsetLeft + tab.offsetWidth > row.scrollLeft + row.clientWidth)) {
            row.scrollLeft = tab.offsetLeft - 6
        }
    }, [panel.key, topics.length])

    // fullscreen only: the whole picture letterboxed ("fit", object-fit: contain) or the screen filled, edges cropped ("fill", cover); this viewer's, per panel
    const [fill, setFill] = useState(() => loadPanelFill(panel.id))
    const toggleFill = () => {
        setFill(!fill)
        savePanelFill(panel.id, !fill)
    }

    // the latency/quality menu (gear over the picture)
    const quality = useQuality(app, topic, depth)

    const floating = !isMain
    // on a phone the controls under the camera (view controls, scene tools) sit at its real bottom, which its aspect sets
    useEffect(() => {
        const node = element.current
        if (!mobile || !floating || !shown || !node) {
            return
        }
        const root = document.documentElement
        const place = () => root.style.setProperty("--cam-bottom", `${Math.ceil(node.getBoundingClientRect().bottom)}px`)
        const observer = new ResizeObserver(place)
        observer.observe(node)
        place()
        return () => {
            observer.disconnect()
            root.style.removeProperty("--cam-bottom")
        }
    }, [mobile, floating, shown])
    const style: React.CSSProperties = floating && !mobile
        ? { width, height, ...(panel.x >= 0 ? { left: panel.x, top: panel.y } : { right: 12, top: 60 + index * (height + 12) }) }
        : mobile && floating && size.width && size.height
        ? { "--cam-aspect": (size.height / size.width).toFixed(4) } as React.CSSProperties
        : {}
    const info = size.width ? `${size.width}×${size.height}${size.fps ? ` · ${size.fps} fps` : ""}${depth && depthRange ? ` · ${depthRange[0].toFixed(1)}–${depthRange[1].toFixed(1)} m` : ""}` : ""
    const overlays = topics.filter((other) => overlayTypeFor(other.type))
    const tabs = cameraTabs(topics)
    const gone = !topic && panel.key ? (everSeen.current ? "(gone) " : "") + (parseKey(panel.key)?.name ?? panel.key) : null
    return (
        <Card padded={false} ref={element} className={`camera-panel ${isMain ? "main" : "floating"}`} style={style} data-panel={panel.id}>
            <Toolbar className="camera-head" onPointerDown={startDrag} onDoubleClick={onMain} title={info}>
                <div className="camera-tabs" onWheel={(event) => (event.currentTarget.scrollLeft += event.deltaY)}>
                    {gone && <Text mono small muted title={parseKey(panel.key)?.name ?? panel.key}>{gone}</Text>}
                    {tabs.length > 0 && (
                        <Tabs
                            size="sm"
                            label="Cameras"
                            items={tabs.map((tab) => ({ value: tab.topic.key, label: tab.label, title: `${tab.topic.name} (${tab.topic.type})` }))}
                            value={panel.key}
                            onChange={(key: string) => onChange({ key, picked: key })}
                        />
                    )}
                    {!tabs.length && !panel.key && <Text mono small muted>no camera on the bus</Text>}
                </div>
                {overlays.length > 0 && (
                    <Select size="sm" aria-label="Overlay" value={panel.overlay} options={[["", "no overlay"], ...overlays.map((other) => [other.key, other.name])]} onChange={(overlay: string) => onChange({ overlay })} />
                )}
                {depth && (
                    <>
                        <Select size="sm" aria-label="Depth colormap" value={depthLook.colormap} options={DEPTH_COLORMAPS} onChange={(colormap: string) => onChange({ depth: { ...depthLook, colormap } })} />
                        <NumberInput nullable size="sm" step={0.1} className="depth-range" placeholder="near" title="near (m); empty = auto" value={depthLook.near} onChange={(near: number | null) => onChange({ depth: { ...depthLook, near } })} />
                        <NumberInput nullable size="sm" step={0.1} className="depth-range" placeholder="far" title="far (m); empty = auto" value={depthLook.far} onChange={(far: number | null) => onChange({ depth: { ...depthLook, far } })} />
                    </>
                )}
                <Text mono small muted className="camera-info">{info || "…"}</Text>
                {isMain && (
                    <IconButton size="sm" icon={fill ? "fill" : "fit"} pressed={fill} label={fill ? "Fill: the picture fills the screen, edges cropped (click to fit the whole picture)" : "Fit: the whole picture, letterboxed (click to fill the screen)"} onClick={toggleFill} />
                )}
                <IconButton size="sm" icon="expand" label={isMain ? "Back to the 3D view" : "Fullscreen camera (3D becomes a popup)"} onClick={onMain} />
                <IconButton size="sm" icon="close" label="Close" onClick={onClose} />
            </Toolbar>
            <div className={`camera-body ${isMain && fill ? "fill" : ""}`} onClick={mobile && !isMain ? onMain : undefined}>
                {depth ? <div ref={depthHost} className="camera-media depth-host" /> : <video ref={video} className="camera-media" muted playsInline autoPlay disablePictureInPicture disableRemotePlayback />}
                <canvas ref={overlayCanvas} className="camera-overlay" />
                {topic && !depth && (!mobile || isMain) && (
                    <div className="camera-quality" onClick={(event) => event.stopPropagation()}>
                        <Popover
                            placement="bottom-end"
                            trigger={<IconButton size="sm" variant="default" icon="settings" className="dr-glass quality-gear" label={`Latency ↔ quality: ${presetFor(quality).label}`} aria-haspopup="menu" />}
                        >
                            {({ close }: { close: () => void }) => (
                                <div role="menu" aria-label="Latency or quality" className="quality-menu">
                                    <Text as="div" small muted className="dr-label">Latency ↔ quality</Text>
                                    {QUALITY_PRESETS.map((preset) => (
                                        <Button
                                            key={preset.id}
                                            variant="ghost"
                                            block
                                            role="menuitemradio"
                                            aria-checked={quality === preset.id}
                                            pressed={quality === preset.id}
                                            className="quality-option"
                                            onClick={() => {
                                                app.video.setQuality(topic, preset.id)
                                                close()
                                            }}
                                        >
                                            <span>
                                                <Text as="div" small>{preset.label}</Text>
                                                <Text as="div" small muted>{preset.about}</Text>
                                            </span>
                                        </Button>
                                    ))}
                                </div>
                            )}
                        </Popover>
                    </div>
                )}
            </div>
            {floating && !mobile && (
                <ResizeHandle corner={handleLeft ? "bottom-left" : "bottom-right"} label="Resize the camera" onStart={startResize} onResize={onResize} />
            )}
        </Card>
    )
}

/** The smallest and largest a floating camera gets: at least 200 px wide, at most the window between the top bar and
 * the drive guide (so the handle in the corner stays reachable). */
function clampWidth(width: number, aspect: number) {
    const maxWidth = Math.min((globalThis.innerWidth || 1280) - 24, ((globalThis.innerHeight || 800) - 60 - 110 - HEAD_PX) / aspect)
    return Math.round(Math.max(Math.min(200, maxWidth), Math.min(maxWidth, width)))
}

/** panel id → width this viewer dragged it to (per viewer: a phone and a desktop don't share it) */
const SIZE_KEY = "gi.cameras.width"
const loadPanelWidth = (id: number): number | null => readLocal<Record<string, number>>(SIZE_KEY, {})[id] ?? null
const savePanelWidth = (id: number, width: number) => writeLocal(SIZE_KEY, { ...readLocal<Record<string, number>>(SIZE_KEY, {}), [id]: width })

/** panel id → fullscreen fills the screen (cropped) instead of fitting the picture; per viewer, like the width */
const FILL_KEY = "gi.cameras.fill"
const loadPanelFill = (id: number): boolean => readLocal<Record<string, boolean>>(FILL_KEY, {})[id] === true
const savePanelFill = (id: number, fill: boolean) => writeLocal(FILL_KEY, { ...readLocal<Record<string, boolean>>(FILL_KEY, {}), [id]: fill })

/** The topic's quality preset as the shared source has it (changes in another panel of the same topic show here). */
function useQuality(app: ViewerApp, topic: Topic | null, depth: boolean): VideoQuality {
    const [quality, setQuality] = useState<VideoQuality>("balanced")
    useEffect(() => {
        if (!topic || depth) {
            return
        }
        const source = app.video.acquire(topic)
        const apply = () => setQuality(source.quality.get().quality)
        apply()
        const unsubscribe = source.quality.subscribe(apply)
        return () => {
            unsubscribe()
            app.video.release(topic)
        }
    }, [app, topic?.key, depth])
    return quality
}

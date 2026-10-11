// Connection state, live numbers, and the panel tabs. In Desktop's shell its window title already shows the icon and name, so the bar leaves them out.
import { Badge, ConnectionStatus, IconButton, Tabs, TopBar as Bar } from "dimos-react"
import type { ViewerApp } from "../core/app.ts"
import { useStore } from "../core/store.ts"
import { splatFallback } from "../core/render/rendering.ts"
import { inDesktopShell } from "../dim-app/source/desktop.js"
import type { Tab } from "./SidePanel.tsx"

export function TopBar({ app, tab, onTab }: { app: ViewerApp; tab: Tab | null; onTab: (tab: Tab) => void }) {
    const connection = useStore(app.connection.status)
    const stats = useStore(app.viewer.stats)
    const { issues: tfIssues } = useStore(app.tfIssues)
    const fallback = useStore(splatFallback)
    const live = connection.state === "connected"
    // driving's settings are Settings' first section; recording is the Record button at the top left (RecordControl)
    const tabs = [
        { value: "tf", icon: "tree", label: "TF", title: "TF", badge: tfIssues.length > 0 ? tfIssues.length : undefined },
        { value: "layers", icon: "layers", label: "Layers", title: "Layers" },
        { value: "settings", icon: "settings", label: "Settings", title: "Settings" },
    ]
    return (
        <Bar
            className="topbar"
            title={inDesktopShell() ? undefined : "GI Controller"}
            left={
                <>
                    <ConnectionStatus
                        className="conn-pill"
                        state={connection.state}
                        title={connection.error ?? ""}
                        label={live ? `${connection.topics.length} topics` : connection.state === "lost" ? "no gateway" : connection.state}
                        detail={connection.droppedPerSecond > 0 ? `${connection.droppedPerSecond} drop/s` : undefined}
                    />
                    <Badge className="stats-pill" title="frames per second · gateway → screen latency (p50)">
                        {stats.fps} fps{stats.latencyP50 !== null ? ` · ${Math.round(stats.latencyP50)} ms` : ""}
                    </Badge>
                    {fallback.active && (
                        <Badge
                            tone="warn"
                            role="button"
                            className="warn-pill"
                            title={`splat frames took ${fallback.frameMs.toFixed(0)} ms (over 16 ms): drawing cubes instead. Click to try splats again.`}
                            onClick={() => splatFallback.set({ active: false, frameMs: 0 })}
                        >
                            splats → cubes ({fallback.frameMs.toFixed(0)} ms)
                        </Badge>
                    )}
                </>
            }
            right={
                <>
                    <Tabs className="tabs" items={tabs} value={tab} onChange={(next: Tab) => onTab(next)} label="Panels" />
                    <IconButton
                        className="fullscreen-tab"
                        icon="fullscreen"
                        label="Fullscreen"
                        onClick={() => (document.fullscreenElement ? document.exitFullscreen() : document.documentElement.requestFullscreen()).catch(() => {})}
                    />
                </>
            }
        />
    )
}

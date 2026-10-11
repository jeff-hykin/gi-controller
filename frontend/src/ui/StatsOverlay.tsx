// Render numbers, for tuning and for the latency claim: fps, CPU per frame, bridge→screen latency, points drawn.
import { Card, Text } from "dimos-react"
import type { ViewerApp } from "../core/app.ts"
import { useStore } from "../core/store.ts"

export function StatsOverlay({ app }: { app: ViewerApp }) {
    const { showStats } = useStore(app.settings)
    const stats = useStore(app.viewer.stats)
    const connection = useStore(app.connection.status)
    if (!showStats) {
        return null
    }
    const ms = (value: number | null) => value === null ? "–" : `${value.toFixed(1)} ms`
    return (
        <Card glass className="stats-overlay" data-testid="stats">
            <Text as="div" mono small>{stats.fps} fps · {stats.frameMs.toFixed(2)} ms/frame CPU</Text>
            <Text as="div" mono small>latency p50 {ms(stats.latencyP50)} · p95 {ms(stats.latencyP95)}</Text>
            <Text as="div" mono small>arrival→frame {ms(stats.arrivalToFrameMs)} · rtt {ms(connection.rttMs)}</Text>
            <Text as="div" mono small>{stats.points.toLocaleString()} points · {stats.drawCalls} draws</Text>
        </Card>
    )
}

// Every drawable topic, grouped by layer type: a switch (on = subscribed), live info or the problem, and the
// layer's own settings behind a disclosure.
import { useState } from "react"
import { Button, Heading, KeyValue, Panel, Text, Toggle } from "dimos-react"
import type { ViewerApp } from "../core/app.ts"
import type { LayerEntry } from "../core/layers/manager.ts"
import { useStore } from "../core/store.ts"

function LayerRow({ app, entry }: { app: ViewerApp; entry: LayerEntry }) {
    const [open, setOpen] = useState(false)
    const Settings = entry.type.Settings
    return (
        <div className={`layer-row ${entry.enabled ? "on" : ""}`} data-key={entry.topic.key}>
            <div className="layer-line">
                <Toggle size="sm" value={entry.enabled} onChange={(enabled: boolean) => app.layers.setEnabled(entry.topic.key, enabled)} />
                <Button
                    variant="ghost"
                    size="sm"
                    className="layer-name"
                    onClick={() => setOpen(!open)}
                    disabled={!Settings}
                    title={entry.topic.key}
                    iconRight={Settings ? (open ? "chevron-down" : "chevron-right") : undefined}
                    aria-expanded={Settings ? open : undefined}
                >
                    <Text mono>{entry.topic.name}</Text>
                    <Text muted small>{entry.topic.type.split(".")[1]}</Text>
                </Button>
            </div>
            {entry.enabled && (entry.status.problem || entry.status.info) && (
                <Text as="div" mono small muted={!entry.status.problem} tone={entry.status.problem ? "warn" : undefined} className="layer-status">
                    {entry.status.problem ?? entry.status.info}
                </Text>
            )}
            {open && Settings && (
                <div className="layer-settings">
                    <Settings settings={entry.settings} topic={entry.topic} />
                </div>
            )}
        </div>
    )
}

export function LayersPanel({ app }: { app: ViewerApp }) {
    const { list } = useStore(app.layers.entries)
    const connection = useStore(app.connection.status)
    const groups = new Map<string, LayerEntry[]>()
    for (const entry of list) {
        groups.set(entry.type.label, [...(groups.get(entry.type.label) ?? []), entry])
    }
    const drawn = new Set(list.map((entry) => entry.topic.key))
    const other = connection.topics.filter((topic) => !drawn.has(topic.key))
    return (
        <div className="layers">
            {!list.length && <Text as="p" muted small>Waiting for topics… start a blueprint (or a replay) and they appear here.</Text>}
            {[...groups].map(([label, entries]) => (
                <section key={label} className="layer-group">
                    <Heading level={3}>{label}</Heading>
                    {entries.map((entry) => <LayerRow key={entry.topic.key} app={app} entry={entry} />)}
                </section>
            ))}
            {other.length > 0 && (
                <Panel collapsible defaultOpen={false} className="other-topics" title={`${other.length} other topics (not drawn)`}>
                    <KeyValue items={other.map((topic) => [topic.name, topic.type])} />
                </Panel>
            )}
        </div>
    )
}

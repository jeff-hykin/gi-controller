// Recording, floating at the top left of the view (a panel opens below it): a red Record button (while recording: "Stop recording", its time, size and stream count) and "…", which opens
// the options: the folder, the biggest streams by live bandwidth (each can be left out), See recordings, and an
// Advanced section (image format, chunk compression, new topics, dimos logs, every stream with its rate and a max
// rate). Every topic is recorded unless turned off; the options are saved in the backend (gi.record.options).
import { useEffect, useRef, useState } from "react"
import type { ViewerApp } from "../core/app.ts"
import { persistentStore, useStore } from "../core/store.ts"
import { recorder, type Compression, type ImageFormat, type StreamRate } from "../core/recorder.ts"
import { biggestStreams, formatBytes, formatClock, formatRate, inRecordingsFolder, isRecorded, isRpcTopic, TOP_STREAMS } from "../core/recordFormat.ts"
import type { Topic } from "../core/transport.ts"
import { Alert, Badge, Button, ButtonGroup, Card, Checkbox, Field, Heading, IconButton, NumberInput, Panel, Row, Select, Text, TextInput, Toggle } from "dimos-react"
import { appInstalled, openApp, underDesktop } from "../dim-app/source/desktop.js"

/** topic key → recorded or not; a topic not in it is recorded (so new ones are too) */
export const recordedTopics = persistentStore<Record<string, boolean>>("gi.record.topics", {})
export function RecordControl({ app }: { app: ViewerApp }) {
    const status = useStore(recorder.status)
    const pending = useStore(recorder.pending)
    const { topics } = useStore(app.connection.status)
    const chosen = useStore(recordedTopics)
    const [open, setOpen] = useState(false)
    const [error, setError] = useState<string | null>(null)
    const active = status.recording.active
    const selected = topics.filter((topic) => isRecorded(topic.key, chosen))
    const busy = pending.action !== null

    // a hash link (#record, as other apps open it with) opens the options
    useEffect(() => {
        if (location.hash === "#record") {
            setOpen(true)
        }
    }, [])

    const toggle = () => {
        setError(null)
        const work = active ? recorder.stop() : recorder.start(status.options.recordNew ? null : selected.map((topic) => topic.key))
        work.catch((problem) => setError(String(problem.message ?? problem)))
    }
    const label = busy
        ? (pending.action === "start" ? "Starting…" : "Stopping…")
        : active
        ? `Stop recording (${formatClock(status.recording.seconds)}, ${formatBytes(status.recording.bytes)}, ${status.keys.length} streams)`
        : status.options.recordNew
        ? `Record every stream${topics.length - selected.length ? ` but ${topics.length - selected.length} turned off` : ""}; new ones join`
        : `Record ${selected.length} streams`

    // the options are the button's sibling, not its child: the button's frosted glass would pin a fixed child to itself
    return (
        <>
            <Card glass padded={false} className={`record-control ${active ? "recording" : ""}`} data-testid="record-control">
                {/* one split button: Record │ … */}
                <ButtonGroup className="record-split">
                    <Button
                        size="sm"
                        icon={active ? "stop" : "record"}
                        className="record-toggle"
                        pressed={active}
                        title={status.unavailable ?? (error ? `${label}: ${error}` : label)}
                        aria-label={label}
                        // with new streams joining, a recording can start before anything is on the bus: they join as they appear
                        disabled={busy || !!status.unavailable || (!active && !status.options.recordNew && !selected.length)}
                        onClick={toggle}
                    >
                        {active
                            ? (
                                <span className="record-live" data-testid="record-live">
                                    <span>{busy ? "Stopping…" : "Stop recording"}</span>
                                    <Text mono small>{formatClock(status.recording.seconds)}</Text>
                                    <Text mono small className="record-extra">· {formatBytes(status.recording.bytes)} · {status.keys.length} streams</Text>
                                </span>
                            )
                            : <span>{busy ? "Starting…" : "Record"}</span>}
                    </Button>
                    <IconButton
                        size="sm"
                        variant="default"
                        icon="more-horizontal"
                        className="record-more"
                        pressed={open}
                        aria-haspopup="dialog"
                        aria-expanded={open}
                        label="Recording options"
                        onClick={() => setOpen(!open)}
                    />
                </ButtonGroup>
                {error && !open && <Badge tone="danger" title={error}>failed</Badge>}
            </Card>
            {open && <RecordOptions app={app} error={error} onClose={() => setOpen(false)} />}
        </>
    )
}

function RecordOptions({ app, error, onClose }: { app: ViewerApp; error: string | null; onClose: () => void }) {
    const status = useStore(recorder.status)
    const streams = useStore(recorder.streams)
    const { topics } = useStore(app.connection.status)
    const chosen = useStore(recordedTopics)
    const [advanced, setAdvanced] = useState(() => {
        try {
            return localStorage.getItem("controller.record.advanced") === "1"
        } catch {
            return false
        }
    })
    const [problem, setProblem] = useState<string | null>(null)
    const [recordings, setRecordings] = useState<"checking" | "installed" | "missing" | "outside">("checking")
    const panel = useRef<HTMLDivElement>(null)
    useEffect(() => recorder.watch(), [])
    useEffect(() => recorder.watchStreams(), [])
    useEffect(() => {
        if (!underDesktop()) {
            setRecordings("outside")
            return
        }
        appInstalled("dim-recordings").then((installed) => setRecordings(installed ? "installed" : "missing"))
    }, [])
    // clicks outside (but not on the "…" that toggles it) and Escape close it
    useEffect(() => {
        const away = (event: PointerEvent) => {
            const target = event.target as Element
            if (!panel.current?.contains(target) && !target.closest?.(".record-control")) {
                onClose()
            }
        }
        const escape = (event: KeyboardEvent) => event.key === "Escape" && onClose()
        addEventListener("pointerdown", away)
        addEventListener("keydown", escape)
        return () => {
            removeEventListener("pointerdown", away)
            removeEventListener("keydown", escape)
        }
    }, [onClose])

    const active = status.recording.active
    const options = status.options
    const run = (work: Promise<unknown>) => work.then(() => setProblem(null)).catch((failure) => setProblem(String(failure.message ?? failure)))
    const setAdvancedOpen = (value: boolean) => {
        setAdvanced(value)
        try {
            localStorage.setItem("controller.record.advanced", value ? "1" : "0")
        } catch {
            // private window: it just isn't remembered
        }
    }
    const rateOf = new Map(streams.list.map((stream) => [stream.key, stream]))
    // the biggest streams, ranked once and then held in place while this is open, so a switch doesn't move under the
    // pointer as rates change (new ones fill free places; the numbers stay live)
    const [topKeys, setTopKeys] = useState<string[]>([])
    useEffect(() => {
        if (streams.seconds < 2) {
            return
        }
        const ranked = biggestStreams(streams.list).map((stream) => stream.key).filter((key) => !topKeys.includes(key))
        if (topKeys.length < TOP_STREAMS && ranked.length) {
            setTopKeys([...topKeys, ...ranked].slice(0, TOP_STREAMS))
        }
    }, [streams, topKeys])
    const top = topKeys.map((key) => {
        const stream = streams.list.find((other) => other.key === key)
        const topic = topics.find((other) => other.key === key)
        return stream ?? { key, topic: topic?.name ?? key, type: topic?.type ?? "", bytesPerSecond: 0, messagesPerSecond: 0, recorded: true, maxRate: null }
    })
    const recordedRate = streams.list.filter((stream) => isRecorded(stream.key, chosen)).reduce((sum, stream) => sum + stream.bytesPerSecond, 0)
    const known = new Set(topics.map((topic) => topic.key))
    // every stream: the bridge's topics plus anything the meter heard that the bridge hasn't announced
    const all: Topic[] = [
        ...topics,
        ...streams.list.filter((stream) => !known.has(stream.key)).map((stream) => ({ key: stream.key, name: stream.topic, type: stream.type })),
    ].sort((a, b) => (rateOf.get(b.key)?.bytesPerSecond ?? 0) - (rateOf.get(a.key)?.bytesPerSecond ?? 0) || a.name.localeCompare(b.name))
    const recordedCount = all.filter((topic) => isRecorded(topic.key, chosen)).length
    const outside = !inRecordingsFolder(status.directory, status.recordings_root)

    return (
        <Card
            ref={panel}
            glass
            className="record-options"
            role="dialog"
            aria-label="Recording options"
            data-testid="record-options"
            title="Recording"
            actions={<IconButton icon="close" size="sm" label="Close" onClick={onClose} />}
        >
            {status.unavailable === "connecting…" && <Text as="p" muted small>connecting to the recorder…</Text>}
            {status.unavailable && status.unavailable !== "connecting…" && (
                <Alert
                    tone="warn"
                    title="Recording isn't available"
                    data-testid="onboard-recorder-down"
                    actions={<Button size="sm" onClick={() => recorder.refresh()}>Try again</Button>}
                >
                    The Controller's server isn't answering. Closing the Controller (✕) and opening it again restarts it.
                    <Text as="div" muted small>{status.unavailable}</Text>
                </Alert>
            )}
            {!status.unavailable && !all.length && (
                <Alert
                    title="Nothing to record yet"
                    data-testid="onboard-nothing-to-record"
                    actions={<Button size="sm" onClick={() => openApp("launcher")}>Open the Launcher</Button>}
                >
                    Launch a blueprint (or a replay) and its topics show up here to record.
                </Alert>
            )}
            {active && (
                <Alert tone="danger" className="record-now" data-testid="record-now" title={<Badge tone="danger" solid dot>REC {formatClock(status.recording.seconds)}</Badge>}>
                    <Text as="div" mono small>{formatBytes(status.recording.bytes)} · {status.keys.length} streams · {status.recording.messages.toLocaleString()} msgs</Text>
                    <Text as="div" mono small muted className="record-path" title={status.recording.path ?? ""}>{status.recording.path}</Text>
                    {status.recording.dropped > 0 && <Text as="div" small tone="danger">{status.recording.dropped.toLocaleString()} dropped: the disk can't keep up</Text>}
                    {status.recording.skipped > 0 && <Text as="div" small muted>{status.recording.skipped.toLocaleString()} left out by max rates</Text>}
                    {options.logs && <Text as="div" small muted>{status.logs.dirs.length ? `${status.logs.lines.toLocaleString()} dimos log lines` : "no dimos run logs found"}</Text>}
                </Alert>
            )}
            {(error || problem) && <Text as="p" small tone="danger">{error ?? problem}</Text>}

            <Field
                label="Folder"
                hint={outside ? undefined : options.directory ? "Inside Desktop's recordings folder." : "Desktop's recordings folder (the Recordings app lists it)."}
                error={outside ? "Outside Desktop's recordings folder: the Recordings app won't list these." : undefined}
            >
                <Row gap={6}>
                    <FolderInput
                        value={status.directory}
                        disabled={active}
                        title={active ? "The folder can change once this recording ends" : status.directory}
                        onCommit={(directory) => directory !== status.directory && run(recorder.settings({ directory }))}
                    />
                    {options.directory && (
                        <Button size="sm" disabled={active} title={status.default_directory} onClick={() => run(recorder.settings({ directory: "" }))}>Default</Button>
                    )}
                </Row>
            </Field>

            <Heading level={3}>Biggest streams</Heading>
            <div className="top-streams" data-testid="top-streams">
                {top.map((stream) => (
                    <Row key={stream.key} gap={8} className="stream-row">
                        <Toggle size="sm" value={isRecorded(stream.key, chosen)} onChange={(value: boolean) => recordedTopics.update({ [stream.key]: value })} />
                        <Text mono small className="topic-name" title={`${stream.key}`}>{stream.topic}</Text>
                        <Text mono small muted>{formatRate(stream.bytesPerSecond)}</Text>
                    </Row>
                ))}
                {!top.length && <Text as="p" muted small>{streams.error ? `can't measure: ${streams.error}` : streams.seconds < 2 ? "measuring…" : "nothing is sending"}</Text>}
            </div>
            <Text as="p" muted small data-testid="record-summary">
                Recording {recordedCount} of {all.length} streams{recordedRate > 0 ? ` · about ${formatRate(recordedRate)}` : ""}
                {active && !options.recordNew ? "" : " · new ones join"}
            </Text>

            <Row gap={8}>
                {recordings === "missing"
                    ? <Button size="sm" icon="download" onClick={() => openApp("appstore")}>Install Recordings from the App Store</Button>
                    : (
                        <Button size="sm" icon="folder" disabled={recordings === "outside"} title={recordings === "outside" ? "Open the Controller inside dimOS Desktop to open Recordings" : "Open the Recordings app"} onClick={() => openApp("dim-recordings")}>
                            See recordings
                        </Button>
                    )}
            </Row>

            <Panel collapsible open={advanced} onOpenChange={setAdvancedOpen} title="Advanced" className="record-advanced" data-testid={advanced ? "record-advanced" : undefined}>
                <Field inline label="Images" title={active ? "can change once this recording ends" : "how camera images are stored"}>
                    <Select
                        value={options.image_format}
                        options={[["raw", "raw (exact)"], ["png", "png (lossless)"], ["jpegxl", "jpeg xl (lossless)"], ["webp", "webp"], ["jpeg", "jpeg"]]}
                        onChange={(image_format: string) => run(recorder.settings({ image_format: image_format as ImageFormat }))}
                    />
                </Field>
                <Field inline label="Chunks" title="mcap chunk compression; uncompressed survives a hard kill best">
                    <Select value={options.compression} options={[["none", "uncompressed"], ["lz4", "lz4"], ["zstd", "zstd"]]} onChange={(compression: string) => run(recorder.settings({ compression: compression as Compression }))} />
                </Field>
                <Field inline label="New topics"><Toggle value={options.recordNew} onChange={(recordNew: boolean) => run(recorder.settings({ recordNew }))} label="join a running recording" /></Field>
                <Field inline label="dimos logs"><Toggle value={options.logs} onChange={(logs: boolean) => run(recorder.settings({ logs }))} label="record the running dimos's logs" /></Field>
                <Row gap={8} className="all-streams-head">
                    <Heading level={3}>All streams · {recordedCount} of {all.length}</Heading>
                    <Button variant="ghost" size="sm" onClick={() => recordedTopics.update(Object.fromEntries(all.map((topic) => [topic.key, true])))}>all</Button>
                    <Button variant="ghost" size="sm" onClick={() => recordedTopics.update(Object.fromEntries(all.map((topic) => [topic.key, false])))}>none</Button>
                </Row>
                <div className="record-topics" data-testid="all-streams">
                    <div className="record-topic legend">
                        <span />
                        <Text small muted>topic</Text>
                        <Text small muted>now</Text>
                        <Text small muted title="At most this many messages per second are recorded; empty = every message">max Hz</Text>
                    </div>
                    {all.map((topic) => <StreamRow key={topic.key} topic={topic} rate={rateOf.get(topic.key)} chosen={chosen} maxRate={options.rates[topic.key]} onRate={(hz) => run(recorder.settings({ rates: { [topic.key]: hz } }))} />)}
                </div>
            </Panel>
        </Card>
    )
}

/** The recording folder: saved on Enter or leaving the box */
function FolderInput({ value, disabled, title, onCommit }: { value: string; disabled: boolean; title: string; onCommit: (value: string) => void }) {
    const [text, setText] = useState(value)
    useEffect(() => setText(value), [value])
    return <TextInput mono size="sm" aria-label="Recording folder" value={text} disabled={disabled} title={title} onChange={setText} onEnter={() => onCommit(text.trim())} onBlur={() => onCommit(text.trim())} />
}

function StreamRow({ topic, rate, chosen, maxRate, onRate }: { topic: Topic; rate: StreamRate | undefined; chosen: Record<string, boolean>; maxRate: number | undefined; onRate: (hz: number | null) => void }) {
    const on = isRecorded(topic.key, chosen)
    return (
        <div className={`record-topic ${on ? "" : "off"} ${isRpcTopic(topic) ? "rpc" : ""}`}>
            <Checkbox aria-label={`Record ${topic.name}`} value={on} onChange={(value: boolean) => recordedTopics.update({ [topic.key]: value })} />
            <Text mono small muted={!on} className="topic-name" title={`${topic.key}`}>
                {topic.name}
                <Text muted> {topic.type.split(".")[1]}</Text>
            </Text>
            <Text mono small muted title={rate ? `${rate.messagesPerSecond} msg/s` : "quiet"}>{rate ? formatRate(rate.bytesPerSecond) : "–"}</Text>
            <NumberInput
                nullable
                size="sm"
                aria-label={`Max messages per second for ${topic.name}`}
                min={0}
                step={1}
                placeholder="all"
                value={maxRate ?? null}
                onChange={(value: number | null) => onRate(value && value > 0 ? value : null)}
            />
        </div>
    )
}

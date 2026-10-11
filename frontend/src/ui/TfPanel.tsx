// The TF tree, what's wrong with it, and which frame the view is fixed to.
import { useEffect, useMemo, useRef, useState } from "react"
import { Field, Select, Text, Tree } from "dimos-react"
import type { ViewerApp } from "../core/app.ts"
import { useStore } from "../core/store.ts"
import type { TfSnapshot } from "dimos-react/src/three/tf.js"

interface FrameNode {
    id: string
    label: string
    badge?: string
    children: FrameNode[]
}

/** the tree as Tree nodes, from each root down (a frame shows once, so a cycle can't loop) */
function frameNodes(snapshot: TfSnapshot): FrameNode[] {
    const seen = new Set<string>()
    const node = (frame: string, depth: number): FrameNode | null => {
        if (seen.has(frame) || depth > 64) {
            return null
        }
        seen.add(frame)
        const edge = snapshot.edges.find((other) => other.child === frame)
        const children = snapshot.edges.filter((other) => other.parent === frame).map((other) => other.child).sort()
        return {
            id: frame,
            label: frame,
            badge: edge ? (edge.isStatic ? "static" : `${Math.round(edge.ageMs)} ms`) : undefined,
            children: children.map((child) => node(child, depth + 1)).filter((child): child is FrameNode => !!child),
        }
    }
    return snapshot.problems.roots.map((root) => node(root, 0)).filter((root): root is FrameNode => !!root)
}

export function TfPanel({ app }: { app: ViewerApp }) {
    const view = useStore(app.settings)
    const frameInfo = useStore(app.frameInfo)
    const [snapshot, setSnapshot] = useState<TfSnapshot>(() => app.tf.snapshot())
    useEffect(() => {
        const timer = setInterval(() => setSnapshot(app.tf.snapshot()), 1000)
        return () => clearInterval(timer)
    }, [app])
    const highlight = useStore(app.highlight.state)
    // the highlight goes with the panel
    useEffect(() => () => app.highlight.set(null), [app])
    const { issues } = useStore(app.tfIssues)
    const flagged = new Set(issues.flatMap((issue) => issue.frames))
    const nodes = useMemo(() => frameNodes(snapshot), [snapshot])
    // every frame starts open (new ones too); only what the user folds stays folded
    const [folded, setFolded] = useState<Set<string>>(() => new Set())
    const parents = snapshot.edges.map((edge) => edge.parent)
    // opened from the view's TF note: bring the first frame it's about into sight
    const tree = useRef<HTMLDivElement>(null)
    const scrolled = useRef(false)
    useEffect(() => {
        const first = tree.current?.querySelector("[data-flagged]")
        if (first && !scrolled.current) {
            scrolled.current = true
            first.scrollIntoView({ block: "nearest" })
        }
    })
    return (
        <div className="tf-panel">
            <Field label="Fixed frame" hint="everything is drawn relative to this frame">
                <Select
                    value={view.fixedFrame}
                    options={[["", `auto (${frameInfo.fixedFrame})`], ...snapshot.frames.map((frame) => [frame, frame])]}
                    onChange={(fixedFrame: string) => app.settings.update({ fixedFrame })}
                />
            </Field>
            <Text as="p" muted small>Robot frame: {app.profile.baseFrame} {frameInfo.robotFound ? "(in TF)" : "(not in TF yet)"}</Text>
            {issues.map((issue) => <Text as="p" small tone="danger" key={issue.kind + issue.summary} title={issue.frames.join(", ")}>{issue.summary}: {issue.detail}</Text>)}
            {!snapshot.frames.length && <Text as="p" muted small>no tf yet</Text>}
            <div className="tf-tree" ref={tree} onPointerLeave={() => app.highlight.set(null)}>
                <Tree
                    nodes={nodes}
                    expanded={[...new Set(parents)].filter((frame) => !folded.has(frame))}
                    onExpandedChange={(open: string[]) => setFolded(new Set(parents.filter((frame) => !open.includes(frame))))}
                    selected={highlight.frame}
                    renderLabel={(node: FrameNode) => (
                        <Text
                            mono
                            small
                            tone={flagged.has(node.id) || snapshot.problems.stale.includes(node.id) ? "warn" : undefined}
                            data-frame={node.id}
                            data-flagged={flagged.has(node.id) || undefined}
                            title="Hover to find it in the 3D view"
                            onPointerEnter={() => app.highlight.set(node.id)}
                        >
                            {node.label}
                        </Text>
                    )}
                />
            </div>
            {highlight.frame && !highlight.placed && <Text as="p" muted small>{highlight.frame} isn't connected to {frameInfo.fixedFrame}: it can't be shown in the view</Text>}
        </div>
    )
}

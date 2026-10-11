// The 3D view's own camera buttons, over its corner: follow (track the followed TF frame, base_link by default; a pan
// stops it, this resumes it) and top-down (straight down on the area around it). They move this page's camera
// directly; the agent's POST api/camera does the same in every open page.
import { Button, Column } from "dimos-react"
import type { ViewerApp } from "../core/app.ts"
import { useStore } from "../core/store.ts"

export function ViewControls({ app }: { app: ViewerApp }) {
    const view = useStore(app.settings)
    const { paused } = useStore(app.viewer.followPaused)
    const { followFound } = useStore(app.frameInfo)
    const following = view.follow && !paused
    const frame = app.followFrame
    const title = following
        ? `Following ${frame}${followFound ? "" : " (waiting for it in TF)"}: orbit and zoom keep following, a pan looks around. Click to reframe it`
        : `Follow ${frame} again`
    return (
        <Column gap={6} className="view-controls" data-testid="view-controls">
            <Button className="dr-btn--icon dr-glass view-follow" icon="target" pressed={following} title={title} aria-label={following ? "Following" : "Follow"} onClick={() => app.recenter()} />
            <Button className="dr-btn--icon dr-glass" icon="top" title="Top-down view" aria-label="Top down" onClick={() => app.topDown()} />
        </Column>
    )
}

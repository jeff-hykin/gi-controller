// A quiet one-line note over the view's corner when the TF tree is broken (core/tfCheck.ts); nothing when it's fine.
// Clicking it opens the TF tab, where the frames involved are marked.
import { Button } from "dimos-react"
import type { ViewerApp } from "../core/app.ts"
import { useStore } from "../core/store.ts"

export function TfFootnote({ app, onOpen }: { app: ViewerApp; onOpen: () => void }) {
    const { issues } = useStore(app.tfIssues)
    if (!issues.length) {
        return null
    }
    const more = issues.length > 1 ? ` · +${issues.length - 1} more` : ""
    return (
        <Button variant="ghost" size="sm" icon="warn" className="dr-glass dr-warn tf-footnote" data-testid="tf-footnote" title={issues.map((issue) => `${issue.summary}: ${issue.detail}`).join("\n")} onClick={onOpen}>
            TF: {issues[0].summary}{more}
        </Button>
    )
}

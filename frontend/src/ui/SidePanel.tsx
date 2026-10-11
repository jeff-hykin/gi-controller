// The panel the top bar's tabs open: a side panel on a desktop, a bottom sheet on a phone.
import { IconButton, Panel } from "dimos-react"
import type { ViewerApp } from "../core/app.ts"
import { LayersPanel } from "./LayersPanel.tsx"
import { TfPanel } from "./TfPanel.tsx"
import { SettingsPanel } from "./SettingsPanel.tsx"

export type Tab = "layers" | "tf" | "settings"

const TITLES: Record<Tab, string> = { layers: "Layers", tf: "Transforms", settings: "Settings" }

export function SidePanel({ app, tab, onClose, mobile }: { app: ViewerApp; tab: Tab; onTab: (tab: Tab) => void; onClose: () => void; mobile: boolean }) {
    return (
        <Panel
            glass
            className={`side-panel ${mobile ? "sheet" : ""}`}
            bodyClassName="panel-body"
            data-tab={tab}
            title={TITLES[tab]}
            actions={<IconButton icon="close" label="Close" size="sm" onClick={onClose} />}
        >
            {tab === "layers" && <LayersPanel app={app} />}
            {tab === "tf" && <TfPanel app={app} />}
            {tab === "settings" && <SettingsPanel app={app} />}
        </Panel>
    )
}

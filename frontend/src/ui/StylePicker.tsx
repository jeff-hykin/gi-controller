// The point-style picker: a choice per style with a one-line description. Settings → Rendering uses it for the global
// default; each point-cloud layer uses it with a "default" choice to follow that.
import { RadioGroup } from "dimos-react"
import { POINT_STYLES } from "dimos-react/three"
import type { PointStyle } from "../core/render/rendering.ts"

export function StylePicker({ value, onChange, withDefault }: { value: PointStyle | "default"; onChange: (style: PointStyle | "default") => void; withDefault?: string }) {
    const options = [
        ...(withDefault ? [{ value: "default", label: `default · ${withDefault} (follow Settings → Rendering)` }] : []),
        ...(Object.keys(POINT_STYLES) as PointStyle[]).map((style) => ({ value: style, label: `${POINT_STYLES[style].label} · ${POINT_STYLES[style].about}` })),
    ]
    return <RadioGroup className="style-picker" options={options} value={value} onChange={onChange} />
}

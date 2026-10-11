// Edits how points look: style, size, color mode, gradient and range. Used by every layer that draws points.
import { GradientPicker, POINT_STYLES } from "dimos-react/three"
import type { PointLook, PointStyle } from "../core/render/rendering.ts"
import { rendering } from "../core/render/rendering.ts"
import { useStore } from "../core/store.ts"
import { StylePicker } from "./StylePicker.tsx"
import { ColorSwatch, Field, NumberInput, Row, Select, Slider } from "dimos-react"

export function PointLookEditor({ look, onChange }: { look: PointLook; onChange: (look: PointLook) => void }) {
    const set = (patch: Partial<PointLook>) => onChange({ ...look, ...patch })
    const global = useStore(rendering)
    const shown = look.style === "default" ? global.pointStyle : look.style
    return (
        <>
            <Field inline label="Style">
                <StylePicker value={look.style} onChange={(style) => set({ style })} withDefault={POINT_STYLES[global.pointStyle].label} />
            </Field>
            <Field inline label={shown === "voxel" ? "Voxel" : "Size"}>
                <Slider min={0.01} max={0.5} step={0.01} value={look.size} format={(size: number) => `${Math.round(size * 100)} cm`} onChange={(size: number) => set({ size })} />
            </Field>
            <Field inline label="Color">
                <Select value={look.colorMode} options={[["height", "by height"], ["intensity", "by intensity"], ["range", "by distance"], ["solid", "solid"]]} onChange={(colorMode: string) => set({ colorMode: colorMode as PointLook["colorMode"] })} />
            </Field>
            {look.colorMode === "solid"
                ? (
                    <Field inline label="Solid">
                        <ColorSwatch value={look.solid} onChange={(solid: string) => set({ solid })} />
                    </Field>
                )
                : (
                    <>
                        <Field inline label="Gradient">
                            <GradientPicker value={look.gradient} onChange={(gradient: string) => set({ gradient })} />
                        </Field>
                        {look.colorMode === "height" && (
                            <Field inline label="Axis">
                                <Select value={String(look.axis)} options={[["2", "z (height)"], ["0", "x"], ["1", "y"]]} onChange={(axis: string) => set({ axis: Number(axis) as PointLook["axis"] })} />
                            </Field>
                        )}
                        <Field inline label="Range" title="empty = automatic (5th–95th percentile)">
                            <Row gap={6}>
                                <NumberInput nullable step={0.1} size="sm" value={look.rangeMin} placeholder="auto" onChange={(rangeMin: number | null) => set({ rangeMin })} />
                                <NumberInput nullable step={0.1} size="sm" value={look.rangeMax} placeholder="auto" onChange={(rangeMax: number | null) => set({ rangeMax })} />
                            </Row>
                        </Field>
                    </>
                )}
            <Field inline label="Opacity">
                <Slider min={0.1} max={1} step={0.05} value={look.opacity} format={(opacity: number) => `${Math.round(opacity * 100)}%`} onChange={(opacity: number) => set({ opacity })} />
            </Field>
        </>
    )
}

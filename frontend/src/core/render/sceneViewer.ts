// The parts of dimos-react's Viewer (its 3D view) this app uses, typed: dimos-react ships untyped declarations.
import type * as THREE from "three"
import type { CSS2DRenderer } from "three/examples/jsm/renderers/CSS2DRenderer.js"
import type { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js"
import type { Store } from "dimos-react/three" // the viewer's stores are dimos-react's

export interface RenderStats {
    fps: number
    frameMs: number
    latencyP50: number | null
    latencyP95: number | null
    arrivalToFrameMs: number | null
    drawCalls: number
    points: number
}

export interface FrameInfo {
    now: number
    fixedFrame: string
    camera: THREE.PerspectiveCamera
}

export interface SceneViewer {
    readonly renderer: THREE.WebGLRenderer
    readonly labels: CSS2DRenderer
    readonly scene: THREE.Scene
    readonly camera: THREE.PerspectiveCamera
    readonly controls: OrbitControls
    readonly stats: Store<RenderStats>
    readonly followPaused: Store<{ paused: boolean }>
    readonly pixelsPerMeter: { value: number }
    readonly resolution: THREE.Vector2
    fixedFrame: string
    followTarget: THREE.Vector3 | null
    setTheme(): void
    requestRender(): void
    noteData(timestampMs: number): void
    onFrame(listener: (frame: FrameInfo) => void): () => void
    pick(clientX: number, clientY: number): { point: THREE.Vector3; on: "points" | "mesh" | "ground" } | null
    frame(target: THREE.Vector3, distance: number): void
    topDown(target: THREE.Vector3, extent: number): void
    pauseFollow(): void
    resumeFollow(): void
    dataBounds(): THREE.Box3 | null
}

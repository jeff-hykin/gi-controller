// The robot camera, as frames for GI: the profile's preferred color camera (else the first one on the bridge), its
// latest video frame drawn to a canvas at most MAX_WIDTH wide, as JPEG. Depth cameras are never used.
import type { ViewerApp } from "../app.ts"
import type { Topic } from "../transport.ts"
import type { FrameSource } from "./autodrive.ts"
import type { GiFrame } from "./policy.ts"

const MAX_WIDTH = 640
const QUALITY = 0.7

export class CameraFrames implements FrameSource {
    #camera: { topic: Topic; element: HTMLVideoElement } | null = null
    #canvas: HTMLCanvasElement | null = null

    constructor(readonly app: ViewerApp) {}

    /** The camera topic in use (null until one is on the bridge). */
    get topic(): Topic | null {
        return this.#camera?.topic ?? null
    }

    #ensureCamera() {
        if (this.#camera) {
            return this.#camera
        }
        const images = this.app.connection.status.get().topics.filter((topic) => (topic.type === "sensor_msgs.Image" || topic.type === "sensor_msgs.CompressedImage") && !/depth/i.test(topic.name))
        const topic = this.app.profile.cameras.preferred.map((name) => images.find((image) => image.name === name)).find(Boolean) ?? images[0]
        if (!topic) {
            return null
        }
        const source = this.app.video.acquire(topic)
        this.#camera = { topic, element: this.app.video.element(source) }
        return this.#camera
    }

    grab(): Promise<GiFrame | null> {
        const camera = this.#ensureCamera()
        const element = camera?.element
        if (!element || element.readyState < 2 || !element.videoWidth) {
            return Promise.resolve(null)
        }
        const scale = Math.min(1, MAX_WIDTH / element.videoWidth)
        const width = Math.round(element.videoWidth * scale)
        const height = Math.round(element.videoHeight * scale)
        this.#canvas ??= document.createElement("canvas")
        const canvas = this.#canvas
        canvas.width = width
        canvas.height = height
        canvas.getContext("2d")!.drawImage(element, 0, 0, width, height)
        const data = canvas.toDataURL("image/jpeg", QUALITY).split(",")[1]
        return Promise.resolve({ mimeType: "image/jpeg", data, width, height })
    }

    dispose() {
        if (this.#camera) {
            this.app.video.release(this.#camera.topic)
            this.#camera = null
        }
    }
}

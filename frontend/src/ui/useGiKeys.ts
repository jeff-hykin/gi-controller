// GI's keys on a desktop: hold T to talk (the words become the instruction and autodrive starts), G toggles autodrive.
// Not while typing in a field, and not for an arm (its profile uses T and G). A physical gamepad drives too (A toggles
// autodrive, B stops).
import { useEffect } from "react"
import type { ViewerApp } from "../core/app.ts"
import { watchGamepads } from "../core/gamepad.ts"

const typing = (target: EventTarget | null) => target instanceof HTMLElement && (target.isContentEditable || ["INPUT", "SELECT", "TEXTAREA"].includes(target.tagName))

export function useGiKeys(app: ViewerApp | null, enabled: boolean) {
    useEffect(() => {
        if (!app || !enabled) {
            return
        }
        const { autodrive, speech } = app.gi
        const down = (event: KeyboardEvent) => {
            if (typing(event.target) || event.metaKey || event.ctrlKey || event.altKey || event.repeat) {
                return
            }
            if (event.code === "KeyT") {
                event.preventDefault()
                speech.start((text) => {
                    autodrive.setInstruction(text)
                    autodrive.start()
                })
            } else if (event.code === "KeyG") {
                event.preventDefault()
                autodrive.toggle()
            }
        }
        const up = (event: KeyboardEvent) => {
            if (event.code === "KeyT") {
                speech.stop()
            }
        }
        addEventListener("keydown", down)
        addEventListener("keyup", up)
        return () => {
            removeEventListener("keydown", down)
            removeEventListener("keyup", up)
        }
    }, [app, enabled])

    useEffect(() => (app && enabled ? watchGamepads(app.drive, () => app.gi.autodrive.toggle()) : undefined), [app, enabled])
}

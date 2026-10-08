// Push-to-talk speech → text with the browser's speech recognition (Chrome, Edge, Safari: webkitSpeechRecognition).
// Hold to listen; interim words are reported as they come, and the final text on release.
import { Store } from "../store.ts"

export interface SpeechState {
    /** null when it can be used; else why not (shown on the disabled mic button) */
    unavailable: string | null
    listening: boolean
    /** the words so far while listening */
    interim: string
    error: string | null
}

// deno-lint-ignore no-explicit-any
type Recognition = any

// deno-lint-ignore no-explicit-any
const recognitionClass = (scope: any = globalThis): (new () => Recognition) | null => scope.SpeechRecognition ?? scope.webkitSpeechRecognition ?? null

/** Why speech recognition can't be used here, or null if it can. */
export function speechUnavailable(scope: unknown = globalThis): string | null {
    // deno-lint-ignore no-explicit-any
    const anyScope = scope as any
    if (!recognitionClass(anyScope)) {
        return "this browser has no speech recognition (use Chrome, Edge or Safari), type instead"
    }
    if (anyScope.isSecureContext === false) {
        return "the mic needs a secure page (https or localhost)"
    }
    return null
}

export class Speech {
    readonly state: Store<SpeechState>
    #recognition: Recognition | null = null
    #final = ""
    #onFinal: (text: string) => void = () => {}

    constructor(readonly scope: unknown = globalThis) {
        this.state = new Store<SpeechState>({ unavailable: speechUnavailable(scope), listening: false, interim: "", error: null })
    }

    /** Starts listening; onFinal gets the whole utterance once listening ends (an empty one is not reported). */
    start(onFinal: (text: string) => void) {
        const Class = recognitionClass(this.scope)
        if (!Class || this.state.get().unavailable || this.#recognition) {
            return
        }
        this.#onFinal = onFinal
        this.#final = ""
        const recognition = new Class()
        recognition.continuous = true
        recognition.interimResults = true
        recognition.lang = (typeof navigator !== "undefined" && navigator.language) || "en-US"
        // deno-lint-ignore no-explicit-any
        recognition.onresult = (event: any) => {
            let interim = ""
            for (let index = event.resultIndex; index < event.results.length; index++) {
                const result = event.results[index]
                if (result.isFinal) {
                    this.#final += result[0].transcript
                } else {
                    interim += result[0].transcript
                }
            }
            this.state.update({ interim: (this.#final + interim).trim() })
        }
        // deno-lint-ignore no-explicit-any
        recognition.onerror = (event: any) => {
            const error = event.error === "not-allowed" ? "the mic is blocked: allow it for this page" : event.error === "no-speech" ? null : `speech: ${event.error}`
            this.state.update({ error })
        }
        recognition.onend = () => {
            const text = (this.#final || this.state.get().interim).trim()
            this.#recognition = null
            this.state.update({ listening: false, interim: "" })
            if (text) {
                this.#onFinal(text)
            }
        }
        this.#recognition = recognition
        this.state.update({ listening: true, interim: "", error: null })
        try {
            recognition.start()
        } catch (error) {
            this.#recognition = null
            this.state.update({ listening: false, error: `speech: ${error}` })
        }
    }

    /** Stops listening; the final text arrives through start's onFinal. */
    stop() {
        this.#recognition?.stop()
    }
}

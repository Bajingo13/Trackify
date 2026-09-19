import { useRef } from "react"
import { tap } from "./native"

/**
 * Two ways to attach a photo, because a phone has two.
 *
 * The `capture` attribute forces the camera and takes the gallery away. That is
 * right only when the photo does not exist yet, and most of the time it does: a
 * licence the office already scanned, a receipt photographed at the pump before
 * the app was open, a delivery shot taken while the signal was gone. A driver
 * who has the picture and cannot reach it will give up rather than retake it.
 *
 * Two inputs rather than one, because a single input cannot reliably offer both
 * on every Android build — dropping `capture` is supposed to produce a chooser,
 * and on a good many handsets it simply opens the gallery instead, which loses
 * the camera. Asking plainly is the only thing that works everywhere.
 */
export default function PhotoPick({
  onFile,
  busy = false,
  takeLabel = "Take photo",
  pickLabel = "From gallery",
  facing = "environment",
  accept = "image/*",
  className = "dr-btn-quiet",
}) {
  const camera = useRef(null)
  const gallery = useRef(null)

  const handle = (e) => {
    const file = e.target.files?.[0]
    // Cleared so choosing the same file twice still fires a change event —
    // otherwise a retake of an identical filename looks like nothing happened.
    e.target.value = ""
    if (file) onFile(file)
  }

  return (
    <>
      <button
        type="button"
        className={className}
        disabled={busy}
        onClick={() => { tap("light"); camera.current?.click() }}
      >
        {takeLabel}
      </button>
      <button
        type="button"
        className={className}
        disabled={busy}
        onClick={() => { tap("light"); gallery.current?.click() }}
      >
        {pickLabel}
      </button>

      <input ref={camera} type="file" accept={accept} capture={facing} hidden onChange={handle} />
      <input ref={gallery} type="file" accept={accept} hidden onChange={handle} />
    </>
  )
}

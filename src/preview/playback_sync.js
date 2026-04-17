// Shared playback behaviours for preview modals.
//
// Both the editor's PreviewModal and the standalone content preview need:
//   1. attachPlaybackSync(dialog, pageMedia) — sync currentTime between the
//      inline page media and the modal's media on open/close, auto-continuing
//      playback if the page media was playing.
//   2. installPauseOthers() — a document-level "play" listener that pauses
//      all other <video>/<audio> elements when any one starts playing.
//
// Centralising these keeps the two entry points in sync and avoids drift.

let pauseOthersInstalled = false

// Wire up bidirectional playback-time sync between a page media element and
// the modal's media. Safe to call without a pageMedia (no-ops).
export function attachPlaybackSync(dialog, pageMedia) {
  if (!pageMedia) return

  // Sync back to the inline player when the dialog closes — fires for
  // Escape, backdrop click, and close button (all trigger the native close).
  dialog.addEventListener("close", () => {
    const media = dialog.querySelector("video, audio")
    if (media) pageMedia.currentTime = media.currentTime
  }, { once: true })

  // Sync forward into the modal and continue playing if it was playing.
  const modalMedia = dialog.querySelector("video, audio")
  if (!modalMedia) return

  const wasPlaying = !pageMedia.paused
  modalMedia.currentTime = pageMedia.currentTime
  if (wasPlaying) {
    pageMedia.pause()
    modalMedia.play()
  }
}

// Install a single document-level "play" listener that pauses every other
// video/audio when any one starts playing. Idempotent — safe to call multiple
// times from different entry points.
export function installPauseOthers() {
  if (pauseOthersInstalled) return
  pauseOthersInstalled = true

  document.addEventListener("play", (event) => {
    const target = event.target
    if (!target || (target.tagName !== "VIDEO" && target.tagName !== "AUDIO")) return

    document.querySelectorAll("video, audio").forEach(media => {
      if (media !== target && !media.paused) media.pause()
    })
  }, true)
}

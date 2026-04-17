import { expect } from "@playwright/test"

// Drive a block drag via hover → handle → mouse down → move → drop. Shared
// across block-drag tests so a single definition owns the timing and the
// handle-locator selector.
export async function dragBlock(page, sourceLocator, targetLocator, { position = "after", offsetX = 0 } = {}) {
  const sourceBox = await sourceLocator.boundingBox()
  const targetBox = await targetLocator.boundingBox()

  // 1. Hover over the source to reveal the drag handle
  const sourceCenter = { x: sourceBox.x + sourceBox.width / 2, y: sourceBox.y + sourceBox.height / 2 }
  await page.mouse.move(sourceCenter.x, sourceCenter.y)
  await page.waitForTimeout(100) // wait for handle to appear

  // 2. Find and click the drag handle
  const handle = page.locator("lexxy-editor .lexxy-block-handle--visible")
  await expect(handle).toBeVisible({ timeout: 2000 })
  const handleBox = await handle.boundingBox()
  const handleCenter = { x: handleBox.x + handleBox.width / 2, y: handleBox.y + handleBox.height / 2 }

  // 3. Mousedown on the handle
  await page.mouse.move(handleCenter.x, handleCenter.y)
  await page.mouse.down()

  // 4. Move past the drag threshold (5px)
  await page.mouse.move(handleCenter.x, handleCenter.y + 10, { steps: 3 })

  // 5. Move to the target position
  let targetY
  if (position === "before") {
    targetY = targetBox.y + 2 // top edge
  } else if (position === "inside") {
    targetY = targetBox.y + targetBox.height / 2 // center
  } else {
    targetY = targetBox.y + targetBox.height - 2 // bottom edge
  }
  const targetX = targetBox.x + offsetX

  await page.mouse.move(targetX, targetY, { steps: 5 })
  await page.waitForTimeout(50) // let the RAF update the drop indicator

  // 6. Release
  await page.mouse.up()
  await page.waitForTimeout(100) // let the editor update settle
}

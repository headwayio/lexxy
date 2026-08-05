import { test } from "../../test_helper.js"
import { expect } from "@playwright/test"

test("dynamically created editor renders assigned value", async ({ page }) => {
  await page.goto("/index.html")
  await page.waitForSelector("lexxy-editor[connected]")

  await page.evaluate(async () => {
    const wrap = document.createElement("div")
    wrap.id = "dyn-wrap"
    const editor = document.createElement("lexxy-editor")
    editor.id = "dyn-editor"
    editor.setAttribute("toolbar", "true")
    wrap.appendChild(editor)
    document.body.appendChild(wrap)
    await new Promise(r => setTimeout(r, 800))
    editor.value = "<p>dynamic probe</p>"
  })

  await expect(page.locator("#dyn-editor .lexxy-editor__content p")).toHaveText("dynamic probe", { timeout: 5_000 })
})

test("editor survives being moved to another parent", async ({ page }) => {
  await page.goto("/index.html")
  await page.waitForSelector("lexxy-editor[connected]")

  await page.evaluate(async () => {
    const wrap = document.createElement("div")
    wrap.id = "dyn-wrap"
    const editor = document.createElement("lexxy-editor")
    editor.id = "dyn-editor"
    editor.setAttribute("toolbar", "true")
    wrap.appendChild(editor)
    document.body.appendChild(wrap)
    await new Promise(r => setTimeout(r, 800))

    const newHome = document.createElement("div")
    newHome.id = "new-home"
    document.body.appendChild(newHome)
    newHome.appendChild(editor)
    await new Promise(r => setTimeout(r, 800))
    editor.value = "<p>after the move</p>"
  })

  await expect(page.locator("#dyn-editor .lexxy-editor__content p")).toHaveText("after the move", { timeout: 5_000 })
})

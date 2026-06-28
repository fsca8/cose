// 通用平台工具函数

/**
 * 注入通用工具函数到页面主世界
 * 此函数会在页面中定义 window.waitFor 和 window.setInputValue
 */
function injectCommonUtils() {
  // 等待元素出现的工具函数（使用 MutationObserver）
  window.waitFor = (selector, timeout = 10000) => {
    return new Promise(resolve => {
      const el = document.querySelector(selector)
      if (el) return resolve(el)

      const observer = new MutationObserver(() => {
        const el = document.querySelector(selector)
        if (el) {
          observer.disconnect()
          resolve(el)
        }
      })
      observer.observe(document.body, { childList: true, subtree: true })

      setTimeout(() => {
        observer.disconnect()
        resolve(document.querySelector(selector))
      }, timeout)
    })
  }

  // 设置输入值的工具函数
  window.setInputValue = (el, value) => {
    if (!el || !value) return
    el.focus()
    if (el.tagName === 'TEXTAREA' || el.tagName === 'INPUT') {
      // 使用 native setter 确保 React/Vue 等框架能检测到变化
      const nativeSetter =
        Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value')?.set ||
        Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set
      if (nativeSetter) {
        nativeSetter.call(el, value)
      } else {
        el.value = value
      }
      el.dispatchEvent(new Event('input', { bubbles: true }))
      el.dispatchEvent(new Event('change', { bubbles: true }))
    } else if (el.contentEditable === 'true') {
      el.innerHTML = value.replace(/\n/g, '<br>')
      el.dispatchEvent(new Event('input', { bubbles: true }))
    }
  }

  // 将 data URL 转为 File 对象
  window.dataUrlToFile = (dataUrl, filename) => {
    const [header, data] = dataUrl.split(',')
    const mime = header.match(/:(.*?);/)[1]
    const binary = atob(data)
    const array = new Uint8Array(binary.length)
    for (let i = 0; i < binary.length; i++) {
      array[i] = binary.charCodeAt(i)
    }
    return new File([array], filename || 'image.png', { type: mime })
  }

  // 将图片文件粘贴到编辑器，触发平台自动上传
  window.pasteImageFile = async (editor, file, waitMs = 800) => {
    editor.focus()

    // 先删除当前选中的内容（避免重复插入）
    const sel = window.getSelection()
    if (sel && sel.rangeCount > 0 && !sel.isCollapsed) {
      sel.deleteFromDocument()
    }

    const dt = new DataTransfer()
    dt.items.add(file)
    const pasteEvent = new ClipboardEvent('paste', {
      bubbles: true,
      cancelable: true,
      clipboardData: dt,
    })
    editor.dispatchEvent(pasteEvent)
    await new Promise(resolve => setTimeout(resolve, waitMs))
  }

  // 解析 Markdown 为 text/image 交替片段（含 alt 文本）
  window.parseMarkdownSegments = (markdown) => {
    if (!markdown) return []
    const segments = []
    const regex = /\!\[([^\]]*)\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g
    let lastIndex = 0
    let match
    while ((match = regex.exec(markdown)) !== null) {
      if (match.index > lastIndex) {
        segments.push({ type: 'text', content: markdown.slice(lastIndex, match.index) })
      }
      segments.push({ type: 'image', url: match[2], alt: match[1] || '' })
      lastIndex = regex.lastIndex
    }
    if (lastIndex < markdown.length) {
      segments.push({ type: 'text', content: markdown.slice(lastIndex) })
    }
    return segments
  }

  // 注入 HTML 内容到编辑器，自动处理图片（剥离→注入文本→逐个粘贴图片）
  // 返回 { wordCount, imageCount }
  window.injectHtmlWithImages = async (editor, htmlBody, imageCache) => {
    const { strippedHtml, images: imageInfos } = window.stripImagesFromHtml(htmlBody)
    const hasImages = imageInfos.length > 0
    const injectHtml = hasImages ? strippedHtml : htmlBody

    // 注入 HTML（不含图片，避免 data URL 被转为 blob URL）
    const dt = new DataTransfer()
    dt.setData('text/html', injectHtml)
    dt.setData('text/plain', injectHtml.replace(/<[^>]*>/g, ''))
    const pasteEvent = new ClipboardEvent('paste', {
      bubbles: true, cancelable: true, clipboardData: dt,
    })
    editor.dispatchEvent(pasteEvent)
    await new Promise(r => setTimeout(r, 500))

    // 降级：如果 paste 未生效，用 innerHTML
    const wordCount = editor.textContent?.length || 0
    if (wordCount === 0) {
      editor.innerHTML = injectHtml
      editor.dispatchEvent(new Event('input', { bubbles: true }))
    }

    // 逐个插入图片
    let imageCount = 0
    if (hasImages && imageCache) {
      imageCount = await window.insertImagesAtPlaceholders(editor, imageInfos, imageCache)
    }

    return { wordCount: editor.textContent?.length || 0, imageCount }
  }

  // 从 HTML 中剥离图片标签，替换为文本占位符
  window.stripImagesFromHtml = (html) => {
    if (!html) return { strippedHtml: html, images: [] }
    const images = []
    let idx = 0
    const strippedHtml = html.replace(/<img[^>]*>/gi, (match) => {
      const srcMatch = match.match(/src=["']([^"']+)["']/i)
      const altMatch = match.match(/alt=["']([^"']*)["']/i)
      const src = srcMatch ? srcMatch[1] : ''
      const alt = altMatch ? altMatch[1] : ''
      const placeholder = `[COSE_IMG_${idx}]`
      images.push({ placeholder, src, alt, originalTag: match })
      idx++
      return placeholder
    })
    return { strippedHtml, images }
  }

  // 在占位符位置逐个插入图片（File 粘贴）
  window.insertImagesAtPlaceholders = async (editor, imageInfos, imageCache) => {
    if (!imageInfos || imageInfos.length === 0 || !imageCache) return 0
    let count = 0
    for (let i = 0; i < imageInfos.length; i++) {
      const { placeholder, src, alt } = imageInfos[i]
      const cached = imageCache[src]
      if (!cached) continue
      try {
        const file = window.dataUrlToFile(cached.dataUrl, cached.filename)
        const imgsBefore = editor.querySelectorAll('img').length
        const walker = document.createTreeWalker(editor, NodeFilter.SHOW_TEXT)
        let phNode = null
        while (walker.nextNode()) {
          if (walker.currentNode.textContent.includes(placeholder)) {
            phNode = walker.currentNode
            break
          }
        }
        if (phNode) {
          const range = document.createRange()
          const idx = phNode.textContent.indexOf(placeholder)
          range.setStart(phNode, idx)
          range.setEnd(phNode, idx + placeholder.length)
          const sel = window.getSelection()
          sel.removeAllRanges()
          sel.addRange(range)
          sel.deleteFromDocument()
          await new Promise(r => setTimeout(r, 300))
          await window.pasteImageFile(editor, file)
        } else {
          await window.pasteImageFile(editor, file)
        }
        if (alt) {
          const allImgs = Array.from(editor.querySelectorAll('img'))
          const newImg = allImgs[imgsBefore]
          if (newImg && !newImg.alt) newImg.alt = alt
        }
        count++
      } catch (err) {
        console.warn(`[COSE] 图片插入失败:`, err.message)
      }
      await new Promise(r => setTimeout(r, 500))
    }
    return count
  }

  return true
}

/**
 * 在页面中注入通用工具函数
 * @param {object} chrome - Chrome API 对象
 * @param {number} tabId - 目标 tab ID
 * @returns {Promise<void>}
 */
async function injectUtils(chrome, tabId) {
  await chrome.scripting.executeScript({
    target: { tabId },
    func: injectCommonUtils,
    world: 'MAIN',
  })
}

/**
 * 将 Markdown 解析为 text/image 交替的片段
 * @param {string} markdown
 * @returns {Array<{type: 'text', content?: string, url?: string}>}
 */
function parseMarkdownSegments(markdown) {
  if (!markdown) return []
  const segments = []
  const regex = /\!\[([^\]]*)\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g
  let lastIndex = 0
  let match
  while ((match = regex.exec(markdown)) !== null) {
    if (match.index > lastIndex) {
      segments.push({ type: 'text', content: markdown.slice(lastIndex, match.index) })
    }
    segments.push({ type: 'image', url: match[2], alt: match[1] || '' })
    lastIndex = regex.lastIndex
  }
  if (lastIndex < markdown.length) {
    segments.push({ type: 'text', content: markdown.slice(lastIndex) })
  }
  return segments
}

/**
 * 将 data URL 转为 File 对象（在页面 MAIN world 中执行）
 * @param {string} dataUrl
 * @param {string} filename
 * @returns {File}
 */
function dataUrlToFile(dataUrl, filename) {
  const [header, data] = dataUrl.split(',')
  const mime = header.match(/:(.*?);/)[1]
  const binary = atob(data)
  const array = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) {
    array[i] = binary.charCodeAt(i)
  }
  return new File([array], filename || 'image.png', { type: mime })
}

/**
 * 将图片文件粘贴到编辑器，触发平台自动上传（在页面 MAIN world 中执行）
 * @param {Element} editor - 编辑器元素
 * @param {File} file - 图片文件
 * @param {number} waitMs - 粘贴后等待时间
 */
async function pasteImageFile(editor, file, waitMs = 800) {
  editor.focus()

  // 先删除当前选中的内容（避免重复插入）
  const selection = window.getSelection()
  if (selection && selection.rangeCount > 0 && !selection.isCollapsed) {
    selection.deleteFromDocument()
    // 等待编辑器完成删除事务
    await new Promise(resolve => setTimeout(resolve, 300))
  }

  const dt = new DataTransfer()
  dt.items.add(file)
  const pasteEvent = new ClipboardEvent('paste', {
    bubbles: true,
    cancelable: true,
    clipboardData: dt,
  })
  editor.dispatchEvent(pasteEvent)
  await new Promise(resolve => setTimeout(resolve, waitMs))
}

// 导出
export { injectCommonUtils, injectUtils, parseMarkdownSegments, dataUrlToFile, pasteImageFile }

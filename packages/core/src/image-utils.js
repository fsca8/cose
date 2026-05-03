/**
 * 图片处理工具函数
 * 用于在同步到各平台前，下载外部图片并缓存
 */

/**
 * 判断是否为有效的图片 URL（包括外部 URL 和 data URL）
 */
function isValidImageUrl(url) {
  if (!url) return false
  if (url.startsWith('data:image/')) return true
  if (url.startsWith('http://') || url.startsWith('https://')) return true
  return false
}

/**
 * 从 Markdown 文本中提取图片 URL
 */
function extractImageUrlsFromMarkdown(markdown) {
  if (!markdown) return []
  const regex = /!\[[^\]]*\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g
  const urls = new Set()
  let match
  while ((match = regex.exec(markdown)) !== null) {
    const url = match[1]
    if (isValidImageUrl(url)) {
      urls.add(url)
    }
  }
  return [...urls]
}

/**
 * 从 HTML 文本中提取图片 URL
 */
function extractImageUrlsFromHtml(html) {
  if (!html) return []
  const regex = /<img[^>]+src=["']([^"']+)["'][^>]*>/gi
  const urls = new Set()
  let match
  while ((match = regex.exec(html)) !== null) {
    const url = match[1]
    if (isValidImageUrl(url)) {
      urls.add(url)
    }
  }
  return [...urls]
}

/**
 * 从 content 对象中提取所有图片 URL（去重）
 */
function extractAllImageUrls(content) {
  const allUrls = new Set()
  extractImageUrlsFromMarkdown(content.markdown).forEach(url => allUrls.add(url))
  extractImageUrlsFromHtml(content.body).forEach(url => allUrls.add(url))
  extractImageUrlsFromHtml(content.wechatHtml).forEach(url => allUrls.add(url))
  return [...allUrls]
}

/**
 * 从 content 中提取所有 data URL 图片
 */
function extractDataUrlImages(content) {
  const dataUrls = new Set()
  for (const source of [content.markdown, content.body, content.wechatHtml]) {
    if (!source) continue
    const regex = /data:image\/[a-zA-Z]+;base64,[A-Za-z0-9+/=]+/g
    let match
    while ((match = regex.exec(source)) !== null) {
      dataUrls.add(match[0])
    }
  }
  return [...dataUrls]
}

/**
 * 下载图片
 */
async function downloadImage(url, timeout = 15000) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeout)

  try {
    const response = await fetch(url, {
      signal: controller.signal,
      referrerPolicy: 'no-referrer',
    })
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`)
    }
    const blob = await response.blob()
    const mimeType = blob.type || 'image/png'
    const filename = getFilenameFromUrl(url) || `image-${Date.now()}.png`
    return { blob, filename, mimeType }
  } catch (err) {
    console.warn(`[COSE] 直接下载失败 ${url}: ${err.message}, 尝试代理...`)
    try {
      const proxyUrl = `https://wsrv.nl/?url=${encodeURIComponent(url)}`
      const proxyResponse = await fetch(proxyUrl, { signal: controller.signal })
      if (!proxyResponse.ok) {
        throw new Error(`Proxy HTTP ${proxyResponse.status}`)
      }
      const blob = await proxyResponse.blob()
      const mimeType = blob.type || 'image/png'
      const filename = getFilenameFromUrl(url) || `image-${Date.now()}.png`
      return { blob, filename, mimeType }
    } catch (proxyErr) {
      throw new Error(`图片下载失败: ${err.message} (代理也失败: ${proxyErr.message})`)
    }
  } finally {
    clearTimeout(timer)
  }
}

/**
 * 从 URL 中提取文件名
 */
function getFilenameFromUrl(url) {
  try {
    const pathname = new URL(url).pathname
    const segments = pathname.split('/')
    const last = segments[segments.length - 1]
    return last && last.includes('.') ? last : null
  } catch {
    return null
  }
}

/**
 * 批量下载 content 中的所有外部图片
 * @param {object} content - { title, body, markdown, wechatHtml }
 * @param {number} concurrency - 并发下载数
 * @param {Set<string>} skipUrls - 跳过已有缓存的 URL
 */
async function downloadAllImages(content, concurrency = 3, skipUrls = new Set()) {
  const imageUrls = extractAllImageUrls(content).filter(url => !url.startsWith('data:') && !skipUrls.has(url))
  const cache = new Map()

  if (imageUrls.length === 0) {
    console.log('[COSE] 内容中没有外部图片，跳过下载')
    return cache
  }

  console.log(`[COSE] 发现 ${imageUrls.length} 张外部图片，开始批量下载...`)

  for (let i = 0; i < imageUrls.length; i += concurrency) {
    const batch = imageUrls.slice(i, i + concurrency)
    const results = await Promise.allSettled(
      batch.map(async (url) => {
        try {
          const result = await downloadImage(url)
          console.log(`[COSE] 已下载: ${result.filename} (${(result.blob.size / 1024).toFixed(1)}KB)`)
          return { url, result }
        } catch (err) {
          console.warn(`[COSE] 下载失败 ${url}: ${err.message}`)
          return null
        }
      })
    )

    for (const r of results) {
      if (r.status === 'fulfilled' && r.value) {
        cache.set(r.value.url, r.value.result)
      }
    }
  }

  console.log(`[COSE] 图片下载完成: ${cache.size}/${imageUrls.length} 成功`)
  return cache
}

/**
 * 将 Blob 转为 base64 data URL
 */
async function blobToDataUrl(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result)
    reader.onerror = reject
    reader.readAsDataURL(blob)
  })
}

/**
 * 将图片缓存转为可序列化的对象
 */
async function serializeImageCache(cache) {
  const serialized = {}
  for (const [url, { blob, filename, mimeType }] of cache) {
    serialized[url] = {
      dataUrl: await blobToDataUrl(blob),
      filename,
      mimeType,
    }
  }
  return serialized
}

/**
 * 去除 HTML 中图片的 data URL src，避免平台自动上传 data URL 导致重复
 */
function stripDataUrlImages(html) {
  if (!html) return html
  return html.replace(/<img([^>]*?)src="data:image\/[^"]*"([^>]*?)>/g, '<img$1$2>')
}

/**
 * 通过模拟粘贴事件将编辑器中的外部图片替换为平台本地上传
 * 在 chrome.scripting.executeScript 的 world: 'MAIN' 中执行
 */
async function replaceImagesViaPasteInPage(imageCache) {
  const results = { total: 0, replaced: 0, failed: 0, errors: [] }

  function isExternalUrl(url) {
    if (!url) return false
    if (url.startsWith('blob:')) return false
    return url.startsWith('http://') || url.startsWith('https://') || url.startsWith('data:image/')
  }

  function findEditableAncestor(el) {
    let node = el
    while (node && node !== document.body) {
      if (node.contentEditable === 'true') return node
      if (node.tagName === 'TEXTAREA' || (node.tagName === 'INPUT' && node.type === 'text')) return node
      node = node.parentElement
    }
    return document.querySelector('.ProseMirror') ||
      document.querySelector('[contenteditable="true"]') ||
      document.querySelector('.DraftEditor-root') ||
      document.querySelector('.public-DraftEditor-content') ||
      null
  }

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

  async function urlToFile(url) {
    const response = await fetch(url, { referrerPolicy: 'no-referrer' })
    if (!response.ok) throw new Error(`fetch ${url} failed: HTTP ${response.status}`)
    const blob = await response.blob()
    const ext = blob.type.split('/')[1] || 'png'
    const filename = `image-${Date.now()}.${ext}`
    return new File([blob], filename, { type: blob.type })
  }

  function waitForNewPlatformImage(editor, originalSrc, timeout = 15000) {
    return new Promise((resolve) => {
      const startTime = Date.now()
      const check = () => {
        const imgs = editor.querySelectorAll('img')
        for (const i of imgs) {
          if (i.src !== originalSrc && isExternalUrl(i.src) && !i.src.startsWith('data:')) {
            resolve(i.src)
            return
          }
        }
        if (Date.now() - startTime < timeout) {
          setTimeout(check, 300)
        } else {
          resolve(null)
        }
      }
      setTimeout(check, 800)
    })
  }

  const initialImages = Array.from(document.querySelectorAll('img')).filter(img => isExternalUrl(img.src))
  results.total = initialImages.length

  if (initialImages.length === 0) {
    console.log('[COSE] 编辑器中未发现外部图片')
    return results
  }

  console.log(`[COSE] 发现 ${initialImages.length} 张外部图片，开始粘贴替换...`)

  const processedSrcs = new Set()
  let processedCount = 0

  while (processedCount < results.total) {
    const currentImages = Array.from(document.querySelectorAll('img')).filter(img => isExternalUrl(img.src))
    const img = currentImages.find(i => !processedSrcs.has(i.src))

    if (!img) {
      console.log('[COSE] 没有更多待处理的图片')
      break
    }

    const originalSrc = img.src
    processedSrcs.add(originalSrc)

    try {
      let file
      if (imageCache && imageCache[originalSrc]) {
        const cached = imageCache[originalSrc]
        file = dataUrlToFile(cached.dataUrl, cached.filename)
        console.log(`[COSE] 使用缓存图片: ${cached.filename} (${(file.size / 1024).toFixed(1)}KB)`)
      } else {
        file = await urlToFile(originalSrc)
        console.log(`[COSE] 已下载图片: ${file.name} (${(file.size / 1024).toFixed(1)}KB)`)
      }

      const editor = findEditableAncestor(img)
      if (!editor) {
        console.warn('[COSE] 未找到可编辑区域，跳过:', originalSrc)
        results.failed++
        results.errors.push(`未找到编辑器区域: ${originalSrc}`)
        processedCount++
        continue
      }

      editor.focus()
      const range = document.createRange()
      range.selectNode(img)
      const selection = window.getSelection()
      selection.removeAllRanges()
      selection.addRange(range)
      selection.deleteFromDocument()

      await new Promise(resolve => setTimeout(resolve, 300))

      const dt = new DataTransfer()
      dt.items.add(file)
      const pasteEvent = new ClipboardEvent('paste', {
        bubbles: true,
        cancelable: true,
        clipboardData: dt,
      })
      editor.dispatchEvent(pasteEvent)

      const newUrl = await waitForNewPlatformImage(editor, originalSrc, 20000)
      if (newUrl) {
        console.log(`[COSE] 图片已替换: ${originalSrc.substring(0, 60)}... → ${newUrl.substring(0, 60)}...`)
        results.replaced++
      } else {
        const stillExists = document.contains(img)
        if (!stillExists) {
          console.log(`[COSE] 图片已移除，视为替换成功: ${originalSrc.substring(0, 60)}...`)
          results.replaced++
        } else {
          console.warn(`[COSE] 图片粘贴后未变化: ${originalSrc}`)
          results.failed++
          results.errors.push(`粘贴未触发上传: ${originalSrc}`)
        }
      }
    } catch (err) {
      console.warn(`[COSE] 图片处理失败: ${originalSrc}`, err.message)
      results.failed++
      results.errors.push(`${originalSrc}: ${err.message}`)
    }

    processedCount++
    await new Promise(resolve => setTimeout(resolve, 500))
  }

  console.log(`[COSE] 图片粘贴替换完成: ${results.replaced}/${results.total} 成功, ${results.failed} 失败`)
  return results
}

/**
 * 通过 chrome.scripting 注入粘贴替换脚本到平台 tab
 */
async function replaceImagesViaPaste(tabId, chrome, imageCache) {
  try {
    const result = await chrome.scripting.executeScript({
      target: { tabId },
      func: replaceImagesViaPasteInPage,
      args: [imageCache || null],
      world: 'MAIN',
    })
    return result?.[0]?.result || { total: 0, replaced: 0, failed: 0 }
  } catch (err) {
    console.warn('[COSE] 粘贴替换脚本注入失败:', err.message)
    return { total: 0, replaced: 0, failed: 0, errors: [err.message] }
  }
}

// 导出
export {
  extractDataUrlImages,
  downloadAllImages,
  serializeImageCache,
  replaceImagesViaPaste,
  stripDataUrlImages,
}

/**
 * 图片处理工具函数
 * 用于在同步到各平台前，将外部图片 URL 替换为平台自身的图片 URL
 */

/**
 * 从 Markdown 文本中提取图片 URL
 * @param {string} markdown - Markdown 文本
 * @returns {string[]} 去重后的图片 URL 数组
 */
function extractImageUrlsFromMarkdown(markdown) {
  if (!markdown) return []
  // 匹配 ![alt](url) 语法，支持带标题的 ![alt](url "title")
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
 * @param {string} html - HTML 文本
 * @returns {string[]} 去重后的图片 URL 数组
 */
function extractImageUrlsFromHtml(html) {
  if (!html) return []
  // 匹配 <img src="url"> 或 <img src='url'>
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
 * @param {object} content - { title, body, markdown, wechatHtml }
 * @returns {string[]} 去重后的图片 URL 数组
 */
function extractAllImageUrls(content) {
  const allUrls = new Set()
  extractImageUrlsFromMarkdown(content.markdown).forEach(url => allUrls.add(url))
  extractImageUrlsFromHtml(content.body).forEach(url => allUrls.add(url))
  extractImageUrlsFromHtml(content.wechatHtml).forEach(url => allUrls.add(url))
  return [...allUrls]
}

/**
 * 判断是否为有效的图片 URL（包括外部 URL 和 data URL）
 * @param {string} url
 * @returns {boolean}
 */
function isValidImageUrl(url) {
  if (!url) return false
  if (url.startsWith('data:image/')) return true
  if (url.startsWith('http://') || url.startsWith('https://')) return true
  return false
}

/**
 * 从 content 中提取所有 data URL 图片
 * @param {object} content - { title, body, markdown, wechatHtml }
 * @returns {string[]} data URL 数组
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
 * @param {string} url - 图片 URL
 * @param {number} timeout - 超时时间（毫秒）
 * @returns {Promise<{blob: Blob, filename: string, mimeType: string}>}
 */
async function downloadImage(url, timeout = 15000) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeout)

  try {
    // 直接请求（service worker 无 CORS 限制）
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
    // 尝试 wsrv.nl 代理
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
 * @param {string} url
 * @returns {string|null}
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
 * 替换 Markdown 中的图片 URL
 * @param {string} markdown - 原始 Markdown
 * @param {Map<string, string>} urlMap - 旧 URL → 新 URL 映射
 * @returns {string} 替换后的 Markdown
 */
function replaceMarkdownImageUrls(markdown, urlMap) {
  if (!markdown || urlMap.size === 0) return markdown
  let result = markdown
  for (const [oldUrl, newUrl] of urlMap) {
    // 转义 URL 中的特殊正则字符
    const escaped = oldUrl.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    result = result.replace(new RegExp(escaped, 'g'), newUrl)
  }
  return result
}

/**
 * 替换 HTML 中的图片 URL
 * @param {string} html - 原始 HTML
 * @param {Map<string, string>} urlMap - 旧 URL → 新 URL 映射
 * @returns {string} 替换后的 HTML
 */
function replaceHtmlImageUrls(html, urlMap) {
  if (!html || urlMap.size === 0) return html
  let result = html
  for (const [oldUrl, newUrl] of urlMap) {
    const escaped = oldUrl.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    result = result.replace(new RegExp(escaped, 'g'), newUrl)
  }
  return result
}

/**
 * 处理 content 中的图片：提取 → 下载 → 上传 → 替换
 * @param {object} content - { title, body, markdown, wechatHtml }
 * @param {function} uploadFn - async (blob, filename) => newUrl（平台特定上传函数）
 * @param {number} concurrency - 并发下载数
 * @returns {Promise<object>} 处理后的 content
 */
async function processContentImages(content, uploadFn, concurrency = 3) {
  const imageUrls = extractAllImageUrls(content)
  if (imageUrls.length === 0) {
    console.log('[COSE] 内容中没有外部图片，跳过图片处理')
    return content
  }

  console.log(`[COSE] 发现 ${imageUrls.length} 张外部图片，开始处理...`)

  // 并发下载并上传
  const urlMap = new Map()

  // 分批处理，控制并发
  for (let i = 0; i < imageUrls.length; i += concurrency) {
    const batch = imageUrls.slice(i, i + concurrency)
    const results = await Promise.allSettled(
      batch.map(async (url) => {
        try {
          console.log(`[COSE] 下载图片: ${url}`)
          const { blob, filename } = await downloadImage(url)
          console.log(`[COSE] 上传图片: ${filename} (${(blob.size / 1024).toFixed(1)}KB)`)
          const newUrl = await uploadFn(blob, filename)
          if (newUrl && newUrl !== url) {
            console.log(`[COSE] 图片已替换: ${url.substring(0, 60)}... → ${newUrl.substring(0, 60)}...`)
            return { oldUrl: url, newUrl }
          }
          return null
        } catch (err) {
          console.warn(`[COSE] 图片处理失败 ${url}: ${err.message}`)
          return null
        }
      })
    )

    for (const result of results) {
      if (result.status === 'fulfilled' && result.value) {
        urlMap.set(result.value.oldUrl, result.value.newUrl)
      }
    }
  }

  if (urlMap.size === 0) {
    console.log('[COSE] 没有图片被成功替换')
    return content
  }

  console.log(`[COSE] 成功替换 ${urlMap.size}/${imageUrls.length} 张图片`)

  // 替换 content 中的 URL
  return {
    ...content,
    markdown: replaceMarkdownImageUrls(content.markdown, urlMap),
    body: replaceHtmlImageUrls(content.body, urlMap),
    wechatHtml: content.wechatHtml ? replaceHtmlImageUrls(content.wechatHtml, urlMap) : content.wechatHtml,
  }
}

/**
 * 通过模拟粘贴事件将编辑器中的外部图片替换为平台本地上传
 * 在 chrome.scripting.executeScript 的 world: 'MAIN' 中执行
 *
 * @param {Object} imageCache - 预下载的图片缓存 { url: { dataUrl, filename, mimeType } }
 *   如果不提供，则在页面中直接 fetch 下载
 * @returns {{ total: number, replaced: number, failed: number, errors: string[] }}
 */
async function replaceImagesViaPasteInPage(imageCache) {
  const results = { total: 0, replaced: 0, failed: 0, errors: [] }

  function isExternalUrl(url) {
    if (!url) return false
    if (url.startsWith('blob:')) return false
    return url.startsWith('http://') || url.startsWith('https://') || url.startsWith('data:image/')
  }

  // 找到包含图片的可编辑区域
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

  // 将 dataUrl 转为 File 对象
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

  // 直接从 URL 下载为 File（无缓存时的降级方案）
  async function urlToFile(url) {
    const response = await fetch(url, { referrerPolicy: 'no-referrer' })
    if (!response.ok) throw new Error(`fetch ${url} failed: HTTP ${response.status}`)
    const blob = await response.blob()
    const ext = blob.type.split('/')[1] || 'png'
    const filename = `image-${Date.now()}.${ext}`
    return new File([blob], filename, { type: blob.type })
  }

  // 等待编辑器中出现新的外部图片（平台上传后返回的 URL）
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

  // 统计初始图片数量
  const initialImages = Array.from(document.querySelectorAll('img')).filter(img => isExternalUrl(img.src))
  results.total = initialImages.length

  if (initialImages.length === 0) {
    console.log('[COSE] 编辑器中未发现外部图片')
    return results
  }

  console.log(`[COSE] 发现 ${initialImages.length} 张外部图片，开始粘贴替换...`)

  // 每次重新查询，始终处理第一张，避免 DOM 变动导致引用失效
  const processedSrcs = new Set()
  let processedCount = 0

  while (processedCount < results.total) {
    // 每轮重新获取当前 DOM 中的外部图片
    const currentImages = Array.from(document.querySelectorAll('img')).filter(img => isExternalUrl(img.src))
    const img = currentImages.find(i => !processedSrcs.has(i.src))

    if (!img) {
      console.log('[COSE] 没有更多待处理的图片')
      break
    }

    const originalSrc = img.src
    processedSrcs.add(originalSrc)

    try {
      // 1. 获取图片 File 对象（优先用缓存，降级直接下载）
      let file
      if (imageCache && imageCache[originalSrc]) {
        const cached = imageCache[originalSrc]
        file = dataUrlToFile(cached.dataUrl, cached.filename)
        console.log(`[COSE] 使用缓存图片: ${cached.filename} (${(file.size / 1024).toFixed(1)}KB)`)
      } else {
        file = await urlToFile(originalSrc)
        console.log(`[COSE] 已下载图片: ${file.name} (${(file.size / 1024).toFixed(1)}KB)`)
      }

      // 2. 找到编辑器区域
      const editor = findEditableAncestor(img)
      if (!editor) {
        console.warn('[COSE] 未找到可编辑区域，跳过:', originalSrc)
        results.failed++
        results.errors.push(`未找到编辑器区域: ${originalSrc}`)
        processedCount++
        continue
      }

      // 3. 选中图片并删除（避免粘贴时重复插入）
      editor.focus()
      const range = document.createRange()
      range.selectNode(img)
      const selection = window.getSelection()
      selection.removeAllRanges()
      selection.addRange(range)
      selection.deleteFromDocument()

      // 等待 ProseMirror 完成删除事务，避免 TransformError
      await new Promise(resolve => setTimeout(resolve, 300))

      // 4. 构建包含图片文件的 DataTransfer 并触发粘贴
      const dt = new DataTransfer()
      dt.items.add(file)
      const pasteEvent = new ClipboardEvent('paste', {
        bubbles: true,
        cancelable: true,
        clipboardData: dt,
      })
      editor.dispatchEvent(pasteEvent)

      // 5. 等待平台处理（上传并替换图片）
      const newUrl = await waitForNewPlatformImage(editor, originalSrc, 20000)
      if (newUrl) {
        console.log(`[COSE] 图片已替换: ${originalSrc.substring(0, 60)}... → ${newUrl.substring(0, 60)}...`)
        results.replaced++
      } else {
        const stillExists = document.contains(img)
        if (!stillExists) {
          // 图片已从 DOM 移除，视为成功（平台可能正在上传）
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

    // 等待 ProseMirror 完成粘贴事务，再处理下一张图片
    await new Promise(resolve => setTimeout(resolve, 500))
  }

  console.log(`[COSE] 图片粘贴替换完成: ${results.replaced}/${results.total} 成功, ${results.failed} 失败`)
  return results
}

/**
 * 通过 chrome.scripting 注入粘贴替换脚本到平台 tab
 * @param {number} tabId
 * @param {object} chrome
 * @param {Object} [imageCache] - 预下载的图片缓存（可序列化对象）
 * @returns {Promise<{ total: number, replaced: number, failed: number }>}
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

/**
 * 批量下载 content 中的所有外部图片（只下载一次，供所有平台复用）
 * 在 background service worker 中执行（无 CORS 限制）
 * @param {object} content - { title, body, markdown, wechatHtml }
 * @param {number} concurrency - 并发下载数
 * @returns {Promise<Map<string, {blob: Blob, filename: string, mimeType: string}>>} url → 下载结果
 */
async function downloadAllImages(content, concurrency = 3) {
  const imageUrls = extractAllImageUrls(content).filter(url => !url.startsWith('data:'))
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
 * 将 Blob 转为 base64 data URL（用于跨上下文传递）
 * @param {Blob} blob
 * @returns {Promise<string>}
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
 * 将图片缓存转为可序列化的对象（用于传递到 content script / page context）
 * @param {Map<string, {blob: Blob, filename: string, mimeType: string}>} cache
 * @returns {Promise<Object>} { url: { dataUrl, filename, mimeType } }
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
 * 保留 <img> 标签本身，只清空 src 属性，后续通过 paste 替换插入实际图片
 * @param {string} html
 * @returns {string}
 */
function stripDataUrlImages(html) {
  if (!html) return html
  return html.replace(/<img([^>]*?)src="data:image\/[^"]*"([^>]*?)>/g, '<img$1$2>')
}

/**
 * 从 IndexedDB 读取图片 blob（在页面 MAIN world 中执行）
 * @param {string} key - IndexedDB key
 * @returns {Promise<Blob|null>}
 */
async function getImageFromIndexedDB(key) {
  return new Promise((resolve) => {
    const request = indexedDB.open('md-images', 1)
    request.onerror = () => resolve(null)
    request.onsuccess = () => {
      const db = request.result
      if (!db.objectStoreNames.contains('images')) {
        db.close()
        return resolve(null)
      }
      const tx = db.transaction('images', 'readonly')
      const store = tx.objectStore('images')
      const getReq = store.get(key)
      getReq.onsuccess = () => {
        db.close()
        resolve(getReq.result?.blob ?? null)
      }
      getReq.onerror = () => {
        db.close()
        resolve(null)
      }
    }
  })
}

const INDEXEDDB_URL_REGEX = /indexeddb:\/\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/g

/**
 * 从内容中提取所有 indexeddb:// URL
 * @param {object} content - { markdown, body, wechatHtml }
 * @returns {string[]} indexeddb:// URL 数组
 */
function extractIndexedDbUrls(content) {
  const urls = new Set()
  for (const source of [content.markdown, content.body, content.wechatHtml]) {
    if (!source) continue
    let match
    const re = new RegExp(INDEXEDDB_URL_REGEX.source, 'g')
    while ((match = re.exec(source)) !== null) {
      urls.add(match[0])
    }
  }
  return [...urls]
}

/**
 * 解析内容中的 indexeddb:// URL 为 data URL（在页面 MAIN world 中执行）
 * 同时构建 imageCache 供平台 handler 使用
 * @param {object} content - { markdown, body, wechatHtml }
 * @returns {Promise<{content: object, imageCache: object}>}
 */
async function resolveIndexedDbImages(content) {
  const indexedDbUrls = extractIndexedDbUrls(content)
  if (indexedDbUrls.length === 0) {
    return { content, imageCache: {} }
  }

  console.log(`[COSE] 发现 ${indexedDbUrls.length} 张 IndexedDB 图片，开始解析...`)

  const resolved = new Map()
  for (const url of indexedDbUrls) {
    const key = url.replace('indexeddb://', '')
    try {
      const blob = await getImageFromIndexedDB(key)
      if (blob) {
        const dataUrl = await blobToDataUrl(blob)
        resolved.set(url, dataUrl)
      }
    } catch {
      // skip
    }
  }

  if (resolved.size === 0) {
    return { content, imageCache: {} }
  }

  // Replace indexeddb:// URLs in all content fields
  const result = { ...content }
  for (const field of ['markdown', 'body', 'wechatHtml']) {
    if (!result[field]) continue
    for (const [indexedDbUrl, dataUrl] of resolved) {
      result[field] = result[field].split(indexedDbUrl).join(dataUrl)
    }
  }

  // Build imageCache keyed by data URL
  const imageCache = {}
  for (const [, dataUrl] of resolved) {
    const ext = dataUrl.match(/image\/([a-zA-Z]+)/)?.[1] || 'png'
    imageCache[dataUrl] = { dataUrl, filename: `image.${ext}`, mimeType: `image/${ext}` }
  }

  console.log(`[COSE] IndexedDB 图片解析完成: ${resolved.size}/${indexedDbUrls.length} 张`)
  return { content: result, imageCache }
}

// 导出
export {
  extractImageUrlsFromMarkdown,
  extractImageUrlsFromHtml,
  extractAllImageUrls,
  extractDataUrlImages,
  isValidImageUrl,
  downloadImage,
  downloadAllImages,
  blobToDataUrl,
  serializeImageCache,
  replaceMarkdownImageUrls,
  replaceHtmlImageUrls,
  processContentImages,
  replaceImagesViaPaste,
  stripDataUrlImages,
  extractIndexedDbUrls,
  getImageFromIndexedDB,
  resolveIndexedDbImages,
}

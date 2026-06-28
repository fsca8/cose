// 今日头条平台配置
const ToutiaoPlatform = {
  id: 'toutiao',
  name: 'Toutiao',
  icon: 'https://sf3-cdn-tos.toutiaostatic.com/obj/eden-cn/uhbfnupkbps/toutiao_favicon.ico',
  url: 'https://mp.toutiao.com',
  publishUrl: 'https://mp.toutiao.com/profile_v4/graphic/publish',
  title: '今日头条',
  type: 'toutiao',
}

import { injectUtils } from './common.js'

// 今日头条内容填充函数（在页面主世界中执行）
// imageCache: { [url]: { dataUrl, filename, mimeType } } 或 null
function fillToutiaoContentInPage(title, body, imageCache) {
  // 等待满足条件的元素出现
  function waitForElement(predicate, timeout = 10000) {
    return new Promise(resolve => {
      const el = predicate()
      if (el) return resolve(el)

      const observer = new MutationObserver(() => {
        const el = predicate()
        if (el) {
          observer.disconnect()
          resolve(el)
        }
      })
      observer.observe(document.body, { childList: true, subtree: true })

      setTimeout(() => {
        observer.disconnect()
        resolve(predicate())
      }, timeout)
    })
  }

  async function fillContent() {
    // 填充标题 - 头条使用 textarea
    const titleInput = await waitForElement(() =>
      document.querySelector('textarea[placeholder*="标题"]')
    )
    if (titleInput && title) {
      titleInput.focus()
      // 模拟用户输入
      const nativeSetter = Object.getOwnPropertyDescriptor(
        window.HTMLTextAreaElement.prototype,
        'value'
      ).set
      nativeSetter.call(titleInput, title)
      titleInput.dispatchEvent(
        new InputEvent('input', { bubbles: true, data: title, inputType: 'insertText' })
      )
      titleInput.dispatchEvent(new Event('change', { bubbles: true }))
      titleInput.dispatchEvent(new Event('blur', { bubbles: true }))
      console.log('[COSE] 头条标题填充成功:', title)
    } else {
      console.log('[COSE] 头条未找到标题输入框')
    }

    // 等待编辑器加载
    await new Promise(resolve => setTimeout(resolve, 500))

    // 头条使用 ProseMirror 富文本编辑器
    const editor = await waitForElement(() => document.querySelector('.ProseMirror'))

    if (editor && body) {
      editor.focus()

      // 清空现有内容
      editor.innerHTML = ''

      // 从 HTML body 中剥离图片，替换为占位符
      // body 是渲染后的 HTML，已有正确的标题、加粗等格式
      // 需要剥离图片避免 data URL 被 ProseMirror 转为 blob URL（被 CSP 阻止）
      const imagePlaceholders = []
      let imgIdx = 0
      let cleanBody = body

      // 移除 <style> 标签
      cleanBody = cleanBody.replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')

      // 移除阅读时间统计
      cleanBody = cleanBody.replace(/<blockquote[^>]*>[\s\S]*?阅读大约需[\s\S]*?<\/blockquote>/gi, '')

      // 处理 <figure> 块（图片 + 描述），替换为占位符
      cleanBody = cleanBody.replace(/<figure[^>]*>([\s\S]*?)<\/figure>/gi, (match) => {
        const imgMatch = match.match(/<img[^>]*>/i)
        if (!imgMatch) return ''
        const srcMatch = imgMatch[0].match(/src=["']([^"']+)["']/i)
        const altMatch = imgMatch[0].match(/alt=["']([^"']*)["']/i)
        const src = srcMatch ? srcMatch[1] : ''
        if (!src) return ''
        // 从 figcaption 提取描述（优先），降级使用 alt
        const captionMatch = match.match(/<figcaption[^>]*>([\s\S]*?)<\/figcaption>/i)
        const caption = captionMatch ? captionMatch[1].replace(/<[^>]*>/g, '').trim() : ''
        const alt = altMatch ? altMatch[1] : ''
        const desc = caption || alt
        const placeholder = `[COSE_IMG_${imgIdx}]`
        imagePlaceholders.push({ placeholder, src, alt: desc })
        imgIdx++
        return `<p>${placeholder}</p>`
      })

      // 处理独立的 <img> 标签（不在 figure 中的）
      cleanBody = cleanBody.replace(/<img[^>]*>/gi, (match) => {
        const srcMatch = match.match(/src=["']([^"']+)["']/i)
        const altMatch = match.match(/alt=["']([^"']*)["']/i)
        const src = srcMatch ? srcMatch[1] : ''
        const alt = altMatch ? altMatch[1] : ''
        if (!src) return ''
        const placeholder = `[COSE_IMG_${imgIdx}]`
        imagePlaceholders.push({ placeholder, src, alt })
        imgIdx++
        return `<p>${placeholder}</p>`
      })

      // 清理属性：移除 class、data-heading、id 等（避免带入自定义样式）
      cleanBody = cleanBody.replace(/\s+class="[^"]*"/gi, '')
      cleanBody = cleanBody.replace(/\s+data-heading="[^"]*"/gi, '')
      cleanBody = cleanBody.replace(/\s+data-indexeddb-src="[^"]*"/gi, '')
      cleanBody = cleanBody.replace(/\s+id="[^"]*"/gi, '')

      // 使用 document.execCommand 插入内容（ProseMirror 兼容）
      const selection = window.getSelection()
      const range = document.createRange()
      range.selectNodeContents(editor)
      range.collapse(false)
      selection.removeAllRanges()
      selection.addRange(range)

      // 使用 insertHTML 命令
      document.execCommand('insertHTML', false, cleanBody)

      // 触发事件让 ProseMirror 同步
      editor.dispatchEvent(new InputEvent('input', { bubbles: true }))
      editor.dispatchEvent(new Event('change', { bubbles: true }))

      console.log('[COSE] 头条文本内容填充成功，开始处理图片...')

      // 逐个找到占位符，在原位粘贴图片 File 触发平台自动上传
      // 直接分发 paste 事件，不用 pasteImageFile（避免 deleteFromDocument 干扰）
      function pasteFileDirect(el, file) {
        el.focus()
        const dt = new DataTransfer()
        dt.items.add(file)
        el.dispatchEvent(new ClipboardEvent('paste', {
          bubbles: true, cancelable: true, clipboardData: dt,
        }))
      }

      // 等待新可见 <img> 出现（MutationObserver，最多 10 秒）
      // 头条 ProseMirror 每张图片卡片有两个 <img>：一个在 <templ>（隐藏），一个在 .img-loading-container（可见）
      // 只计算可见的 img，避免计数翻倍
      function getVisibleImgs(container) {
        return Array.from(container.querySelectorAll('.img-loading-container img'))
      }

      // 等待新的图片卡片完全渲染（包括描述区域）
      function waitForNewImgCard(container, countBefore) {
        return new Promise((resolve) => {
          function check() {
            const imgs = getVisibleImgs(container)
            if (imgs.length > countBefore) {
              const newImg = imgs[imgs.length - 1]
              const pgcCard = newImg.closest('.pgc-image')
              // 确保描述区域已渲染
              if (pgcCard && pgcCard.querySelector('textarea.pgc-img-caption-ipt')) {
                return newImg
              }
            }
            return null
          }
          const existing = check()
          if (existing) return resolve(existing)

          const observer = new MutationObserver(() => {
            const result = check()
            if (result) {
              observer.disconnect()
              resolve(result)
            }
          })
          observer.observe(container, { childList: true, subtree: true })
          setTimeout(() => { observer.disconnect(); resolve(null) }, 15000)
        })
      }

      // 逐个替换占位符为图片
      let imageCount = 0
      if (imagePlaceholders.length > 0 && imageCache) {
        for (let i = 0; i < imagePlaceholders.length; i++) {
          const { placeholder, src, alt } = imagePlaceholders[i]
          const cached = imageCache[src]
          if (!cached) {
            console.log('[COSE] 头条图片无缓存，跳过:', src?.substring(0, 60))
            continue
          }

          const file = window.dataUrlToFile(cached.dataUrl, cached.filename)

          editor.focus()

          // 查找并删除占位符（保持光标在原位，确保图片插入到正确位置）
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
          }

          // 记录当前可见图片数量，粘贴，等待新图片卡片完全渲染
          const imgsBefore = getVisibleImgs(editor).length
          pasteFileDirect(editor, file)
          const newImg = await waitForNewImgCard(editor, imgsBefore)

          // 设置图片描述（头条特有的 pgc-img-caption 区域）
          if (newImg && alt) {
            if (!newImg.alt) newImg.alt = alt
            const pgcCard = newImg.closest('.pgc-image')
            if (pgcCard) {
              const captionInput = pgcCard.querySelector('textarea.pgc-img-caption-ipt')
              if (captionInput) {
                // 聚焦描述输入框，模拟用户输入
                captionInput.focus()
                await new Promise(r => setTimeout(r, 100))
                const nativeSetter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value')?.set
                if (nativeSetter) {
                  nativeSetter.call(captionInput, alt)
                } else {
                  captionInput.value = alt
                }
                // 触发多种事件确保 ProseMirror 感知变化
                captionInput.dispatchEvent(new InputEvent('input', { bubbles: true, data: alt, inputType: 'insertText' }))
                captionInput.dispatchEvent(new Event('change', { bubbles: true }))
                captionInput.dispatchEvent(new Event('blur', { bubbles: true }))
              }
              // 同步设置展示态的描述文本和镜像元素
              const captionText = pgcCard.querySelector('p.pgc-img-caption')
              if (captionText) captionText.textContent = alt
              const captionPre = pgcCard.querySelector('pre.caption-textarea-pre')
              if (captionPre) captionPre.textContent = alt
            }
          }

          imageCount++
          console.log(`[COSE] 头条图片已粘贴: ${cached.filename} (${(file.size / 1024).toFixed(1)}KB)`)
        }
      }

      // 触发事件让 ProseMirror 同步
      editor.dispatchEvent(new InputEvent('input', { bubbles: true }))
      editor.dispatchEvent(new Event('change', { bubbles: true }))

      console.log(`[COSE] 头条内容填充完成: ${imagePlaceholders.length} 张图片占位, ${imageCount} 张已粘贴`)
      return { success: true }
    } else {
      console.log('[COSE] 头条未找到编辑器')
      return { success: false, error: '未找到编辑器' }
    }
  }

  return fillContent()
}

/**
 * 今日头条同步处理器
 * @param {object} tab - Chrome tab 对象
 * @param {object} content - 内容对象 { title, body, markdown }
 * @param {object} helpers - 帮助函数 { chrome, waitForTab, addTabToSyncGroup, imageCache }
 * @returns {Promise<{success: boolean, message?: string, tabId?: number}>}
 */
async function syncToutiaoContent(tab, content, helpers) {
  const { chrome, waitForTab, imageCache } = helpers

  // 等待页面加载完成
  await waitForTab(tab.id)

  // 额外等待一下让编辑器完全加载
  await new Promise(resolve => setTimeout(resolve, 2500))

  // 先注入公共工具函数
  await injectUtils(chrome, tab.id)

  console.log('[COSE] 开始注入头条填充函数, body长度:', (content.body || '').length, 'imageCache keys:', imageCache ? Object.keys(imageCache).length : 0)

  // 在页面中执行填充（传入 body 和 imageCache）
  let result
  try {
    result = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: fillToutiaoContentInPage,
      args: [content.title, content.body || '', imageCache || null],
      world: 'MAIN',
    })
  } catch (e) {
    console.error('[COSE] 头条脚本注入失败:', e.message)
    return { success: false, message: `脚本注入失败: ${e.message}`, tabId: tab.id }
  }

  const fillResult = result?.[0]?.result
  if (fillResult?.success) {
    return { success: true, message: '已打开头条号并填充内容', tabId: tab.id }
  } else {
    return { success: false, message: fillResult?.error || '内容填充失败', tabId: tab.id }
  }
}

// 导出
export { ToutiaoPlatform, fillToutiaoContentInPage, syncToutiaoContent }

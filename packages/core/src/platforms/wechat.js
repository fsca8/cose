import { injectUtils } from './common.js'

// 微信公众号平台配置
const WechatPlatform = {
  id: 'wechat',
  name: 'WeChat',
  icon: 'https://res.wx.qq.com/a/wx_fed/assets/res/NTI4MWU5.ico',
  url: 'https://mp.weixin.qq.com',
  // 先打开草稿箱，再自动点击新建
  publishUrl:
    'https://mp.weixin.qq.com/cgi-bin/appmsg?t=media/appmsg_edit_v2&action=edit&isNew=1&type=10',
  title: '微信公众号',
  type: 'wechat',
}

function getEditorArea(editor) {
  return (editor?.clientHeight || 0) * (editor?.clientWidth || 0)
}

// 扩展的标题编辑器选择器列表（按优先级排序）
const TITLE_EDITOR_SELECTORS = [
  '.title-editor__input .ProseMirror',
  '.publish_title_editor .ProseMirror',
  '.article-title-editor .ProseMirror',
  '[class*="title-editor"] .ProseMirror',
  '[class*="title_editor"] .ProseMirror',
  '[class*="titleEditor"] .ProseMirror',
]

function isWechatTitleEditor(editor, titleEditor) {
  if (!editor) return false
  if (editor === titleEditor) return true

  // 检查是否在任意已知的标题编辑器容器内
  for (const selector of TITLE_EDITOR_SELECTORS) {
    if (editor.closest?.(selector.split(' .ProseMirror')[0])) return true
  }

  return false
}

function findTitleEditor() {
  for (const selector of TITLE_EDITOR_SELECTORS) {
    const el = document.querySelector(selector)
    if (el) return el
  }
  return null
}

function findTitleInput() {
  return (
    document.querySelector('#title') ||
    document.querySelector('input[placeholder*="标题"]') ||
    document.querySelector('textarea[placeholder*="标题"]') ||
    document.querySelector('input[id*="title"]') ||
    document.querySelector('textarea[id*="title"]')
  )
}

function pickWechatBodyProseMirrorCandidate(nodes, { titleInput, titleEditor } = {}) {
  const bodyCandidates = nodes.filter(editor => !isWechatTitleEditor(editor, titleEditor))
  if (bodyCandidates.length === 0) return null
  if (bodyCandidates.length === 1) return bodyCandidates[0]

  const byPlaceholder = bodyCandidates.find(editor =>
    (editor.textContent || '').includes('从这里开始写正文')
  )
  if (byPlaceholder) return byPlaceholder

  // 按位置筛选：位于标题输入框下方的 editor
  if (titleInput) {
    const band = titleInput.getBoundingClientRect()
    const belowTitle = bodyCandidates.filter(editor => {
      const rect = editor.getBoundingClientRect()
      return rect.top >= band.bottom - 8
    })
    if (belowTitle.length > 0) {
      return belowTitle.sort((a, b) => getEditorArea(b) - getEditorArea(a))[0]
    }
  }

  // 最后兜底：排除靠近页面顶部的 editor（通常是标题编辑器）
  const pageTop = 50
  const notAtTop = bodyCandidates.filter(editor => {
    const rect = editor.getBoundingClientRect()
    return rect.top > pageTop
  })
  if (notAtTop.length > 0) {
    return notAtTop.sort((a, b) => getEditorArea(b) - getEditorArea(a))[0]
  }

  return bodyCandidates.sort((a, b) => getEditorArea(b) - getEditorArea(a))[0]
}

// 微信公众号内容填充函数（在页面主世界中执行）
// 注意：需要先调用 injectUtils 注入 window.waitFor
async function fillWechatContent(title, htmlBody) {
  /**
   * 后台改版后可能存在多个 `.ProseMirror`（标题区也可能是 ProseMirror），
   * `querySelector('.ProseMirror')` 常会命中标题编辑器，导致正文 HTML 被贴进标题。
   * 另外，正文编辑器有时会比标题编辑器晚挂载，这时也要继续等待，不能把唯一节点误判成正文。
   */
  // 标题编辑器选择器列表（与外部保持同步）
  const TITLE_SELECTORS = [
    '.title-editor__input .ProseMirror',
    '.publish_title_editor .ProseMirror',
    '.article-title-editor .ProseMirror',
    '[class*="title-editor"] .ProseMirror',
    '[class*="title_editor"] .ProseMirror',
    '[class*="titleEditor"] .ProseMirror',
  ]
  function findTitleEditor() {
    for (const sel of TITLE_SELECTORS) {
      const el = document.querySelector(sel)
      if (el) return el
    }
    return null
  }
  function findTitleInput() {
    return (
      document.querySelector('#title') ||
      document.querySelector('input[placeholder*="标题"]') ||
      document.querySelector('textarea[placeholder*="标题"]') ||
      document.querySelector('input[id*="title"]') ||
      document.querySelector('textarea[id*="title"]')
    )
  }
  function pickWechatBodyProseMirror() {
    function getEditorArea(editor) {
      return (editor?.clientHeight || 0) * (editor?.clientWidth || 0)
    }
    function isTitleEditor(editor) {
      if (!editor) return false
      for (const sel of TITLE_SELECTORS) {
        const containerSel = sel.split(' .ProseMirror')[0]
        if (editor.closest?.(containerSel)) return true
      }
      return false
    }
    function pickCandidate(nodes, { titleInput } = {}) {
      const bodyCandidates = nodes.filter(editor => !isTitleEditor(editor))
      if (bodyCandidates.length === 0) return null
      if (bodyCandidates.length === 1) return bodyCandidates[0]

      const byPlaceholder = bodyCandidates.find(editor =>
        (editor.textContent || '').includes('从这里开始写正文')
      )
      if (byPlaceholder) return byPlaceholder

      if (titleInput) {
        const band = titleInput.getBoundingClientRect()
        const belowTitle = bodyCandidates.filter(editor => {
          const rect = editor.getBoundingClientRect()
          return rect.top >= band.bottom - 8
        })
        if (belowTitle.length > 0) {
          return belowTitle.sort((a, b) => getEditorArea(b) - getEditorArea(a))[0]
        }
      }

      // 兜底：排除靠近页面顶部的 editor（通常是标题编辑器）
      const notAtTop = bodyCandidates.filter(editor => {
        const rect = editor.getBoundingClientRect()
        return rect.top > 50
      })
      if (notAtTop.length > 0) {
        return notAtTop.sort((a, b) => getEditorArea(b) - getEditorArea(a))[0]
      }

      return bodyCandidates.sort((a, b) => getEditorArea(b) - getEditorArea(a))[0]
    }

    const nodes = [...document.querySelectorAll('.ProseMirror')]
    if (nodes.length === 0) return null

    const titleInput = findTitleInput()
    return pickCandidate(nodes, { titleInput })
  }

  async function waitForBodyEditor(timeout = 15000) {
    const start = Date.now()
    while (Date.now() - start < timeout) {
      const el = pickWechatBodyProseMirror()
      if (el) return el
      await new Promise(r => setTimeout(r, 100))
    }
    return pickWechatBodyProseMirror()
  }

  try {
    const titleInput = findTitleInput()
    // 优先用 waitFor 等待标题输入框出现，不限于 #title
    const waitTitleInput = await window.waitFor(
      '#title, input[placeholder*="标题"], textarea[placeholder*="标题"], input[id*="title"]',
      15000
    )

    // 填充标题（优先于正文，避免焦点停留在标题区的 ProseMirror）
    if (title) {
      const input = waitTitleInput || titleInput
      const titleEditorEl = findTitleEditor()

      // 判断 input 是否可见（微信改版后 #title 是隐藏的 textarea，只是数据同步用）
      const isInputVisible = input && input.offsetHeight > 0 && input.style?.visibility !== 'hidden'

      // 方式1（优先）：ProseMirror 标题编辑器 — 微信改版后的实际可见标题区
      if (titleEditorEl) {
        titleEditorEl.focus()
        // ProseMirror 需要先全选再替换，确保触发内部状态更新
        document.execCommand('selectAll', false, null)
        document.execCommand('insertText', false, title)
        titleEditorEl.dispatchEvent(new Event('input', { bubbles: true }))
        console.log('[COSE] 微信标题已填充 (ProseMirror):', title)
      }
      // 方式2：传统可见 input/textarea 元素
      else if (isInputVisible) {
        input.focus()
        const nativeSetter =
          Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value')?.set ||
          Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set
        if (nativeSetter) {
          nativeSetter.call(input, title)
        } else {
          input.value = title
        }
        input.dispatchEvent(new Event('input', { bubbles: true }))
        input.dispatchEvent(new Event('change', { bubbles: true }))
        console.log('[COSE] 微信标题已填充 (input):', title)
      }
      // 方式3：隐藏的表单字段兜底（至少同步数据）
      else if (input) {
        const nativeSetter =
          Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value')?.set ||
          Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set
        if (nativeSetter) {
          nativeSetter.call(input, title)
        } else {
          input.value = title
        }
        input.dispatchEvent(new Event('input', { bubbles: true }))
        input.dispatchEvent(new Event('change', { bubbles: true }))
        console.log('[COSE] 微信标题已填充 (hidden input 兜底):', title)
      } else {
        console.warn('[COSE] 未找到标题输入元素，跳过标题填充')
      }
    }

    await new Promise(r => setTimeout(r, 300))

    // 剥离正文中的第一个 h1 标题——标题已单独填入标题输入框，
    // 保留在正文中会导致 ProseMirror 节点错乱且无法正常删除
    if (title) {
      htmlBody = htmlBody.replace(/<h1[^>]*>[\s\S]*?<\/h1>\s*/i, '')
    }

    const editor = await waitForBodyEditor(15000)
    if (!editor) {
      return { success: false, error: '未找到正文编辑器' }
    }

    // 填充正文内容
    if (editor && htmlBody) {
      editor.focus()

      // 清空现有占位符内容
      if (editor.textContent.includes('从这里开始写正文')) {
        editor.innerHTML = ''
      }

      const plainText = htmlBody.replace(/<[^>]*>/g, '')
      const hasImageInSource = /<img\b/i.test(htmlBody)
      let injected = false
      let injectError = ''

      // 优先使用微信编辑器 JSAPI。合成 Ctrl+V 事件不会触发真实粘贴；
      // 直接写 innerHTML 也不会可靠同步到 ProseMirror 的文档模型。
      if (window.__MP_Editor_JSAPI__ && typeof window.__MP_Editor_JSAPI__.invoke === 'function') {
        injected = await new Promise(resolve => {
          let done = false
          const finish = (ok, err) => {
            if (done) return
            done = true
            if (err) injectError = err.message || String(err)
            resolve(ok)
          }

          try {
            window.__MP_Editor_JSAPI__.invoke({
              apiName: 'mp_editor_set_content',
              apiParam: { content: htmlBody },
              sucCb: () => finish(true),
              errCb: err => finish(false, err),
            })
          } catch (err) {
            finish(false, err)
          }

          setTimeout(() => finish(false, new Error('mp_editor_set_content 调用超时')), 5000)
        })

        if (injected) {
          console.log('[COSE] 微信内容已通过 mp_editor_set_content 注入')
          await new Promise(r => setTimeout(r, 800))
        } else {
          console.warn('[COSE] mp_editor_set_content 注入失败:', injectError)
        }
      }

      if (!injected) {
        if (hasImageInSource) {
          console.warn('[COSE] 正文包含图片，但微信 JSAPI 不可用；paste 兜底可能无法保留图片')
        }

        const dt = new DataTransfer()
        dt.setData('text/html', htmlBody)
        dt.setData('text/plain', plainText)

        const pasteEvent = new ClipboardEvent('paste', {
          bubbles: true,
          cancelable: true,
          clipboardData: dt,
        })

        editor.dispatchEvent(pasteEvent)
        console.log('[COSE] 微信内容已通过 paste 事件注入（兜底方案）')

        // 等待内容渲染
        await new Promise(r => setTimeout(r, 800))
      }

      // 验证内容是否注入成功
      const wordCount = editor.textContent?.trim().length || 0
      const imageCount = editor.querySelectorAll?.('img').length || 0
      const hasEditorContent = wordCount > 0 || imageCount > 0 || injected

      const titleEditorEl = findTitleEditor()
      return {
        success: hasEditorContent,
        error: hasEditorContent ? undefined : injectError || '正文注入后未检测到有效内容',
        wordCount,
        imageCount,
        titleFilled:
          waitTitleInput?.value === title || titleEditorEl?.textContent?.trim() === title,
      }
    }

    return { success: false, error: '内容为空' }
  } catch (err) {
    return { success: false, error: err.message }
  }
}

// 微信公众号保存草稿函数（在页面主世界中执行）
function saveWechatDraft() {
  const saveDraftBtn = Array.from(document.querySelectorAll('button')).find(b =>
    b.textContent.includes('保存为草稿')
  )
  if (saveDraftBtn) {
    saveDraftBtn.click()
    console.log('[COSE] 已点击保存为草稿')
    return { success: true }
  }
  return { success: false, error: '未找到保存按钮' }
}

/**
 * 微信公众号同步处理器
 * @param {object} tab - Chrome tab 对象（初始为首页）
 * @param {object} content - 内容对象 { title, body, markdown, wechatHtml }
 * @param {object} helpers - 帮助函数 { chrome, waitForTab, addTabToSyncGroup, PLATFORMS }
 * @returns {Promise<{success: boolean, message?: string, tabId?: number}>}
 */
async function syncWechatContent(tab, content, helpers) {
  const { chrome, waitForTab } = helpers

  // 步骤1：等待首页加载完成
  console.log('[COSE] 微信公众号等待页面加载')
  await waitForTab(tab.id)

  // 注入公共工具函数（waitFor, setInputValue）
  await injectUtils(chrome, tab.id)

  // 步骤2：使用 MutationObserver 监听获取 token
  console.log('[COSE] 开始检测 token...')
  const [tokenResult] = await chrome.scripting.executeScript({
    target: { tabId: tab.id },
    func: () => {
      return new Promise(resolve => {
        // 先检查当前页面是否已有 token
        const checkToken = () => {
          const urlMatch = window.location.href.match(/token=(\d+)/)
          if (urlMatch) return urlMatch[1]

          const links = document.querySelectorAll('a[href*="token"]')
          for (const link of links) {
            const match = link.href?.match(/token=(\d+)/)
            if (match) return match[1]
          }

          const scripts = document.querySelectorAll('script:not([src])')
          for (const script of scripts) {
            const content = script.textContent
            const match = content.match(/token["']?\s*[:=]\s*["']?(\d+)["']?/i)
            if (match && match[1]) return match[1]
          }
          return null
        }

        const existing = checkToken()
        if (existing) return resolve(existing)

        // 使用 MutationObserver 监听 DOM 变化
        const observer = new MutationObserver(() => {
          const token = checkToken()
          if (token) {
            observer.disconnect()
            resolve(token)
          }
        })
        observer.observe(document.documentElement, { childList: true, subtree: true })

        // 超时保护
        setTimeout(() => {
          observer.disconnect()
          resolve(checkToken())
        }, 10000)
      })
    },
    world: 'MAIN',
  })

  const token = tokenResult?.result

  if (!token) {
    console.error('[COSE] 无法从页面获取 token')
    return { success: false, message: '无法获取微信公众号 token，请确保已登录', tabId: tab.id }
  }

  // 步骤3：跳转到编辑器页面
  const editorUrl = `https://mp.weixin.qq.com/cgi-bin/appmsg?t=media/appmsg_edit_v2&action=edit&isNew=1&type=10&token=${token}&lang=zh_CN`
  console.log('[COSE] 获取到 token:', token, '跳转到编辑器')

  await chrome.tabs.update(tab.id, { url: editorUrl })
  await waitForTab(tab.id)

  // 使用剪贴板 HTML（带完整样式）或降级到 body
  const htmlContent = content.wechatHtml || content.body
  console.log('[COSE] 微信 HTML 内容长度:', htmlContent?.length || 0)

  // 步骤4：使用 MutationObserver 监听编辑器出现
  console.log('[COSE] 正在等待编辑器...')
  const [editorResult] = await chrome.scripting.executeScript({
    target: { tabId: tab.id },
    func: () => {
      return new Promise(resolve => {
        const existing = document.querySelector('.ProseMirror')
        if (existing) return resolve(true)

        const observer = new MutationObserver(() => {
          if (document.querySelector('.ProseMirror')) {
            observer.disconnect()
            resolve(true)
          }
        })
        observer.observe(document.documentElement, { childList: true, subtree: true })

        setTimeout(() => {
          observer.disconnect()
          resolve(!!document.querySelector('.ProseMirror'))
        }, 15000)
      })
    },
    world: 'MAIN',
  })

  if (!editorResult?.result) {
    console.error('[COSE] 编辑器等待超时')
    return { success: false, message: '编辑器加载超时', tabId: tab.id }
  }

  console.log('[COSE] 编辑器已就绪，开始注入内容...')

  // 页面跳转后需要重新注入工具函数（waitFor, setInputValue）
  await injectUtils(chrome, tab.id)

  // 步骤5：填充内容
  let result
  try {
    result = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: fillWechatContent,
      args: [content.title, htmlContent],
      world: 'MAIN',
    })
  } catch (e) {
    console.error('[COSE] executeScript 执行失败:', e)
    return { success: false, message: '脚本执行失败: ' + e.message, tabId: tab.id }
  }

  const fillResult = result?.[0]?.result
  console.log('[COSE] 微信填充结果:', JSON.stringify(fillResult, null, 2))

  if (!fillResult?.success) {
    console.error('[COSE] 微信内容填充失败:', fillResult?.error)
    return { success: false, message: fillResult?.error || '内容填充失败', tabId: tab.id }
  }

  console.log('[COSE] 微信内容填充成功，字数:', fillResult.wordCount)

  // 步骤6：等待内容稳定后，点击保存为草稿按钮
  await new Promise(resolve => setTimeout(resolve, 500))
  await chrome.scripting.executeScript({
    target: { tabId: tab.id },
    func: saveWechatDraft,
    world: 'MAIN',
  })

  return { success: true, message: '已同步并保存为草稿', tabId: tab.id }
}

// 导出
export { WechatPlatform, fillWechatContent, pickWechatBodyProseMirrorCandidate, syncWechatContent }

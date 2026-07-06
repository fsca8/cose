/**
 * 网易号 detection logic
 * Strategy:
 * 1. Find an existing mp.163.com tab
 * 2. Inject script into the page to call navinfo.do (cookies auto-attached by browser)
 * 3. Extract username and avatar from API response
 *
 * Note: chrome.cookies.getAll returns empty arrays for .163.com in MV3 service
 * workers (likely Chrome's cookie partitioning / third-party cookie policy).
 * Injecting into the page context avoids this entirely.
 */

import { convertAvatarToBase64 } from '../utils.js'

/** Fetch navinfo.do from within the mp.163.com page context. */
async function _fetchNavinfoInPage() {
  try {
    const resp = await fetch(`/wemedia/navinfo.do?_=${Date.now()}`, {
      method: 'GET',
      headers: { Accept: 'application/json' },
    })
    if (!resp.ok) return { error: `HTTP ${resp.status}` }
    return await resp.json()
  } catch (e) {
    return { error: e.message }
  }
}

export async function detectWangyihaoUser() {
  try {
    // 1. Find an existing mp.163.com tab
    const tabs = await chrome.tabs.query({ url: 'https://mp.163.com/*' })

    if (tabs.length === 0) {
      return await _detectViaCookies()
    }

    // 2. Inject script into the page to fetch navinfo (cookies auto-attached)
    const results = await chrome.scripting.executeScript({
      target: { tabId: tabs[0].id },
      func: _fetchNavinfoInPage,
      world: 'MAIN',
    })

    const data = results?.[0]?.result

    if (!data || data.error) {
      return await _detectViaCookies()
    }

    if (data.code !== 1 || !data.data?.wemediaId) return { loggedIn: false }

    const username = data.data.tname || ''
    let avatar = data.data.icon || ''

    if (avatar && (avatar.includes('126.net') || avatar.includes('163.com'))) {
      avatar = await convertAvatarToBase64(avatar, 'https://mp.163.com/')
    }

    return { loggedIn: true, username, avatar }
  } catch (e) {
    console.error('[COSE] Wangyihao Detection Error:', e)
    return { loggedIn: false, error: e.message }
  }
}

/** Fallback: cookie-based detection (for when no mp.163.com tab is open). */
async function _detectViaCookies() {
  try {
    const cookies = await chrome.cookies.getAll({ domain: '.163.com' })
    const mpCookies = await chrome.cookies.getAll({ url: 'https://mp.163.com' })

    const allCookies = [...cookies, ...mpCookies]
    const seen = new Set()
    const uniqueCookies = allCookies.filter(c => {
      const key = `${c.name}=${c.value}`
      if (seen.has(key)) return false
      seen.add(key)
      return true
    })
    const cookieStr = uniqueCookies.map(c => `${c.name}=${c.value}`).join('; ')

    if (!cookieStr) return { loggedIn: false }

    const response = await fetch(`https://mp.163.com/wemedia/navinfo.do?_=${Date.now()}`, {
      method: 'GET',
      headers: {
        Accept: 'application/json',
        Cookie: cookieStr,
      },
    })

    if (!response.ok) return { loggedIn: false }

    const data = await response.json()
    if (data?.code !== 1 || !data?.data?.wemediaId) return { loggedIn: false }

    const username = data.data.tname || ''
    let avatar = data.data.icon || ''

    if (avatar && (avatar.includes('126.net') || avatar.includes('163.com'))) {
      avatar = await convertAvatarToBase64(avatar, 'https://mp.163.com/')
    }

    return { loggedIn: true, username, avatar }
  } catch (e) {
    console.error('[COSE] Wangyihao Cookie Detection Error:', e)
    return { loggedIn: false, error: e.message }
  }
}

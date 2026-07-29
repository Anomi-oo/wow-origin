/**
 * 现代化启动界面
 * 提供美观整洁的服务器启动信息展示
 */
class WelcomePage {
  static colors = {
    reset: '\x1b[0m',
    bright: '\x1b[1m',
    dim: '\x1b[2m',
    red: '\x1b[31m',
    green: '\x1b[32m',
    yellow: '\x1b[33m',
    blue: '\x1b[34m',
    magenta: '\x1b[35m',
    cyan: '\x1b[36m',
    white: '\x1b[37m',
    gray: '\x1b[90m'
  }

  /**
   * 显示启动横幅
   */
  static showBanner() {
    const { cyan, bright, reset, gray } = this.colors

    // 使用padLine方法确保完美对齐
    const titleLine = this.padLine(`          🎵 Multi-Platform Music API Server `)
    const subtitleLine = this.padLine(`    ${gray}A unified API gateway for multiple music platforms${reset} `)
    const emptyLine = this.padLine('')

    console.log()
    console.log(`${cyan}${bright}╔══════════════════════════════════════════════════════════╗${reset}`)
    console.log(`${cyan}${bright}║${reset}${emptyLine}${cyan}${bright}║${reset}`)
    console.log(`${cyan}${bright}║${reset}${titleLine}${cyan}${bright}║${reset}`)
    console.log(`${cyan}${bright}║${reset}${emptyLine}${cyan}${bright}║${reset}`)
    console.log(`${cyan}${bright}║${reset}${subtitleLine}${cyan}${bright}║${reset}`)
    console.log(`${cyan}${bright}║${reset}${emptyLine}${cyan}${bright}║${reset}`)
    console.log(`${cyan}${bright}╚══════════════════════════════════════════════════════════╝${reset}`)
    console.log()
  }

  /**
   * 显示启动状态
   */
  static showStartupStatus() {
    const { yellow, bright, reset } = this.colors
    console.log(`${yellow}${bright}⚡ Starting server...${reset}`)
    console.log()
  }

  /**
   * 显示平台加载状态
   */
  static showPlatformStatus(platformName, moduleCount, deviceId, staticIP, defaultUid) {
    const { green, reset, gray, cyan, yellow } = this.colors
    const statusIcon = '✓'

    console.log(`  ${green}${statusIcon}${reset} Platform: ${cyan}${platformName}${reset}`)
    console.log(`    ${gray}├─${reset} ModuleNum: ${moduleCount}`)

    // deviceId是52位大写十六进制，显示前8位+后4位的格式
    if (deviceId && deviceId !== 'N/A' && deviceId.length >= 12) {
      const displayId = `${deviceId.substring(0, 8)}...${deviceId.substring(deviceId.length - 4)}`
      console.log(`    ${gray}├─${reset} Device ID: ${displayId}`)
    } else {
      console.log(`    ${gray}├─${reset} Status: Ready`)
    }

    // 显示静态IP
    if (staticIP) {
      console.log(`    ${gray}├─${reset} Static IP: ${staticIP}`)
    } else {
      console.log(`    ${gray}├─${reset} IP: Not configured`)
    }

  }

  /**
   * 显示服务器就绪信息
   */
  static showReadyStatus(serverInfo) {
    const { green, bright, reset, cyan, white, gray } = this.colors

    console.log()
    console.log(`${green}${bright}🚀 Server Ready!${reset}`)
    console.log()

    // 构建内容行
    const localUrl = `http://${serverInfo.host || 'localhost'}:${serverInfo.port}`
    const platformText = serverInfo.platforms.map(p => `${p.name}(${p.modules})`).join(', ')
    const timeText = new Date().toLocaleString('zh-CN')

    // 计算对齐填充
    const localLine = this.padLine(`  ${white}Local:${reset}     ${localUrl}`)
    const platformLine = this.padLine(`  ${white}Platform:${reset}  ${platformText}`)
    const timeLine = this.padLine(`  ${white}Time:${reset}      ${timeText}`)

    // 服务信息框
    console.log(`${cyan}┌─ Server Information ─────────────────────────────────────┐${reset}`)
    console.log(`${cyan}│${reset}                                                          ${cyan}│${reset}`)
    console.log(`${cyan}│${reset}${localLine}${cyan}│${reset}`)
    console.log(`${cyan}│${reset}${platformLine}${cyan}│${reset}`)
    console.log(`${cyan}│${reset}${timeLine}${cyan}│${reset}`)
    console.log(`${cyan}│${reset}                                                          ${cyan}│${reset}`)
    console.log(`${cyan}└──────────────────────────────────────────────────────────┘${reset}`)
    console.log()

    // 快速指南
    console.log(`${gray}💡 Quick Start:${reset}`)
    console.log(`${gray}   GET  /${reset} → API documentation`)
    console.log(`${gray}   GET  ${this.randomTips()} ${reset} → Start!`)
    console.log()
  }


  static randomTips() {
    const tips = [
      "/search?platform=netease&keywords=爱你",
      "/song/detail?platform=netease&id=82453",
      "/playlist/detail?platform=netease&id=3136952023",
      "/song/url?platform=netease&id=2062623445"
    ]
    return tips[Math.floor(Math.random() * tips.length)]
  }

  /**
   * 填充字符串到指定宽度，去掉ANSI颜色码计算实际长度
   */
  static padLine(text, width = 58) {
    // 去掉ANSI颜色码计算实际显示长度
    const cleanText = text.replace(/\x1b\[[0-9;]*m/g, '')
    const padding = Math.max(0, width - cleanText.length)
    return text + ' '.repeat(padding)
  }

  /**
   * 显示错误信息
   */
  static showError(message, error = null) {
    const { red, bright, reset, gray } = this.colors

    console.log()
    console.log(`${red}${bright}❌ Startup Failed${reset}`)
    console.log(`${red}│${reset} ${message}`)

    if (error) {
      console.log(`${red}│${reset}`)
      console.log(`${red}└─${reset} ${gray}${error.message}${reset}`)
    }

    console.log()
  }

  /**
   * 清屏并准备显示
   */
  static clear() {
    // 清屏并移动光标到顶部
    process.stdout.write('\x1b[2J\x1b[H')
  }
}

module.exports = WelcomePage
const log = require('./Logger').createConsole({ component: 'server' });

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
    const titleLine = this.padLine(`          Multi-Platform Music API Server `)
    const subtitleLine = this.padLine(`    ${gray}A unified API gateway for multiple music platforms${reset} `)
    const emptyLine = this.padLine('')

    log.info()
    log.info(`${cyan}${bright}╔══════════════════════════════════════════════════════════╗${reset}`)
    log.info(`${cyan}${bright}║${reset}${emptyLine}${cyan}${bright}║${reset}`)
    log.info(`${cyan}${bright}║${reset}${titleLine}${cyan}${bright}║${reset}`)
    log.info(`${cyan}${bright}║${reset}${emptyLine}${cyan}${bright}║${reset}`)
    log.info(`${cyan}${bright}║${reset}${subtitleLine}${cyan}${bright}║${reset}`)
    log.info(`${cyan}${bright}║${reset}${emptyLine}${cyan}${bright}║${reset}`)
    log.info(`${cyan}${bright}╚══════════════════════════════════════════════════════════╝${reset}`)
    log.info()
  }

  /**
   * 显示启动状态
   */
  static showStartupStatus() {
    const { yellow, bright, reset } = this.colors
    log.info(`${yellow}${bright}Starting server...${reset}`)
    log.info()
  }

  /**
   * 显示平台加载状态
   */
  static showPlatformStatus(platformName, moduleCount, deviceId, staticIP, defaultUid) {
    const { green, reset, gray, cyan, yellow } = this.colors
    const statusIcon = '✓'

    log.info(`  ${green}${statusIcon}${reset} Platform: ${cyan}${platformName}${reset}`)
    log.info(`    ${gray}├─${reset} ModuleNum: ${moduleCount}`)

    // deviceId是52位大写十六进制，显示前8位+后4位的格式
    if (deviceId && deviceId !== 'N/A' && deviceId.length >= 12) {
      const displayId = `${deviceId.substring(0, 8)}...${deviceId.substring(deviceId.length - 4)}`
      log.info(`    ${gray}├─${reset} Device ID: ${displayId}`)
    } else {
      log.info(`    ${gray}├─${reset} Status: Ready`)
    }

    // 显示静态IP
    if (staticIP) {
      log.info(`    ${gray}├─${reset} Static IP: ${staticIP}`)
    } else {
      log.info(`    ${gray}├─${reset} IP: Not configured`)
    }

  }

  /**
   * 显示服务器就绪信息
   */
  static showReadyStatus(serverInfo) {
    const { green, bright, reset, cyan, white, gray } = this.colors

    log.info()
    log.info(`${green}${bright}Server Ready!${reset}`)
    log.info()

    // 构建内容行
    const localUrl = `http://${serverInfo.host || 'localhost'}:${serverInfo.port}`
    const platformText = serverInfo.platforms.map(p => `${p.name}(${p.modules})`).join(', ')
    const timeText = new Date().toLocaleString('zh-CN')

    // 计算对齐填充
    const localLine = this.padLine(`  ${white}Local:${reset}     ${localUrl}`)
    const platformLine = this.padLine(`  ${white}Platform:${reset}  ${platformText}`)
    const timeLine = this.padLine(`  ${white}Time:${reset}      ${timeText}`)

    // 服务信息框
    log.info(`${cyan}┌─ Server Information ─────────────────────────────────────┐${reset}`)
    log.info(`${cyan}│${reset}                                                          ${cyan}│${reset}`)
    log.info(`${cyan}│${reset}${localLine}${cyan}│${reset}`)
    log.info(`${cyan}│${reset}${platformLine}${cyan}│${reset}`)
    log.info(`${cyan}│${reset}${timeLine}${cyan}│${reset}`)
    log.info(`${cyan}│${reset}                                                          ${cyan}│${reset}`)
    log.info(`${cyan}└──────────────────────────────────────────────────────────┘${reset}`)
    log.info()

    // 快速指南
    log.info(`${gray}Quick Start:${reset}`)
    log.info(`${gray}   GET  /${reset} → API documentation`)
    log.info(`${gray}   GET  ${this.randomTips()} ${reset} → Start!`)
    log.info()
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

    log.info()
    log.info(`${red}${bright}❌ Startup Failed${reset}`)
    log.info(`${red}│${reset} ${message}`)

    if (error) {
      log.info(`${red}│${reset}`)
      log.info(`${red}└─${reset} ${gray}${error.message}${reset}`)
    }

    log.info()
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
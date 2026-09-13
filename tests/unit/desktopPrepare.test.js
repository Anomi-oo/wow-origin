const fs = require('fs')
const path = require('path')

describe('desktop runtime preparation', () => {
  test('通过当前 Node 执行 npm CLI，避免 Windows 直接 spawn npm.cmd', () => {
    const script = fs.readFileSync(
      path.join(process.cwd(), 'scripts', 'prepare-desktop.mjs'),
      'utf8'
    )

    expect(script).toContain('const npmCli = process.env.npm_execpath')
    expect(script).toContain('execFileSync(process.execPath, [npmCli, ...args], options)')
    expect(script).toContain("shell: process.platform === 'win32'")
    expect(script).not.toContain("const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm'")
  })
})

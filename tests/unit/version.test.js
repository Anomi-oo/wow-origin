const fs = require('node:fs')
const path = require('node:path')

describe('release version', () => {
  test('Node、Tauri 和 Cargo 版本统一为 1.0.2', () => {
    const projectDir = process.cwd()
    const packageJson = require(path.join(projectDir, 'package.json'))
    const packageLock = require(path.join(projectDir, 'package-lock.json'))
    const tauriConfig = require(path.join(projectDir, 'src-tauri', 'tauri.conf.json'))
    const cargoToml = fs.readFileSync(path.join(projectDir, 'src-tauri', 'Cargo.toml'), 'utf8')
    const cargoLock = fs.readFileSync(path.join(projectDir, 'src-tauri', 'Cargo.lock'), 'utf8')
    const desktopPackage = cargoLock.match(/\[\[package\]\]\nname = "wow-desktop"\nversion = "([^"]+)"/)

    expect(packageJson.version).toBe('1.0.2')
    expect(packageLock.version).toBe('1.0.2')
    expect(packageLock.packages[''].version).toBe('1.0.2')
    expect(tauriConfig.version).toBe('1.0.2')
    expect(cargoToml).toMatch(/\[package\][\s\S]*?version = "1\.0\.2"/)
    expect(desktopPackage?.[1]).toBe('1.0.2')
  })
})

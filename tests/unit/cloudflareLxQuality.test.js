jest.mock('../../cloudflare/generated/lx-source', () => ({
  bundledLxSource: { enabled: true },
  installBundledLxSource: ({ lx }) => {
    lx.on(lx.EVENT_NAMES.request, async ({ info }) => {
      if (info.type === 'flac') throw new Error('SQ unavailable')
      return `https://audio.test/${info.type}`
    })
    lx.send(lx.EVENT_NAMES.inited, { sources: {
      tx: { actions: ['musicUrl'], qualitys: ['128k', '320k', 'flac'] },
      wy: { actions: ['musicUrl'], qualitys: ['128k', '320k', 'flac'] }
    } })
  }
}), { virtual: true })

const { CloudflareLxSourceManager } = require('../../cloudflare/lx-manager')

test('Cloudflare 洛雪与本地流程一致，只请求指定音质，由外层按详情降级', async () => {
  const manager = new CloudflareLxSourceManager()
  const options = { allowFallback: false }
  await expect(manager.resolveTrackUrl('qq', 'track', 'lossless', [], options)).rejects.toThrow('SQ unavailable')
  await expect(manager.resolveTrackUrl('netease', 'track', 'hires', [], options)).resolves.toBeUndefined()
  await expect(manager.resolveTrackUrl('qq', 'track', 'higher', [], options)).resolves.toBeUndefined()
  await expect(manager.resolveTrackUrl('qq', 'track', 'exhigh', [], options)).resolves.toMatchObject({ quality: 'exhigh' })
})

const express = require('express')
const net = require('node:net')
const { listenWithOptionalFallback } = require('../../../dist/server')

describe('desktop server listener', () => {
  test('首选端口被占用时自动选择空闲端口', async () => {
    const occupier = net.createServer()
    await new Promise((resolve) => occupier.listen(0, '127.0.0.1', resolve))
    const preferredPort = occupier.address().port
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {})
    let server
    try {
      const result = await listenWithOptionalFallback(express(), preferredPort, '127.0.0.1', true)
      server = result.server
      expect(result.port).not.toBe(preferredPort)
      expect(result.port).toBeGreaterThan(0)
      expect(warn).toHaveBeenCalledWith(expect.stringContaining('已占用'))
    } finally {
      if (server) await new Promise((resolve) => server.close(resolve))
      await new Promise((resolve) => occupier.close(resolve))
    }
  })
})

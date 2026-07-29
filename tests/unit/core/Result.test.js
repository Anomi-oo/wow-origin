/**
 * Result 单元测试
 * 测试结果格式化工具
 */
const Result = require('../../../core/Result')

describe('Result', () => {
  describe('success', () => {
    test('应该正确格式化对象数据', () => {
      const data = { id: 123, name: 'test' }
      const result = Result.success(data)

      expect(result).toEqual({
        id: 123,
        name: 'test',
        code: 200
      })
    })

    test('应该正确格式化数组数据', () => {
      const data = [1, 2, 3]
      const result = Result.success(data)

      expect(result).toEqual({
        data: [1, 2, 3],
        code: 200
      })
    })

    test('应该正确格式化原始类型数据', () => {
      expect(Result.success('text')).toEqual({ data: 'text', code: 200 })
      expect(Result.success(123)).toEqual({ data: 123, code: 200 })
      expect(Result.success(true)).toEqual({ data: true, code: 200 })
      expect(Result.success(null)).toEqual({ data: null, code: 200 })
    })

    test('code字段应该始终为200', () => {
      // 即使数据中有code字段，也应该被覆盖
      const data = { code: 500, message: 'error' }
      const result = Result.success(data)

      expect(result.code).toBe(200)
    })

    test('应该保留对象中的所有字段', () => {
      const data = {
        songs: [],
        songCount: 0,
        hasMore: false,
        code: 500 // 这个会被覆盖
      }
      const result = Result.success(data)

      expect(result).toEqual({
        songs: [],
        songCount: 0,
        hasMore: false,
        code: 200
      })
    })
  })

  describe('error', () => {
    test('应该正确格式化Error对象', () => {
      const error = new Error('Something went wrong')
      const result = Result.error(error, 500)

      expect(result).toEqual({
        code: 500,
        message: 'Something went wrong',
        data: null
      })
    })

    test('应该正确格式化字符串错误', () => {
      const result = Result.error('Invalid parameter', 400)

      expect(result).toEqual({
        code: 400,
        message: 'Invalid parameter',
        data: null
      })
    })

    test('默认状态码应该是500', () => {
      const result = Result.error('Error')

      expect(result.code).toBe(500)
    })

    test('应该处理没有message的错误对象', () => {
      const error = {}
      const result = Result.error(error, 500)

      expect(result).toEqual({
        code: 500,
        message: 'Unknown error',
        data: null
      })
    })

    test('应该处理null/undefined', () => {
      expect(Result.error(null, 500).message).toBe('Unknown error')
      expect(Result.error(undefined, 500).message).toBe('Unknown error')
    })
  })

  describe('网易云API兼容性', () => {
    test('成功响应应该兼容网易云格式', () => {
      const neteaseData = {
        songs: [{ id: 1, name: 'song1' }],
        songCount: 1
      }
      const result = Result.success(neteaseData)

      // 顶层直出，保持网易云API的格式
      expect(result.songs).toBeDefined()
      expect(result.songCount).toBeDefined()
      expect(result.code).toBe(200)
    })

    test('code字段应该始终是200', () => {
      // 网易云API可能返回code字段
      const neteaseData = { code: 404, msg: 'not found' }
      const result = Result.success(neteaseData)

      // code应该被覆盖为200
      expect(result.code).toBe(200)
      expect(result.msg).toBe('not found')
    })
  })
})

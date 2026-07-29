/**
 * 结果格式化
 *
 */
class Result {
  /**
   * 创建成功响应
   * @param {*} data - 响应数据
   * @returns {Object} 标准化成功响应
   */
  static success(data) {
    // 顶层直出：与网易云API保持一致
    // 注意：必须保证 code=200 不被 payload 中同名字段覆盖
    // - 若为对象：合并到顶层，最后写入 code:200 => { ...data, code:200 }
    // - 若为数组/原始类型：包裹到 data 字段 => { data, code:200 }
    if (data && typeof data === 'object' && !Array.isArray(data)) {
      return { ...data, code: 200 }
    }
    return { data, code: 200 }
  }

  /**
   * 创建错误响应
   * @param {Error|string} error - 错误信息
   * @param {number} code - HTTP状态码
   * @returns {Object} 标准化错误响应
   */
  static error(error, code = 500) {
    console.error('Error:', error)
    return {
      code,
      message: typeof error === 'string' ? error : (error?.message || 'Unknown error'),
      data: null
    }
  }
}

module.exports = Result

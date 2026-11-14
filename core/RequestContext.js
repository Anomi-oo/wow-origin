const { AsyncLocalStorage } = require('node:async_hooks')
const { createHash } = require('node:crypto')

const storage = new AsyncLocalStorage()

function getRequestContext() {
  return storage.getStore()
}

function formatRequestContextPrefix() {
  const context = getRequestContext()
  if (!context) return ''
  return `[account=${JSON.stringify(`${context.accountName ?? ''}[${context.accountId ?? ''}]`)}] `
}

function runWithRequestContext(context, callback) {
  return storage.run(context ? Object.freeze({ ...context }) : undefined, callback)
}

function runWithAccountContext(account, callback) {
  if (!account) return runWithRequestContext(undefined, callback)
  // SQLite 使用原有主键；无数字主键的存储使用稳定摘要，不记录访问密钥。
  const accountId = account.id ?? (account.apiAccessKey
    ? `account-${createHash('sha256').update(account.apiAccessKey).digest('hex').slice(0, 16)}`
    : undefined)
  return runWithRequestContext({ accountId, accountName: account.name, platform: account.platform }, callback)
}

module.exports = { getRequestContext, formatRequestContextPrefix, runWithRequestContext, runWithAccountContext }

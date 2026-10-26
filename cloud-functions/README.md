# EdgeOne Makers 云函数目录

EdgeOne Makers CLI 在生成构建计划时，会先检查 `cloud-functions/` 目录是否存在且非空，
再决定是否为项目打包 Node 运行时云函数。这个检查发生在 `buildCommand` 执行之前，
所以目录必须真实存在于 Git 检出结果中，不能只靠构建命令临时生成。

因此本目录在仓库里保留这个说明文件作为占位，真正的函数产物由构建命令生成：

```bash
npm run edgeone:build   # 生成 cloud-functions/[[default]].js
```

`[[default]].js` 是 `edgeone/entry.ts` 打包后的产物（体积较大，不纳入版本管理）。
它由 Makers CLI 在构建阶段再次打包成云函数，路由为 `/` 与 `/:default*`，
对应 Express 应用的全部接口（含 `/login` 登录页与 `/v1/*` Wow 接口）。

线上函数运行时没有 `node_modules`，因此 `express` 等依赖必须整包打进产物；
产物里不能残留 `require('express')` 之类的运行时依赖，否则请求会返回 500。

删除本文件会导致平台把项目识别成纯静态站点，线上接口全部返回 404。

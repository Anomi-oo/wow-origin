const fs = require('node:fs')
const path = require('node:path')

describe('upstream sync workflow', () => {
  test('只允许手动同步独立部署仓库，并触发 Cloudflare 重新部署', () => {
    const workflow = fs.readFileSync(
      path.join(process.cwd(), '.github', 'workflows', 'sync-upstream.yml'),
      'utf8'
    )

    expect(workflow).toContain('workflow_dispatch:')
    expect(workflow).not.toContain('schedule:')
    expect(workflow).toContain("if: github.repository != 'Anomi-oo/wow-origin'")
    expect(workflow).toContain('contents: write')
    expect(workflow).toContain('https://github.com/Anomi-oo/wow-origin.git')
    expect(workflow).toContain('git read-tree --reset -u FETCH_HEAD')
    expect(workflow).toContain('git push origin "HEAD:$DESTINATION_BRANCH"')
    expect(workflow).not.toMatch(/\[(?:skip ci|ci skip|no ci|skip actions|actions skip)\]/i)

    const mainWorkflow = fs.readFileSync(
      path.join(process.cwd(), '.github', 'workflows', 'ci.yml'),
      'utf8'
    )
    const rewriteWorkflow = fs.readFileSync(
      path.join(process.cwd(), '.github', 'workflows', 'rewrite.yml'),
      'utf8'
    )
    expect(mainWorkflow).toContain("if: github.repository == 'Anomi-oo/wow-origin'")
    expect(rewriteWorkflow).toContain("if: github.repository == 'Anomi-oo/wow-origin'")
  })
})

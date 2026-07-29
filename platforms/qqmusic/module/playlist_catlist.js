// 全部歌单分类
// 保留QQ音乐原始分组，不强制映射到网易云category ID

module.exports = async (_query, request) => {
  const response = await request("music.playlist.PlaylistSquare", "GetAllTag", {qq: ""}, {
    uin: 0,
    qm_keyst: ''
  })

  // QQ音乐返回 { status, body: { v_group: [...] } }
  if (!response || !response.body || !response.body.v_group) {
    return {
      code: 200,
      all: { name: "全部歌单" },
      sub: [],
      categories: {}
    }
  }

  // 构建分类映射 - 使用QQ音乐原始的group_id作为key
  const categories = {}
  const allItems = []
  const vGroups = response.body.v_group

  vGroups.forEach(group => {
    const groupId = group.group_id
    const groupName = group.group_name

    // 使用group_id作为category的key
    categories[groupId] = groupName

    // 转换分组内的项目
    if (group.v_item && Array.isArray(group.v_item)) {
      group.v_item.forEach(item => {
        // 过滤掉AI歌单分类
        if (item.name === 'AI歌单') {
          return
        }

        allItems.push({
          name: item.name,
          resourceCount: 1000,
          imgId: 0,
          imgUrl: null,
          type: 0,
          category: groupId,  // 使用QQ音乐原始的group_id
          resourceType: 0,
          hot: groupName === "热门",
          activity: false,
          qqmusicId: item.id
        })
      })
    }
  })

  // 返回统一格式
  return {
    code: response.status || 200,
    all: {
      name: "全部歌单",
      resourceCount: 1000,
      imgId: 0,
      imgUrl: null,
      type: 0,
      category: 0,
      resourceType: 0,
      hot: false,
      activity: false
    },
    sub: allItems,
    categories: categories  // key是QQ音乐的group_id，value是group_name
  }
}
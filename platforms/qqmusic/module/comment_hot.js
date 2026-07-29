// QQ音乐热门评论

module.exports = async (query, request) => {
  // 验证必需参数
  if (!query.id) {
    throw new Error('Missing required parameter: id')
  }

  // 资源类型映射 (BizType)
  // 1: 歌曲, 2: 专辑, 3: 歌单, 5: MV
  const typeMap = {
    '0': 1,      // 歌曲
    '1': 5,      // MV
    '2': 3,      // 歌单
    '3': 2,      // 专辑
    '4': 17,     // 电台
    'song': 1,
    'mv': 5,
    'playlist': 3,
    'album': 2,
    'dj': 17
  }

  const bizType = typeMap[query.type] !== undefined ? typeMap[query.type] : 3
  const PageSize = parseInt(query.limit) || parseInt(query.pageSize) || 20
  const PageNum = Math.floor(parseInt(query.offset) / PageSize) || parseInt(query.pageNo) - 1 || 0
  const LastCommentSeqNo = query.cursor === 'undefined' ? '' : query.cursor || ''

  // 歌曲和专辑使用数字 ID，不需要转换
  const bizId = String(query.id)

  const data = {
    BizType: bizType,
    BizId: bizId,
    LastCommentSeqNo: LastCommentSeqNo,
    PageSize: PageSize,
    PageNum: PageNum,
    HotType: 1, 
    WithAirborne: 0,
    PicEnable: 1
  }

  return request(
    'music.globalComment.CommentRead',
    'GetHotCommentList',
    data,
    {
      uin: query.uin || 0,
      qm_keyst: query.qm_keyst || ''
    }
  ).then(response => {
    return formatHotCommentList(response.body)
  })
}

/**
 * 格式化单条评论
 */
function formatComment(comment) {
  return {
    user: {
      userId: comment.EncryptUin || '',
      nickname: comment.Nick || '',
      avatarUrl: comment.Avatar || '',
      authStatus: 0,
      vipType: comment.VipIcon ? 11 : 0,
      userType: 0
    },
    beReplied: (comment.RepliedComments || []).map(replied => ({
      user: {
        userId: replied.EncryptUin || '',
        nickname: replied.Nick || '',
        avatarUrl: replied.Avatar || '',
        vipType: 0
      },
      beRepliedCommentId: replied.CmId || '',
      content: replied.Content || '',
      status: 0
    })),
    commentId: comment.CmId || 0,
    content: comment.Content || '',
    richContent: comment.Content || '',
    time: comment.PubTime * 1000,
    timeStr: formatTimeStr(comment.PubTime),
    needDisplayTime: true,
    likedCount: comment.PraiseNum || 0,
    replyCount: comment.ReplyCnt || 0,
    liked: comment.IsPraised === 1,
    status: comment.State || 0,
    commentLocationType: 0
  }
}

/**
 * 格式化热门评论列表（按网易云标准格式）
 */
function formatHotCommentList(data) {
  if (!data) {
    return {
      code: 200,
      data: {
        comments: [],
        totalCount: 0,
        hasMore: false,
        cursor: ''
      }
    }
  }

  const comments = data.CommentList?.Comments || []
  const LastCommentSeqNo = String(comments.at(-1)?.SeqNo || '')
  const hotComments = comments.map(formatComment)

  return {
    code: 200,
    data: {
      comments: hotComments,
      totalCount: data.CommentList?.Total || 0,
      hasMore: data.CommentList?.HasMore || false,
      cursor: LastCommentSeqNo
    }
  }
}

/**
 * 格式化时间戳为字符串
 */
function formatTimeStr(timestamp) {
  if (!timestamp) return ''
  
  const date = new Date(timestamp * 1000)
  const now = new Date()
  const diff = Math.floor((now - date) / 1000)

  if (diff < 60) {
    return '刚刚'
  } else if (diff < 3600) {
    return `${Math.floor(diff / 60)}分钟前`
  } else if (diff < 86400) {
    return `${Math.floor(diff / 3600)}小时前`
  } else if (diff < 2592000) {
    return `${Math.floor(diff / 86400)}天前`
  } else {
    const year = date.getFullYear()
    const month = String(date.getMonth() + 1).padStart(2, '0')
    const day = String(date.getDate()).padStart(2, '0')
    return `${year}-${month}-${day}`
  }
}

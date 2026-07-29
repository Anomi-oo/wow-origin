//关注歌手

module.exports = (query, request) => {
  const type = query.t == 1 ? 0 : 1
  if(!query.uin || !query.qm_keyst){
    throw new Error("need uin and qm_keyst")
  } else if(!query.id){
    throw new Error("need id")
  }

  const data = {
    "opertype": type,   //0关注 1取消关注
    "source": 0,
    "userinfo": {
      "usertype": 1,
      "userid": query.id
    },
    "encrypt_singerid": 1
  }

  return request("Concern.ConcernSystemServer", "cgi_concern_user_v2", data, {
    uin: query.uin,
    qm_keyst: query.qm_keyst
  }) 
}
// 对歌单添加歌曲
// listid, 歌单listid
module.exports = (params, useAxios) => {
  const userid = params?.userid || params?.cookie?.userid || 0;
  const token = params?.token || params.cookie?.token || '';
  const clienttime = Math.floor(Date.now() / 1000);

  const entries = Array.isArray(params.data) ? params.data : (params.data || '').split(',');
  const resource = entries.map((s) => {
    if (s && typeof s === 'object') return {
      number: 1, name: String(s.name || ''), hash: String(s.hash || ''), size: 0, sort: 0, timelen: 0, bitrate: 0,
      album_id: Number(s.album_id || 0), mixsongid: Number(s.mixsongid || 0)
    };
    const data = s.split('|');
    return {
      number: 1,
      name: data[0] || '',
      hash: data[1] || '',
      size: 0,
      sort: 0,
      timelen: 0,
      bitrate: 0,
      album_id: Number(data[2] || 0),
      mixsongid: Number(data[3] || 0),
    };
  });

  const dataMap = {
    userid,
    token,
    listid: params.listid,
    list_ver: 0,
    type: 0,
    slow_upload: 1,
    scene: 'false;null',
    data: resource,
  };

  return useAxios({
    url: '/cloudlist.service/v6/add_song',
    data: dataMap,
    params: { last_time: clienttime, last_area: 'gztx', userid, token },
    method: 'post',
    encryptType: 'android',
    cookie: params?.cookie || {},
  });
};

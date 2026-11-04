// 手机验证码发送
module.exports = (params, useAxios) => {
  const dataMap = {
    businessid: 5,
    mobile: `${params?.mobile}`,
    plat: 3,
  };

  return useAxios({
    baseURL: 'https://loginserviceretry.kugou.com',
    url: '/v7/send_mobile_code',
    method: 'POST',
    data: dataMap,
    encryptType: 'android',
    cookie: params?.cookie || {},
  });
};

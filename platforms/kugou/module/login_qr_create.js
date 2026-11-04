const qrcode = require('qrcode');

// SVG works in both Node and Workers without native PNG/zlib streams.
module.exports = async (params) => {
  const url = `https://h5.kugou.com/apps/loginQRCode/html/index.html?qrcode=${encodeURIComponent(params.key)}`;
  const svg = params.qrimg ? await qrcode.toString(url, { type: 'svg', margin: 1 }) : '';
  return {
    status: 200,
    body: { code: 200, data: { url, base64: svg ? `data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}` : '' } }
  };
};

function getCookie(rawCookie, name) {
  if (!rawCookie || !name) return null;
  const cookie = rawCookie.split(';').map(item => item.trim()).find(item => item.startsWith(name + '='))
  return cookie ? cookie.split('=')[1] : null
}


module.exports = {
  getCookie
}
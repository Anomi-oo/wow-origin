/** 只有返回艺人或专辑收藏状态的路由才需要加载账号的收藏 ID。 */
export function collectionStatusNeeded(path: string): { artists: boolean; albums: boolean } {
  return {
    artists: ['/artist/top', '/artist/list', '/artist/detail', '/album/detail', '/search/suggest', '/search/artists'].includes(path),
    albums: ['/artist/albums', '/album/detail', '/search/suggest', '/search/albums'].includes(path)
  };
}

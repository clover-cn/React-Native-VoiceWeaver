/**
 * VoiceWeaver 全局静态图像与图标资源中心
 * 后续新增的图标或图片资源，建议统一存放在 `src/assets/icons/` 或 `src/assets/images/`，
 * 并在本文件中统一登记导出，便于跨页面复用和统一维护。
 */

export const AppImages = {
  // 文章和小说缺少封面时使用的默认图片
  defaultCover: require('./icons/defCvrImg.png'),
  // 播放按钮图标
  play: require('./icons/play.png'),
  setting: require('./icons/setting.png'),
  imp: require('./icons/imp.png'),
  refresh: require('./icons/refresh_icon.png'),
  back: require('./icons/back_icon.png'),
  delete: require('./icons/delete_icon.png'),
  logo: require('./icons/logo.png'),
  searchIcon: require('./icons/search_icon.png'),
  refreshWhiteIcon: require('./icons/refresh_white_icon.png'),
  menuIcon: require('./icons/menu_icon.png'),
  // 首页顶部视觉横幅背景图
  homeBanner: require('./Image/index_banner.png'),
  // 从横幅底部延伸到书架背景的暖粉渐变
  homeBannerFade: require('./Image/index_banner_fade.png'),
};

export default AppImages;

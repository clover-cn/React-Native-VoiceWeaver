export class UserInfo {
  userId = -1
  userName = ""
  userPhone = ""
  userAvatar = ""
}

export class GlobalData {
  /**
   * 我的积分
   */
  static TAG_POINT = 0;
  static userInfo: UserInfo = new UserInfo()
  static myPoint: number = 2457
}
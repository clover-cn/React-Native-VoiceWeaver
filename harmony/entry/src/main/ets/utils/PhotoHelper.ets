import { photoAccessHelper } from '@kit.MediaLibraryKit'

const TAG = 'ICSS_DSL_PH'

export class PhotoHelper {
  constructor() {
  }

  private static isPhotoAccessHelperEnable() {
    if ('SystemCapability.FileManagement.PhotoAccessHelper.Core') {
      return true
    }
    return false
  }

  static async select(options?: photoAccessHelper.PhotoSelectOptions): Promise<Array<string>> {
    if (!PhotoHelper.isPhotoAccessHelperEnable()) {
      return []
    }
    if (options === undefined) {
      options = new photoAccessHelper.PhotoSelectOptions()
      options.MIMEType = photoAccessHelper.PhotoViewMIMETypes.IMAGE_TYPE //可选择的媒体文件类型，若无此参数，则默认为图片和视频类型。
      options.maxSelectNumber = options.maxSelectNumber //选择媒体文件数量的最大值,默认9
      options.isPhotoTakingSupported = true //支持拍照。
      options.isEditSupported = true //支持编辑照片。
      options.isOriginalSupported = true //显示选择原图按钮。
    }
    const photoPicker = new photoAccessHelper.PhotoViewPicker()
    let photoSelectResult: photoAccessHelper.PhotoSelectResult = await photoPicker.select(options)
    if (photoSelectResult && photoSelectResult.photoUris && photoSelectResult.photoUris.length > 0) {
      return photoSelectResult.photoUris
    } else {
      return []
    }
  }
}
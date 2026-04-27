import { photoAccessHelper } from '@kit.MediaLibraryKit';
import { fileIo as fs, fileUri } from '@kit.CoreFileKit';
import { Logger } from './Logger';

const TAG = 'ImageUtils'

export class ImageUtils {
  static async saveImageToAlbum(context: Context, filePath: string, callback: (res: boolean, saveUri: string) => void) {
    Logger.info(TAG, 'saveImageToAlbum ' + filePath)
    const validUri = fileUri.getUriFromPath(filePath);

    let phAccessHelper = photoAccessHelper.getPhotoAccessHelper(context);
    let srcFileUris: Array<string> = [validUri];
    // 指定待保存照片的创建选项，包括文件后缀和照片类型，标题和照片子类型可选
    let photoCreationConfigs: Array<photoAccessHelper.PhotoCreationConfig> = [{
      fileNameExtension: 'png',
      photoType: photoAccessHelper.PhotoType.IMAGE,
    }];
    // 基于弹窗授权的方式获取媒体库的目标uri
    phAccessHelper.showAssetsCreationDialog(srcFileUris, photoCreationConfigs).then(async (desFileUris) => {
      // 将来源于应用沙箱的照片内容写入媒体库的目标uri
      let desFile: fs.File = await fs.open(desFileUris[0], fs.OpenMode.WRITE_ONLY);
      let srcFile: fs.File = await fs.open(filePath, fs.OpenMode.READ_ONLY);
      await fs.copyFile(srcFile.fd, desFile.fd);
      fs.closeSync(srcFile);
      fs.closeSync(desFile);
      callback(true, desFileUris[0])
    }).catch((err: object) => {
    })
  }
}
import { Logger } from '../utils/Logger'

class RNQrCodeProps {
  value: string = ''
  color = '#000'
  backgroundColor = '#fff'
  contentOpacity = 1
}

const TAG = 'RNQrCode'

@Component
export struct RNQrCode {
  static NAME: string = 'RnFabricView'
  @Prop nativeIndex: number
  @Prop tag: number = 0
  @Prop src: string = 'RNLoadingProgress in native'
  @Prop nativeViewName: string = ''
  @State parmProps: RNQrCodeProps = new RNQrCodeProps()

  aboutToAppear(): void {
    Logger.info(TAG, 'RNSwiperPicture aboutToAppear  : ' + this.src)
    this.parmProps = JSON.parse(this.src) as RNQrCodeProps
  }

  build() {
    QRCode(this.parmProps.value)
      .width(64)
      .height(64)
      .color(this.parmProps.color)
      .backgroundColor(this.parmProps.backgroundColor)
      .opacity(this.parmProps.contentOpacity)
  }
}
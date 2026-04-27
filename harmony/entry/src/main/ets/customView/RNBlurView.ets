import { RNOHContext } from '@rnoh/react-native-openharmony'
import { Logger } from '../utils/Logger'

class RNBlurViewProps {
  tag: string = 'RNBlurViewProps'
  bgColor = '#66000000'
}

const TAG = 'RNBlurView'

@Component
export struct RNBlurView {
  static NAME: string = 'RnFabricView'
  ctx?: RNOHContext
  @Prop nativeIndex: number
  @Prop tag: number = 0
  @Prop src: string = 'RNLoadingProgress in native'
  @Prop nativeViewName: string = ''
  @State parmProps: RNBlurViewProps = new RNBlurViewProps()

  aboutToAppear(): void {
    Logger.info(TAG, 'RNBlurView aboutToAppear  : ' + this.src)
    this.parmProps = JSON.parse(this.src) as RNBlurViewProps
  }

  build() {
    Column()
      .width('100%')
      .height('100%')
      .backgroundColor(this.parmProps.bgColor) // 背景透明
      .backgroundBlurStyle(BlurStyle.BACKGROUND_REGULAR) // 背景高斯模糊
  }
}
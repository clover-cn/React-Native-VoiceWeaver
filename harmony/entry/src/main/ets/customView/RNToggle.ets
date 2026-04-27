import { RNOHContext } from '@rnoh/react-native-openharmony'
import { Logger } from '../utils/Logger'

class RNToggleProps {
  tag: string = 'RNToggleProps'
  selectedColor = '#fff'
  switchPointColor = '#fff'
  isOn = false
}

const TAG = 'RNToggle'

@Component
export struct RNToggle {
  static NAME: string = 'RnFabricView'
  ctx?: RNOHContext
  @Prop nativeIndex: number
  @Prop tag: number = 0
  @Prop src: string = 'RNLoadingProgress in native'
  @Prop nativeViewName: string = ''
  @State parmProps: RNToggleProps = new RNToggleProps()

  aboutToAppear(): void {
    Logger.info(TAG, 'RNToggle aboutToAppear  : ' + this.src)
    this.parmProps = JSON.parse(this.src) as RNToggleProps
  }

  build() {
    Toggle({ type: ToggleType.Switch, isOn: this.parmProps.isOn })
      .selectedColor(this.parmProps.selectedColor)
      .switchPointColor(this.parmProps.switchPointColor)
      .onChange((isOn: boolean) => {
        this.ctx?.rnInstance.emitComponentEvent(
          this.tag, 'onReceiveData', {
          rnValue: JSON.stringify({
            tag: this.parmProps.tag,
            isOn: isOn
          })
        })
      })
      .width('100%')
      .height('100%')
  }
}
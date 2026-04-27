import { Logger } from '../utils/Logger'

class LoadingProgressProps {
  color: string = '#ff666666'
}

const TAG = 'RNLoadingProgress'

@Component
export struct RNLoadingProgress {
  static NAME: string = 'RnFabricView'
  @Prop nativeIndex: number
  @Prop tag: number = 0
  @Prop src: string = 'RNLoadingProgress in native'
  @Prop nativeViewName: string = ''
  @State loadingProgressProps: LoadingProgressProps = new LoadingProgressProps()

  aboutToAppear(): void {
    Logger.info(TAG,'ab : ' + this.src)
    this.loadingProgressProps = JSON.parse(this.src) as LoadingProgressProps
  }

  build() {
    LoadingProgress().color(this.loadingProgressProps.color)
  }
}
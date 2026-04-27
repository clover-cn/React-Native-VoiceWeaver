import { Descriptor, ViewBaseProps } from '@rnoh/react-native-openharmony';
import { RNOHContext, RNViewBase } from '@rnoh/react-native-openharmony'
import { JSON } from '@kit.ArkTS';
import { RNLoadingProgress } from './RNLoadingProgress';
import { RNSwiperPicture } from './RNSwiperPicture';
import { RNQrCode } from './RNQrCode';
import { Logger } from '../utils/Logger';
import { RNToggle } from './RNToggle';
import { RNBlurView } from './RNBlurView';

export interface RnFabricViewProps extends ViewBaseProps {
  nativeViewName: string
  src: string
}

export type RnFabricViewDescriptor = Descriptor<'RnFabricView', RnFabricViewProps>;

const TAG = 'RnFabricView'

@Component
export struct RnFabricView {
  static NAME: string = 'RnFabricView'
  ctx?: RNOHContext
  @State nativeIndex: number = 0;
  tag: number = 0
  private unregisterDescriptorChangesListener?: () => void = undefined
  @State private descriptor: RnFabricViewDescriptor = {} as RnFabricViewDescriptor
  @State src: string = 'RnFabricView in native' // 和props里的src绑定
  @State nativeViewName: string = '' // 和props里的nativeViewName绑定
  /**
   * 是否正在初始化
   */
  private isInit = false

  private init() {
    this.isInit = true;
    try {
      // Logger.info(TAG, 'RnFabricView rawProps = ' + JSON.stringify(this.descriptor.rawProps) + this.tag)
      Logger.info(TAG, 'RnFabricView props = ' + JSON.stringify(this.descriptor.props) + this.tag)
      this.src = (this.descriptor.rawProps as RnFabricViewProps).src
      try {
        this.nativeViewName = (JSON.parse(this.src) as RnFabricViewProps).nativeViewName
      } catch (e) {
        this.nativeViewName = ''
        Logger.info(TAG, e)
      }
    } finally {
      this.isInit = false
    }
  }

  aboutToAppear() {
    if (this.ctx) {
      this.descriptor = this.ctx.descriptorRegistry.getDescriptor<RnFabricViewDescriptor>(this.tag)
      this.unregisterDescriptorChangesListener =
        this.ctx.descriptorRegistry.subscribeToDescriptorChanges(this.tag, (newDescriptor) => {
          if (this.isInit) {
            Logger.info('RnFabricView aboutToAppear', 'isInit now');
            return
          }
          this.descriptor = (newDescriptor as RnFabricViewDescriptor)
        })
    }
    this.init();
  }

  aboutToDisappear() {
    this.unregisterDescriptorChangesListener?.()
  }

  build() {
    RNViewBase({ ctx: this.ctx, tag: this.tag }) {
      if (this.nativeViewName === 'LoadingProgress') {
        RNLoadingProgress({
          nativeIndex: this.nativeIndex,
          tag: this.tag,
          src: this.src,
          nativeViewName: this.nativeViewName,
        })
      } else if (this.nativeViewName === 'SwiperPicture') {
        RNSwiperPicture({
          nativeIndex: this.nativeIndex,
          tag: this.tag,
          src: this.src,
          nativeViewName: this.nativeViewName,
        }).width('100%').height('100%')
      } else if (this.nativeViewName === 'RNQrCode') {
        RNQrCode({
          nativeIndex: this.nativeIndex,
          tag: this.tag,
          src: this.src,
          nativeViewName: this.nativeViewName,
        }).width('100%').height('100%')
      } else if (this.nativeViewName === 'RNToggle') {
        RNToggle({
          nativeIndex: this.nativeIndex,
          tag: this.tag,
          src: this.src,
          nativeViewName: this.nativeViewName,
          ctx: this.ctx
        }).width('100%').height('100%')
      } else if (this.nativeViewName === 'RNBlurView') {
        RNBlurView({
          nativeIndex: this.nativeIndex,
          tag: this.tag,
          src: this.src,
          nativeViewName: this.nativeViewName,
          ctx: this.ctx
        }).width('100%').height('100%')
      } else {
        Text('nativeViewName : ' + this.nativeViewName).width(100).height(100)
          .backgroundColor(Color.Red)
      }
    }
  }
}

import { Logger } from '../utils/Logger'

class RNSwiperPictureProps {
  pics: string[] = []
  aspectRatio: number = 1
  autoPlay: boolean = true
}

const TAG = 'RNSwiperPicture'

@Component
export struct RNSwiperPicture {
  static NAME: string = 'RnFabricView'
  @Prop nativeIndex: number
  @Prop tag: number = 0
  @Prop src: string = 'RNLoadingProgress in native'
  @Prop nativeViewName: string = ''
  @State parmProps: RNSwiperPictureProps = new RNSwiperPictureProps()
  @State curIndex: number = 0;
  @State isVideoStop: boolean = true;
  @State isGestureSwipe: boolean = false;
  controller: VideoController = new VideoController();
  private timeoutId: number = -1;

  aboutToAppear(): void {
    Logger.info(TAG, 'RNSwiperPicture aboutToAppear  : ' + this.src)
    this.parmProps = JSON.parse(this.src) as RNSwiperPictureProps
  }

  build() {
    Swiper() {
      ForEach(this.parmProps.pics, (item: string, index: number) => {
        if (item === 'mock_homepage_banner1') {
          Stack({ alignContent: Alignment.Center }) {
            Video({
              src: $rawfile('mock_homepage_banner1.mp4'),
              controller: this.controller,
              previewUri: $r('app.media.mock_spec_green')
            })
              .constraintSize({
                maxHeight: '100%', // 设置最大高度为屏幕高度的80%
                minHeight: 200    // 设置最小高度（单位vp）
              })
              .controls(false)// 设置是否显示默认控制条
              .autoPlay(false)// 设置是否自动播放
              .loop(false)// 设置是否循环播放
              .width('100%')
              .margin({ bottom: 10 })
              .onStop(() => { // 停止事件回调
                this.isVideoStop = true
              })
              .onStart(() => {
                this.isVideoStop = false;
              })
              .onPause(() => {
                this.isVideoStop = true;
              })
              .onClick(() => {
                if (this.isVideoStop) {
                  this.isVideoStop = false
                  this.controller.start();
                } else {
                  this.isVideoStop = true
                  this.controller.pause();
                }
              })
            if (this.isVideoStop) {
              Image($r('app.media.video_image_stop'))
                .width(50)
                .height(50)
                .onClick(() => {
                  this.curIndex = index;
                  this.isVideoStop = false
                  this.controller.start();
                })
            }
          }
        } else {
          Image($r(item.startsWith('app.media.') ? item : ('app.media.' + item)))
            .width('100%')
            .height('100%')
            .aspectRatio(this.parmProps.aspectRatio ?? 1)
            .objectFit(ImageFit.Cover)
            .draggable(false);
        }
      }, (item: ResourceStr) => JSON.stringify(item));
    }
    .index(this.curIndex)
    .width('100%')
    .autoPlay(this.parmProps.autoPlay === true && this.isVideoStop && !this.isGestureSwipe ? true : false)
    .aspectRatio(this.parmProps.aspectRatio ?? 1)
    .onGestureSwipe((index: number, extraInfo: SwiperAnimationEvent) => {
      this.curIndex = index;
      this.isGestureSwipe = true;
      if (this.timeoutId !== -1) {
        clearTimeout(this.timeoutId);
      }
      this.timeoutId = setTimeout(() => {
        this.isGestureSwipe = false;
      }, 2000);
    })
    .indicatorInteractive(true)
    .indicator(
      new DotIndicator()
        .selectedItemWidth(12)
        .selectedItemHeight(6)
        .selectedColor($r('app.color.theme_color'))
        .itemWidth(6)
        .itemHeight(6)
        .color('#80ffffff'),
    );
  }
}
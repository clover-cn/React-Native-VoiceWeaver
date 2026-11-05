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
  @State isGestureSwipe: boolean = false;
  private timeoutId: number = -1;

  aboutToAppear(): void {
    Logger.info(TAG, 'RNSwiperPicture aboutToAppear  : ' + this.src)
    this.parmProps = JSON.parse(this.src) as RNSwiperPictureProps
  }

  build() {
    Swiper() {
      ForEach(this.parmProps.pics, (item: string) => {
        Image($r(item.startsWith('app.media.') ? item : ('app.media.' + item)))
          .width('100%')
          .height('100%')
          .aspectRatio(this.parmProps.aspectRatio ?? 1)
          .objectFit(ImageFit.Cover)
          .draggable(false);
      }, (item: ResourceStr) => JSON.stringify(item));
    }
    .index(this.curIndex)
    .width('100%')
    .autoPlay(this.parmProps.autoPlay === true && !this.isGestureSwipe)
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

import bridge from './bridge';

export const BottomReactHeight: number = Number.parseInt(
  String(bridge.getOhASData('bottomRectHeight', 20)),
);

export const TopReactHeight: number = Number.parseInt(
  String(bridge.getOhASData('topRectHeight', 30)),
);

export const DELIVERY_TYPE_EXPRESS = 'express'; // express:快递发货

export const EXPRESS_TITLE = '快递发货';
export const PICKUP_TITLE = '到店自提';

export const BACKGROUND_COLOR = '#F1F3F5';
export const THEME_COLOR = '#E84026';
export const BACK_BUTTON_COLOR = '#0000000A';

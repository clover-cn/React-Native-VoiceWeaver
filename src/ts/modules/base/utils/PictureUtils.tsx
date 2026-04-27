export class PictureUtils {
  static getIcon(icon: string) {
    let res = require('../../../rawfile/dev/media/icon/edit.svg');
    if (icon.indexOf('edit') >= 0) {
      res = require('../../../rawfile/dev/media/icon/edit.svg');
    } else if (icon.indexOf('ic_address') >= 0) {
      res = require('../../../rawfile/dev/media/icon/ic_address.svg');
    } else if (icon.indexOf('ic_minus') >= 0) {
      res = require('../../../rawfile/dev/media/icon/ic_minus.svg');
    } else if (icon.indexOf('ic_order_pending_payment') >= 0) {
      res = require('../../../rawfile/dev/media/icon/ic_order_pending_payment.svg');
    } else if (icon.indexOf('ic_order_pending_receipt') >= 0) {
      res = require('../../../rawfile/dev/media/icon/ic_order_pending_receipt.svg');
    } else if (icon.indexOf('ic_order_pending_review') >= 0) {
      res = require('../../../rawfile/dev/media/icon/ic_order_pending_review.svg');
    } else if (icon.indexOf('ic_order_pending_shipment') >= 0) {
      res = require('../../../rawfile/dev/media/icon/ic_order_pending_shipment.svg');
    } else if (icon.indexOf('ic_order_refund_after_sale') >= 0) {
      res = require('../../../rawfile/dev/media/icon/ic_order_refund_after_sale.svg');
    } else if (icon.indexOf('ic_plus') >= 0) {
      res = require('../../../rawfile/dev/media/icon/ic_plus.svg');
    } else if (icon.indexOf('ic_search') >= 0) {
      res = require('../../../rawfile/dev/media/icon/ic_search.svg');
    } else if (icon.indexOf('ic_share') >= 0) {
      res = require('../../../rawfile/dev/media/icon/ic_share.png');
    } else if (icon.indexOf('ic_tab_inactive_cart') >= 0) {
      res = require('../../../rawfile/dev/media/icon/ic_tab_inactive_cart.svg');
    } else if (icon.indexOf('ic_x_mark') >= 0) {
      res = require('../../../rawfile/dev/media/icon/ic_x_mark.svg');
    } else if (icon.indexOf('ic_box') >= 0) {
      res = require('../../../rawfile/dev/media/icon/ic_box.svg');
    } else if (icon.indexOf('ic_car') >= 0) {
      res = require('../../../rawfile/dev/media/icon/ic_car.svg');
    } else if (icon.indexOf('ic_heart') >= 0) {
      res = require('../../../rawfile/dev/media/icon/ic_heart.svg');
    } else if (icon.indexOf('ic_truck') >= 0) {
      res = require('../../../rawfile/dev/media/icon/ic_truck.svg');
    } else if (icon.indexOf('ic_close') >= 0) {
      res = require('../../../rawfile/dev/media/icon/ic_close.svg');
    } else if (icon.indexOf('ic_left_arrow_white') >= 0) {
      res = require('../../../rawfile/dev/media/icon/ic_left_arrow_white.svg');
    }
    return res;
  }
}

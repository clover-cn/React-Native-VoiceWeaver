import { hilog } from '@kit.PerformanceAnalysisKit';

export class Logger {
  private static IAP_DEMO_PREFIX: string = 'dsl';

  private static IAP_LOG_DOMIN = 0x0fff;

  public static isDebug = true

  // 日志格式：TAG message
  private static TWO_PLACEHOLDER_FORMAT: string = '%{public}s    %{public}s';

  public static info(tag: string, log: string) {
    Logger.isDebug && hilog.info(Logger.IAP_LOG_DOMIN, Logger.IAP_DEMO_PREFIX, Logger.TWO_PLACEHOLDER_FORMAT, tag, log);
  }

  public static debug(tag: string, log: string) {
    Logger.isDebug && hilog.debug(Logger.IAP_LOG_DOMIN, Logger.IAP_DEMO_PREFIX, Logger.TWO_PLACEHOLDER_FORMAT, tag, log);
  }

  public static warn(tag: string, log: string) {
    Logger.isDebug && hilog.warn(Logger.IAP_LOG_DOMIN, Logger.IAP_DEMO_PREFIX, Logger.TWO_PLACEHOLDER_FORMAT, tag, log);
  }

  public static error(tag: string, log: string) {
    Logger.isDebug && hilog.error(Logger.IAP_LOG_DOMIN, Logger.IAP_DEMO_PREFIX, Logger.TWO_PLACEHOLDER_FORMAT, tag, log);
  }

  public static hideLog() {
    Logger.isDebug = false
  }
}

export class HttpUtils {
  /**
   * 模拟网络请求
   * @param data
   * @param delay
   */
  static _simulateDelay<T>(data: T, delay: number = 500): Promise<T> {
    return new Promise<T>(resolve => {
      setTimeout(() => {
        resolve(data);
      }, delay);
    });
  }
}

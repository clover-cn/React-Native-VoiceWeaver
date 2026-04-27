import {
  ActivityIndicator,
  Image,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import bridge from './bridge';
import React from 'react';
import RnFabricView from '../../../widget/RnFabricView';
import { BACK_BUTTON_COLOR, THEME_COLOR } from './Constant';
import { showModal } from './ModalUtils';
import { ProductServiceItem } from '../pages/detail/data/DetailBean';
import { ProductCardItem } from '../pages/search/data/mockData/MockData';
import { WindowInfo } from './WindowInfo';

export function deepClone<T>(source: T): T {
  // 处理null/undefined
  if (source === null || source === undefined) {
    return source;
  }

  // 处理基础类型（直接返回，无需克隆）
  if (typeof source !== 'object') {
    return source;
  }

  // 处理Date类型
  if (source instanceof Date) {
    return new Date(source.getTime()) as unknown as T;
  }

  // 处理Map类型：创建新Map，递归克隆键和值
  if (source instanceof Map) {
    const newMap = new Map();
    // 遍历原Map的键值对，分别克隆键和值
    source.forEach((value, key) => {
      newMap.set(deepClone(key), deepClone(value));
    });
    return newMap as unknown as T;
  }

  // 处理Set类型（可选，按需添加）
  if (source instanceof Set) {
    const newSet = new Set();
    source.forEach(item => {
      newSet.add(deepClone(item));
    });
    return newSet as unknown as T;
  }

  // 处理数组：递归克隆每个元素
  if (Array.isArray(source)) {
    return source.map(item => deepClone(item)) as unknown as T;
  }

  // 处理普通对象：递归克隆每个属性
  if (Object.prototype.toString.call(source) === '[object Object]') {
    const newObj: Record<string, any> = {};
    Object.keys(source).forEach(key => {
      newObj[key] = deepClone((source as Record<string, any>)[key]);
    });
    return newObj as T;
  }

  // 其他不支持的类型（如函数、类实例等）直接返回引用（按需扩展）
  return source;
}


export function generateRandomUUID() {
  // 生成16位随机字节（用Math.random()模拟，非加密级，适合一般业务）
  const randomBytes = new Uint8Array(16);
  for (let i = 0; i < 16; i++) {
    randomBytes[i] = Math.floor(Math.random() * 256);
  }

  // 按UUID v4标准修改特定字节
  randomBytes[6] = (randomBytes[6] & 0x0f) | 0x40; // 版本号：第7字节前4位设为0100（v4）
  randomBytes[8] = (randomBytes[8] & 0x3f) | 0x80; // 变体号：第9字节前2位设为10（RFC 4122标准）

  // 转换为十六进制字符串，并按格式拼接
  const hexStr = Array.from(randomBytes, byte =>
    byte.toString(16).padStart(2, '0'),
  ).join('');
  return [
    hexStr.slice(0, 8),
    hexStr.slice(8, 12),
    hexStr.slice(12, 16),
    hexStr.slice(16, 20),
    hexStr.slice(20, 32),
  ].join('-');
}

export function formatTime(timestamp: number): string {
  const absoluteTimestamp = Math.abs(timestamp);

  // 计算小时、分钟和秒
  const hours = Math.floor(absoluteTimestamp / 3600);
  const minutes = Math.floor((absoluteTimestamp % 3600) / 60);
  const seconds = Math.floor(absoluteTimestamp % 60);

  // 格式化为两位数
  const formattedHours = hours.toString().padStart(2, '0');
  const formattedMinutes = minutes.toString().padStart(2, '0');
  const formattedSeconds = seconds.toString().padStart(2, '0');

  // 处理负数情况
  if (timestamp < 0) {
    return `--`;
  }

  return `${formattedHours}:${formattedMinutes}:${formattedSeconds}`;
}

export function formatFullDate(date: Date, type?: number): string {
  const pad = (n: number) => (n < 10 ? '0' + n : n.toString());

  const year = date.getFullYear();
  const month = pad(date.getMonth() + 1); // 月份是从0开始的，所以要加1
  const day = pad(date.getDate());
  const hours = pad(date.getHours());
  const minutes = pad(date.getMinutes());
  const seconds = pad(date.getSeconds());

  return type === 1
    ? `${year}-${month}-${day} ${hours}:${minutes}:${seconds}`
    : `${year}年${month}月${day}日 ${hours}:${minutes}`;
}

export function formatCommonDate(date: Date, tag: number = 0): string {
  const pad = (n: number) => (n < 10 ? '0' + n : n.toString());

  const year = date.getFullYear();
  const month = pad(date.getMonth() + 1); // 月份是从0开始的，所以要加1
  const day = pad(date.getDate());

  return tag !== 0 ? `${year}/${month}/${day}` : `${year}.${month}.${day}`;
}

export function unFormatDate(dateStr: string): Date {
  let diffx = '/';
  if (dateStr.includes('/')) {
    diffx = '/';
  } else if (dateStr.includes('-')) {
    diffx = '-';
  } else if (dateStr.includes('.')) {
    diffx = '.';
  }

  const year = dateStr.split(diffx)[0];
  const month = dateStr.split(diffx)[1];
  const day = dateStr.split(diffx)[2];

  const hours = dateStr.split(' ')[1].split(':')[0];
  const minus = dateStr.split(' ')[1].split(':')[1];

  let date = new Date(
    Number.parseInt(year),
    Number.parseInt(month) - 1,
    Number.parseInt(day),
    Number.parseInt(hours),
    Number.parseInt(minus),
  );
  return date;
}

export function getDateTimes(date: Date): string {
  const pad = (n: number) => (n < 10 ? '0' + n : n.toString());

  let hours = pad(date.getHours());
  let minutes = pad(date.getMinutes());

  if (hours.length === 1) {
    hours = '0' + hours;
  }

  if (minutes.length === 1) {
    minutes = '0' + minutes;
  }

  return `${hours}:${minutes}`;
}

export function formatCommonDate2(date: Date): string {
  const pad = (n: number) => (n < 10 ? '0' + n : n.toString());

  const year = date.getFullYear();
  const month = pad(date.getMonth() + 1); // 月份是从0开始的，所以要加1
  const day = pad(date.getDate());

  return `${year}年${month}月${day}日`;
}

export function withDelay<T>(
  callback: () => T | Promise<T>,
  delay = 300,
): Promise<T> {
  return new Promise((resolve, reject) => {
    setTimeout(async () => {
      try {
        const result: T = await callback();
        resolve(result);
      } catch (error) {
        reject(error);
      }
    }, delay);
  });
}

export const CommonTitle = (
  title: string,
  titleColor: string = 'black',
  children?: () => React.ReactNode,
  backEvent?: () => void,
  includeDefaultPadding: boolean = true,
) => {
  const { foldStatus } = WindowInfo();

  const getPadding = () => {
    if (!includeDefaultPadding) {
      return 0;
    } else if (foldStatus === 1) {
      return 24;
    } else {
      return 16;
    }
  };

  return (
    <View
      style={{
        width: '100%',
        height: 55,
        paddingHorizontal: getPadding(),
        flexDirection: 'row',
        justifyContent: 'center',
        alignItems: 'center',
      }}>
      <TouchableOpacity
        style={{
          width: 40,
          height: 40,
          justifyContent: 'center',
          alignItems: 'center',
          borderRadius: 20,
          backgroundColor: BACK_BUTTON_COLOR,
        }}
        onPress={() => {
          if (backEvent) {
            backEvent();
          } else {
            bridge.back('');
          }
        }}>
        {/* <Image
          source={require('../../../rawfile/dev/media/icon/ic_left_arrow.svg')}
          style={{ width: 22, height: 22 }}
        /> */}
        <Text style={{ fontSize: 18, color: '#000' }}>{'<'}</Text>
      </TouchableOpacity>
      <Text
        style={{
          fontSize: 20,
          color: titleColor,
          marginLeft: 10,
        }}>
        {title}
      </Text>
      <View
        style={{
          flex: 1,
          justifyContent: 'flex-end',
          alignItems: 'center',
          flexDirection: 'row',
        }}>
        {children?.()}
      </View>
    </View>
  );
};

export const Loading = () => (
  <View
    style={{
      flex: 1,
      alignItems: 'center',
      width: '100%',
      height: '100%',
      position: 'absolute',
      justifyContent: 'center',
    }}>
    <ActivityIndicator size="large" color="#999" animating={true} />
  </View>
);

export const BackImage = () => (
  <TouchableOpacity
    style={{
      width: 40,
      height: 40,
      justifyContent: 'center',
      alignItems: 'center',
      borderRadius: 20,
      marginRight: 16,
      backgroundColor: BACK_BUTTON_COLOR,
    }}
    onPress={() => {
      bridge.back('');
    }}>
    {/* <Image
      source={require('../../../rawfile/dev/media/icon/ic_left_arrow.svg')}
      style={{ width: 22, height: 22 }}
    /> */}
    <Text style={{ fontSize: 18, color: '#000' }}>{'<'}</Text>
  </TouchableOpacity>
);

export const DialogTitle = (
  title: string,
  showClose: boolean = true,
  onClose: () => void,
) => (
  <View
    style={{
      width: '100%',
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
    }}>
    <Text
      style={{
        fontSize: 18,
      }}>
      {title}
    </Text>
    {showClose && (
      <TouchableOpacity
        style={{
          width: 40,
          height: 40,
          justifyContent: 'center',
          alignItems: 'center',
          borderRadius: 20,
          backgroundColor: BACK_BUTTON_COLOR,
        }}
        onPress={() => {
          onClose();
        }}>
        {/* <Image
          source={require('../../../rawfile/dev/media/icon/ic_close.svg')}
          style={{ width: 18, height: 18, opacity: 0.6 }}
        /> */}
        <Text style={{ fontSize: 18, color: '#000', opacity: 0.6 }}>{'X'}</Text>
      </TouchableOpacity>
    )}
  </View>
);

export const commonListFooter = (
  loadingMore: boolean = false,
  dataList: any[],
) => (
  <View style={{ width: '100%', justifyContent: 'center', alignItems: 'center' }}>
    {loadingMore && (
      <RnFabricView
        style={{ width: 30, height: 30 }}
        src={JSON.stringify({
          nativeViewName: 'LoadingProgress',
          color: '#999999',
        })}
        onReceiveData={recvData => { }}
      />
    )}
    {!loadingMore && !!dataList && dataList.length > 0 && (
      <View
        style={{
          marginVertical: 10,
          alignItems: 'center',
          width: '100%',
          justifyContent: 'center',
        }}>
        <Text
          style={{
            fontSize: 12,
            color: '#999999',
            alignItems: 'center',
            justifyContent: 'center',
            marginBottom: 30,
          }}>
          {'已经到达底部'}
        </Text>
      </View>
    )}
  </View>
);

export const RenderCommonDialog = (
  show: boolean,
  hideFun?: () => void,
  content?: string,
  leftBtnText?: string,
  rightBtnText?: string,
  leftBtnFun?: () => void,
  rightBtnFun?: () => void,
) => (
  <View>
    {showModal(
      <View
        style={{
          flexDirection: 'column',
          backgroundColor: 'white',
          borderRadius: 32,
          alignItems: 'center',
          justifyContent: 'center',
          marginHorizontal: 16,
        }}>
        <Text
          style={{
            marginTop: 36,
            marginBottom: 22,
            fontSize: 16,
            textAlign: 'center',
            lineHeight: 22,
            includeFontPadding: true,
            marginHorizontal: 26,
          }}>
          {content}
        </Text>

        <View
          style={{
            flexDirection: 'row',
            marginHorizontal: 16,
            marginBottom: 16,
            justifyContent: 'center',
            alignItems: 'center',
          }}>
          <TouchableOpacity
            style={{
              flex: 1,
              justifyContent: 'center',
              alignItems: 'center',
              height: 40,
            }}
            onPress={leftBtnFun}>
            <Text style={{ fontSize: 16, color: '#000', opacity: 0.6 }}>
              {leftBtnText}
            </Text>
          </TouchableOpacity>
          <View style={{ width: 1, backgroundColor: '#ccc', height: 24 }} />
          <TouchableOpacity
            style={{
              flex: 1,
              justifyContent: 'center',
              alignItems: 'center',
              height: 40,
            }}
            onPress={rightBtnFun}>
            <Text style={{ fontSize: 16, color: THEME_COLOR }}>
              {rightBtnText}
            </Text>
          </TouchableOpacity>
        </View>
      </View>,
      show,
      hideFun,
    )}
  </View>
);

/**
 * 格式化聊天消息时间戳（仿微信逻辑）
 * @param timestamp 消息时间戳（毫秒级，如 Date.now()）
 * @returns 格式化后的时间字符串（如：14:35、昨天 09:20、周三 18:45、8月15日 10:30、2024年8月15日 10:30）
 */
export function formatChatTime(timestamp: number): string {
  // 目标时间对象
  const targetDate = new Date(timestamp);
  // 当前时间对象
  const now = new Date();

  // 补零工具函数（如 9 → 09，5 → 05）
  const padZero = (num: number): string => num.toString().padStart(2, '0');

  // 提取目标时间的核心字段
  const targetYear = targetDate.getFullYear();
  const targetMonth = targetDate.getMonth() + 1; // 月份从0开始，需+1
  const targetDay = targetDate.getDate();
  const targetHour = targetDate.getHours();
  const targetMinute = targetDate.getMinutes();
  const targetWeekDay = targetDate.getDay(); // 星期（0=周日，1=周一...6=周六）

  // 提取当前时间的核心字段
  const nowYear = now.getFullYear();
  const nowMonth = now.getMonth() + 1;
  const nowDay = now.getDate();

  // 1. 判断是否是「今天」：年、月、日完全一致
  const isToday =
    targetYear === nowYear && targetMonth === nowMonth && targetDay === nowDay;
  if (isToday) {
    return `${padZero(targetHour)}:${padZero(targetMinute)}`;
  }

  // 2. 判断是否是「昨天」：目标时间 = 当前时间 - 1天
  const yesterday = new Date(now);
  yesterday.setDate(nowDay - 1);
  const yesterdayYear = yesterday.getFullYear();
  const yesterdayMonth = yesterday.getMonth() + 1;
  const yesterdayDay = yesterday.getDate();
  const isYesterday =
    targetYear === yesterdayYear &&
    targetMonth === yesterdayMonth &&
    targetDay === yesterdayDay;
  if (isYesterday) {
    return `昨天 ${padZero(targetHour)}:${padZero(targetMinute)}`;
  }

  // 3. 判断是否是「本周」（微信逻辑：本周指 周一至周日，且非今天/昨天）
  // 步骤1：计算当前时间的本周起始（周一 00:00:00）
  const nowWeekDay = now.getDay();
  // 周日（0）→ 往前推6天到周一，其他星期 → 往前推 (星期-1) 天
  const mondayOffset = nowWeekDay === 0 ? -6 : -(nowWeekDay - 1);
  const weekStart = new Date(now);
  weekStart.setDate(nowDay + mondayOffset);
  weekStart.setHours(0, 0, 0, 0); // 重置为当天0点

  // 步骤2：计算当前时间的本周结束（周日 23:59:59）
  const weekEnd = new Date(weekStart);
  weekEnd.setDate(weekStart.getDate() + 6);
  weekEnd.setHours(23, 59, 59, 999); // 重置为当天23:59:59

  // 步骤3：判断目标时间是否在本周范围内
  const targetTime = targetDate.getTime();
  const isThisWeek =
    targetTime >= weekStart.getTime() && targetTime <= weekEnd.getTime();
  if (isThisWeek) {
    // 星期映射（0=周日，1=周一...6=周六）
    const weekMap = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];
    return `${weekMap[targetWeekDay]} ${padZero(targetHour)}:${padZero(
      targetMinute,
    )}`;
  }

  // 4. 非本周：判断是否跨年
  if (targetYear !== nowYear) {
    // 跨年：显示 年+月+日+时分
    return `${targetYear}年${targetMonth}月${targetDay}日 ${padZero(
      targetHour,
    )}:${padZero(targetMinute)}`;
  } else {
    // 同一年非本周：显示 月+日+时分
    return `${targetMonth}月${targetDay}日 ${padZero(targetHour)}:${padZero(
      targetMinute,
    )}`;
  }
}

export function filterProduct(
  filters: [string[], number[][], string[]],
  dataList: ProductCardItem[],
): ProductCardItem[] {
  if (!filters || (!filters?.[0] && !filters?.[1] && !filters?.[2])) {
    return dataList;
  }
  let selFilterLogistics: string[] = filters[0];
  let selFilterPrice: number[][] = filters[1];
  let selFilterSpec: string[] = filters[2];
  if (!selFilterLogistics && !selFilterPrice && !selFilterSpec) {
    return [];
  }
  const searchResListTemp = [...dataList];
  let newList = searchResListTemp.filter((item_, index) => {
    let isLogisticsMatch = !(
      selFilterLogistics && selFilterLogistics?.length > 0
    );
    if (
      !isLogisticsMatch &&
      item_.logistics?.filter(
        (item__: ProductServiceItem) =>
          selFilterLogistics?.filter(item___ =>
            item__.content.includes(item___),
          ).length > 0,
      )?.length > 0
    ) {
      isLogisticsMatch = true;
    }
    let isPriceMatch = !(selFilterPrice && selFilterPrice?.length > 0);
    selFilterPrice?.map(item => {
      if (!isPriceMatch && item_.price >= item[0] && item_.price <= item[1]) {
        isPriceMatch = true;
      }
    });
    let isSpecMatch = !(selFilterSpec && selFilterSpec?.length > 0);
    if (
      item_.specList?.filter((item: { text: string }) =>
        selFilterSpec?.includes(item.text),
      )?.length > 0
    ) {
      isSpecMatch = true;
    }
    return isLogisticsMatch && isPriceMatch && isSpecMatch;
  });
  return newList;
}

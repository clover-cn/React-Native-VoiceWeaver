import React from 'react';
import {Image, ImageProps} from 'react-native';

// 自定义图片组件，自动处理source类型
const AutoSourceImage: React.FC<
  Omit<ImageProps, 'source'> & {source: string | number}
> = ({source, ...props}) => {
  return (
    <Image
      source={typeof source !== 'string' ? source : {uri: source}}
      {...props}
    />
  );
};

export default AutoSourceImage;
